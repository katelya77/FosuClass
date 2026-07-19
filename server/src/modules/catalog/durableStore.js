const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { typedError } = require("./contracts");

function pathInside(root, candidate, allowRoot = false) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(base, resolved);
  if ((!allowRoot && !relative) || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw typedError("catalog path escaped its managed root", "CATALOG_TARGET_INVALID", 500);
  }
  return { base, resolved, relative };
}

function assertSafeExisting(candidate, kind, code = "CATALOG_TARGET_INVALID") {
  let stat;
  try { stat = fs.lstatSync(candidate); } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw typedError("catalog managed path cannot be inspected", code, 500);
  }
  if (stat.isSymbolicLink() || (kind === "directory" && !stat.isDirectory()) || (kind === "file" && !stat.isFile())) {
    throw typedError("catalog managed path is unsafe", code, 500);
  }
  return true;
}

function ensureManagedDirectory(root, directory, code = "CATALOG_TARGET_INVALID") {
  const { base, resolved, relative } = pathInside(root, directory, true);
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  assertSafeExisting(base, "directory", code);
  let cursor = base;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) {
      try { fs.mkdirSync(cursor, { recursive: false }); }
      catch (error) { if (!error || error.code !== "EEXIST") throw error; }
    }
    assertSafeExisting(cursor, "directory", code);
  }
  if (resolved !== cursor) throw typedError("catalog managed directory resolution failed", code, 500);
  return resolved;
}

function assertManagedPath(root, candidate, options = {}) {
  const { base, resolved } = pathInside(root, candidate, options.allowRoot === true);
  if (!fs.existsSync(base)) throw typedError("catalog managed root does not exist", options.code || "CATALOG_TARGET_INVALID", 500);
  assertSafeExisting(base, "directory", options.code);
  let cursor = resolved;
  while (cursor !== base) {
    if (fs.existsSync(cursor)) assertSafeExisting(cursor, cursor === resolved && options.kind === "file" ? "file" : cursor === resolved && options.kind === "directory" ? "directory" : undefined, options.code);
    cursor = path.dirname(cursor);
  }
  return resolved;
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
    return { supported: true };
  } catch (error) {
    if (process.platform === "win32" && error && ["EPERM", "EACCES", "EINVAL", "EISDIR"].includes(error.code)) {
      return { supported: false, warning: { code: "CATALOG_DIRECTORY_FSYNC_UNSUPPORTED", platform: process.platform } };
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function fsyncFile(filePath) {
  const descriptor = fs.openSync(filePath, "r+");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function contentTempPath(finalPath, bytes) {
  const digest = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 20);
  return path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${digest}.tmp`);
}

function writeFileAtomic(root, finalPath, data, options = {}) {
  const code = options.code || "CATALOG_STORAGE_FAILED";
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), options.encoding || "utf8");
  const parent = ensureManagedDirectory(root, path.dirname(finalPath), options.targetCode || "CATALOG_TARGET_INVALID");
  const resolved = assertManagedPath(root, finalPath, { code: options.targetCode || "CATALOG_TARGET_INVALID" });
  if (fs.existsSync(resolved)) assertSafeExisting(resolved, "file", options.targetCode || "CATALOG_TARGET_INVALID");
  if (options.replace === false && fs.existsSync(resolved)) {
    const error = new Error("catalog durable target already exists");
    error.code = "EEXIST";
    throw error;
  }
  const temp = assertManagedPath(root, contentTempPath(resolved, bytes), { code: options.targetCode || "CATALOG_TARGET_INVALID" });
  let stage = "prepare";
  try {
    if (fs.existsSync(temp)) {
      stage = "verify-existing-temp";
      assertSafeExisting(temp, "file", options.targetCode || "CATALOG_TARGET_INVALID");
      if (!fs.readFileSync(temp).equals(bytes)) throw typedError("catalog partial artifact does not match the intended write", "CATALOG_PARTIAL_ARTIFACT_INVALID", 500);
      fsyncFile(temp);
    } else {
      stage = "write-temp";
      const descriptor = fs.openSync(temp, "wx", options.mode || 0o600);
      try {
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
    stage = "verify-temp";
    if (!fs.readFileSync(temp).equals(bytes)) throw typedError("catalog durable write verification failed", code, 500);
    if (typeof options.verify === "function") options.verify(temp, bytes);
    stage = "rename-temp";
    fs.renameSync(temp, resolved);
    stage = "fsync-parent";
    fsyncDirectory(parent);
    return resolved;
  } catch (error) {
    if (error && error.code && String(error.code).startsWith("CATALOG_")) throw error;
    throw typedError(`catalog durable atomic write failed at ${stage}: ${error.code || error.message}`, code, 500);
  }
}

function writeFileExclusive(root, finalPath, data, options = {}) {
  const parent = ensureManagedDirectory(root, path.dirname(finalPath), options.targetCode || "CATALOG_TARGET_INVALID");
  const resolved = assertManagedPath(root, finalPath, { code: options.targetCode || "CATALOG_TARGET_INVALID" });
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), options.encoding || "utf8");
  if (fs.existsSync(resolved)) {
    const error = new Error("catalog durable target already exists");
    error.code = "EEXIST";
    throw error;
  }
  const temp = assertManagedPath(root, contentTempPath(resolved, bytes), { code: options.targetCode || "CATALOG_TARGET_INVALID" });
  if (fs.existsSync(temp)) {
    assertSafeExisting(temp, "file", options.targetCode || "CATALOG_TARGET_INVALID");
    if (!fs.readFileSync(temp).equals(bytes)) throw typedError("catalog partial exclusive artifact does not match the intended write", "CATALOG_PARTIAL_ARTIFACT_INVALID", 500);
    fsyncFile(temp);
  } else {
    const descriptor = fs.openSync(temp, "wx", options.mode || 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
  if (!fs.readFileSync(temp).equals(bytes)) throw typedError("catalog durable exclusive write verification failed", options.code || "CATALOG_STORAGE_FAILED", 500);
  fs.linkSync(temp, resolved);
  fsyncDirectory(parent);
  fs.unlinkSync(temp);
  fsyncDirectory(parent);
  return resolved;
}

function unlinkDurable(root, filePath, options = {}) {
  const resolved = assertManagedPath(root, filePath, { kind: "file", code: options.targetCode || "CATALOG_TARGET_INVALID" });
  fs.unlinkSync(resolved);
  fsyncDirectory(path.dirname(resolved));
}

function renameDirectoryDurable(root, source, target, options = {}) {
  const sourcePath = assertManagedPath(root, source, { kind: "directory", code: options.targetCode || "CATALOG_TARGET_INVALID" });
  ensureManagedDirectory(root, path.dirname(target), options.targetCode || "CATALOG_TARGET_INVALID");
  const targetPath = assertManagedPath(root, target, { code: options.targetCode || "CATALOG_TARGET_INVALID" });
  fsyncDirectory(sourcePath);
  fs.renameSync(sourcePath, targetPath);
  fsyncDirectory(path.dirname(targetPath));
  return targetPath;
}

module.exports = {
  assertManagedPath,
  ensureManagedDirectory,
  fsyncDirectory,
  fsyncFile,
  renameDirectoryDurable,
  unlinkDurable,
  writeFileAtomic,
  writeFileExclusive,
};
