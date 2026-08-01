/**
 * 环境无关 Run 状态机 + 幂等 reducer（P6a）。
 *
 * 交付语义：服务端至少一次可重放 + 客户端按 eventId/sequence 幂等消费
 * = 状态不重复、不回退。本模块不触碰任何传输/API，只处理纯状态。
 */

const TERMINAL_STATUSES = Object.freeze(["completed", "degraded", "failed", "cancelled"]);
const TERMINAL_STATUS_SET = new Set(TERMINAL_STATUSES);

const STATUS_BY_TERMINAL_EVENT = Object.freeze({
  "run.completed": "completed",
  "run.degraded": "degraded",
  "run.failed": "failed",
  "run.cancelled": "cancelled",
});

// 合法状态转换：queued→running→terminal；running 上普通事件保持 running；
// terminal 为吸收态（不可被后续普通或终态事件覆盖）；cancelled 与普通失败
// 是不同终态，不得互相改写。
const LEGAL_TRANSITIONS = Object.freeze({
  queued: Object.freeze(["running", "completed", "degraded", "failed", "cancelled"]),
  running: Object.freeze(["running", "completed", "degraded", "failed", "cancelled"]),
  completed: Object.freeze([]),
  degraded: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

const MAX_SEEN_EVENT_IDS = 500;
const MAX_KEPT_EVENTS = 200;

function isTerminalStatus(status) {
  return TERMINAL_STATUS_SET.has(status);
}

function createRunState(input = {}) {
  return {
    runId: String(input.runId || ""),
    status: "queued",
    cursor: Math.max(0, Number(input.cursor || 0) || 0),
    events: [],
    seenEventIds: [],
    result: null,
    terminalEventId: "",
    diagnostics: [],
  };
}

function pushDiagnostic(state, code, detail) {
  state.diagnostics.push({
    code: String(code || "").slice(0, 64),
    detail: String(detail == null ? "" : detail).slice(0, 200),
  });
  if (state.diagnostics.length > 50) state.diagnostics = state.diagnostics.slice(-50);
}

/**
 * 幂等归并一个事件。返回 { applied, reason }：
 * - duplicate_eventId：同一 eventId 不重复应用；
 * - stale_sequence：sequence ≤ cursor，不让状态倒退；
 * - after_terminal：终态后不再应用任何事件（终态不可覆盖）；
 * - out_of_order：sequence 跳跃时仍按序推进 cursor，但记录诊断，
 *   调用方应视情况重新拉取权威快照。
 */
function reduceRunEvent(state, event = {}) {
  if (!state || typeof state !== "object") throw new Error("RUN_STATE_REQUIRED");
  const sequence = Number(event.sequence);
  const type = String(event.type || "");
  if (!type) return { applied: false, reason: "invalid_event" };
  if (!Number.isInteger(sequence) || sequence < 1) {
    pushDiagnostic(state, "invalid_sequence", `${type}#${event.sequence}`);
    return { applied: false, reason: "invalid_sequence" };
  }
  const eventId = String(event.eventId || "");
  if (eventId && state.seenEventIds.includes(eventId)) {
    return { applied: false, reason: "duplicate_eventId" };
  }
  if (sequence <= state.cursor) {
    return { applied: false, reason: "stale_sequence" };
  }
  if (isTerminalStatus(state.status)) {
    pushDiagnostic(state, "after_terminal", `${type}#${sequence} after ${state.status}`);
    return { applied: false, reason: "after_terminal" };
  }
  if (sequence > state.cursor + 1) {
    pushDiagnostic(state, "out_of_order_gap", `cursor ${state.cursor} -> ${sequence}`);
  }

  const nextStatus = STATUS_BY_TERMINAL_EVENT[type] || "running";
  const legal = (LEGAL_TRANSITIONS[state.status] || []).includes(nextStatus);
  if (!legal) {
    pushDiagnostic(state, "illegal_transition", `${state.status} -> ${nextStatus} (${type}#${sequence})`);
    return { applied: false, reason: "illegal_transition" };
  }

  state.status = nextStatus;
  state.cursor = sequence;
  if (eventId) {
    state.seenEventIds.push(eventId);
    if (state.seenEventIds.length > MAX_SEEN_EVENT_IDS) {
      state.seenEventIds = state.seenEventIds.slice(-MAX_SEEN_EVENT_IDS);
    }
  }
  state.events.push(event);
  if (state.events.length > MAX_KEPT_EVENTS) state.events = state.events.slice(-MAX_KEPT_EVENTS);
  if (STATUS_BY_TERMINAL_EVENT[type]) {
    state.terminalEventId = eventId;
    if (event.result !== undefined && event.result !== null) state.result = event.result;
  }
  return { applied: true, reason: "applied" };
}

module.exports = Object.freeze({
  LEGAL_TRANSITIONS,
  TERMINAL_STATUSES,
  createRunState,
  isTerminalStatus,
  reduceRunEvent,
});
