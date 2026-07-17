/**
 * Admin backup repository — list / download / delete / preflight / restore.
 * Single implementation shared by Legacy + Vue handlers.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../data"));
const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const BACKUPS_DIR = path.join(DATA_DIR, "backups");

/** Map backup type prefix → restore target path */
const RESTORE_TARGETS = {
  notices: path.join(STORAGE_DIR, "notices.json"),
  news: path.join(STORAGE_DIR, "news.json"),
  config: path.join(STORAGE_DIR, "admin-config.json"),
  feedback: path.join(STORAGE_DIR, "feedbacks.json"),
  "catalog-meta": path.join(STORAGE_DIR, "catalog-meta.json"),
  "assistant-kb": path.join(STORAGE_DIR, "assistant-kb.json"),
};

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

function parseBackupType(filename) {
  const name = path.basename(String(filename || ""));
  const match = name.match(/^([a-z0-9-]+)-\d{8}-\d{6}\.json$/i);
  if (match) return match[1].toLowerCase();
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
  if (!filePath.startsWith(path.resolve(BACKUPS_DIR) + path.sep) && filePath !== path.resolve(BACKUPS_DIR)) {
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
        restorable: Boolean(RESTORE_TARGETS[type]),
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
  return { filename: safeFile, filePath, type: parseBackupType(safeFile) };
}

function deleteBackup(filename) {
  const { safeFile, filePath } = getBackupFile(filename);
  fs.unlinkSync(filePath);
  return { filename: safeFile, deleted: true };
}

function preflightRestore(filename) {
  const { safeFile, filePath, type } = getBackupFile(filename);
  const targetPath = RESTORE_TARGETS[type];
  let parseOk = false;
  let itemCount = null;
  let parseError = null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    parseOk = true;
    if (Array.isArray(data)) itemCount = data.length;
    else if (data && typeof data === "object") itemCount = Object.keys(data).length;
  } catch (error) {
    parseError = error.message;
  }
  const targetExists = Boolean(targetPath && fs.existsSync(targetPath));
  const ok = parseOk && Boolean(targetPath);
  return {
    ok,
    filename: safeFile,
    type,
    sizeBytes: fs.statSync(filePath).size,
    parseOk,
    parseError,
    itemCount,
    restorable: Boolean(targetPath),
    targetPath: targetPath || null,
    targetExists,
    blockers: [
      !parseOk ? "backup JSON is invalid" : null,
      !targetPath ? `no restore target mapped for type "${type}"` : null,
    ].filter(Boolean),
    warnings: [
      targetExists ? "restore will overwrite current live file after creating a safety backup" : "target file does not exist yet; restore will create it",
    ],
    impact: {
      affectsMiniprogram: ["notices", "news", "config"].includes(type),
      rollback: "automatic safety backup is written before overwrite",
    },
  };
}

function restoreBackup(filename, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const preflight = preflightRestore(filename);
  if (!preflight.ok) {
    const err = new Error(preflight.blockers.join("; ") || "restore preflight failed");
    err.statusCode = 400;
    err.code = "RESTORE_PREFLIGHT_FAILED";
    err.preflight = preflight;
    throw err;
  }
  if (dryRun) {
    return { restored: false, dryRun: true, preflight };
  }
  const { filePath } = getBackupFile(filename);
  const targetPath = preflight.targetPath;
  // Safety backup of current target
  if (fs.existsSync(targetPath)) {
    ensureBackupsDir();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safetyName = `pre-restore-${preflight.type}-${stamp}.json`;
    fs.copyFileSync(targetPath, path.join(BACKUPS_DIR, safetyName));
  }
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(filePath, targetPath);
  // Post verify
  const verify = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  return {
    restored: true,
    dryRun: false,
    filename: preflight.filename,
    type: preflight.type,
    targetPath,
    preflight,
    verified: verify != null,
  };
}

module.exports = {
  BACKUPS_DIR,
  RESTORE_TARGETS,
  listBackups,
  getBackupFile,
  deleteBackup,
  preflightRestore,
  restoreBackup,
  parseBackupType,
};
