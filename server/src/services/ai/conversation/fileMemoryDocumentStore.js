/**
 * P5a WS4b：user-memory.v2 文档的文件系统存储实现（同步）。
 *
 * 本模块是从 userPreferenceService 逐字抽出的持久化原语（纯移动，无行为变更）：
 *   - 每 principal 的文档路径解析（64-hex HMAC 保持部署路径；其余 principal
 *     以不可逆 digest 隔离，与抽取前完全一致）；
 *   - per-principal 互斥文件锁（exclusiveFileLockService，含 stale 回收）；
 *   - 原子写入（tmp 文件 + rename）；
 *   - 原始文本读写与 mtime 查询（legacy v1 迁移的 mtime 回退用）。
 *
 * 加密层留在 store 之上（userPreferenceService）：本 store 只见序列化后的
 * 不透明信封文本（含密文），不理解 schemaVersion / 加密 / 文档结构。
 *
 * 接口形状（同步文档存储 seam，PG 版见 pgMemoryDocumentStore.js）：
 *   - filePath(principalKey) → 文档位置描述符（文件路径）；
 *   - withLock(principalKey, callback) → 持锁执行 callback(filePath)，
 *     读-改-写必须在同一把锁内完成；
 *   - load(filePath) → string | null（缺失返回 null，不做 JSON 解析）；
 *   - save(filePath, text) → 原子覆盖写；
 *   - statMtimeMs(filePath) → number（legacy 迁移回退用，与 fs.statSync 同语义）。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { acquireExclusiveFileLock } = require("../../exclusiveFileLockService");
const { principalShard } = require("./conversationPrincipalService");

function typedError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode || 400;
  return error;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeTextAtomic(filePath, text) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, text, "utf8");
  fs.renameSync(tmpPath, filePath);
}

class FileMemoryDocumentStore {
  constructor(options = {}) {
    const rootDir = options.rootDir;
    if (!rootDir) {
      throw typedError("Memory document store rootDir is required", "MEMORY_STORE_ROOT_REQUIRED", 500);
    }
    this.rootDir = path.resolve(rootDir);
  }

  filePath(principalKey) {
    const stableKey = String(principalKey || "");
    // Production principals are already 64-char HMACs, so preserve the deployed path.
    // Test/custom principals may share the same 16-char display shard; isolate those
    // with a non-reversible digest rather than allowing one principal to decrypt or
    // overwrite another principal's document.
    if (/^[a-f0-9]{64}$/i.test(stableKey)) {
      return path.join(this.rootDir, principalShard(stableKey), "preferences.json");
    }
    const isolated = crypto.createHash("sha256").update(stableKey).digest("hex").slice(0, 24);
    return path.join(this.rootDir, principalShard(stableKey), isolated, "preferences.json");
  }

  withLock(principalKey, callback) {
    const filePath = this.filePath(principalKey);
    ensureDir(path.dirname(filePath));
    const release = acquireExclusiveFileLock(filePath, {
      lockPath: `${filePath}.lock`,
      codePrefix: "USER_PREFERENCE",
      waitMs: 1200,
      staleMs: 30000,
    });
    try {
      return callback(filePath);
    } finally {
      release();
    }
  }

  load(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  }

  save(filePath, text) {
    writeTextAtomic(filePath, String(text));
  }

  statMtimeMs(filePath) {
    return fs.statSync(filePath).mtimeMs;
  }
}

function createFileMemoryDocumentStore(options = {}) {
  return new FileMemoryDocumentStore(options);
}

module.exports = {
  FileMemoryDocumentStore,
  createFileMemoryDocumentStore,
};
