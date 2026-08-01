/**
 * agentRunShell：小佛助手页面唯一 active-run 状态源（P6b W2）。
 *
 * 交付语义：服务端 Run Events 至少一次可重放，客户端由 agent-sdk 的
 * 幂等 reducer 按 eventId/sequence 消费 —— 事件不重复、状态不回退。
 * 本模块只负责：建 Run、轮询编排、事件扇出、active 句柄持久化与断线恢复。
 * 页面不得再维护第二份 active-run 状态（自写 wx Storage、页内另起轮询均
 * 属违规）；断线/重开后一律经 resumeActiveRun 恢复，绝不重建第二个 Run。
 *
 * 轮询语义与 agentRunClient.pollRunUntilDone 对齐：
 * - 终态但 result 未落库的竞态宽限 4 次 × 600ms；
 * - 单次轮询失败（ok:false）容忍：sleep 500ms 后续跑，直到 maxWaitMs；
 * - 节奏 sleep(max(200, nextPollMs || 400))；
 * - 每 tick 检查 shouldCancel → 真实 cancelRun → cancelled 信封；
 * - 超时返回 timeout 信封并保留句柄（供 resumeActiveRun 续跑）。
 *
 * 事件扇出走 client.getState 的 sequence 差分：reducer 已是唯一幂等权威，
 * shell 不重复实现去重，只把“新应用的事件”累计推给页面回调。
 */
const AGENT_SDK = require("../shared/agentSdk.generated");

const ACTIVE_RUN_STORAGE_KEY = "agent-run:active";
const TERMINAL_GRACE_MAX = 4;
const TERMINAL_GRACE_MS = 600;
const POLL_ERROR_BACKOFF_MS = 500;
const DEFAULT_POLL_MS = 400;
const MIN_POLL_MS = 200;
const DEFAULT_MAX_WAIT_MS = 45000;

// 小程序真实路由（utils/request 会再拼 API_BASE_URL）。
const RUN_ROUTES = Object.freeze({
  createRun: "/api/ai/agent/runs",
  run: (runId) => `/api/ai/agent/runs/${encodeURIComponent(runId)}`,
  cancel: (runId) => `/api/ai/agent/runs/${encodeURIComponent(runId)}/cancel`,
});

function safeText(value, max = 200) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRunGone(failure) {
  const errorClass = failure && failure.errorClass;
  return errorClass === "not_found" || errorClass === "expired";
}

function foldPollError(error) {
  return {
    errorClass: safeText(error && error.errorClass, 32) || "network",
    retriable: !error || error.retriable !== false,
    message: safeText(error && error.message, 200),
  };
}

/**
 * 默认 wx KV 适配（同步语义；方法内 try/catch，绝不抛出）。
 * wx 全局在方法被调用时才解析，模块在 wx 未定义环境下也可安全 require。
 * 注入自定义 storage 时也需保持同步返回（wx KV 语义）。
 */
function createWxStorageAdapter() {
  return {
    get(key) {
      try {
        const value = wx.getStorageSync(key);
        return value === undefined || value === "" ? null : value;
      } catch (error) {
        return null;
      }
    },
    set(key, value) {
      try {
        wx.setStorageSync(key, value);
      } catch (error) {
        // 句柄持久化失败不阻断主流程（仅断线恢复能力降级）。
      }
    },
    remove(key) {
      try {
        wx.removeStorageSync(key);
      } catch (error) {
        // 同上，best-effort。
      }
    },
  };
}

/**
 * 默认传输适配：SDK request({method, path, body, query}) → utils/request。
 * - query 序列化进 path querystring（encodeURIComponent）；
 * - 成功返回 {status:200, json}；
 * - HTTP 错误（err.statusCode 存在）回传 {status, json:err.payload}；
 * - 无 statusCode 的底层错误原样上抛，由 SDK 归类 network/retriable。
 * utils/request 在首次真实调用时才 require，避免模块加载期连带依赖。
 */
function createUtilsRequestAdapter() {
  let utilsRequest = null;
  return async function utilsRequestAdapter(req) {
    if (!utilsRequest) utilsRequest = require("../utils/request");
    const method = safeText(req && req.method || "GET", 8).toUpperCase() || "GET";
    let path = safeText(req && req.path, 512);
    const query = (req && req.query) || {};
    const pairs = Object.keys(query)
      .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== "")
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`);
    if (pairs.length) path += (path.indexOf("?") >= 0 ? "&" : "?") + pairs.join("&");
    const options = {
      showLoading: false,
      silentError: true,
      dedupe: false,
      timeout: method === "GET" ? 12000 : 20000,
      retries: method === "GET" ? 0 : 2,
    };
    try {
      const json = method === "GET"
        ? await utilsRequest.get(path, {}, options)
        : await utilsRequest.post(path, (req && req.body) || {}, options);
      return { status: 200, json };
    } catch (error) {
      if (error && error.statusCode) {
        return { status: error.statusCode, json: error.payload || { code: error.code } };
      }
      throw error;
    }
  };
}

function createAgentRunShell(deps = {}) {
  const storage = deps.storage && typeof deps.storage.get === "function"
    ? deps.storage
    : createWxStorageAdapter();
  const transport = typeof deps.request === "function" ? deps.request : createUtilsRequestAdapter();
  const sleep = typeof deps.sleep === "function" ? deps.sleep : defaultSleep;
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const maxWaitMs = Math.max(200, Number(deps.maxWaitMs || DEFAULT_MAX_WAIT_MS) || DEFAULT_MAX_WAIT_MS);
  const logger = typeof deps.logger === "function" ? deps.logger : () => {};

  // create 请求需捎带 memoryMode/cloudSyncEnabled（SDK 协议体之外的业务
  // 字段，与 agentRunClient.createRun 一致）。在 shell 的 SDK-request 包装
  // 层注入，保证 DI 传输与默认适配走同一条路径；protocolVersion 固定
  // agent.v2（服务端 legacy 兼容）。shell 同时只有一个进行中的 create，
  // 不存在并发串扰。
  let pendingCreateExtras = null;
  function sdkRequest(req) {
    if (pendingCreateExtras && req && req.method === "POST" && req.path === RUN_ROUTES.createRun) {
      return transport(Object.assign({}, req, {
        body: Object.assign({}, req.body || {}, pendingCreateExtras),
      }));
    }
    return transport(req);
  }

  const client = AGENT_SDK.createAgentRunClient({
    request: sdkRequest,
    storage,
    sleep,
    clock: { now },
    logger,
    routes: RUN_ROUTES,
    protocolVersion: "agent.v2",
  });

  // 进程内镜像；storage 中的 agent-run:active 是跨页面重开的持久副本。
  let activeHandle = null;

  function normalizeHandle(raw) {
    if (!raw || !raw.runId) return null;
    return {
      runId: safeText(raw.runId, 96),
      pollToken: safeText(raw.pollToken, 128),
      conversationId: safeText(raw.conversationId, 96),
      startedAt: Number(raw.startedAt || 0) || 0,
      cursor: Math.max(0, Number(raw.cursor || 0) || 0),
    };
  }

  function readHandle() {
    if (activeHandle && activeHandle.runId) return activeHandle;
    let stored = null;
    try {
      stored = storage.get(ACTIVE_RUN_STORAGE_KEY);
    } catch (error) {
      stored = null;
    }
    activeHandle = normalizeHandle(stored);
    return activeHandle;
  }

  function persistHandle(handle) {
    activeHandle = handle;
    try {
      storage.set(ACTIVE_RUN_STORAGE_KEY, handle);
    } catch (error) {
      logger("shell-handle-persist-failed", { code: safeText(error && error.code, 64) });
    }
  }

  function clearHandle(runId) {
    if (!runId || (activeHandle && activeHandle.runId === runId)) {
      activeHandle = null;
      try {
        storage.remove(ACTIVE_RUN_STORAGE_KEY);
      } catch (error) {
        // best-effort
      }
    }
    if (runId) {
      // 终态/取消后顺带清理 SDK 句柄副本，避免 storage 只增不减。
      try {
        storage.remove(`agent-run:${runId}`);
      } catch (error) {
        // best-effort
      }
    }
  }

  // resume/cancel 前确保 SDK 侧句柄可读：正常路径下 SDK 在 create/poll
  // 时已自行持久化；副本缺失（如 storage 被清理）时用 shell 句柄播种，
  // 游标回退到 shell 记录值，服务端至少一次重放 + reducer 幂等保证
  // 事件不会重复计入状态。
  function ensureSdkHandle(handle) {
    const key = `agent-run:${handle.runId}`;
    let stored = null;
    try {
      stored = storage.get(key);
    } catch (error) {
      stored = null;
    }
    if (stored && stored.runId) return stored;
    const seeded = {
      runId: handle.runId,
      pollToken: handle.pollToken || "",
      cursor: Math.max(0, Number(handle.cursor || 0) || 0),
      status: "running",
      protocolVersion: "agent.v2",
      compatibilityMode: "native",
    };
    try {
      storage.set(key, seeded);
    } catch (error) {
      logger("shell-handle-seed-failed", { code: safeText(error && error.code, 64) });
    }
    return seeded;
  }

  function createFan(startCursor) {
    return { cursor: Math.max(0, Number(startCursor || 0) || 0), ids: new Set(), events: [] };
  }

  // 扇出新应用的事件：sequence 差分为主、eventId 集合兜底，整个 Run 生命
  // 周期内同一 eventId 绝不重复投递。onRunEvents 收累计全量（对齐现行
  // 路由行为）；onStatus 只在最新事件带 label 时触发。
  function fanOut(runId, fan, callbacks) {
    const state = client.getState(runId);
    if (!state || !Array.isArray(state.events)) return;
    const fresh = state.events.filter((event) => {
      const sequence = Number(event && event.sequence) || 0;
      const eventId = safeText(event && event.eventId, 128);
      if (sequence <= fan.cursor) return false;
      if (eventId && fan.ids.has(eventId)) return false;
      return true;
    });
    if (!fresh.length) return;
    fresh.forEach((event) => {
      fan.cursor = Math.max(fan.cursor, Number(event.sequence) || 0);
      const eventId = safeText(event.eventId, 128);
      if (eventId) fan.ids.add(eventId);
      fan.events.push(event);
    });
    if (callbacks && typeof callbacks.onRunEvents === "function") {
      callbacks.onRunEvents(fan.events.slice());
    }
    const latest = fresh[fresh.length - 1];
    if (latest && latest.label && callbacks && typeof callbacks.onStatus === "function") {
      callbacks.onStatus({ type: latest.type, text: latest.label, event: latest });
    }
  }

  // SDK poll 只在本地句柄缺失等场景抛出；统一折成 ok:false 供循环分类。
  async function safePoll(runId) {
    try {
      return await client.poll(runId);
    } catch (error) {
      return { ok: false, failure: foldPollError(error) };
    }
  }

  async function safeReconnect(runId) {
    try {
      return await client.reconnect(runId);
    } catch (error) {
      return { ok: false, failure: foldPollError(error) };
    }
  }

  // 统一轮询循环：startRun 与 resumeActiveRun 共用（resume 传入已有 fan）。
  async function runPollLoop(handle, options = {}) {
    const callbacks = options.callbacks || {};
    const shouldCancel = typeof options.shouldCancel === "function" ? options.shouldCancel : () => false;
    const fan = options.fan || createFan(handle.cursor);
    const started = now();
    let lastStatus = "queued";
    let terminalGraceLeft = TERMINAL_GRACE_MAX;

    while (now() - started < maxWaitMs) {
      if (shouldCancel()) {
        await cancelActiveRun();
        return { status: "cancelled", events: [], result: null, cancelled: true };
      }
      // eslint-disable-next-line no-await-in-loop
      const view = await safePoll(handle.runId);
      if (!view.ok) {
        // 服务端权威“已不存在”不可重试：清句柄并如实上抛，绝不空转到超时。
        if (isRunGone(view.failure)) {
          clearHandle(handle.runId);
          return { gone: true, status: lastStatus, failure: view.failure, events: fan.events, result: null };
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(POLL_ERROR_BACKOFF_MS);
        continue;
      }
      lastStatus = view.status || lastStatus;
      fanOut(handle.runId, fan, callbacks);
      if (view.eventCursor > handle.cursor) {
        handle.cursor = view.eventCursor;
        persistHandle(handle); // 游标随句柄持久化，供重开后续跑
      }
      if (view.terminal) {
        if (!view.result && view.status !== "cancelled" && terminalGraceLeft > 0) {
          terminalGraceLeft -= 1;
          // eslint-disable-next-line no-await-in-loop
          await sleep(TERMINAL_GRACE_MS); // 终态 result 落库竞态宽限
          continue;
        }
        clearHandle(handle.runId);
        return {
          status: view.status,
          events: fan.events,
          result: view.result || null,
          cancelled: view.status === "cancelled",
        };
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.max(MIN_POLL_MS, Number(view.nextPollMs || DEFAULT_POLL_MS) || DEFAULT_POLL_MS));
    }
    // 超时保留句柄：Run 在服务端可能仍存活，页面可 resumeActiveRun 续跑。
    return { status: lastStatus || "timeout", events: [], result: null, timeout: true };
  }

  async function startRun(input = {}) {
    const context = input.context && typeof input.context === "object" ? input.context : {};
    const conversationId = safeText(input.conversationId, 96);
    pendingCreateExtras = {
      memoryMode: safeText(input.memoryMode || context.memoryMode || "local_only", 24),
      cloudSyncEnabled: input.cloudSyncEnabled === true || context.cloudSyncEnabled === true,
    };
    let created;
    try {
      created = await client.createRun(safeText(input.message, 2000), {
        requestId: safeText(input.requestId, 96),
        conversationId,
        context,
        idempotencyKey: input.idempotencyKey ? safeText(input.idempotencyKey, 128) : "",
      });
    } finally {
      pendingCreateExtras = null;
    }
    const handle = {
      runId: created.runId,
      pollToken: created.pollToken,
      conversationId,
      startedAt: now(),
      cursor: Math.max(0, Number(created.cursor || 0) || 0),
    };
    persistHandle(handle);
    const callbacks = input.callbacks || {};
    if (typeof callbacks.onRunCreated === "function") {
      callbacks.onRunCreated({ runId: handle.runId, pollToken: handle.pollToken });
    }
    const outcome = await runPollLoop(handle, { callbacks, shouldCancel: input.shouldCancel });
    if (outcome.gone) {
      // 服务端权威 not_found/expired：如实失败，不伪造终态。
      return { status: "failed", failure: outcome.failure, events: outcome.events, result: null, gone: true };
    }
    return outcome;
  }

  async function cancelActiveRun() {
    const handle = readHandle();
    if (!handle || !handle.runId) return { ok: false, reason: "NO_ACTIVE_RUN" };
    ensureSdkHandle(handle);
    const result = await client.cancelRun(handle.runId);
    if (!result || !result.ok) {
      // 网络/可重试失败：保留句柄与原状态，绝不伪造 cancelled。
      return { ok: false, failure: (result && result.failure) || null };
    }
    clearHandle(handle.runId);
    return { ok: true, status: result.status, alreadyFinished: result.alreadyFinished === true };
  }

  async function resumeActiveRun(callbacks = {}) {
    const handle = readHandle();
    if (!handle || !handle.runId) return null;
    const sdkHandle = ensureSdkHandle(handle);
    const fan = createFan(sdkHandle.cursor);

    // 先重连探一次权威状态（凭 storage 游标续读，绝不重建 Run）。
    const first = await safeReconnect(handle.runId);
    if (!first.ok && isRunGone(first.failure)) {
      clearHandle(handle.runId);
      return { ok: false, reason: "RUN_GONE" };
    }
    if (first.ok) {
      fanOut(handle.runId, fan, callbacks);
      if (first.eventCursor > handle.cursor) {
        handle.cursor = first.eventCursor;
        persistHandle(handle);
      }
    }
    if (first.ok && first.terminal) {
      // 服务端已终态：经 recoverFinalResult 恢复最终结果；result 落库
      // 竞态沿用 4×600ms 宽限，仍拿不到则如实 null，不伪造。
      let result = first.result || null;
      let graceLeft = TERMINAL_GRACE_MAX;
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const recovered = await client.recoverFinalResult(handle.runId);
        fanOut(handle.runId, fan, callbacks);
        if (!recovered.ok && isRunGone(recovered.failure)) {
          clearHandle(handle.runId);
          return { ok: false, reason: "RUN_GONE" };
        }
        if (recovered.ok && recovered.result) {
          result = recovered.result;
          break;
        }
        if (graceLeft <= 0 || first.status === "cancelled") break;
        graceLeft -= 1;
        // eslint-disable-next-line no-await-in-loop
        await sleep(TERMINAL_GRACE_MS);
      }
      clearHandle(handle.runId);
      return { status: first.status, result, events: fan.events, recovered: true };
    }
    // 未终态（或首次探活为可重试失败）：进入统一循环续跑，语义与
    // startRun 完全一致（错误容忍 / 宽限 / 节奏 / 超时）。
    const outcome = await runPollLoop(handle, { callbacks, fan });
    if (outcome.gone) return { ok: false, reason: "RUN_GONE" };
    return Object.assign({ recovered: true }, outcome);
  }

  function getActiveRun() {
    const handle = readHandle();
    return handle ? Object.assign({}, handle) : null;
  }

  function clearActiveRun() {
    const handle = readHandle();
    activeHandle = null;
    try {
      storage.remove(ACTIVE_RUN_STORAGE_KEY);
    } catch (error) {
      // best-effort
    }
    if (handle && handle.runId) {
      try {
        storage.remove(`agent-run:${handle.runId}`);
      } catch (error) {
        // best-effort
      }
    }
  }

  return {
    startRun,
    cancelActiveRun,
    resumeActiveRun,
    getActiveRun,
    clearActiveRun,
  };
}

// 页面用默认单例（真实 wx KV + utils/request 适配）；测试用工厂注入依赖。
const shell = createAgentRunShell();

module.exports = {
  ACTIVE_RUN_STORAGE_KEY,
  createAgentRunShell,
  shell,
};
