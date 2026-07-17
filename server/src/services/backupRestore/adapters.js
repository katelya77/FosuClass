/**
 * Domain restore adapters for admin backups.
 * Each adapter owns schema validation, atomic restore, and post-verify.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function fsyncFile(fd) {
  try {
    if (typeof fs.fsyncSync === "function") fs.fsyncSync(fd);
  } catch {
    // platform may not support fsync on this handle
  }
}

function atomicWriteJson(targetPath, data) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fsyncFile(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (fs.existsSync(targetPath) && process.platform === "win32") {
      try {
        fs.unlinkSync(targetPath);
      } catch {
        /* ignore */
      }
    }
    fs.renameSync(tmp, targetPath);
  } catch (error) {
    fs.writeFileSync(targetPath, payload, "utf8");
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function fileSha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function assertArray(data, label) {
  if (!Array.isArray(data)) {
    const err = new Error(`${label} backup must be a JSON array`);
    err.statusCode = 400;
    err.code = "SCHEMA_INVALID";
    throw err;
  }
}

function assertObject(data, label) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const err = new Error(`${label} backup must be a JSON object`);
    err.statusCode = 400;
    err.code = "SCHEMA_INVALID";
    throw err;
  }
}

function createAdapter({ type, getTargetFiles, validate, restoreFiles, postVerify, invalidateCache }) {
  return {
    type,
    getTargetFiles,
    validateSchema(payload) {
      return validate(payload);
    },
    preflight(payload, ctx) {
      const targets = getTargetFiles(ctx);
      validate(payload);
      return {
        ok: true,
        type,
        targets: targets.map((t) => ({
          path: t.path,
          exists: fs.existsSync(t.path),
          role: t.role,
        })),
        itemCount: Array.isArray(payload)
          ? payload.length
          : payload && typeof payload === "object"
            ? Object.keys(payload).length
            : null,
      };
    },
    createSafetyBackup(ctx) {
      const backupsDir = ctx.backupsDir;
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      const safety = [];
      for (const target of getTargetFiles(ctx)) {
        if (!fs.existsSync(target.path)) continue;
        const name = `pre-restore-${type}-${target.role || "main"}-${stamp}.json`;
        const dest = path.join(backupsDir, name);
        fs.copyFileSync(target.path, dest);
        safety.push({ role: target.role, path: dest, hash: fileSha256(dest) });
      }
      return safety;
    },
    restoreAtomically(payload, ctx) {
      validate(payload);
      return restoreFiles(payload, ctx, atomicWriteJson);
    },
    postVerify(payload, ctx) {
      return postVerify(payload, ctx);
    },
    invalidateCache(ctx) {
      if (typeof invalidateCache === "function") invalidateCache(ctx);
    },
    rollback(safetyEntries) {
      for (const entry of safetyEntries || []) {
        if (!entry || !entry.path || !fs.existsSync(entry.path)) continue;
        // safety files live in backupsDir; restore target must be re-derived by caller via type map
      }
      return { rolledBack: false, note: "caller applies safety files to targets" };
    },
    fileSha256,
  };
}

function createAdapters(paths) {
  const {
    noticesPath,
    newsPath,
    configPath,
    feedbacksPath,
    feedbackJsonlPath,
    catalogMetaPath,
    assistantKbPath,
  } = paths;

  const notices = createAdapter({
    type: "notices",
    getTargetFiles: () => [{ path: noticesPath, role: "main" }],
    validate: (data) => {
      assertArray(data, "notices");
      data.forEach((item, i) => {
        if (!item || typeof item !== "object" || !item.title) {
          const err = new Error(`notices[${i}] missing title`);
          err.statusCode = 400;
          err.code = "SCHEMA_INVALID";
          throw err;
        }
      });
    },
    restoreFiles: (data, _ctx, write) => {
      write(noticesPath, data);
      return { files: [noticesPath] };
    },
    postVerify: (data) => {
      const live = JSON.parse(fs.readFileSync(noticesPath, "utf8"));
      if (!Array.isArray(live) || live.length !== data.length) {
        const err = new Error("notices post-verify length mismatch");
        err.statusCode = 500;
        err.code = "POST_VERIFY_FAILED";
        throw err;
      }
      return { ok: true, count: live.length };
    },
  });

  const news = createAdapter({
    type: "news",
    getTargetFiles: () => [{ path: newsPath, role: "main" }],
    validate: (data) => {
      assertArray(data, "news");
    },
    restoreFiles: (data, _ctx, write) => {
      write(newsPath, data);
      return { files: [newsPath] };
    },
    postVerify: (data) => {
      const live = JSON.parse(fs.readFileSync(newsPath, "utf8"));
      if (!Array.isArray(live) || live.length !== data.length) {
        const err = new Error("news post-verify length mismatch");
        err.statusCode = 500;
        err.code = "POST_VERIFY_FAILED";
        throw err;
      }
      return { ok: true, count: live.length };
    },
  });

  const config = createAdapter({
    type: "config",
    getTargetFiles: () => [{ path: configPath, role: "main" }],
    validate: (data) => assertObject(data, "config"),
    restoreFiles: (data, _ctx, write) => {
      write(configPath, data);
      return { files: [configPath] };
    },
    postVerify: () => {
      JSON.parse(fs.readFileSync(configPath, "utf8"));
      return { ok: true };
    },
  });

  /**
   * Feedback: JSON array snapshot is the sole restore source.
   * After restore we atomically rewrite feedbacks.json and rebuild feedback.jsonl
   * so readAllFeedbackRecords() cannot retain post-backup JSONL rows.
   */
  const feedback = createAdapter({
    type: "feedback",
    getTargetFiles: () => [
      { path: feedbacksPath, role: "array" },
      { path: feedbackJsonlPath, role: "jsonl" },
    ],
    validate: (data) => {
      assertArray(data, "feedback");
    },
    restoreFiles: (data, _ctx, write) => {
      write(feedbacksPath, data);
      const dir = path.dirname(feedbackJsonlPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const lines = data.map((row) => JSON.stringify(row)).join("\n");
      const body = lines ? `${lines}\n` : "";
      const tmp = `${feedbackJsonlPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, body, "utf8");
      try {
        if (fs.existsSync(feedbackJsonlPath) && process.platform === "win32") {
          try {
            fs.unlinkSync(feedbackJsonlPath);
          } catch {
            /* ignore */
          }
        }
        fs.renameSync(tmp, feedbackJsonlPath);
      } catch {
        fs.writeFileSync(feedbackJsonlPath, body, "utf8");
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
      return { files: [feedbacksPath, feedbackJsonlPath] };
    },
    postVerify: (data) => {
      const live = JSON.parse(fs.readFileSync(feedbacksPath, "utf8"));
      if (!Array.isArray(live) || live.length !== data.length) {
        const err = new Error("feedback post-verify array length mismatch");
        err.statusCode = 500;
        err.code = "POST_VERIFY_FAILED";
        throw err;
      }
      const jsonl = fs.existsSync(feedbackJsonlPath)
        ? fs
            .readFileSync(feedbackJsonlPath, "utf8")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
        : [];
      if (jsonl.length !== data.length) {
        const err = new Error("feedback post-verify jsonl length mismatch");
        err.statusCode = 500;
        err.code = "POST_VERIFY_FAILED";
        throw err;
      }
      return { ok: true, count: live.length, jsonlCount: jsonl.length };
    },
  });

  const catalogMeta = createAdapter({
    type: "catalog-meta",
    getTargetFiles: () => [{ path: catalogMetaPath, role: "main" }],
    validate: (data) => assertObject(data, "catalog-meta"),
    restoreFiles: (data, _ctx, write) => {
      write(catalogMetaPath, data);
      return { files: [catalogMetaPath] };
    },
    postVerify: () => {
      JSON.parse(fs.readFileSync(catalogMetaPath, "utf8"));
      return { ok: true };
    },
  });

  const assistantKb = createAdapter({
    type: "assistant-kb",
    getTargetFiles: () => [{ path: assistantKbPath, role: "main" }],
    validate: (data) => {
      if (data == null) {
        const err = new Error("assistant-kb backup is empty");
        err.statusCode = 400;
        err.code = "SCHEMA_INVALID";
        throw err;
      }
    },
    restoreFiles: (data, _ctx, write) => {
      write(assistantKbPath, data);
      return { files: [assistantKbPath] };
    },
    postVerify: () => {
      JSON.parse(fs.readFileSync(assistantKbPath, "utf8"));
      return { ok: true };
    },
  });

  return {
    notices,
    news,
    config,
    feedback,
    "catalog-meta": catalogMeta,
    "assistant-kb": assistantKb,
  };
}

module.exports = {
  createAdapters,
  atomicWriteJson,
  fileSha256,
};
