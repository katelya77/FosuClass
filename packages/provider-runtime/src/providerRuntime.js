const { createDeadline, createStageSignal } = require("./deadline");
const { createMetricsStore } = require("./metrics");

function codedError(code, message, extra = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function normalizeId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ? id : "";
}

function errorCode(error) {
  return String(error && error.code || "PROVIDER_FAILED").replace(/[^A-Z0-9_.-]/gi, "_").slice(0, 80) || "PROVIDER_FAILED";
}

function parsePayload(payload) {
  if (typeof payload === "string") return JSON.parse(payload);
  if (payload && typeof payload === "object") {
    if (payload.contract && typeof payload.contract === "object") return payload.contract;
    const content = payload.content || payload.text || payload.answer;
    if (typeof content === "string") return JSON.parse(content);
  }
  throw codedError("PROVIDER_STRUCTURED_OUTPUT_INVALID", "Provider returned no structured content");
}

function createProviderRuntime(options = {}) {
  const adapters = new Map();
  (Array.isArray(options.adapters) ? options.adapters : []).forEach((adapter) => {
    const id = normalizeId(adapter && adapter.id);
    if (!id || !adapter || typeof adapter.generateStructured !== "function") {
      throw codedError("PROVIDER_ADAPTER_INVALID", "Provider Adapter requires an exact id and generateStructured");
    }
    if (adapters.has(id)) throw codedError("PROVIDER_ADAPTER_DUPLICATE", `Duplicate Provider Adapter: ${id}`);
    adapters.set(id, adapter);
  });
  const metrics = options.metrics || createMetricsStore();
  const clock = options.clock && typeof options.clock.now === "function" ? options.clock : { now: Date.now };
  const failureThreshold = Math.max(1, Number(options.failureThreshold || 3) || 3);
  const circuitCooldownMs = Math.max(100, Number(options.circuitCooldownMs || 30000) || 30000);
  const circuits = new Map();

  function circuit(provider) {
    if (!circuits.has(provider)) circuits.set(provider, { failures: 0, openedAt: 0, lastFailureCode: "" });
    return circuits.get(provider);
  }

  function isCircuitOpen(provider) {
    const state = circuit(provider);
    if (!state.openedAt) return false;
    if (clock.now() - state.openedAt >= circuitCooldownMs) {
      state.openedAt = 0;
      state.failures = Math.max(0, failureThreshold - 1);
      return false;
    }
    return true;
  }

  function markSuccess(provider) {
    const state = circuit(provider);
    state.failures = 0;
    state.openedAt = 0;
    state.lastFailureCode = "";
  }

  function markFailure(provider, code) {
    const state = circuit(provider);
    state.failures += 1;
    state.lastFailureCode = code;
    if (state.failures >= failureThreshold) state.openedAt = clock.now();
  }

  function emit(onEvent, event) {
    if (typeof onEvent !== "function") return;
    try { onEvent(Object.freeze(event)); } catch (error) { /* observability cannot change execution */ }
  }

  async function invokeAttempt(input, provider, fallback) {
    const adapter = adapters.get(provider);
    if (!adapter) throw codedError("PROVIDER_NOT_REGISTERED", `Provider is not registered: ${provider}`);
    if (isCircuitOpen(provider)) throw codedError("PROVIDER_CIRCUIT_OPEN", `Provider circuit is open: ${provider}`);
    const lease = input.deadline.lease(input.stage, input.stageCapMs, input.finishReserveMs);
    const stageSignal = createStageSignal(input.signal || null, lease.timeoutMs);
    const startedAt = clock.now();
    emit(input.onEvent, { type: "provider.selected", provider, stage: input.stage, status: "selected", fallback });
    emit(input.onEvent, { type: "provider.started", provider, stage: input.stage, status: "started", providerUsed: true, fallback });
    try {
      if (stageSignal.signal.aborted) throw codedError("ABORTED", "Provider call was cancelled");
      const abortPromise = new Promise((resolve, reject) => {
        stageSignal.signal.addEventListener("abort", () => {
          reject(codedError(stageSignal.timedOut() ? "PROVIDER_TIMEOUT" : "ABORTED", "Provider call was cancelled"));
        }, { once: true });
      });
      const payload = await Promise.race([
        Promise.resolve().then(() => adapter.generateStructured(Object.assign({}, input.request || {}, {
          provider,
          stage: input.stage,
          timeoutMs: lease.timeoutMs,
          deadlineAt: input.deadline.deadlineAt,
          signal: stageSignal.signal,
        }))),
        abortPromise,
      ]);
      if (stageSignal.signal.aborted) throw codedError(stageSignal.timedOut() ? "PROVIDER_TIMEOUT" : "ABORTED", "Provider call was cancelled");
      let parsed;
      try {
        parsed = parsePayload(payload);
      } catch (error) {
        throw codedError("PROVIDER_STRUCTURED_OUTPUT_INVALID", "Provider returned invalid structured JSON");
      }
      const contract = typeof input.validate === "function" ? input.validate(parsed) : parsed;
      const durationMs = Math.max(0, clock.now() - startedAt);
      markSuccess(provider);
      metrics.record(input.stage, { durationMs, outcome: "success", fallback });
      emit(input.onEvent, { type: "provider.completed", provider, stage: input.stage, status: "success", latencyMs: durationMs, providerUsed: true, fallback });
      return { contract, payload, provider, latencyMs: durationMs };
    } catch (error) {
      const code = errorCode(error);
      const durationMs = Math.max(0, clock.now() - startedAt);
      const cancelled = code === "ABORTED";
      if (!cancelled) markFailure(provider, code);
      metrics.record(input.stage, { durationMs, outcome: cancelled ? "cancelled" : "failed", fallback });
      emit(input.onEvent, { type: "provider.failed", provider, stage: input.stage, status: "failed", latencyMs: durationMs, reasonCode: code, providerUsed: true, fallback });
      throw codedError(code, error && error.message, { cause: error });
    } finally {
      stageSignal.cleanup();
    }
  }

  async function generateStructured(input = {}) {
    const mode = String(input.runtimeMode || "public").toLowerCase();
    if (mode === "public" || String(input.executionPolicy || "") === "deterministic") {
      throw codedError("PUBLIC_PROVIDER_FORBIDDEN", "External Provider calls are forbidden by deterministic policy");
    }
    if (input.signal && input.signal.aborted) throw codedError("ABORTED", "Provider call was cancelled");
    const intendedProvider = normalizeId(input.intendedProvider);
    const fallbackProvider = normalizeId(input.fallbackProvider);
    if (!intendedProvider) throw codedError("PROVIDER_REQUIRED", "An intended Provider is required");
    const providers = [intendedProvider];
    if (fallbackProvider && fallbackProvider !== intendedProvider) providers.push(fallbackProvider);
    const deadline = input.deadline && typeof input.deadline.lease === "function"
      ? input.deadline
      : createDeadline({ timeoutMs: input.timeoutMs || 15000 });
    const attemptInput = Object.assign({}, input, {
      stage: String(input.stage || "structured").slice(0, 48),
      stageCapMs: Math.max(1, Number(input.stageCapMs || 3500) || 3500),
      finishReserveMs: Math.max(0, Number(input.finishReserveMs || 500) || 0),
      deadline,
    });
    const fallbackPath = [];
    let actualFirstProvider = "";
    let lastError = null;
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      if (!actualFirstProvider) actualFirstProvider = provider;
      try {
        const result = await invokeAttempt(attemptInput, provider, index > 0);
        fallbackPath.push(`${provider}:success`);
        return Object.freeze(Object.assign({}, result, {
          intendedProvider,
          actualFirstProvider,
          fallbackPath: Object.freeze(fallbackPath.slice()),
          attemptCount: fallbackPath.length,
        }));
      } catch (error) {
        lastError = error;
        fallbackPath.push(`${provider}:${errorCode(error)}`);
        if (errorCode(error) === "ABORTED") throw Object.assign(error, { intendedProvider, actualFirstProvider, fallbackPath });
      }
    }
    throw codedError("PROVIDER_CHAIN_EXHAUSTED", "Structured Provider attempts were exhausted", {
      cause: lastError,
      intendedProvider,
      actualFirstProvider,
      fallbackPath: Object.freeze(fallbackPath.slice()),
      attemptCount: fallbackPath.length,
    });
  }

  async function probe(providerId, input = {}) {
    const provider = normalizeId(providerId);
    const adapter = adapters.get(provider);
    if (!adapter || typeof adapter.probe !== "function") throw codedError("PROVIDER_PROBE_UNSUPPORTED", `Provider probe is unavailable: ${provider}`);
    const stageSignal = createStageSignal(input.signal || null, Math.max(1, Number(input.timeoutMs || 2500) || 2500));
    try {
      const result = await adapter.probe(Object.assign({}, input, { signal: stageSignal.signal }));
      if (!result || result.ok === false) throw codedError("PROVIDER_PROBE_FAILED", "Provider probe failed");
      markSuccess(provider);
      return { ok: true, provider };
    } finally {
      stageSignal.cleanup();
    }
  }

  function diagnostics() {
    return Object.freeze({
      providers: Object.freeze(Array.from(adapters.keys()).map((provider) => Object.freeze({
        provider,
        circuitOpen: isCircuitOpen(provider),
        failureCount: circuit(provider).failures,
        lastFailureCode: circuit(provider).lastFailureCode,
      }))),
      metrics: metrics.summary(),
      maxFallbackAttempts: 1,
    });
  }

  return Object.freeze({ diagnostics, generateStructured, probe });
}

module.exports = {
  createProviderRuntime,
};
