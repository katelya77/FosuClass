/**
 * P5b WS-A：standalone 结构化 JSON 日志（四角色共用）。
 *
 * 纪律（简报「禁令」与 AGENTS.md）：
 * - 单行 JSON：{at, level, event, serviceRole, version, arch, ...fields}；
 * - 密钥形态字段名（token/secret/password/apiKey/authorization/cookie/credential）
 *   一律替换为 "[REDACTED]"；用户消息 / 完整 prompt / 敏感记忆原文不是合法
 *   日志字段（message/prompt/memory 字样键同表拒绝），调用方只传长度、计数、
 *   状态码等低基数元数据；
 * - errorClass 取自 coded error 的 code（或异常名），自由文本 message 截断。
 */

const SENSITIVE_KEY = /api[-_]?key|token|secret|pass(word)?|authorization|cookie|credential|prompt|message|memory/i;
const REDACTED = "[REDACTED]";
const MAX_STRING = 300;
const MAX_DEPTH = 4;
const MAX_ITEMS = 20;

function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined) return value === undefined ? undefined : null;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    Object.keys(value).slice(0, MAX_ITEMS).forEach((key) => {
      if (SENSITIVE_KEY.test(key)) {
        output[key] = REDACTED;
        return;
      }
      const sanitized = sanitizeValue(value[key], depth + 1);
      if (sanitized !== undefined) output[key] = sanitized;
    });
    return output;
  }
  return String(value).slice(0, MAX_STRING);
}

function errorClassOf(error) {
  if (!error || typeof error !== "object") return "UNKNOWN";
  return String(error.code || error.name || "UNKNOWN").replace(/[^A-Z0-9_.-]/gi, "_").slice(0, 100) || "UNKNOWN";
}

/**
 * @param {{serviceRole: string, version?: string, arch?: string, sink?: (line: string) => void}} options
 * @returns {(event: string, fields?: object, level?: string) => void}
 */
function createStandaloneLogger(options = {}) {
  const serviceRole = String(options.serviceRole || "server").slice(0, 40);
  const version = String(options.version || process.env.AGENT_PLATFORM_VERSION || process.env.GIT_REVISION || "0.1.0").slice(0, 80);
  const arch = String(options.arch || process.arch).slice(0, 20);
  const sink = typeof options.sink === "function" ? options.sink : (line) => process.stdout.write(`${line}\n`);

  return function log(event, fields = {}, level = "info") {
    const base = {
      at: new Date().toISOString(),
      level: String(level || "info").slice(0, 10),
      event: String(event || "unknown").slice(0, 80),
      serviceRole,
      version,
      arch,
    };
    const extra = sanitizeValue(fields && typeof fields === "object" ? fields : {});
    try {
      sink(JSON.stringify(Object.assign(base, extra)));
    } catch (_) {
      // 可观测性不得影响主链；序列化失败时退化为最小行。
      try {
        sink(JSON.stringify(base));
      } catch (_) {
        /* 尽力而为 */
      }
    }
  };
}

module.exports = Object.freeze({
  createStandaloneLogger,
  errorClassOf,
  sanitizeValue,
});
