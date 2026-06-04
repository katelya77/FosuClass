const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const zlib = require("zlib");
const { safeLog } = require("../utils/safeLogger");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const UPLOAD_ROOT = process.env.STAGING_DIR
  ? path.resolve(process.env.STAGING_DIR)
  : path.join(STORAGE_DIR, "staging-uploads");
const INDEX_PATH = path.join(UPLOAD_ROOT, "uploads.json");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureStorage() {
  ensureDir(UPLOAD_ROOT);
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed == null ? fallback : parsed;
  } catch (error) {
    safeLog("staging-upload-read-json-failed", { filePath, error: error.message });
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try { fs.unlinkSync(filePath); } catch (error) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { fs.unlinkSync(tempPath); } catch (cleanupError) {}
  }
}

function sanitizeFileName(value) {
  const base = path.basename(String(value || "staging.json"));
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return safe || "staging.json";
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error("Invalid staging upload path");
    error.statusCode = 400;
    throw error;
  }
}

function getUploadDir(uploadId) {
  ensureStorage();
  const safeId = String(uploadId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) {
    const error = new Error("Missing uploadId");
    error.statusCode = 400;
    throw error;
  }
  const dir = path.join(UPLOAD_ROOT, safeId);
  assertInside(UPLOAD_ROOT, dir);
  return dir;
}

function getManifestPath(uploadId) {
  return path.join(getUploadDir(uploadId), "manifest.json");
}

function readIndex() {
  ensureStorage();
  const list = readJsonFile(INDEX_PATH, []);
  return Array.isArray(list) ? list : [];
}

function writeIndex(list) {
  writeJsonAtomic(INDEX_PATH, list.slice(0, 200));
}

function publicManifest(manifest) {
  if (!manifest) return null;
  const copy = Object.assign({}, manifest);
  const chunkStatus = getChunkStatus(manifest);
  copy.sourceSize = manifest.originalSize || 0;
  copy.gzipSize = manifest.contentEncoding === "gzip" ? manifest.uploadSize || 0 : 0;
  copy.chunkCount = manifest.totalChunks || 0;
  copy.uploadedChunks = chunkStatus.receivedCount;
  copy.receivedCount = chunkStatus.receivedCount;
  copy.receivedBytes = chunkStatus.receivedBytes;
  copy.progress = chunkStatus.progress;
  copy.counts = manifest.summary?.counts || manifest.summary || {};
  delete copy.uploadDir;
  delete copy.joinedPath;
  delete copy.jsonPath;
  return copy;
}

function updateIndex(manifest) {
  const current = readIndex();
  const publicCopy = publicManifest(manifest);
  const next = current.filter((item) => item.uploadId !== manifest.uploadId);
  next.unshift(publicCopy);
  writeIndex(next);
}

function writeManifest(manifest) {
  const dir = getUploadDir(manifest.uploadId);
  manifest.uploadDir = dir;
  writeJsonAtomic(path.join(dir, "manifest.json"), manifest);
  updateIndex(manifest);
}

function readManifest(uploadId) {
  const manifest = readJsonFile(getManifestPath(uploadId), null);
  if (!manifest) {
    const error = new Error("staging upload not found");
    error.statusCode = 404;
    throw error;
  }
  manifest.uploadDir = getUploadDir(uploadId);
  return manifest;
}

function toPositiveInteger(value, fallback, max) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(num), max || Math.floor(num));
}

function normalizeHash(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

function checkActor(manifest, actor) {
  if (actor && actor.type === "admin") {
    return true;
  }
  if (!manifest.actorType || manifest.actorType === "admin") {
    return true;
  }
  if (!actor || actor.type !== manifest.actorType || String(actor.id || "") !== String(manifest.actorId || "")) {
    const error = new Error("staging upload token cannot access this upload");
    error.statusCode = 403;
    throw error;
  }
  return true;
}

function chunkPath(manifest, chunkIndex) {
  const filePath = path.join(manifest.uploadDir, `chunk-${String(chunkIndex).padStart(6, "0")}.part`);
  assertInside(manifest.uploadDir, filePath);
  return filePath;
}

function getReceivedBytes(receivedChunks) {
  return Object.values(receivedChunks || {}).reduce((sum, chunk) => sum + Number(chunk.size || 0), 0);
}

function getChunkStatus(manifest) {
  const receivedChunks = manifest.receivedChunks || {};
  const receivedCount = Object.keys(receivedChunks).length;
  const receivedBytes = getReceivedBytes(receivedChunks);
  return {
    receivedCount,
    receivedBytes,
    totalChunks: manifest.totalChunks,
    progress: manifest.uploadSize > 0
      ? Number(Math.min(100, (receivedBytes / manifest.uploadSize) * 100).toFixed(2))
      : 0,
  };
}

function initUpload(input, actor) {
  ensureStorage();
  const chunkSize = toPositiveInteger(input.chunkSize, 8 * 1024 * 1024, 64 * 1024 * 1024);
  const uploadSize = toPositiveInteger(input.uploadSize || input.size, 0);
  if (!uploadSize) {
    const error = new Error("uploadSize must be greater than 0");
    error.statusCode = 400;
    throw error;
  }
  const totalChunks = toPositiveInteger(input.totalChunks, Math.ceil(uploadSize / chunkSize), 100000);
  if (totalChunks !== Math.ceil(uploadSize / chunkSize)) {
    const error = new Error("totalChunks does not match uploadSize and chunkSize");
    error.statusCode = 400;
    throw error;
  }

  const uploadId = `stg_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const dir = getUploadDir(uploadId);
  ensureDir(dir);

  const manifest = {
    uploadId,
    fileName: sanitizeFileName(input.fileName),
    originalFileName: String(input.fileName || ""),
    term: String(input.term || ""),
    releaseVersion: String(input.releaseVersion || ""),
    note: String(input.note || ""),
    source: String(input.source || (actor && actor.type) || "local-upload"),
    actorType: actor && actor.type ? String(actor.type) : "admin",
    actorId: actor && actor.id ? String(actor.id) : "",
    contentEncoding: input.contentEncoding === "gzip" ? "gzip" : "identity",
    contentType: String(input.contentType || "application/json"),
    chunkSize,
    totalChunks,
    uploadSize,
    uploadSha256: normalizeHash(input.uploadSha256 || input.sha256),
    originalSize: toPositiveInteger(input.originalSize, 0),
    originalSha256: normalizeHash(input.originalSha256),
    receivedChunks: {},
    status: "initialized",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    uploadDir: dir,
  };
  writeManifest(manifest);
  return publicManifest(manifest);
}

function writeChunk(uploadId, chunkIndexRaw, buffer, actor, options = {}) {
  const manifest = readManifest(uploadId);
  checkActor(manifest, actor);
  const chunkIndex = Number(chunkIndexRaw);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= manifest.totalChunks) {
    const error = new Error("Invalid chunkIndex");
    error.statusCode = 400;
    throw error;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error("Chunk body cannot be empty");
    error.statusCode = 400;
    throw error;
  }

  const expectedSize = chunkIndex === manifest.totalChunks - 1
    ? manifest.uploadSize - manifest.chunkSize * (manifest.totalChunks - 1)
    : manifest.chunkSize;
  if (buffer.length !== expectedSize) {
    const error = new Error(`Chunk ${chunkIndex} size mismatch: expected ${expectedSize}, got ${buffer.length}`);
    error.statusCode = 400;
    throw error;
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const expectedHash = normalizeHash(options.chunkSha256);
  if (expectedHash && expectedHash !== sha256) {
    const error = new Error(`Chunk ${chunkIndex} hash mismatch`);
    error.statusCode = 400;
    throw error;
  }

  fs.writeFileSync(chunkPath(manifest, chunkIndex), buffer);
  manifest.receivedChunks[String(chunkIndex)] = {
    size: buffer.length,
    sha256,
    receivedAt: new Date().toISOString(),
  };
  manifest.status = "uploading";
  manifest.updatedAt = new Date().toISOString();
  writeManifest(manifest);
  return Object.assign(publicManifest(manifest), getChunkStatus(manifest));
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(filePath, "r");
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function concatChunks(manifest) {
  const joinedPath = path.join(manifest.uploadDir, manifest.contentEncoding === "gzip" ? "payload.json.gz" : "payload.json");
  assertInside(manifest.uploadDir, joinedPath);
  const out = fs.openSync(joinedPath, "w");
  const hash = crypto.createHash("sha256");
  let totalSize = 0;
  try {
    for (let index = 0; index < manifest.totalChunks; index += 1) {
      const filePath = chunkPath(manifest, index);
      if (!fs.existsSync(filePath)) {
        const error = new Error(`Missing chunk ${index}`);
        error.statusCode = 400;
        throw error;
      }
      const buffer = fs.readFileSync(filePath);
      const recorded = manifest.receivedChunks[String(index)];
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      if (!recorded || recorded.size !== buffer.length || recorded.sha256 !== sha256) {
        const error = new Error(`Chunk ${index} verification failed`);
        error.statusCode = 400;
        throw error;
      }
      fs.writeSync(out, buffer);
      hash.update(buffer);
      totalSize += buffer.length;
    }
  } finally {
    fs.closeSync(out);
  }
  return {
    joinedPath,
    uploadSize: totalSize,
    uploadSha256: hash.digest("hex"),
  };
}

async function finalizeUpload(uploadId, actor, expected = {}) {
  const manifest = readManifest(uploadId);
  checkActor(manifest, actor);
  const received = getChunkStatus(manifest);
  if (received.receivedCount !== manifest.totalChunks || received.receivedBytes !== manifest.uploadSize) {
    const error = new Error(`Upload is incomplete: ${received.receivedCount}/${manifest.totalChunks} chunks`);
    error.statusCode = 400;
    throw error;
  }

  manifest.status = "merging";
  manifest.updatedAt = new Date().toISOString();
  writeManifest(manifest);

  const merged = concatChunks(manifest);
  const expectedUploadHash = normalizeHash(expected.uploadSha256 || expected.sha256 || manifest.uploadSha256);
  if (merged.uploadSize !== manifest.uploadSize) {
    const error = new Error("Merged upload size mismatch");
    error.statusCode = 400;
    throw error;
  }
  if (expectedUploadHash && merged.uploadSha256 !== expectedUploadHash) {
    const error = new Error("Merged upload hash mismatch");
    error.statusCode = 400;
    throw error;
  }

  const jsonPath = path.join(manifest.uploadDir, "payload.json");
  assertInside(manifest.uploadDir, jsonPath);
  if (manifest.contentEncoding === "gzip") {
    await pipeline(
      fs.createReadStream(merged.joinedPath),
      zlib.createGunzip(),
      fs.createWriteStream(jsonPath)
    );
  } else if (merged.joinedPath !== jsonPath) {
    fs.copyFileSync(merged.joinedPath, jsonPath);
  }

  const originalStat = fs.statSync(jsonPath);
  const expectedOriginalSize = toPositiveInteger(expected.originalSize || manifest.originalSize, 0);
  if (expectedOriginalSize && originalStat.size !== expectedOriginalSize) {
    const error = new Error("Decompressed JSON size mismatch");
    error.statusCode = 400;
    throw error;
  }
  const expectedOriginalHash = normalizeHash(expected.originalSha256 || manifest.originalSha256);
  if (expectedOriginalHash && hashFile(jsonPath) !== expectedOriginalHash) {
    const error = new Error("Decompressed JSON hash mismatch");
    error.statusCode = 400;
    throw error;
  }

  manifest.status = "validating";
  manifest.joinedPath = merged.joinedPath;
  manifest.jsonPath = jsonPath;
  manifest.finalizedAt = new Date().toISOString();
  manifest.updatedAt = manifest.finalizedAt;
  writeManifest(manifest);

  let stagingData;
  try {
    stagingData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  } catch (error) {
    markUploadFailed(uploadId, `JSON parse failed: ${error.message}`);
    error.statusCode = 400;
    throw error;
  }

  return {
    manifest: publicManifest(readManifest(uploadId)),
    stagingData,
    jsonPath,
  };
}

function markUploadPendingReview(uploadId, summary) {
  const manifest = readManifest(uploadId);
  manifest.status = "pending-review";
  manifest.summary = summary || {};
  manifest.term = summary?.term || manifest.term;
  manifest.releaseVersion = summary?.releaseVersion || manifest.releaseVersion;
  manifest.pendingReviewAt = new Date().toISOString();
  manifest.updatedAt = manifest.pendingReviewAt;
  writeManifest(manifest);
  return publicManifest(manifest);
}

function markUploadPublished(uploadId, version) {
  try {
    const manifest = readManifest(uploadId);
    manifest.status = "published";
    manifest.publishedVersion = version || manifest.releaseVersion || "";
    manifest.publishedAt = new Date().toISOString();
    manifest.updatedAt = manifest.publishedAt;
    writeManifest(manifest);
    return publicManifest(manifest);
  } catch (error) {
    safeLog("staging-upload-mark-published-failed", { uploadId, error: error.message });
    return null;
  }
}

function markUploadFailed(uploadId, reason) {
  try {
    const manifest = readManifest(uploadId);
    manifest.status = "failed";
    manifest.failureReason = String(reason || "unknown error");
    manifest.failedAt = new Date().toISOString();
    manifest.updatedAt = manifest.failedAt;
    writeManifest(manifest);
    return publicManifest(manifest);
  } catch (error) {
    safeLog("staging-upload-mark-failed-failed", { uploadId, error: error.message });
    return null;
  }
}

function getUploadStatus(uploadId, actor) {
  const manifest = readManifest(uploadId);
  checkActor(manifest, actor);
  return Object.assign(publicManifest(manifest), getChunkStatus(manifest));
}

function listUploads(limit = 20) {
  const raw = readIndex().slice(0, toPositiveInteger(limit, 20, 100));
  const hydrated = raw.map((item) => {
    try {
      return publicManifest(readManifest(item.uploadId));
    } catch (error) {
      return publicManifest(item);
    }
  });

  const versions = new Map();
  hydrated.forEach((item) => {
    const version = String(item.releaseVersion || item.summary?.releaseVersion || "").trim();
    if (!version) return;
    if (!versions.has(version)) versions.set(version, []);
    versions.get(version).push(item.uploadId);
  });

  return hydrated.map((item) => {
    const version = String(item.releaseVersion || item.summary?.releaseVersion || "").trim();
    const duplicates = version ? versions.get(version) || [] : [];
    return Object.assign({}, item, {
      duplicateReleaseVersion: duplicates.length > 1,
      duplicateKeepLatest: duplicates.length > 1 ? duplicates[0] === item.uploadId : true,
      duplicateUploadIds: duplicates,
    });
  });
}

function deleteUpload(uploadId, actor) {
  const safeId = String(uploadId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) {
    const error = new Error("Missing uploadId");
    error.statusCode = 400;
    throw error;
  }

  let manifest = null;
  try {
    manifest = readManifest(safeId);
    checkActor(manifest, actor);
  } catch (error) {
    if (error.statusCode !== 404) {
      throw error;
    }
  }

  const dir = getUploadDir(safeId);
  assertInside(UPLOAD_ROOT, dir);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const next = readIndex().filter((item) => item.uploadId !== safeId);
  writeIndex(next);
  return publicManifest(manifest || { uploadId: safeId, status: "deleted" });
}

function normalizeStagingData(data) {
  const stagingData = Object.assign({}, data || {});
  if (!stagingData.classSchedules && stagingData.resources?.classSchedules) {
    stagingData.classSchedules = stagingData.resources.classSchedules;
  }
  if (!stagingData.resources || typeof stagingData.resources !== "object") {
    stagingData.resources = {};
  }
  stagingData.resources = Object.assign({
    teacherSchedules: stagingData.teacherSchedules || [],
    classroomSchedules: stagingData.classroomSchedules || [],
    courseSchedules: stagingData.courseSchedules || [],
    classrooms: stagingData.classrooms || [],
    teachers: stagingData.teachers || [],
    courses: stagingData.courses || [],
  }, stagingData.resources);
  return stagingData;
}

module.exports = {
  UPLOAD_ROOT,
  finalizeUpload,
  getUploadStatus,
  initUpload,
  deleteUpload,
  listUploads,
  markUploadFailed,
  markUploadPendingReview,
  markUploadPublished,
  normalizeStagingData,
  sanitizeFileName,
  writeChunk,
};
