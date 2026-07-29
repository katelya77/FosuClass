const { STAGE_ORDER, detailsForStage, stageRecord } = require("./stageTrace");
const { createDeadline, createMetricsStore, createStageSignal } = require("@xiaofu-agent/provider-runtime");

const DEFAULT_STAGE_BUDGETS = Object.freeze({
  simple: Object.freeze({
    context: 1000,
    decision: 3500,
    skillTool: 1200,
    verification: 500,
    response: 800,
    ui: 300,
    finishReserve: 500,
  }),
  multi: Object.freeze({
    context: 1000,
    decision: 3500,
    skillTool: 5500,
    verification: 1000,
    response: 1500,
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
  const maximum = Math.max(0, Math.min(1, Number(maxFallbacks) || 0));
  return Object.freeze({
    maxFallbacks: maximum,
    fallbacksUsed() { return fallbacksUsed; },
    claimFallback() {
      if (fallbacksUsed >= maximum) return false;
      fallbacksUsed += 1;
      return true;
    },
    snapshot() {
      return Object.freeze({ maxFallbacks: maximum, fallbacksUsed });
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
      });
    const providerAttemptLedger = input.providerAttemptLedger || createProviderAttemptLedger(1);
    const createRunDurationMs = Math.max(0, Number(request.createRunDurationMs) || 0);
    const records = [];
    const artifacts = {};
    stageMetrics.record("createRun", { durationMs: createRunDurationMs, outcome: "success" });

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
        const stagePromise = Promise.resolve().then(() => stages[method](Object.freeze({
          request,
          configSnapshot,
          signal: stageSignal.signal,
          deadline,
          budget,
          providerAttemptLedger,
          emit: emitFromStage,
          context: artifacts.context,
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
        const immutableOutput = deepFreeze(output && typeof output === "object" ? output : {});
        artifacts[method] = immutableOutput;
        const durationMs = Math.max(0, clock.now() - startedAt);
        records.push(stageRecord(stageName, "success", durationMs, immutableOutput));
        stageMetrics.record(stageMetricName(stageName), { durationMs, outcome: "success" });
        await emit("stage.completed", {
          stage: stageName,
          durationMs,
          details: detailsForStage(stageName, immutableOutput),
        });
        return immutableOutput;
      } catch (error) {
        const outcome = isAborted(error, signal) ? "cancelled" : "failed";
        const durationMs = Math.max(0, clock.now() - startedAt);
        records.push(stageRecord(stageName, outcome, durationMs, {}));
        stageMetrics.record(stageMetricName(stageName), { durationMs, outcome });
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
        stageMetrics.record("ui", { durationMs: uiDurationMs, outcome: "success" });
        await emit("stage.completed", {
          stage: "ui",
          durationMs: uiDurationMs,
          details: detailsForStage("ui", artifacts.ui),
        });
      } catch (error) {
        const uiDurationMs = Math.max(0, clock.now() - uiStartedAt);
        records.push(stageRecord("ui", "failed", uiDurationMs, {}));
        stageMetrics.record("ui", { durationMs: uiDurationMs, outcome: "failed" });
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
      stageMetrics.record("total", { durationMs: totalDurationMs, outcome: "success" });
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
      stageMetrics.record("total", {
        durationMs: Math.max(0, clock.now() - totalStartedAt),
        outcome: aborted ? "cancelled" : "failed",
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
