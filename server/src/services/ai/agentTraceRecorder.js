/**
 * Agent Trace recorder（管理面诊断事实源之一）。
 *
 * P5a WS3：模块单例 → 可注入工厂 createAgentTraceRecorder({ store })，
 * 与 agentRunEventService 共享同一 store 实例（journal 段 / pg traces 表）：
 *   - 脱敏链逐字不变：record() 先经 sanitizeTrace 裁剪/脱敏（rawMessage、
 *     context、明文 conversationId、任何形似密钥的文本一律不进 trace），
 *     store 只接收脱敏后的对象，写入前不再有第二次加工；
 *   - 默认内存实现行为与 P5a 前逐字一致（prune / listForTest /
 *     clearForTest / configureForTest 原样）；
 *   - traceId 为新增的可追溯元数据（随机 hex，不含内容），供 journal 重放
 *     去重与 pg 主键使用；
 *   - 模块级导出 = 薄默认实例；platformComposition 组合根经
 *     bindDefaultStore 绑定 durable store（agentKernel 与 runEventPublisher
 *     持有的模块引用自动落到同一实例，零改动）。
 */
const crypto = require("crypto");
const capabilityManifestService = require("./capabilityManifestService");
const { createMemoryRunStore } = require("./persistence/memoryRunStore");

const defaults = capabilityManifestService.getManifest().limits;

function hashConversationId(value) {
  return crypto.createHash("sha256").update(String(value || "anonymous")).digest("hex").slice(0, 16);
}

const SECRET_TEXT_PATTERN = /(password|passwd|pwd|secret|token|authorization|cookie|set-cookie|api[-_]?key|access[-_]?key|session[-_]?id|credential|ticket)\s*[:=]\s*[^\s,;]+/gi;

function redactSecrets(text) {
  return String(text || "").replace(SECRET_TEXT_PATTERN, "[redacted]");
}

function safeText(value, limit) {
  return redactSecrets(String(value || "").replace(/[\r\n\t]/g, " ")).slice(0, limit);
}

function sanitizeToolCalls(value) {
  return (Array.isArray(value) ? value : []).slice(0, defaults.maxPlanSteps).map((call) => ({
    name: safeText(call && (call.name || call.toolName), 80),
    status: safeText(call && call.status, 24),
  }));
}

function sanitizeSteps(value) {
  return (Array.isArray(value) ? value : []).slice(0, defaults.maxPlanSteps).map((step, index) => ({
    id: safeText(step && (step.id || step.key) || `step-${index + 1}`, 80),
    tool: safeText(step && (step.tool || step.toolName), 80),
    status: safeText(step && step.status, 24),
    durationMs: Math.max(0, Number(step && step.durationMs || 0) || 0),
    errorCode: safeText(step && step.errorCode, 80),
    retried: Boolean(step && step.retried),
  }));
}

function sanitizeTrace(input = {}) {
  const now = new Date().toISOString();
  return {
    runId: safeText(input.runId, 100),
    requestId: safeText(input.requestId, 100),
    conversationIdHash: hashConversationId(input.conversationId),
    environment: safeText(input.environment || input.runtimeMode || "public", 16),
    runtimeMode: safeText(input.runtimeMode || "public", 16),
    configVersion: safeText(input.configVersion, 120),
    intent: safeText(input.intent && input.intent.name || input.intent, 80),
    selectedSkill: safeText(input.selectedSkill && input.selectedSkill.id || input.selectedSkill, 80),
    stepCount: Math.max(0, Number(input.stepCount || (Array.isArray(input.steps) ? input.steps.length : 0)) || 0),
    toolCalls: sanitizeToolCalls(input.toolCalls),
    steps: sanitizeSteps(input.steps),
    totalDurationMs: Math.max(0, Number(input.totalDurationMs || 0) || 0),
    providerUsed: input.providerUsed === true,
    provider: safeText(input.provider || (input.providerUsed === true ? "unknown" : "mock"), 80),
    externalProviderUsed: input.providerUsed === true,
    fallbackLayer: safeText(input.fallbackLayer || "none", 24),
    failureLayer: safeText(input.failureLayer || (input.errorCode ? input.fallbackLayer || "server" : ""), 40),
    fallbackReason: safeText(input.fallbackReason, 120),
    evidenceComplete: input.evidenceComplete === true,
    errorCode: safeText(input.errorCode, 80),
    status: safeText(input.status || (input.errorCode ? "failed" : "completed"), 24),
    recordedAt: now,
  };
}

function isThenable(value) {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function";
}

function createAgentTraceRecorder(options = {}) {
  const store = options.store || createMemoryRunStore();
  let config = {
    maxEntries: defaults.maxTraceEntries,
    retentionMs: defaults.traceRetentionMs,
  };
  let traces = [];

  function prune(now = Date.now()) {
    const cutoff = now - config.retentionMs;
    traces = traces.filter((item) => {
      const at = Date.parse(item.recordedAt || "");
      return Number.isFinite(at) && at >= cutoff;
    }).slice(-config.maxEntries);
  }

  function record(input = {}) {
    const trace = sanitizeTrace(input);
    trace.traceId = `trace_${crypto.randomBytes(12).toString("hex")}`;
    traces.push(trace);
    prune();
    store.onTrace(trace);
    return trace;
  }

  function listForTest() {
    prune();
    return traces.map((item) => Object.assign({}, item, {
      toolCalls: item.toolCalls.map((call) => Object.assign({}, call)),
      steps: item.steps.map((step) => Object.assign({}, step)),
    }));
  }

  async function listRecent() {
    if (persistenceReady) await persistenceReady;
    return listForTest().slice().reverse();
  }

  function clearForTest() {
    traces = [];
    config = {
      maxEntries: defaults.maxTraceEntries,
      retentionMs: defaults.traceRetentionMs,
    };
    return store.onTracesCleared();
  }

  function configureForTest(options = {}) {
    config = {
      maxEntries: Math.max(1, Number(options.maxEntries || config.maxEntries) || config.maxEntries),
      retentionMs: Math.max(1000, Number(options.retentionMs || config.retentionMs) || config.retentionMs),
    };
    prune();
  }

  // 启动重放：并入保留窗口内的历史 trace（按 traceId 去重），与内存态同
  // 口径 prune；恢复只还原数据，不产生任何新副作用。
  function adoptPersisted(state) {
    const known = new Set(traces.map((item) => item && item.traceId));
    ((state && state.traces) || []).forEach((trace) => {
      if (!trace || !trace.traceId || known.has(trace.traceId)) return;
      known.add(trace.traceId);
      traces.push(trace);
    });
    traces.sort((left, right) => String(left.recordedAt || "").localeCompare(String(right.recordedAt || "")));
    prune();
  }

  let persistenceReady = null;
  const hydrated = store.hydrate();
  if (isThenable(hydrated)) {
    persistenceReady = Promise.resolve(hydrated)
      .then(adoptPersisted)
      .catch(() => {}); // 水合失败已由 store 记录；内存投影继续服务
  } else {
    adoptPersisted(hydrated);
  }

  return {
    clearForTest,
    configureForTest,
    listForTest,
    listRecent,
    record,
    // 组合/测试观察口：
    persistenceReady,
    store,
    storeKind: store.kind,
  };
}

// 模块级薄默认实例（内存后端，行为与 P5a 前逐字一致）。
const memoryDefaultRecorder = createAgentTraceRecorder();
let activeRecorder = memoryDefaultRecorder;

function bindDefaultStore(store) {
  activeRecorder = store ? createAgentTraceRecorder({ store }) : memoryDefaultRecorder;
  return activeRecorder;
}

module.exports = {
  bindDefaultStore,
  clearForTest() {
    return activeRecorder.clearForTest();
  },
  configureForTest(options) {
    return activeRecorder.configureForTest(options);
  },
  createAgentTraceRecorder,
  hashConversationId,
  listForTest() {
    return activeRecorder.listForTest();
  },
  listRecent() {
    return activeRecorder.listRecent();
  },
  record(input) {
    return activeRecorder.record(input);
  },
  sanitizeTrace,
};
