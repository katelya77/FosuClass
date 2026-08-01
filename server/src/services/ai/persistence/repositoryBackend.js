/**
 * P5a WS4a：Agent 四类仓储的后端选择（file 默认 | postgres 可选）。
 *
 * 唯一权威开关：服务端 env FOSU_AGENT_REPOSITORY_BACKEND。
 * 各 facade（conversationRepository / taskStore / knowledgeControlPlane）
 * 统一经 resolveRepositoryBackend 判定，不出现第二份开关解析逻辑。
 *
 * 语义：
 *   - 缺省 / 空串 / 未识别值 → "file"（一体化默认；standalone 未配置时不得误选 PG）；
 *   - "postgres"（大小写不敏感）→ PostgreSQL standalone 模式；
 *   - 该开关只决定存储实现，领域规则（状态机、schema 迁移、TTL、错误码）
 *     由双实现共用，见各 PG adapter 文件头注释。
 */

const BACKEND_ENV = "FOSU_AGENT_REPOSITORY_BACKEND";
const BACKENDS = Object.freeze(["file", "postgres"]);

function resolveRepositoryBackend(value) {
  const raw = value === undefined || value === null ? process.env[BACKEND_ENV] : value;
  const text = String(raw || "").trim().toLowerCase();
  return BACKENDS.indexOf(text) >= 0 ? text : "file";
}

module.exports = {
  BACKEND_ENV,
  BACKENDS,
  resolveRepositoryBackend,
};
