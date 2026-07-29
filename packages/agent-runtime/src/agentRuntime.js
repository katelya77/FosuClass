const { STAGE_ORDER, detailsForStage, stageRecord } = require("./stageTrace");

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
    const totalStartedAt = clock.now();
    const records = [];
    const artifacts = {};

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
    }

    async function runStage(stageName, method) {
      assertNotAborted();
      const startedAt = clock.now();
      await emit("stage.started", { stage: stageName });
      try {
        const output = await stages[method](Object.freeze({
          request,
          configSnapshot,
          signal,
          emit: emitFromStage,
          context: artifacts.context,
          decision: artifacts.decision,
          skillTool: artifacts.skillTool,
          verification: artifacts.verification,
          response: artifacts.response,
        }));
        assertNotAborted();
        const immutableOutput = deepFreeze(output && typeof output === "object" ? output : {});
        artifacts[method] = immutableOutput;
        const durationMs = Math.max(0, clock.now() - startedAt);
        records.push(stageRecord(stageName, "success", durationMs, immutableOutput));
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
        await emit("stage.failed", {
          stage: stageName,
          durationMs,
          errorCode: normalizeErrorCode(error, outcome === "cancelled" ? "ABORTED" : "AGENT_STAGE_FAILED"),
        });
        throw error;
      }
    }

    function buildTrace(outcome) {
      const totalDurationMs = Math.max(0, clock.now() - totalStartedAt);
      return protocol.createPlatformTrace({
        runId,
        configVersion,
        pluginIds,
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
      let blocks;
      try {
        blocks = uiSchema.blocksFromAgentResult(artifacts.response || {});
        artifacts.ui = deepFreeze({ blocks });
        const uiDurationMs = Math.max(0, clock.now() - uiStartedAt);
        records.push(stageRecord("ui", "success", uiDurationMs, artifacts.ui));
        await emit("stage.completed", {
          stage: "ui",
          durationMs: uiDurationMs,
          details: detailsForStage("ui", artifacts.ui),
        });
      } catch (error) {
        const uiDurationMs = Math.max(0, clock.now() - uiStartedAt);
        records.push(stageRecord("ui", "failed", uiDurationMs, {}));
        await emit("stage.failed", {
          stage: "ui",
          durationMs: uiDurationMs,
          errorCode: normalizeErrorCode(error, "UI_SCHEMA_FAILED"),
        });
        throw error;
      }

      const platformTrace = buildTrace("success");
      await persistTrace(platformTrace);
      await emit("runtime.completed", {
        stageCount: records.length,
        blockCount: blocks.length,
      });
      return deepFreeze({
        runId,
        configVersion,
        artifacts: deepFreeze(artifacts),
        ui: artifacts.ui,
        platformTrace,
      });
    } catch (error) {
      const aborted = isAborted(error, signal);
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
  });
}

module.exports = {
  createAgentRuntime,
};
