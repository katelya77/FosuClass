const { STAGE_ORDER, detailsForStage, stageRecord } = require("./stageTrace");
const {
  METRIC_LABEL_VALUES,
  classifyFallbackEligibility,
  createDeadline,
  createMetricsStore,
  createStageSignal,
} = require("@xiaofu-agent/provider-runtime");

const DEFAULT_STAGE_BUDGETS = Object.freeze({
  simple: Object.freeze({
    context: 1000,
    // Leave enough headroom for the configured 8s structured-output timeout;
    // the previous 6.5s stage cap consistently cut healthy trial providers off early.
    decision: 9000,
    skillTool: 1200,
    verification: 500,
    // Free OpenAI-compatible providers routinely need 1.5-3s before the first
    // token. 800ms was below the measured healthy OpenRouter probe latency and
    // became ~275ms after reserving one fallback attempt. The global 15s
    // deadline still caps the turn, so this is a usable stage allowance rather
    // than an unbounded latency increase.
    response: 7000,
    ui: 300,
    finishReserve: 500,
  }),
  multi: Object.freeze({
    context: 1000,
    decision: 9000,
    skillTool: 5500,
    verification: 1000,
    response: 7000,
    ui: 500,
    finishReserve: 1000,
  }),
});

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function cloneForHandoff(value, seen = new WeakMap()) {
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) {
    const output = [];
    seen.set(value, output);
    value.forEach((item) => output.push(cloneForHandoff(item, seen)));
    return output;
  }
  const output = {};
  seen.set(value, output);
  Object.entries(value).forEach(([key, item]) => {
    output[key] = cloneForHandoff(item, seen);
  });
  return output;
}

function immutableCopy(value) {
  if (!value || typeof value !== "object") return deepFreeze({});
  return deepFreeze(cloneForHandoff(value));
}

function normalizeErrorCode(error, fallback = "AGENT_RUNTIME_FAILED") {
  const value = String(error && error.code || fallback).replace(/[^A-Z0-9_.-]/gi, "_").slice(0, 100);
  return value || fallback;
}

function isAborted(error, signal) {
  return Boolean(signal && signal.aborted)
    || Boolean(error && (error.code === "ABORTED" || error.name === "AbortError"));
}

function stageMetricName(stageName) {
  return stageName === "skill_tool" ? "tool" : stageName;
}

// 指标标签只取自 provider-runtime metrics 的集中词表；取不到合法值即省略，
// 绝不把自由文本（runId / conversationId / 消息内容 / model 名）写进桶键。
function pickLabelValue(name, value) {
  const normalized = String(value == null ? "" : value).toLowerCase();
  return METRIC_LABEL_VALUES[name].includes(normalized) ? normalized : undefined;
}

function providerClassLabel(provider) {
  const name = String(provider || "").trim().toLowerCase();
  if (!name) return "none";
  return name === "mock" ? "mock" : "external";
}

function decisionUsedFallback(decision) {
  if (!decision || typeof decision !== "object") return false;
  if (decision.decisionSource === "deterministic_fallback") return true;
  if (decision.understanding && decision.understanding.fallback === true) return true;
  const path = Array.isArray(decision.fallbackPath) ? decision.fallbackPath : [];
  return path.length > 1;
}

function decisionDegraded(decision) {
  return Boolean(decision && typeof decision === "object" && decision.decisionSource === "deterministic_fallback");
}

function responseUsedFallback(response) {
  return Boolean(response && typeof response === "object"
    && (response.fallback === true || String(response.fallbackReason || "").length > 0));
}

function responseDegraded(response) {
  if (!response || typeof response !== "object") return false;
  if (responseUsedFallback(response) || response.partialCompletion === true) return true;
  return ["partial", "degraded"].includes(String(response.status || ""));
}

// 失败分类优先取 Wave 1 透传字段（error.failureClass / fallbackReason /
// remainingFallbackBudget），缺失时用共享分类器兜底（低基数词表）。
function noteProviderFailure(ledger, error) {
  if (!ledger || typeof ledger.noteFailure !== "function" || !error || typeof error !== "object") return;
  const classification = classifyFallbackEligibility(error);
  ledger.noteFailure({
    failureClass: String(error.failureClass || classification.failureClass || ""),
    fallbackReason: String(error.fallbackReason || classification.reason || ""),
    remainingBudget: Number.isFinite(error.remainingFallbackBudget) ? error.remainingFallbackBudget : undefined,
  });
}

// Decision 阶段失败（含降级）链路在 Trace details 中暴露失败分类；public 模式
// 由 createAgentPlatform 的剥离列表移除这些字段。
function decisionFailureTraceDetails(error) {
  if (!error || typeof error !== "object") return {};
  const classification = classifyFallbackEligibility(error);
  const details = {};
  const failureClass = String(error.failureClass || classification.failureClass || "");
  const fallbackReason = String(error.fallbackReason || classification.reason || "");
  if (failureClass) details.failureClass = failureClass;
  if (fallbackReason) details.fallbackReason = fallbackReason;
  if (Number.isFinite(error.remainingFallbackBudget)) {
    details.remainingFallbackBudget = Math.max(0, Math.floor(Number(error.remainingFallbackBudget)));
  }
  return details;
}

function normalizeStageBudgets(value = {}) {
  function profile(name) {
    const defaults = DEFAULT_STAGE_BUDGETS[name];
    const source = value[name] || {};
    return Object.freeze(Object.fromEntries(Object.keys(defaults).map((key) => [
      key,
      Math.max(1, Math.min(15000, Number(source[key] || defaults[key]) || defaults[key])),
    ])));
  }
  return Object.freeze({ simple: profile("simple"), multi: profile("multi") });
}

function createProviderAttemptLedger(maxFallbacks = 1) {
  let fallbacksUsed = 0;
  let lastFailureClass = "";
  let lastFallbackReason = "";
  let lastRemainingBudget = null;
  const maximum = Math.max(0, Math.min(1, Number(maxFallbacks) || 0));
  return Object.freeze({
    maxFallbacks: maximum,
    fallbacksUsed() { return fallbacksUsed; },
    claimFallback() {
      if (fallbacksUsed >= maximum) return false;
      fallbacksUsed += 1;
      return true;
    },
    // P2R Wave 2：错误对象 / 阶段产物透传的失败分类随账本归档
    // （fallbackEligibility failureClass 词表，低基数，可进 Trace / metrics）。
    noteFailure(detail = {}) {
      const failureClass = String(detail.failureClass || "").slice(0, 48);
      const fallbackReason = String(detail.fallbackReason || "").slice(0, 120);
      if (failureClass) lastFailureClass = failureClass;
      if (fallbackReason) lastFallbackReason = fallbackReason;
      if (Number.isFinite(detail.remainingBudget)) {
        lastRemainingBudget = Math.max(0, Math.min(maximum, Math.floor(Number(detail.remainingBudget))));
      }
    },
    snapshot() {
      return Object.freeze({
        maxFallbacks: maximum,
        fallbacksUsed,
        failureClass: lastFailureClass,
        fallbackReason: lastFallbackReason,
        remainingBudget: Number.isFinite(lastRemainingBudget)
          ? lastRemainingBudget
          : Math.max(0, maximum - fallbacksUsed),
      });
    },
  });
}

function stageTimeoutPromise(signal, timedOut) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(codedError(timedOut() ? "STAGE_TIMEOUT" : "ABORTED"));
      return;
    }
    signal.addEventListener("abort", () => {
      reject(codedError(timedOut() ? "STAGE_TIMEOUT" : "ABORTED"));
    }, { once: true });
  });
}

function createAgentRuntime(options = {}) {
  const protocol = options.protocol || require("@xiaofu-agent/agent-protocol");
  const uiSchema = options.uiSchema || require("@xiaofu-agent/ui-schema");
  if (!protocol || typeof protocol.createRunEvent !== "function" || typeof protocol.createPlatformTrace !== "function") {
    throw codedError("AGENT_RUNTIME_PROTOCOL_INVALID");
  }
  if (!uiSchema || typeof uiSchema.blocksFromAgentResult !== "function") {
    throw codedError("AGENT_RUNTIME_UI_SCHEMA_INVALID");
  }
  const clock = options.clock && typeof options.clock.now === "function" ? options.clock : { now: Date.now };
  const traceSink = typeof options.traceSink === "function" ? options.traceSink : null;
  const stageBudgets = normalizeStageBudgets(options.stageBudgets || {});
  const stageMetrics = options.stageMetrics || createMetricsStore({ sampleLimit: 2000 });

  async function executeTurn(input = {}) {
    const request = immutableCopy(input.request);
    const configSnapshot = immutableCopy(input.configSnapshot);
    const stages = input.stages || {};
    const signal = input.signal || null;
    const externalEmit = typeof input.emit === "function" ? input.emit : () => {};
    const runId = String(request.runId || "").slice(0, 128);
    if (!runId) throw codedError("AGENT_RUNTIME_RUN_ID_REQUIRED");
    STAGE_ORDER.forEach(([, method]) => {
      if (typeof stages[method] !== "function") throw codedError("AGENT_RUNTIME_STAGE_REQUIRED", method);
    });

    const configVersion = String(configSnapshot.configVersion || "unversioned").slice(0, 128);
    const pluginIds = Array.isArray(configSnapshot.pluginIds) ? configSnapshot.pluginIds : [];
    const protocolVersion = String(request.runProtocolVersion || "run.v1").slice(0, 32);
    let sequence = Math.max(0, Number(request.eventSequence) || 0);
    const executionStartedAt = clock.now();
    const requestedRunStartedAt = Number(request.runStartedAt);
    const totalStartedAt = Number.isFinite(requestedRunStartedAt) ? requestedRunStartedAt : executionStartedAt;
    const deadline = input.deadline && typeof input.deadline.lease === "function"
      ? input.deadline
      : createDeadline({
        startedAt: totalStartedAt,
        deadlineAt: request.deadlineAt,
        timeoutMs: request.totalTimeoutMs || 15000,
        hardLimitMs: 15000,
        now: () => clock.now(),
      });
    const providerAttemptLedger = input.providerAttemptLedger || createProviderAttemptLedger(1);
    const createRunDurationMs = Math.max(0, Number(request.createRunDurationMs) || 0);
    const records = [];
    const artifacts = {};
    stageMetrics.record("createRun", { durationMs: createRunDurationMs, outcome: "ok", labels: stageLabels() });

    async function emit(type, publicPayload = {}) {
      sequence += 1;
      const event = protocol.createRunEvent({
        runId,
        sequence,
        type,
        protocolVersion,
        configVersion,
        createdAt: new Date(clock.now()).toISOString(),
        publicPayload,
      });
      await externalEmit(event);
      return event;
    }

    async function emitFromStage(event = {}) {
      const type = String(event.type || "");
      const payload = event.publicPayload && typeof event.publicPayload === "object"
        ? event.publicPayload
        : Object.fromEntries(Object.entries(event).filter(([key]) => key !== "type"));
      return emit(type, payload);
    }

    function assertNotAborted() {
      if (signal && signal.aborted) throw codedError("ABORTED", "Run was cancelled");
      if (deadline.remainingMs() <= 0) throw codedError("DEADLINE_EXCEEDED", "Run deadline was exceeded");
    }

    function complexity() {
      return artifacts.decision && artifacts.decision.taskComplexity === "multi" ? "multi" : "simple";
    }

    function decisionArtifact() {
      return artifacts.decision && typeof artifacts.decision === "object" ? artifacts.decision : {};
    }

    function environmentLabel() {
      return pickLabelValue("environment", request.runtimeMode
        || artifacts.response && artifacts.response.runtimeMode
        || "");
    }

    function totalProviderClass() {
      const decisionClass = providerClassLabel(decisionArtifact().actualFirstProvider);
      const response = artifacts.response && typeof artifacts.response === "object" ? artifacts.response : {};
      const responseClass = response.externalProviderUsed === true ? "external" : providerClassLabel(response.provider);
      if (decisionClass === "external" || responseClass === "external") return "external";
      if (decisionClass === "mock" || responseClass === "mock") return "mock";
      return "none";
    }

    // degraded / usedFallback 一律从阶段产物（decision.decisionSource、response
    // fallback 状态等）传播，不靠猜测；取不到标签即省略。
    function stageLabels(extra = {}) {
      const labels = {};
      const environment = environmentLabel();
      if (environment) labels.environment = environment;
      const decision = decisionArtifact();
      const executionPolicy = pickLabelValue("executionPolicy", decision.executionPolicy);
      if (executionPolicy) labels.executionPolicy = executionPolicy;
      if (decision.taskComplexity === "multi") labels.taskComplexity = "multi_tool";
      else if (decision.taskComplexity === "simple") labels.taskComplexity = "simple";
      Object.entries(extra).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        labels[key] = value;
      });
      return labels;
    }

    function stageMetricInput(method, output) {
      if (method === "decision") {
        return {
          outcome: decisionDegraded(output) ? "degraded" : "ok",
          labels: stageLabels({
            usedFallback: decisionUsedFallback(output),
            providerClass: providerClassLabel(output && output.actualFirstProvider),
          }),
        };
      }
      if (method === "response") {
        return {
          outcome: responseDegraded(output) ? "degraded" : "ok",
          labels: stageLabels({
            usedFallback: responseUsedFallback(output),
            providerClass: output && output.externalProviderUsed === true
              ? "external"
              : providerClassLabel(output && output.provider),
          }),
        };
      }
      return { outcome: "ok", labels: stageLabels() };
    }

    function budgetFor(method) {
      const profile = stageBudgets[complexity()];
      const cap = profile[method] || profile.response;
      return deadline.lease(method, cap, profile.finishReserve);
    }

    async function runStage(stageName, method) {
      assertNotAborted();
      const startedAt = clock.now();
      await emit("stage.started", { stage: stageName });
      const budget = budgetFor(method);
      const stageSignal = createStageSignal(signal, budget.timeoutMs);
      try {
        const viewName = method === "skillTool" ? "tool" : method;
        const contextView = method === "context"
          ? null
          : artifacts.context && artifacts.context.views && artifacts.context.views[viewName];
        if (method !== "context" && artifacts.context && artifacts.context.contextId) {
          if (!contextView || contextView.contextId !== artifacts.context.contextId) {
            throw codedError("AGENT_CONTEXT_VIEW_MISMATCH", `${method} did not receive the assembled Context view`);
          }
        }
        const stagePromise = Promise.resolve().then(() => stages[method](Object.freeze({
          request,
          configSnapshot,
          signal: stageSignal.signal,
          deadline,
          budget,
          providerAttemptLedger,
          emit: emitFromStage,
          context: artifacts.context,
          contextView,
          contextId: artifacts.context && artifacts.context.contextId || "",
          decision: artifacts.decision,
          skillTool: artifacts.skillTool,
          verification: artifacts.verification,
          response: artifacts.response,
        })));
        const output = await Promise.race([
          stagePromise,
          stageTimeoutPromise(stageSignal.signal, stageSignal.timedOut),
        ]);
        if (stageSignal.signal.aborted) throw codedError(stageSignal.timedOut() ? "STAGE_TIMEOUT" : "ABORTED");
        assertNotAborted();
        const normalizedOutput = output && typeof output === "object" ? output : {};
        if (method !== "context" && artifacts.context && artifacts.context.contextId
          && normalizedOutput.contextId && normalizedOutput.contextId !== artifacts.context.contextId) {
          throw codedError("AGENT_CONTEXT_ID_MISMATCH", `${method} changed the Context identity`);
        }
        const immutableOutput = deepFreeze(normalizedOutput);
        artifacts[method] = immutableOutput;
        const durationMs = Math.max(0, clock.now() - startedAt);
        const traceDetails = method === "context" || !artifacts.context
          ? immutableOutput
          : Object.assign({}, immutableOutput, { contextId: artifacts.context.contextId });
        records.push(stageRecord(stageName, "success", durationMs, traceDetails));
        const metricInput = stageMetricInput(method, immutableOutput);
        stageMetrics.record(stageMetricName(stageName), {
          durationMs,
          outcome: metricInput.outcome,
          labels: metricInput.labels,
        });
        // 降级链路的失败分类随阶段产物归档进共享账本（Wave 1 透传字段）。
        if (method === "decision" && immutableOutput.failureClass) {
          providerAttemptLedger.noteFailure({
            failureClass: immutableOutput.failureClass,
            fallbackReason: immutableOutput.fallbackReason,
            remainingBudget: immutableOutput.remainingFallbackBudget,
          });
        }
        if (method === "response") {
          const responseFallbackReason = String(immutableOutput.fallbackReason || "");
          if (responseFallbackReason) providerAttemptLedger.noteFailure({ fallbackReason: responseFallbackReason });
        }
        await emit("stage.completed", {
          stage: stageName,
          durationMs,
          details: detailsForStage(stageName, traceDetails),
        });
        return immutableOutput;
      } catch (error) {
        const outcome = isAborted(error, signal)
          ? "cancelled"
          : (error && (error.code === "STAGE_TIMEOUT" || error.code === "DEADLINE_EXCEEDED") ? "timeout" : "failed");
        noteProviderFailure(providerAttemptLedger, error);
        const durationMs = Math.max(0, clock.now() - startedAt);
        const failureDetails = stageName === "decision" ? decisionFailureTraceDetails(error) : {};
        records.push(stageRecord(stageName, outcome, durationMs, failureDetails));
        stageMetrics.record(stageMetricName(stageName), { durationMs, outcome, labels: stageLabels() });
        await emit("stage.failed", {
          stage: stageName,
          durationMs,
          errorCode: normalizeErrorCode(error, outcome === "cancelled" ? "ABORTED" : "AGENT_STAGE_FAILED"),
        });
        throw error;
      } finally {
        stageSignal.cleanup();
      }
    }

    function buildTrace(outcome) {
      const totalDurationMs = Math.max(0, clock.now() - totalStartedAt);
      const durationFor = (stage) => {
        const record = records.slice().reverse().find((item) => item.stage === stage);
        return record ? record.durationMs : 0;
      };
      return protocol.createPlatformTrace({
        runId,
        configVersion,
        pluginIds,
        timings: {
          createRun: createRunDurationMs,
          decision: durationFor("decision"),
          tool: durationFor("skill_tool"),
          verification: durationFor("verification"),
          response: durationFor("response"),
          total: totalDurationMs,
        },
        stages: records.concat([stageRecord("total", outcome, totalDurationMs, {})]),
      });
    }

    async function persistTrace(trace) {
      if (!traceSink) return;
      await traceSink(trace);
    }

    await emit("runtime.entered", {
      runtimePackage: "@xiaofu-agent/agent-runtime",
      pluginIds,
    });

    try {
      assertNotAborted();
      for (const [stageName, method] of STAGE_ORDER) {
        await runStage(stageName, method);
      }

      const uiStartedAt = clock.now();
      await emit("stage.started", { stage: "ui" });
      const uiBudget = budgetFor("ui");
      const uiSignal = createStageSignal(signal, uiBudget.timeoutMs);
      let blocks;
      try {
        if (uiSignal.signal.aborted) throw codedError(uiSignal.timedOut() ? "STAGE_TIMEOUT" : "ABORTED");
        blocks = uiSchema.blocksFromAgentResult(artifacts.response || {});
        artifacts.ui = deepFreeze({ blocks });
        const uiDurationMs = Math.max(0, clock.now() - uiStartedAt);
        records.push(stageRecord("ui", "success", uiDurationMs, artifacts.ui));
        stageMetrics.record("ui", { durationMs: uiDurationMs, outcome: "ok", labels: stageLabels() });
        await emit("stage.completed", {
          stage: "ui",
          durationMs: uiDurationMs,
          details: detailsForStage("ui", artifacts.ui),
        });
      } catch (error) {
        const uiDurationMs = Math.max(0, clock.now() - uiStartedAt);
        records.push(stageRecord("ui", "failed", uiDurationMs, {}));
        stageMetrics.record("ui", { durationMs: uiDurationMs, outcome: "failed", labels: stageLabels() });
        await emit("stage.failed", {
          stage: "ui",
          durationMs: uiDurationMs,
          errorCode: normalizeErrorCode(error, "UI_SCHEMA_FAILED"),
        });
        throw error;
      } finally {
        uiSignal.cleanup();
      }

      const totalDurationMs = Math.max(0, clock.now() - totalStartedAt);
      stageMetrics.record("total", {
        durationMs: totalDurationMs,
        outcome: decisionDegraded(decisionArtifact()) || responseDegraded(artifacts.response) ? "degraded" : "ok",
        labels: stageLabels({
          usedFallback: decisionUsedFallback(decisionArtifact()) || responseUsedFallback(artifacts.response),
          providerClass: totalProviderClass(),
        }),
      });
      const platformTrace = buildTrace("success");
      await persistTrace(platformTrace);
      await emit("runtime.completed", {
        stageCount: records.length,
        blockCount: blocks.length,
      });
      return deepFreeze({
        runId,
        configVersion,
        deadlineAt: deadline.deadlineAt,
        artifacts: deepFreeze(artifacts),
        ui: artifacts.ui,
        platformTrace,
      });
    } catch (error) {
      const aborted = isAborted(error, signal);
      noteProviderFailure(providerAttemptLedger, error);
      stageMetrics.record("total", {
        durationMs: Math.max(0, clock.now() - totalStartedAt),
        outcome: aborted
          ? "cancelled"
          : (error && (error.code === "STAGE_TIMEOUT" || error.code === "DEADLINE_EXCEEDED") ? "timeout" : "failed"),
        labels: stageLabels({
          usedFallback: decisionUsedFallback(decisionArtifact()) || responseUsedFallback(artifacts.response),
          providerClass: totalProviderClass(),
        }),
      });
      const platformTrace = buildTrace(aborted ? "cancelled" : "failed");
      try {
        await persistTrace(platformTrace);
      } catch (traceError) {
        // Preserve the original execution error; trace persistence has its own health signal upstream.
      }
      try {
        await emit(aborted ? "run.cancelled" : "run.failed", {
          errorCode: aborted ? "ABORTED" : normalizeErrorCode(error),
        });
      } catch (emitError) {
        // The caller still receives the original error and attached trace for recovery.
      }
      error.code = aborted ? "ABORTED" : normalizeErrorCode(error);
      error.platformTrace = platformTrace;
      throw error;
    }
  }

  return Object.freeze({
    executeTurn,
    diagnostics() {
      return Object.freeze({
        hardDeadlineMs: 15000,
        maxFallbackAttempts: 1,
        stageBudgets,
        stageMetrics: stageMetrics.summary(),
      });
    },
  });
}

module.exports = {
  createAgentRuntime,
};
