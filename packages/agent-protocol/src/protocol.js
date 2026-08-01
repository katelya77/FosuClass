/**
 * Run protocol version / capability negotiation / error taxonomy (P6a).
 *
 * 交付语义：服务端至少一次可重放 + 客户端按 eventId/sequence 幂等消费
 * = 用户状态不重复、不回退。本模块只定义契约常量与纯函数，不依赖任何
 * 传输、存储或业务模块。
 */

const PROTOCOL_VERSION = "run.v2";
const MIN_COMPATIBLE_VERSION = "run.v1";

// 受控兼容层：现网客户端（小程序 agentRunClient / aiTransportRouter 与能力
// 清单 protocolVersions）在 Run API 上发送的信封版本。拒绝它们等于让全部
// 现存客户端 400——这些版本进入 legacy 兼容路径，服务端仍按 run.v2 应答
// （additive 字段，旧客户端忽略）。显式未知版本才 fail clearly。
const LEGACY_PROTOCOL_VERSIONS = Object.freeze(["run.v1", "agent.v1", "agent.v2"]);

// 与 packages/ui-schema 的 UI_BLOCK_TYPES 保持一一对应（tools 层有 parity 测试
// 防漂移；protocol 包刻意不 require ui-schema，保持依赖方向最低层）。
const SUPPORTED_UI_BLOCKS = Object.freeze([
  "text",
  "markdown",
  "plan",
  "tool_progress",
  "list",
  "detail",
  "schedule",
  "clarification",
  "confirmation",
  "action_receipt",
  "warning",
  "error",
]);

const PROTOCOL_CAPABILITIES = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  minimumCompatibleVersion: MIN_COMPATIBLE_VERSION,
  supportedTransports: Object.freeze(["polling"]),
  supportedUiBlocks: SUPPORTED_UI_BLOCKS,
  cursorResume: true,
  cancellation: true,
  finalResultRecovery: true,
  actionReceipt: true,
  idempotencyKey: true,
});

const RUN_ERROR_CLASSES = Object.freeze([
  "validation",
  "auth",
  "not_found",
  "expired",
  "conflict",
  "rate_limited",
  "timeout",
  "cancelled",
  "provider",
  "internal",
  "unsupported_protocol",
]);

const ERROR_CLASS_BY_CODE = Object.freeze({
  RUN_PROTOCOL_UNSUPPORTED: "unsupported_protocol",
  RUN_NOT_FOUND: "not_found",
  RUN_EXPIRED: "expired",
  RUN_FORBIDDEN: "auth",
  RUN_POLL_TOKEN_REQUIRED: "auth",
  RUN_IDEMPOTENCY_CONFLICT: "conflict",
  RUN_RATE_LIMITED: "rate_limited",
  RATE_LIMITED: "rate_limited",
  RUN_DEADLINE_EXCEEDED: "timeout",
  TIMEOUT: "timeout",
  RUN_CANCELLED: "cancelled",
  ABORTED: "cancelled",
  MESSAGE_REQUIRED: "validation",
  RUN_EVENT_RUN_ID_REQUIRED: "validation",
  RUN_EVENT_SEQUENCE_INVALID: "validation",
  RUN_EVENT_TYPE_UNSUPPORTED: "validation",
  RUN_EVENT_TIMESTAMP_INVALID: "validation",
});

// 旧 direct chat 兼容路径的协议侧契约标记（客户端落地见 P6b；此处只定义
// 稳定的字段名与语义，兼容路径不得伪造 plan/tool_progress/verification/
// action_receipt 事件）。
const DIRECT_CHAT_COMPAT = Object.freeze({
  mode: "compatibility-only",
  deprecated: true,
  reasonField: "compatReason",
  forgedEventsForbidden: Object.freeze(["plan", "tool_progress", "verification", "action_receipt"]),
});

function classifyRunError(code) {
  const key = String(code || "").slice(0, 96);
  if (!key) return "internal";
  if (ERROR_CLASS_BY_CODE[key]) return ERROR_CLASS_BY_CODE[key];
  if (/^PROVIDER_/.test(key)) return "provider";
  if (/^RUN_/.test(key)) return "internal";
  return "internal";
}

/**
 * 协议版本协商。缺失版本默认当前协议（宽容）；run.v1 与现网信封版本
 * （agent.v1/agent.v2）进入受控兼容路径；显式未知版本 fail clearly
 * （不白屏、不无限重试、不静默降级产品语义）。
 */
function negotiateProtocol(clientVersion) {
  const requested = String(clientVersion || "").trim();
  if (!requested || requested === PROTOCOL_VERSION) {
    return Object.freeze({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      compatibilityMode: "native",
      capabilities: PROTOCOL_CAPABILITIES,
    });
  }
  if (LEGACY_PROTOCOL_VERSIONS.includes(requested)) {
    return Object.freeze({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      requestedVersion: requested,
      compatibilityMode: "legacy",
      capabilities: PROTOCOL_CAPABILITIES,
    });
  }
  return Object.freeze({
    ok: false,
    protocolVersion: PROTOCOL_VERSION,
    requestedVersion: requested.slice(0, 32),
    compatibilityMode: "unsupported",
    code: "RUN_PROTOCOL_UNSUPPORTED",
    errorClass: "unsupported_protocol",
    capabilities: PROTOCOL_CAPABILITIES,
  });
}

module.exports = Object.freeze({
  DIRECT_CHAT_COMPAT,
  LEGACY_PROTOCOL_VERSIONS,
  MIN_COMPATIBLE_VERSION,
  PROTOCOL_CAPABILITIES,
  PROTOCOL_VERSION,
  RUN_ERROR_CLASSES,
  SUPPORTED_UI_BLOCKS,
  classifyRunError,
  negotiateProtocol,
});
