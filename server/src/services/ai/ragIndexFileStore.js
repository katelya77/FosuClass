/**
 * P5a WS5：RAG 索引产物的文件存储（integrated 默认）。
 *
 * 由 ragIndexService 原内嵌实现原样抽取，行为保持：
 *   - `<root>/rag-indexes/<env>/<kbId>/v<N>.json`（不可变版本索引）
 *     + `lkg.json`（last-known-good 单指针）；
 *   - 写入后回读 digest 校验（parseIndex），损坏立即失败，不推进 lkg；
 *   - 读取 fail closed：JSON/digest 校验失败一律视为不可读（null），
 *     由服务层回退 lkg/扫描兜底；
 *   - 版本索引不可变且 digest 自校验：短 TTL 记忆化避免同一文件的
 *     构建校验 + 查询双重全文件读取（M-2）；staleness 上限内服务的是
 *     已验证内容。
 */

const fs = require("fs");
const path = require("path");
const { serializeIndex, parseIndex } = require("../../../../packages/rag-runtime");

const INDEX_MEMO_TTL_MS = 30 * 1000;
const INDEX_MEMO_MAX = 64;

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function createFileRagIndexStore(options = {}) {
  const root = String(options.root || "");
  if (!root) {
    const error = new Error("RAG_INDEX_ROOT_REQUIRED");
    error.code = "RAG_INDEX_ROOT_REQUIRED";
    throw error;
  }
  const memoTtlMs = Number.isFinite(options.memoTtlMs) ? options.memoTtlMs : INDEX_MEMO_TTL_MS;
  const memo = new Map(); // file → { at, index }（仅缓存已验证可读的索引）

  const indexDir = (environment, kbId) => path.join(root, "rag-indexes", environment, kbId);
  const versionFile = (environment, kbId, version) => path.join(indexDir(environment, kbId), `v${version}.json`);
  const lkgFile = (environment, kbId) => path.join(indexDir(environment, kbId), "lkg.json");

  async function readVersion(environment, kbId, version) {
    const file = versionFile(environment, kbId, version);
    const now = Date.now();
    const hit = memo.get(file);
    if (hit && now - hit.at < memoTtlMs) return hit.index;
    let index = null;
    try {
      index = parseIndex(fs.readFileSync(file, "utf8"));
    } catch (_) {
      index = null;
    }
    if (index) {
      if (memo.size >= INDEX_MEMO_MAX) memo.clear();
      memo.set(file, { at: now, index });
    } else {
      memo.delete(file);
    }
    return index;
  }

  async function writeVersion(environment, kbId, version, index) {
    const file = versionFile(environment, kbId, version);
    atomicWriteJson(file, JSON.parse(serializeIndex(index)));
    // 回读校验（digest）：写损坏立即失败，不推进 lkg。
    parseIndex(fs.readFileSync(file, "utf8"));
  }

  async function readLkg(environment, kbId) {
    try {
      return JSON.parse(fs.readFileSync(lkgFile(environment, kbId), "utf8"));
    } catch (_) {
      return null;
    }
  }

  async function writeLkg(environment, kbId, pointer) {
    atomicWriteJson(lkgFile(environment, kbId), pointer);
  }

  async function listVersions(environment, kbId) {
    let names;
    try {
      names = fs.readdirSync(indexDir(environment, kbId));
    } catch (_) {
      return [];
    }
    return names
      .map((name) => /^v(\d+)\.json$/.exec(name))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .filter((item) => Number.isInteger(item))
      .sort((a, b) => b - a);
  }

  return Object.freeze({
    kind: "file",
    readVersion,
    writeVersion,
    readLkg,
    writeLkg,
    listVersions,
  });
}

module.exports = Object.freeze({ createFileRagIndexStore });
