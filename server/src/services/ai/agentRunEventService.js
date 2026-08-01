/**
 * Agent Run store with user-safe event timeline.
 *
 * P5a WS3：模块单例 → 可注入工厂 createRunEventService({ store })。
 *   - 默认内存实现（createMemoryRunStore）行为与 P5a 前逐字一致：runs 为
 *     短生命周期、容量受限、principal 隔离、不持久的内存投影（TTL 清理、
 *     TERMINAL 语义、resetForTests 等测试钩子原样）；
 *   - 注入 durable store（journal / pg）后，同一套领域逻辑把每次变更转发
 *     给 store 落存，并把 180s TTL 重定义为数据保留窗口（≥ 断线恢复窗口，
 *     见 persistence/runRetentionPolicy）；进程重启经 store.hydrate() 重放
 *     恢复 accepted/running（design.md §8.2）——恢复只还原文档与事件流，
 *     不重复执行副作用；崩溃时非终态 Run 由服务层如实追加
 *     RUN_EXECUTOR_LOST 终态标记（轮询客户端看到真相而非永久挂起）；
 *   - RunEvent 仍是公开摘要（publicEventSummary）：不含密钥、隐藏推理或
 *     敏感记忆；落存对象与轮询返回对象是同一个。
 *
 * 模块级导出 = 薄默认实例（12 函数 repository surface 逐字不变 +
 * DEFAULT_* 常量），createRunHandlers / fosuTurnPorts 零改动；
 * platformComposition 组合根经 bindDefaultStore 把默认实例绑定到按
 * FOSU_AGENT_REPOSITORY_BACKEND 选择的 durable store（绑定后模块级函数
 * 与 fosuTurnPorts 的 isCancelled 落到同一实例）。
 */
const crypto = require("crypto");
const { publicEventSummary, loadingTextForEvent } = require("./runEventCatalog");
const { createMemoryRunStore } = require("./persistence/memoryRunStore");
const AGENT_PROTOCOL = require("../../../../packages/agent-protocol");

const DEFAULT_TTL_MS = Math.max(30_000, Number(process.env.AI_AGENT_RUN_TTL_MS || 180_000) || 180_000);
const DEFAULT_MAX_RUNS = Math.max(32, Number(process.env.AI_AGENT_RUN_MAX || 256) || 256);
const DEFAULT_TOTAL_TIMEOUT_MS = Math.min(15_000, Math.max(5_000, Number(process.env.AI_AGENT_RUN_TOTAL_TIMEOUT_MS || 15_000) || 15_000));
const TERMINAL_EVENT_TYPES = new Set(["run.completed", "run.degraded", "run.failed", "run.cancelled"]);
const TERMINAL_STATUS_BY_EVENT = Object.freeze({
  "run.completed": "completed",
  "run.degraded": "degraded",
  "run.failed": "failed",
  "run.cancelled": "cancelled",
});
const TERMINAL_STATUSES = new Set(Object.keys(TERMINAL_STATUS_BY_EVENT).map((type) => TERMINAL_STATUS_BY_EVENT[type]));

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function principalFingerprint(serverSession = null) {
  if (!serverSession || !serverSession.openidHash) return "anonymous";
  return hashToken(`principal|${serverSession.openidHash}|${serverSession.appid || ""}`).slice(0, 32);
}

function statusFromResult(result = {}) {
  const status = String(result && (result.status || result.runStatus) || "").toLowerCase();
  if (status === "cancelled") return "cancelled";
  if (status === "partial" || result.partialCompletion === true) return "degraded";
  if (status === "failed" || status === "error" || result.success === false) return "failed";
  if (status === "degraded" || result.fallback === true) return "degraded";
  return "completed";
}

function isThenable(value) {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function";
}

function createRunEventService(options = {}) {
  const store = options.store || createMemoryRunStore();
  // 内存后端：180s 内存清理语义（逐字保持）；durable 后端：保留窗口（数据保留
  // 策略，P6a cursor 重放依赖），由 store 携带（runRetentionPolicy 保证 ≥ 恢复窗口）。
  const ttlMs = store.retentionMs === undefined
    ? DEFAULT_TTL_MS
    : Math.max(1, Number(store.retentionMs) || DEFAULT_TTL_MS);
  const terminalTtlMs = store.terminalRetentionMs === undefined
    ? Math.min(DEFAULT_TTL_MS, 120_000)
    : Math.max(1, Number(store.terminalRetentionMs) || Math.min(DEFAULT_TTL_MS, 120_000));
  const runs = new Map();
  // (principalFp|idempotencyKey) → runId：design.md §8.1 唯一键的服务层第一
  // 防线（重复提交重放既有 Run；PG 唯一约束为第二防线）。仅当调用方显式传
  // idempotencyKey 时生效，未传键的行为与 P5a 前逐字一致。
  const idempotencyKeys = new Map();

  function snapshotOf(run) {
    return JSON.parse(JSON.stringify(run));
  }

  function forgetIdempotency(run) {
    if (run && run.idempotencyKey) {
      idempotencyKeys.delete(`${run.principalFp}|${run.idempotencyKey}`);
    }
  }

  function pruneExpired(now = Date.now()) {
    const pruned = [];
    for (const [id, run] of runs.entries()) {
      if (!run || run.expiresAtMs <= now) {
        runs.delete(id);
        forgetIdempotency(run);
        pruned.push(id);
      }
    }
    if (runs.size > DEFAULT_MAX_RUNS) {
      const ordered = Array.from(runs.values()).sort((a, b) => a.createdAtMs - b.createdAtMs);
      const overflow = ordered.length - DEFAULT_MAX_RUNS;
      for (let i = 0; i < overflow; i += 1) {
        runs.delete(ordered[i].runId);
        forgetIdempotency(ordered[i]);
        pruned.push(ordered[i].runId);
      }
    }
    if (pruned.length) store.onRunsPruned(pruned);
  }

  function createRun(input = {}) {
    pruneExpired();
    const principalFp = principalFingerprint(input.serverSession);
    const idempotencyKey = String(input.idempotencyKey || "").slice(0, 128);
    if (idempotencyKey) {
      const existingId = idempotencyKeys.get(`${principalFp}|${idempotencyKey}`);
      const existing = existingId ? runs.get(existingId) : null;
      if (existing && existing.expiresAtMs > Date.now()) {
        // 幂等重放：返回既有 Run 的句柄。pollToken 明文只在首次创建时返回
        // 一次（持久化只存哈希，无法也不应补发明文）；调用方持有原响应或凭
        // 会话 principal 继续轮询。
        return {
          runId: existing.runId,
          pollToken: null,
          status: existing.status,
          nextPollMs: 400,
          expiresAt: new Date(existing.expiresAtMs).toISOString(),
          createdAt: new Date(existing.createdAtMs).toISOString(),
          deadlineAt: new Date(existing.deadlineAtMs).toISOString(),
          eventCursor: existing.sequence,
          firstEventLatencyMs: 0,
          deduplicated: true,
          protocolVersion: AGENT_PROTOCOL.PROTOCOL_VERSION,
          capabilities: AGENT_PROTOCOL.PROTOCOL_CAPABILITIES,
        };
      }
    }
    const runId = input.runId || createId("run");
    const pollToken = createId("poll");
    const createdAtMs = Date.now();
    const run = {
      runId,
      pollTokenHash: hashToken(pollToken),
      principalFp,
      runtimeMode: String(input.runtimeMode || "public"),
      status: "queued",
      sequence: 0,
      events: [],
      result: null,
      cancelled: false,
      createdAtMs,
      expiresAtMs: createdAtMs + ttlMs,
      totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS,
      deadlineAtMs: createdAtMs + DEFAULT_TOTAL_TIMEOUT_MS,
      requestId: String(input.requestId || "").slice(0, 96),
      conversationId: String(input.conversationId || "").slice(0, 96),
    };
    if (idempotencyKey) run.idempotencyKey = idempotencyKey;
    runs.set(runId, run);
    if (idempotencyKey) idempotencyKeys.set(`${principalFp}|${idempotencyKey}`, runId);
    store.onRunCreated(snapshotOf(run));
    const accepted = appendEvent(runId, {
      type: "run.accepted",
      label: loadingTextForEvent({ type: "run.accepted" }, run.runtimeMode),
      runtimeMode: run.runtimeMode,
    });
    return {
      runId,
      pollToken,
      status: run.status,
      nextPollMs: 400,
      expiresAt: new Date(run.expiresAtMs).toISOString(),
      createdAt: new Date(createdAtMs).toISOString(),
      deadlineAt: new Date(run.deadlineAtMs).toISOString(),
      eventCursor: run.sequence,
      firstEventLatencyMs: accepted ? Math.max(0, Date.parse(accepted.at) - createdAtMs) : 0,
      protocolVersion: AGENT_PROTOCOL.PROTOCOL_VERSION,
      capabilities: AGENT_PROTOCOL.PROTOCOL_CAPABILITIES,
    };
  }

  function getRunRecord(runId) {
    pruneExpired();
    return runs.get(String(runId || "")) || null;
  }

  function authorizeRunAccess(run, options = {}) {
    if (!run) return { ok: false, code: "RUN_NOT_FOUND", status: 404 };
    if (run.expiresAtMs <= Date.now()) {
      runs.delete(run.runId);
      forgetIdempotency(run);
      store.onRunsPruned([run.runId]);
      return { ok: false, code: "RUN_EXPIRED", status: 410 };
    }
    const pollToken = String(options.pollToken || "");
    if (pollToken && hashToken(pollToken) === run.pollTokenHash) {
      return { ok: true };
    }
    const fp = principalFingerprint(options.serverSession);
    if (run.principalFp === "anonymous") {
      // Anonymous runs require poll token.
      return pollToken ? { ok: false, code: "RUN_FORBIDDEN", status: 403 } : { ok: false, code: "RUN_POLL_TOKEN_REQUIRED", status: 401 };
    }
    if (fp !== run.principalFp) {
      return { ok: false, code: "RUN_FORBIDDEN", status: 403 };
    }
    return { ok: true };
  }

  function appendEvent(runId, event = {}) {
    const run = getRunRecord(runId);
    if (!run || run.cancelled && !String(event.type || "").startsWith("run.")) return null;
    const eventType = String(event.type || "");
    if (TERMINAL_EVENT_TYPES.has(eventType)) {
      const previousTerminal = run.events.find((item) => item && TERMINAL_EVENT_TYPES.has(item.type));
      if (previousTerminal) return previousTerminal;
    }
    run.sequence += 1;
    const payload = publicEventSummary(Object.assign({}, event, {
      // P6a：稳定 eventId（缺失时生成一次，随后经 store 持久化；重放/水合
      // 保留原 eventId，客户端按 eventId+sequence 幂等消费）。
      eventId: event.eventId || createId("evt"),
      protocolVersion: event.protocolVersion || AGENT_PROTOCOL.PROTOCOL_VERSION,
      sequence: run.sequence,
      at: event.at || nowIso(),
      runtimeMode: event.runtimeMode || run.runtimeMode,
    }));
    run.events.push(payload);
    if (run.events.length > 80) run.events = run.events.slice(-80);
    if (event.type === "run.completed") run.status = "completed";
    else if (event.type === "run.degraded") run.status = "degraded";
    else if (event.type === "run.failed") run.status = "failed";
    else if (event.type === "run.cancelled") run.status = "cancelled";
    else if (run.status === "queued") run.status = "running";
    store.onEvent(run.runId, payload, snapshotOf(run));
    return payload;
  }

  function setResult(runId, result, status) {
    const run = getRunRecord(runId);
    if (!run) return null;
    run.result = result || null;
    const previousTerminal = run.events.slice().reverse().find((item) => item && TERMINAL_EVENT_TYPES.has(item.type));
    if (previousTerminal) {
      run.status = TERMINAL_STATUS_BY_EVENT[previousTerminal.type] || run.status;
    } else if (status || result && (result.status || result.runStatus || result.partialCompletion === true || result.success === false)) {
      run.status = statusFromResult(Object.assign({}, result || {}, { status: status || result && result.status }));
    }
    run.expiresAtMs = Date.now() + terminalTtlMs;
    store.onRunUpdated(snapshotOf(run));
    return run;
  }

  function cancelRun(runId, options = {}) {
    const run = getRunRecord(runId);
    const auth = authorizeRunAccess(run, options);
    if (!auth.ok) return auth;
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled" || run.status === "degraded") {
      return { ok: true, alreadyFinished: true, status: run.status };
    }
    run.cancelled = true;
    appendEvent(runId, {
      type: "run.cancelled",
      label: "已取消",
      runtimeMode: run.runtimeMode,
    });
    run.status = "cancelled";
    run.result = null;
    store.onRunUpdated(snapshotOf(run));
    return { ok: true, status: "cancelled" };
  }

  function isCancelled(runId) {
    const run = getRunRecord(runId);
    return Boolean(run && run.cancelled);
  }

  function getRunView(runId, options = {}) {
    const run = getRunRecord(runId);
    const auth = authorizeRunAccess(run, options);
    if (!auth.ok) return auth;
    const afterSequence = Math.max(0, Number(options.afterSequence || 0) || 0);
    const events = run.events.filter((item) => item.sequence > afterSequence);
    return {
      ok: true,
      runId: run.runId,
      status: run.status,
      events,
      result: ["completed", "degraded", "failed"].includes(run.status) ? run.result : null,
      nextPollMs: ["completed", "degraded", "failed", "cancelled"].includes(run.status) ? 0 : 400,
      checkedAt: nowIso(),
      eventCursor: run.sequence,
      deadlineAt: new Date(run.deadlineAtMs).toISOString(),
    };
  }

  // P6a 深重放：内存投影是 read-your-writes 在线事实源；当客户端 cursor 早于
  // 投影窗口（环形缓冲 80 条或重启水合截断）时，经 store.listEventsAfter 兜底
  // 取完整持久流，与内存投影按 sequence 去重合并（内存优先）。pg 后端保留全量
  // 事件流；journal 后端与投影同窗口（保留策略如实见 runRetentionPolicy）。
  async function getRunViewDeep(runId, options = {}) {
    const view = getRunView(runId, options);
    if (!view.ok) return view;
    const afterSequence = Math.max(0, Number(options.afterSequence || 0) || 0);
    const run = getRunRecord(runId);
    if (!run || !run.events.length) return view;
    const floor = run.events[0] ? Number(run.events[0].sequence) || 1 : 1;
    if (afterSequence >= floor - 1) return view; // 投影完整覆盖 cursor 之后
    if (typeof store.listEventsAfter !== "function") return view;
    let persisted = store.listEventsAfter(run.runId, afterSequence);
    if (isThenable(persisted)) persisted = await persisted;
    if (!Array.isArray(persisted) || !persisted.length) return view;
    const bySequence = new Map();
    persisted.forEach((item) => {
      if (item && Number.isInteger(item.sequence)) bySequence.set(item.sequence, item);
    });
    view.events.forEach((item) => {
      if (item && Number.isInteger(item.sequence)) bySequence.set(item.sequence, item); // 内存优先
    });
    const merged = Array.from(bySequence.values())
      .filter((item) => item.sequence > afterSequence)
      .sort((a, b) => a.sequence - b.sequence);
    return Object.assign({}, view, { events: merged, eventSource: "store+memory" });
  }

  function createEventEmitter(runId, runtimeMode = "public") {
    return function onEvent(event = {}) {
      if (isCancelled(runId)) return null;
      return appendEvent(runId, Object.assign({}, event, { runtimeMode: event.runtimeMode || runtimeMode }));
    };
  }

  function resetForTests() {
    runs.clear();
    idempotencyKeys.clear();
    return store.resetForTests();
  }

  // 启动重放（design.md §8.2）：恢复保留窗口内的 Run 文档与事件流；
  // 崩溃时非终态 Run 的执行器已随进程消亡——如实追加终态中断标记
  // （恢复 + 标记，不重复执行任何外部副作用）。
  function adoptPersisted(state) {
    const now = Date.now();
    ((state && state.runs) || []).forEach((doc) => {
      if (!doc || typeof doc.runId !== "string" || !doc.runId) return;
      if (runs.has(doc.runId)) return;
      if (!(Number(doc.expiresAtMs) > now)) return; // 已过保留窗口：不恢复
      const run = Object.assign({}, doc, {
        events: (Array.isArray(doc.events) ? doc.events : []).slice(-80),
      });
      runs.set(run.runId, run);
      if (run.idempotencyKey) idempotencyKeys.set(`${run.principalFp}|${run.idempotencyKey}`, run.runId);
      if (!TERMINAL_STATUSES.has(run.status)) {
        appendEvent(run.runId, {
          type: "run.failed",
          reasonCode: "RUN_EXECUTOR_LOST",
          label: "服务已重启，任务中断",
          runtimeMode: run.runtimeMode,
        });
        setResult(run.runId, null, "failed");
      }
    });
  }

  let persistenceReady = null;
  const hydrated = store.hydrate();
  if (isThenable(hydrated)) {
    persistenceReady = Promise.resolve(hydrated)
      .then(adoptPersisted)
      .catch(() => {}); // 水合失败已由 store 记录；在线 API 以内存投影继续服务
  } else {
    adoptPersisted(hydrated);
  }

  return {
    appendEvent,
    authorizeRunAccess,
    cancelRun,
    createEventEmitter,
    createRun,
    getRunRecord,
    getRunView,
    getRunViewDeep,
    isCancelled,
    resetForTests,
    setResult,
    // 组合/测试观察口（不在 repository surface 内）：
    persistenceReady,
    store,
    storeKind: store.kind,
  };
}

// 模块级薄默认实例：默认内存后端（行为与 P5a 前逐字一致）；组合根经
// bindDefaultStore 绑定 durable store 后，下列函数委托到同一实例——
// fosuTurnPorts 的 isCancelled 与 createRunHandlers 的 runRepository 因此
// 永远作用于同一份投影。
const memoryDefaultService = createRunEventService();
let activeService = memoryDefaultService;

function bindDefaultStore(store) {
  activeService = store ? createRunEventService({ store }) : memoryDefaultService;
  return activeService;
}

module.exports = {
  DEFAULT_TTL_MS,
  DEFAULT_MAX_RUNS,
  DEFAULT_TOTAL_TIMEOUT_MS,
  appendEvent(runId, event) {
    return activeService.appendEvent(runId, event);
  },
  authorizeRunAccess(run, options) {
    return activeService.authorizeRunAccess(run, options);
  },
  bindDefaultStore,
  cancelRun(runId, options) {
    return activeService.cancelRun(runId, options);
  },
  createEventEmitter(runId, runtimeMode) {
    return activeService.createEventEmitter(runId, runtimeMode);
  },
  createRun(input) {
    return activeService.createRun(input);
  },
  createRunEventService,
  getRunRecord(runId) {
    return activeService.getRunRecord(runId);
  },
  getRunView(runId, options) {
    return activeService.getRunView(runId, options);
  },
  getRunViewDeep(runId, options) {
    return activeService.getRunViewDeep(runId, options);
  },
  isCancelled(runId) {
    return activeService.isCancelled(runId);
  },
  principalFingerprint,
  resetForTests() {
    return activeService.resetForTests();
  },
  setResult(runId, result, status) {
    return activeService.setResult(runId, result, status);
  },
  statusFromResult,
};
