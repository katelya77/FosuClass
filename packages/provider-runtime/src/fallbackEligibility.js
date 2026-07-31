// P2R：单一 retryability / fallback eligibility 分类。
// Provider Runtime（runProviderChain）、Decision（decisionService）、Response
// （providerOrchestrator）三处共用本模块，禁止再出现 message 正则模糊匹配
// （旧 classifyProviderFailure / classifyHttpError 的 /timeout|超时/i 模式）。
//
// 分类只依据两类确定性信号：
//   1. error.code 显式枚举表（含适配器层小写码与 Runtime 层大写码）；
//   2. 数值 HTTP 状态区间表（error.status 与 error.response.status 在此统一归一，
//      全链只此一处，适配器包装层不再各自解读）。
// 默认不 fallback（fail fast）；只有表内明确枚举的码/状态才可推进 fallback Provider。

// failureClass 低基数词表（可安全进入 Trace / metrics，不含用户与 Provider 私密信息）：
//   cancelled | config | policy | auth | invalid_model | bad_request | invalid_payload
//   | schema_violation | guardrail | client_error | not_found
//   | timeout | network | rate_limited | server_error            （fallback 候选）
//   | circuit_open | not_registered | method_unsupported
//   | budget_exhausted | deadline_exceeded                        （skipped：不消耗 fallback 账本）
//   | unknown                                                     （默认 fail fast）

// [failureClass, fallbackEligible, failFast]
const CODE_TABLE = Object.freeze({
  // —— 取消 ——
  ABORTED: ["cancelled", false, true],

  // —— 配置类 ——
  // NOT_CONFIGURED：链内 skipped——多 Provider 链允许跳过未配置节点以到达已配置节点
  // （test:ai-competition 锁定的故障转移语义），自身不消耗 fallback 账本；
  // 若链耗尽后根因仍是 config 类，Decision/Response catch 统一 fail fast（不包装成降级成功）。
  NOT_CONFIGURED: ["config", false, false],
  // 阶段级无可用 Provider：无可推进，直接 fail fast。
  DECISION_PROVIDER_UNAVAILABLE: ["config", false, true],
  PROVIDER_REQUIRED: ["config", false, true],

  // —— 策略 / 本地 Guardrail 拒绝 ——
  PUBLIC_PROVIDER_FORBIDDEN: ["policy", false, true],
  GUARDRAIL_REJECTED: ["guardrail", false, true],

  // —— 确定性 4xx / 请求体与 Schema 类（fail fast；Decision 层走受控 deterministic_fallback，不换 Provider） ——
  invalid_model: ["invalid_model", false, true],
  provider_bad_request: ["bad_request", false, true],
  ERR_BAD_REQUEST: ["bad_request", false, true],
  invalid_payload: ["invalid_payload", false, true],
  INVALID_PROVIDER_JSON: ["invalid_payload", false, true],
  INVALID_PROVIDER_TEXT: ["invalid_payload", false, true],
  PROVIDER_STRUCTURED_OUTPUT_INVALID: ["schema_violation", false, true],
  DECISION_EXTRA_FIELD: ["schema_violation", false, true],
  DECISION_FORBIDDEN_FIELD: ["schema_violation", false, true],
  DECISION_SKILL_NOT_ALLOWED: ["schema_violation", false, true],
  DECISION_GOAL_NOT_ALLOWED: ["schema_violation", false, true],
  DECISION_GOAL_SKILL_MISMATCH: ["schema_violation", false, true],
  DECISION_SELECTED_SKILL_MISMATCH: ["schema_violation", false, true],
  DECISION_GOAL_RESOLUTION_MISMATCH: ["schema_violation", false, true],
  DECISION_SKILL_NOT_FOUND: ["schema_violation", false, true],

  // —— 临时性故障（fallback 候选，消耗共享 fallback 账本） ——
  PROVIDER_TIMEOUT: ["timeout", true, false],
  provider_timeout: ["timeout", true, false],
  ECONNABORTED: ["timeout", true, false],
  ETIMEDOUT: ["timeout", true, false],
  PROVIDER_NETWORK: ["network", true, false],
  ECONNRESET: ["network", true, false],
  ECONNREFUSED: ["network", true, false],
  ENOTFOUND: ["network", true, false],
  EAI_AGAIN: ["network", true, false],
  ERR_NETWORK: ["network", true, false],
  PROVIDER_RATE_LIMITED: ["rate_limited", true, false],
  ERR_BAD_RESPONSE: ["server_error", true, false],

  // —— 熔断 / 预算 / 租约类（skipped：推进下一 Provider 但不消耗 fallback 账本，保持既有行为） ——
  PROVIDER_CIRCUIT_OPEN: ["circuit_open", false, false],
  PROVIDER_NOT_REGISTERED: ["not_registered", false, false],
  PROVIDER_METHOD_UNSUPPORTED: ["method_unsupported", false, false],
  PROVIDER_FALLBACK_BUDGET_EXHAUSTED: ["budget_exhausted", false, false],
  DEADLINE_EXCEEDED: ["deadline_exceeded", false, false],
});

// 通用传输码：axios/包装层对整段 4xx/5xx 只给一个粗粒度码（ERR_BAD_REQUEST 覆盖
// 全部 4xx，ERR_BAD_RESPONSE 覆盖全部 5xx）。此类码命中且带合法数值状态时，
// 状态区间表更精确（401/403→auth、429→rate_limited），让位于状态表；
// 业务显式码（invalid_model、DECISION_* 等）仍然 code 优先。
const GENERIC_TRANSPORT_CODES = new Set(["ERR_BAD_REQUEST", "ERR_BAD_RESPONSE"]);

// 数值 HTTP 状态区间表：code 表未命中时启用。[failureClass, fallbackEligible, failFast]
const STATUS_TABLE = Object.freeze({
  400: ["bad_request", false, true],
  401: ["auth", false, true],
  403: ["auth", false, true],
  404: ["not_found", false, true],
  408: ["timeout", true, false],
  422: ["invalid_payload", false, true],
  429: ["rate_limited", true, false],
});

function normalizeCode(error) {
  return String(error && error.code || "").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}

// error.status 与 error.response.status 错位在此统一归一（全链只此一处）。
// Runtime 的 invokeAttempt 会把适配器原始错误包进 cause，因此沿 cause 链取第一个合法状态码。
function normalizeHttpStatus(error) {
  let current = error;
  const seen = new Set();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const direct = Number(current.status);
    if (Number.isFinite(direct) && direct >= 100 && direct <= 599) return direct;
    const nested = Number(current.response && current.response.status);
    if (Number.isFinite(nested) && nested >= 100 && nested <= 599) return nested;
    current = current.cause;
  }
  return 0;
}

// PROVIDER_CHAIN_EXHAUSTED 是聚合包装：分类须落到最后的根因错误上。
function resolveProviderRootCause(error) {
  let current = error;
  const seen = new Set();
  while (current && normalizeCode(current) === "PROVIDER_CHAIN_EXHAUSTED" && current.cause && !seen.has(current)) {
    seen.add(current);
    current = current.cause;
  }
  return current || error;
}

function entryForStatus(status) {
  if (!status) return null;
  if (Object.prototype.hasOwnProperty.call(STATUS_TABLE, status)) return STATUS_TABLE[status];
  if (status >= 500) return ["server_error", true, false];
  if (status >= 400) return ["client_error", false, true];
  return null;
}

/**
 * 分类一次 Provider 失败（或聚合后的链错误）。
 * @returns {{failureClass: string, fallbackEligible: boolean, failFast: boolean,
 *            reason: string, reasonCode: string, httpStatus: number}}
 *   - fallbackEligible=true：临时性故障，允许推进 fallback Provider（消耗共享账本）；
 *   - failFast=true：确定性不可重试，立即重抛，不得包装成降级成功（配置类）或换 Provider；
 *   - 两者皆 false：skipped 类（熔断/预算/租约），推进下一 Provider 但不消耗账本。
 * reason / reasonCode 为稳定机器可读 token；Trace 统一落点由 Wave 2 收尾。
 */
function classifyFallbackEligibility(error) {
  const root = resolveProviderRootCause(error);
  // 聚合链错误（PROVIDER_CHAIN_EXHAUSTED 包装）已无下一 Provider 可推进：
  // skipped 语义失效，提升为 fail fast，由 Decision/Response 终止或受控降级。
  const chainExhausted = root !== error;
  const code = normalizeCode(root);
  const httpStatus = normalizeHttpStatus(root);
  let entry = Object.prototype.hasOwnProperty.call(CODE_TABLE, code) ? CODE_TABLE[code] : null;
  let reason = entry ? `code:${code}` : "";
  if (entry && GENERIC_TRANSPORT_CODES.has(code)) {
    // 通用传输码（axios 粗粒度码）让位于更精确的数值状态表。
    const statusEntry = entryForStatus(httpStatus);
    if (statusEntry) {
      entry = statusEntry;
      reason = `http:${httpStatus}`;
    }
  }
  if (!entry) {
    entry = entryForStatus(httpStatus);
    if (entry) reason = `http:${httpStatus}`;
  }
  if (!entry) {
    // 默认不 fallback：未枚举的码一律 fail fast。
    entry = ["unknown", false, true];
    reason = "default_fail_fast";
  }
  const failFast = entry[2] || (chainExhausted && !entry[1]);
  return Object.freeze({
    failureClass: entry[0],
    fallbackEligible: entry[1],
    failFast,
    reason,
    reasonCode: code || "PROVIDER_FAILED",
    httpStatus,
  });
}

module.exports = Object.freeze({
  classifyFallbackEligibility,
  normalizeHttpStatus,
  resolveProviderRootCause,
});
