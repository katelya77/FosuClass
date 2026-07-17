/**
 * Admin backup repository + transactional restore orchestration.
 * Domain adapters perform schema validate / atomic write / post-verify.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createAdapters, fileSha256 } = require("./backupRestore/adapters");

const DATA_DIR = path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../data"));
const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const MAX_BACKUP_BYTES = Number(process.env.FOSU_BACKUP_MAX_BYTES || 25 * 1024 * 1024);

const adapters = createAdapters({
  noticesPath: path.join(STORAGE_DIR, "notices.json"),
  newsPath: path.join(STORAGE_DIR, "news.json"),
  configPath: path.join(STORAGE_DIR, "admin-config.json"),
  feedbacksPath: path.join(STORAGE_DIR, "feedbacks.json"),
  feedbackJsonlPath: path.join(STORAGE_DIR, "feedback.jsonl"),
  catalogMetaPath: path.join(STORAGE_DIR, "catalog-meta.json"),
  assistantKbPath: path.join(STORAGE_DIR, "assistant-kb.json"),
});

const restoreLocks = new Map();
const idempotencyCache = new Map();

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

function parseBackupType(filename) {
  const name = path.basename(String(filename || ""));
  const match = name.match(/^([a-z0-9-]+)-\d{8}-\d{6}\.json$/i);
  if (match) return match[1].toLowerCase();
  // pre-restore-notices-...
  const pre = name.match(/^pre-restore-([a-z0-9-]+)-/i);
  if (pre) return pre[1].toLowerCase();
  const dash = name.indexOf("-");
  if (dash > 0) return name.slice(0, dash).toLowerCase();
  return "unknown";
}

function resolveBackupPath(filename) {
  const safeFile = path.basename(String(filename || ""));
  if (!safeFile || safeFile !== String(filename || "").replace(/^.*[\\/]/, "")) {
    const err = new Error("invalid backup filename");
    err.statusCode = 400;
    err.code = "INVALID_FILENAME";
    throw err;
  }
  if (!safeFile.endsWith(".json")) {
    const err = new Error("only .json backups are supported");
    err.statusCode = 400;
    err.code = "INVALID_FILENAME";
    throw err;
  }
  ensureBackupsDir();
  const filePath = path.resolve(path.join(BACKUPS_DIR, safeFile));
  const root = path.resolve(BACKUPS_DIR) + path.sep;
  if (!filePath.startsWith(root) && filePath !== path.resolve(BACKUPS_DIR)) {
    const err = new Error("invalid backup path");
    err.statusCode = 400;
    err.code = "INVALID_PATH";
    throw err;
  }
  return { safeFile, filePath };
}

function listBackups() {
  ensureBackupsDir();
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, f));
      const type = parseBackupType(f);
      return {
        filename: f,
        type,
        size: `${Math.round(stat.size / 1024)} KB`,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        kind: "backup",
        restorable: Boolean(adapters[type]),
        downloadPath: `/api/admin/backups/download?filename=${encodeURIComponent(f)}`,
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getBackupFile(filename) {
  const { safeFile, filePath } = resolveBackupPath(filename);
  if (!fs.existsSync(filePath)) {
    const err = new Error("备份文件不存在");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_BACKUP_BYTES) {
    const err = new Error(`backup exceeds max size ${MAX_BACKUP_BYTES} bytes`);
    err.statusCode = 400;
    err.code = "BACKUP_TOO_LARGE";
    throw err;
  }
  return { filename: safeFile, filePath, type: parseBackupType(safeFile), sizeBytes: stat.size };
}

function deleteBackup(filename, options = {}) {
  const meta = getBackupFile(filename);
  const safeFile = meta.filename;
  const filePath = meta.filePath;
  if (options.requireConfirm) {
    const confirm = String(options.confirm || options.filename || "").trim();
    if (confirm !== String(safeFile)) {
      const err = new Error("confirm must equal the backup filename for delete");
      err.statusCode = 400;
      err.code = "CONFIRM_REQUIRED";
      throw err;
    }
  }
  fs.unlinkSync(filePath);
  return { filename: safeFile, deleted: true };
}

function readBackupPayload(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const err = new Error(`invalid backup JSON: ${error.message}`);
    err.statusCode = 400;
    err.code = "SCHEMA_INVALID";
    throw err;
  }
}

function preflightRestore(filename) {
  const meta = getBackupFile(filename);
  const adapter = adapters[meta.type];
  if (!adapter) {
    return {
      ok: false,
      filename: meta.filename,
      type: meta.type,
      sizeBytes: meta.sizeBytes,
      parseOk: false,
      restorable: false,
      blockers: [`no restore adapter for type "${meta.type}"`],
      warnings: [],
      impact: { affectsMiniprogram: false, rollback: "n/a" },
    };
  }
  let payload;
  let parseOk = true;
  let parseError = null;
  try {
    payload = readBackupPayload(meta.filePath);
  } catch (error) {
    parseOk = false;
    parseError = error.message;
  }
  if (!parseOk) {
    return {
      ok: false,
      filename: meta.filename,
      type: meta.type,
      sizeBytes: meta.sizeBytes,
      parseOk: false,
      parseError,
      restorable: true,
      blockers: [parseError || "parse failed"],
      warnings: [],
      impact: {
        affectsMiniprogram: ["notices", "news", "config"].includes(meta.type),
        rollback: "automatic safety backup before overwrite",
      },
    };
  }
  try {
    const pf = adapter.preflight(payload, { backupsDir: BACKUPS_DIR, storageDir: STORAGE_DIR });
    return {
      ok: true,
      filename: meta.filename,
      type: meta.type,
      sizeBytes: meta.sizeBytes,
      parseOk: true,
      itemCount: pf.itemCount,
      restorable: true,
      targetPath: pf.targets && pf.targets[0] ? pf.targets[0].path : null,
      targets: pf.targets,
      blockers: [],
      warnings: [
        "restore will overwrite live files after creating a safety backup",
        meta.type === "feedback"
          ? "feedback restore rewrites feedbacks.json and rebuilds feedback.jsonl from the array snapshot"
          : null,
      ].filter(Boolean),
      impact: {
        affectsMiniprogram: ["notices", "news", "config"].includes(meta.type),
        rollback: "automatic safety backup before overwrite",
      },
      beforeHash: fileSha256(meta.filePath),
    };
  } catch (error) {
    return {
      ok: false,
      filename: meta.filename,
      type: meta.type,
      sizeBytes: meta.sizeBytes,
      parseOk: true,
      restorable: true,
      blockers: [error.message],
      warnings: [],
      impact: {
        affectsMiniprogram: ["notices", "news", "config"].includes(meta.type),
        rollback: "automatic safety backup before overwrite",
      },
    };
  }
}

function acquireRestoreLock(type) {
  if (restoreLocks.get(type)) {
    const err = new Error(`restore already in progress for type ${type}`);
    err.statusCode = 409;
    err.code = "RESTORE_LOCKED";
    throw err;
  }
  restoreLocks.set(type, Date.now());
}

function releaseRestoreLock(type) {
  restoreLocks.delete(type);
}

function restoreBackup(filename, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const confirm = String(options.confirm || "");
  const idempotencyKey = String(options.idempotencyKey || "").trim();

  if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
    return idempotencyCache.get(idempotencyKey);
  }

  const preflight = preflightRestore(filename);
  if (!preflight.ok) {
    const err = new Error((preflight.blockers || []).join("; ") || "restore preflight failed");
    err.statusCode = 400;
    err.code = "RESTORE_PREFLIGHT_FAILED";
    err.preflight = preflight;
    throw err;
  }

  if (dryRun) {
    const result = {
      restored: false,
      dryRun: true,
      preflight,
      beforeHash: preflight.beforeHash,
      afterHash: null,
      safetyBackup: [],
      rollbackStatus: "n/a",
    };
    if (idempotencyKey) idempotencyCache.set(idempotencyKey, result);
    return result;
  }

  if (confirm !== path.basename(String(filename))) {
    const err = new Error("confirm must equal the backup filename for restore");
    err.statusCode = 400;
    err.code = "CONFIRM_REQUIRED";
    throw err;
  }

  const meta = getBackupFile(filename);
  const adapter = adapters[meta.type];
  acquireRestoreLock(meta.type);
  let safety = [];
  try {
    const payload = readBackupPayload(meta.filePath);
    const ctx = { backupsDir: BACKUPS_DIR, storageDir: STORAGE_DIR };
    safety = adapter.createSafetyBackup(ctx);
    const beforeLive = (adapter.getTargetFiles(ctx) || []).map((t) => ({
      path: t.path,
      hash: fileSha256(t.path),
    }));
    try {
      adapter.restoreAtomically(payload, ctx);
      const verify = adapter.postVerify(payload, ctx);
      adapter.invalidateCache(ctx);
      const afterLive = (adapter.getTargetFiles(ctx) || []).map((t) => ({
        path: t.path,
        hash: fileSha256(t.path),
      }));
      const result = {
        restored: true,
        dryRun: false,
        filename: meta.filename,
        type: meta.type,
        preflight,
        verified: Boolean(verify && verify.ok !== false),
        verify,
        beforeHash: preflight.beforeHash,
        beforeLive,
        afterLive,
        safetyBackup: safety,
        rollbackStatus: "not_needed",
        idempotencyKey: idempotencyKey || null,
      };
      if (idempotencyKey) idempotencyCache.set(idempotencyKey, result);
      return result;
    } catch (error) {
      // Attempt rollback from safety backups
      let rolled = false;
      for (const entry of safety) {
        try {
          const targets = adapter.getTargetFiles(ctx);
          const match = targets.find((t) => t.role === entry.role) || targets[0];
          if (match && fs.existsSync(entry.path)) {
            fs.copyFileSync(entry.path, match.path);
            rolled = true;
          }
        } catch {
          /* continue */
        }
      }
      error.rollbackStatus = rolled ? "restored_safety" : "rollback_failed";
      error.safetyBackup = safety;
      throw error;
    }
  } finally {
    releaseRestoreLock(meta.type);
  }
}

module.exports = {
  BACKUPS_DIR,
  RESTORE_TARGETS: Object.fromEntries(
    Object.entries(adapters).map(([type, adapter]) => {
      const targets = adapter.getTargetFiles({ storageDir: STORAGE_DIR, backupsDir: BACKUPS_DIR });
      return [type, targets[0] ? targets[0].path : null];
    })
  ),
  listBackups,
  getBackupFile,
  deleteBackup,
  preflightRestore,
  restoreBackup,
  parseBackupType,
  adapters,
  MAX_BACKUP_BYTES,
};
