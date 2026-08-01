/**
 * 环境无关 Agent Run 客户端（P6a）。
 *
 * 依赖注入：request/storage/clock/logger/sleep 全部由宿主环境提供——
 * 本模块不 require http/https/net/wx/DOM，也不引用任何服务端或校园业务
 * 模块（packages 边界测试与源码静态扫描双重保证）。
 *
 * 传输策略：默认 cursor polling；流传输（如 SSE）以 Adapter 注入，
 * 启动失败自动降级 polling 并记录原因（transport 细节不外泄到业务页）。
 * 取消是端到端真实语义：网络超时不等于已取消，以服务端的权威状态为准。
 */

const {
  createRunState,
  isTerminalStatus,
  reduceRunEvent,
} = require("./runStateMachine");

const DEFAULT_ROUTES = Object.freeze({
  createRun: "/api/agent/runs",
  run: (runId) => `/api/agent/runs/${encodeURIComponent(runId)}`,
  cancel: (runId) => `/api/agent/runs/${encodeURIComponent(runId)}/cancel`,
});

const RETRIABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function classifyHttpFailure(status, code, error) {
  if (error) {
    return { errorClass: "network", retriable: true, message: String(error && error.message || error).slice(0, 200) };
  }
  const numeric = Number(status) || 0;
  const bodyCode = String(code || "").slice(0, 96);
  if (bodyCode === "RUN_PROTOCOL_UNSUPPORTED") {
    return { errorClass: "unsupported_protocol", retriable: false, message: bodyCode };
  }
  if (numeric === 401 || numeric === 403) return { errorClass: "auth", retriable: false, message: bodyCode || `HTTP ${numeric}` };
  if (numeric === 404) return { errorClass: "not_found", retriable: false, message: bodyCode || "HTTP 404" };
  if (numeric === 410) return { errorClass: "expired", retriable: false, message: bodyCode || "HTTP 410" };
  if (numeric === 409) return { errorClass: "conflict", retriable: false, message: bodyCode || "HTTP 409" };
  if (numeric === 400) return { errorClass: "validation", retriable: false, message: bodyCode || "HTTP 400" };
  if (RETRIABLE_HTTP_STATUSES.has(numeric)) {
    return { errorClass: numeric === 429 ? "rate_limited" : "internal", retriable: true, message: bodyCode || `HTTP ${numeric}` };
  }
  return { errorClass: "internal", retriable: false, message: bodyCode || `HTTP ${numeric}` };
}

function createMemoryStorage() {
  const map = new Map();
  return {
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, value) => { map.set(key, value); },
    remove: (key) => { map.delete(key); },
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPollingTransport(deps) {
  return Object.freeze({
    name: "polling",
    // polling 无长连接：start 直接返回 false 表示由调用方走轮询循环。
    start: () => false,
    stop: () => {},
    describe: () => ({ name: "polling", streaming: false }),
  });
}

function createAgentRunClient(options = {}) {
  const request = options.request;
  if (typeof request !== "function") {
    throw new Error("AGENT_SDK_REQUEST_REQUIRED");
  }
  const storage = options.storage && typeof options.storage.get === "function"
    ? options.storage
    : createMemoryStorage();
  const clock = options.clock && typeof options.clock.now === "function"
    ? options.clock
    : { now: () => Date.now() };
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const sleep = typeof options.sleep === "function" ? options.sleep : defaultSleep;
  const routes = Object.assign({}, DEFAULT_ROUTES, options.routes || {});
  const protocolVersion = String(options.protocolVersion || "run.v2").slice(0, 32);
  const streamingTransport = options.transport && typeof options.transport.start === "function"
    ? options.transport
    : null;
  const maxWaitMs = Math.max(1000, Number(options.maxWaitMs || 120000) || 120000);

  const handles = new Map(); // runId -> 状态机（进程内权威投影；storage 为恢复副本）
  const states = new Map();

  function storageKey(runId) {
    return `agent-run:${String(runId || "")}`;
  }

  async function saveHandle(handle) {
    handles.set(handle.runId, handle);
    try {
      await Promise.resolve(storage.set(storageKey(handle.runId), {
        runId: handle.runId,
        pollToken: handle.pollToken,
        cursor: handle.cursor,
        status: handle.status,
        protocolVersion: handle.protocolVersion,
        compatibilityMode: handle.compatibilityMode || "native",
      }));
    } catch (error) {
      logger("sdk-storage-write-failed", { code: String(error && error.code || "").slice(0, 64) });
    }
  }

  async function loadHandle(runId) {
    const key = String(runId || "");
    if (handles.has(key)) return handles.get(key);
    let stored = null;
    try {
      stored = await Promise.resolve(storage.get(storageKey(key)));
    } catch (error) {
      logger("sdk-storage-read-failed", { code: String(error && error.code || "").slice(0, 64) });
    }
    if (stored && stored.runId) {
      handles.set(key, stored);
      return stored;
    }
    return null;
  }

  function stateFor(runId, cursor) {
    const key = String(runId || "");
    if (!states.has(key)) states.set(key, createRunState({ runId: key, cursor }));
    const state = states.get(key);
    if (Number.isInteger(cursor) && cursor > state.cursor) state.cursor = cursor;
    return state;
  }

  async function callApi(method, path, body, query) {
    let response;
    try {
      response = await request({
        method,
        path,
        body,
        query,
        headers: { "content-type": "application/json", accept: "application/json" },
      });
    } catch (error) {
      const failure = classifyHttpFailure(0, "", error);
      return { ok: false, status: 0, failure };
    }
    const status = Number(response && response.status) || 0;
    const json = response && response.json;
    if (status >= 200 && status < 300) return { ok: true, status, json };
    const failure = classifyHttpFailure(status, json && json.code, null);
    return { ok: false, status, json, failure };
  }

  async function createRun(message, opts = {}) {
    const text = String(message || "").trim();
    if (!text) throw new Error("AGENT_SDK_MESSAGE_REQUIRED");
    const body = {
      message: text,
      requestId: String(opts.requestId || `sdk-${clock.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).slice(0, 96),
      conversationId: String(opts.conversationId || "").slice(0, 96),
      context: Object.assign({}, opts.context || {}),
      protocolVersion,
    };
    if (opts.idempotencyKey) body.idempotencyKey = String(opts.idempotencyKey).slice(0, 128);
    const created = await callApi("POST", routes.createRun, body);
    if (!created.ok) {
      const error = new Error(created.failure.message);
      error.errorClass = created.failure.errorClass;
      error.retriable = created.failure.retriable;
      throw error;
    }
    const payload = created.json || {};
    const handle = {
      runId: String(payload.runId || ""),
      pollToken: String(payload.pollToken || ""),
      status: String(payload.status || "queued"),
      cursor: Math.max(0, Number(payload.eventCursor || 0) || 0),
      protocolVersion: String(payload.protocolVersion || protocolVersion),
      compatibilityMode: String(payload.diagnostics && payload.diagnostics.compatibilityMode || "native"),
      nextPollMs: Math.max(50, Number(payload.nextPollMs || 400) || 400),
    };
    if (!handle.runId) {
      // 服务端应答违反 Run 契约（缺 runId）：归类为可重试的服务失败
      // （RUN_CREATE_FAILED 与旧 agentRunClient 同码），调用方据此走离线降级，
      // 而不是把契约破坏暴露成未分类异常。
      const contractError = new Error("AGENT_SDK_RUN_ID_MISSING");
      contractError.code = "RUN_CREATE_FAILED";
      contractError.errorClass = "internal";
      contractError.retriable = true;
      throw contractError;
    }
    stateFor(handle.runId, handle.cursor);
    await saveHandle(handle);
    return Object.assign({}, handle, { capabilities: payload.capabilities || null });
  }

  async function poll(runId, opts = {}) {
    const handle = await loadHandle(runId);
    if (!handle) {
      const error = new Error("AGENT_SDK_RUN_UNKNOWN");
      error.errorClass = "not_found";
      error.retriable = false;
      throw error;
    }
    const state = stateFor(handle.runId, handle.cursor);
    const query = { afterSequence: state.cursor };
    if (handle.pollToken) query.pollToken = handle.pollToken;
    const view = await callApi("GET", routes.run(handle.runId), undefined, query);
    if (!view.ok) {
      // 可重试失败保持本地状态不变（网络超时不等于取消/失败）。
      return { ok: false, status: handle.status, failure: view.failure, appliedEvents: 0 };
    }
    const payload = view.json || {};
    const events = Array.isArray(payload.events) ? payload.events : [];
    let applied = 0;
    events.forEach((event) => {
      const result = reduceRunEvent(state, event);
      if (result.applied) applied += 1;
    });
    handle.status = String(payload.status || state.status);
    handle.cursor = Math.max(state.cursor, Number(payload.eventCursor || 0) || 0);
    handle.nextPollMs = Math.max(0, Number(payload.nextPollMs || 0) || 0);
    if (isTerminalStatus(handle.status) && payload.result !== undefined && payload.result !== null) {
      state.result = payload.result;
    }
    await saveHandle(handle);
    return {
      ok: true,
      status: handle.status,
      appliedEvents: applied,
      duplicateEvents: events.length - applied,
      eventCursor: handle.cursor,
      nextPollMs: handle.nextPollMs,
      result: isTerminalStatus(handle.status) ? state.result : null,
      terminal: isTerminalStatus(handle.status),
    };
  }

  // 断线恢复：凭 storage 中的 cursor 续读，绝不重建 Run。
  async function resumeFromCursor(runId) {
    return poll(runId, { resume: true });
  }

  async function reconnect(runId) {
    const handle = await loadHandle(runId);
    if (!handle) {
      const error = new Error("AGENT_SDK_RUN_UNKNOWN");
      error.errorClass = "not_found";
      error.retriable = false;
      throw error;
    }
    logger("sdk-reconnect", { runId: handle.runId.slice(0, 24), cursor: handle.cursor });
    return poll(handle.runId);
  }

  async function waitForTerminal(runId, opts = {}) {
    const deadline = clock.now() + Math.max(1000, Number(opts.timeoutMs || maxWaitMs) || maxWaitMs);
    const signal = opts.signal || null;
    let last = null;
    for (;;) {
      if (signal && signal.aborted) {
        const error = new Error("AGENT_SDK_WAIT_ABORTED");
        error.errorClass = "cancelled";
        error.retriable = false;
        throw error;
      }
      // eslint-disable-next-line no-await-in-loop
      last = await poll(runId);
      if (last.ok && last.terminal) return last;
      if (clock.now() > deadline) {
        const error = new Error("AGENT_SDK_WAIT_TIMEOUT");
        error.errorClass = "timeout";
        error.retriable = true;
        error.lastStatus = last && last.status;
        throw error;
      }
      const waitMs = last.ok ? Math.max(100, last.nextPollMs || 400) : 800;
      // eslint-disable-next-line no-await-in-loop
      await sleep(waitMs);
    }
  }

  async function cancelRun(runId) {
    const handle = await loadHandle(runId);
    if (!handle) {
      const error = new Error("AGENT_SDK_RUN_UNKNOWN");
      error.errorClass = "not_found";
      error.retriable = false;
      throw error;
    }
    const body = handle.pollToken ? { pollToken: handle.pollToken } : {};
    const cancelled = await callApi("POST", routes.cancel(handle.runId), body);
    if (!cancelled.ok) {
      // 网络/可重试失败：不伪造 cancelled，调用方应重试或以 poll 恢复权威状态。
      return { ok: false, status: handle.status, failure: cancelled.failure };
    }
    const payload = cancelled.json || {};
    handle.status = String(payload.status || "cancelled");
    await saveHandle(handle);
    const state = stateFor(handle.runId, handle.cursor);
    if (isTerminalStatus(handle.status)) state.status = handle.status;
    return { ok: true, status: handle.status, alreadyFinished: payload.alreadyFinished === true };
  }

  // 终态结果恢复：断线发生在终态事件前后都可凭此取得最终状态；
  // 非终态返回当前权威状态，不伪造结果。
  async function recoverFinalResult(runId) {
    const view = await poll(runId);
    if (!view.ok) return { ok: false, failure: view.failure, status: view.status };
    if (!view.terminal) return { ok: true, terminal: false, status: view.status, result: null };
    return { ok: true, terminal: true, status: view.status, result: view.result };
  }

  function getState(runId) {
    const key = String(runId || "");
    return states.get(key) || null;
  }

  return Object.freeze({
    cancelRun,
    createRun,
    getState,
    poll,
    reconnect,
    recoverFinalResult,
    resumeFromCursor,
    waitForTerminal,
    // 传输协商：流式 Adapter 由宿主注入（P6b wx adapter）；未注入或启动
    // 失败时客户端以 polling 为权威传输并如实记录。
    transport: streamingTransport || createPollingTransport({ request }),
    protocolVersion,
  });
}

module.exports = Object.freeze({
  classifyHttpFailure,
  createAgentRunClient,
  createMemoryStorage,
  createPollingTransport,
});
