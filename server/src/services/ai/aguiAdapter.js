/**
 * AG-UI compatible event adapter for Xiaofu Agent Runtime.
 * Maps existing Run Events → AG-UI event stream without replacing the custom UI.
 * AG-UI threadId = conversationId; AG-UI runId = agent runId.
 * Cards / actionCommands travel as STATE_SNAPSHOT / custom payload.
 */

const EVENT_MAP = Object.freeze({
  "run.accepted": "RUN_STARTED",
  "request.sanitized": "STEP_STARTED",
  "understanding.started": "STEP_STARTED",
  "understanding.completed": "STEP_FINISHED",
  "understanding.fallback": "STEP_FINISHED",
  "intent.resolved": "STEP_FINISHED",
  "skill.selected": "STEP_FINISHED",
  "plan.created": "STEP_FINISHED",
  "plan.replan": "STEP_STARTED",
  "planner.started": "STEP_STARTED",
  "planner.completed": "STEP_FINISHED",
  "planner.failed": "STEP_FINISHED",
  "tool.started": "TOOL_CALL_START",
  "tool.completed": "TOOL_CALL_END",
  "tool.failed": "TOOL_CALL_END",
  "provider.selected": "STEP_STARTED",
  "provider.started": "STEP_STARTED",
  "provider.completed": "STEP_FINISHED",
  "provider.failed": "STEP_FINISHED",
  "provider.shadow.started": "STEP_STARTED",
  "provider.shadow.completed": "STEP_FINISHED",
  "provider.shadow.failed": "STEP_FINISHED",
  "response.composing": "TEXT_MESSAGE_START",
  "result.verifying": "STEP_STARTED",
  "run.completed": "RUN_FINISHED",
  "run.degraded": "RUN_FINISHED",
  "run.failed": "RUN_ERROR",
  "run.cancelled": "RUN_ERROR",
});

function safeId(value, fallback = "") {
  return String(value == null ? fallback : value).slice(0, 120);
}

function safeText(value, max = 400) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Map a single Run Event to zero or more AG-UI events.
 * @returns {Array<object>}
 */
function mapRunEventToAgui(event = {}, context = {}) {
  const type = String(event.type || event.eventType || "");
  const threadId = safeId(context.threadId || context.conversationId || event.conversationId || event.threadId, "unknown");
  const runId = safeId(context.runId || event.runId, "unknown");
  const aguiType = EVENT_MAP[type];
  if (!aguiType) return [];

  const base = {
    type: aguiType,
    threadId,
    runId,
    timestamp: event.at || event.timestamp || new Date().toISOString(),
    sourceEvent: type,
  };

  if (aguiType === "RUN_STARTED") {
    return [Object.assign({}, base, { message: safeText(event.loadingText || "run started", 120) })];
  }
  if (aguiType === "RUN_FINISHED") {
    return [Object.assign({}, base, {
      status: safeText(event.status || (type === "run.degraded" ? "degraded" : "completed"), 24),
      message: safeText(event.loadingText || event.summary || "run finished", 200),
    })];
  }
  if (aguiType === "RUN_ERROR") {
    return [Object.assign({}, base, {
      status: "error",
      code: safeText(event.code || type, 80),
      message: safeText(event.loadingText || event.message || "run failed", 200),
    })];
  }
  if (aguiType === "TOOL_CALL_START") {
    const toolCallId = safeId(event.toolCallId || `${runId}-${event.tool || event.toolName || "tool"}`, "tool");
    return [
      Object.assign({}, base, {
        toolCallId,
        toolCallName: safeText(event.tool || event.toolName || "", 80),
        message: safeText(event.loadingText || "", 120),
      }),
      Object.assign({}, base, {
        type: "TOOL_CALL_ARGS",
        toolCallId,
        // never dump raw args/secrets — only public summary fields
        args: {
          tool: safeText(event.tool || event.toolName || "", 80),
          intent: safeText(event.intentName || event.intent || "", 80),
        },
      }),
    ];
  }
  if (aguiType === "TOOL_CALL_END") {
    return [Object.assign({}, base, {
      toolCallId: safeId(event.toolCallId || `${runId}-${event.tool || event.toolName || "tool"}`, "tool"),
      toolCallName: safeText(event.tool || event.toolName || "", 80),
      status: type === "tool.failed" ? "failed" : "success",
      message: safeText(event.loadingText || event.summary || "", 160),
    })];
  }
  if (aguiType === "TEXT_MESSAGE_START") {
    const messageId = safeId(event.messageId || `${runId}-msg`, "msg");
    return [Object.assign({}, base, {
      messageId,
      role: "assistant",
    })];
  }
  if (aguiType === "STEP_STARTED" || aguiType === "STEP_FINISHED") {
    return [Object.assign({}, base, {
      stepName: safeText(type, 80),
      message: safeText(event.loadingText || "", 160),
    })];
  }
  return [base];
}

/**
 * Build STATE_SNAPSHOT carrying existing custom protocol (cards, actionCommands).
 */
function buildStateSnapshot(payload = {}, context = {}) {
  const threadId = safeId(context.threadId || context.conversationId || payload.conversationId, "unknown");
  const runId = safeId(context.runId || payload.runId, "unknown");
  return {
    type: "STATE_SNAPSHOT",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    snapshot: {
      answer: safeText(payload.answer || payload.text || "", 4000),
      cards: Array.isArray(payload.cards) ? payload.cards.slice(0, 8) : [],
      actionCommands: Array.isArray(payload.actionCommands) ? payload.actionCommands.slice(0, 8) : [],
      suggestions: Array.isArray(payload.suggestions) ? payload.suggestions.slice(0, 8) : [],
      evidence: Array.isArray(payload.evidence) ? payload.evidence.slice(0, 12) : [],
      protocolVersion: payload.protocolVersion || "agent.v2",
      runtimeMode: safeText(payload.runtimeMode || context.runtimeMode || "public", 20),
      lockedEntityType: safeText(payload.lockedEntityType || "", 24),
      goal: safeText(payload.goal || "", 40),
    },
  };
}

/**
 * Convert a full run event list + final response into ordered AG-UI events.
 * Guarantees RUN_STARTED … RUN_FINISHED|RUN_ERROR order when possible.
 */
function mapRunToAguiEvents(input = {}) {
  const conversationId = safeId(input.conversationId || input.threadId, "unknown");
  const runId = safeId(input.runId, "unknown");
  const context = { threadId: conversationId, runId, conversationId, runtimeMode: input.runtimeMode };
  const events = Array.isArray(input.events) ? input.events : [];
  const out = [];
  let hasStarted = false;
  let hasTerminal = false;

  events.forEach((event) => {
    const mapped = mapRunEventToAgui(event, context);
    mapped.forEach((item) => {
      if (item.type === "RUN_STARTED") hasStarted = true;
      if (item.type === "RUN_FINISHED" || item.type === "RUN_ERROR") hasTerminal = true;
      out.push(item);
    });
  });

  if (!hasStarted) {
    out.unshift({
      type: "RUN_STARTED",
      threadId: conversationId,
      runId,
      timestamp: new Date().toISOString(),
      message: "run started",
    });
  }

  if (input.response || input.cards || input.actionCommands || input.answer) {
    out.push(buildStateSnapshot(Object.assign({}, input.response || {}, {
      answer: input.answer || (input.response && input.response.answer),
      cards: input.cards || (input.response && input.response.cards),
      actionCommands: input.actionCommands || (input.response && input.response.actionCommands),
      conversationId,
      runId,
      runtimeMode: input.runtimeMode,
    }), context));
  }

  if (input.answer || (input.response && input.response.answer)) {
    const messageId = `${runId}-final`;
    const text = safeText(input.answer || input.response.answer, 4000);
    out.push({ type: "TEXT_MESSAGE_START", threadId: conversationId, runId, messageId, role: "assistant", timestamp: new Date().toISOString() });
    out.push({ type: "TEXT_MESSAGE_CONTENT", threadId: conversationId, runId, messageId, delta: text, timestamp: new Date().toISOString() });
    out.push({ type: "TEXT_MESSAGE_END", threadId: conversationId, runId, messageId, timestamp: new Date().toISOString() });
  }

  if (!hasTerminal) {
    const failed = Boolean(input.error || input.failed);
    out.push({
      type: failed ? "RUN_ERROR" : "RUN_FINISHED",
      threadId: conversationId,
      runId,
      timestamp: new Date().toISOString(),
      status: failed ? "error" : "completed",
      message: safeText(input.error && input.error.message || (failed ? "run failed" : "run finished"), 200),
    });
  }

  return out;
}

function serializeSse(events = []) {
  return (Array.isArray(events) ? events : [])
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

module.exports = {
  EVENT_MAP,
  mapRunEventToAgui,
  buildStateSnapshot,
  mapRunToAguiEvents,
  serializeSse,
};
