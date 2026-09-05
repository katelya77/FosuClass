const { createDeadline, createStageSignal } = require("./deadline");
const { classifyFallbackEligibility } = require("./fallbackEligibility");
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

function operationalReasonCode(code, classification = {}) {
  const byClass = {
    auth: "PROVIDER_UNAUTHORIZED",
    rate_limited: "PROVIDER_RATE_LIMITED",
    timeout: "PROVIDER_TIMEOUT",
    network: "PROVIDER_NETWORK",
    server_error: "PROVIDER_SERVER_ERROR",
    config: "PROVIDER_NOT_CONFIGURED",
  };
  return byClass[classification.failureClass] || code;
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
  const runtimeObserver = typeof options.onEvent === "function" ? options.onEvent : null;

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
    const frozen = Object.freeze(event);
    const observers = [];
    if (runtimeObserver) observers.push(runtimeObserver);
    if (typeof onEvent === "function" && onEvent !== runtimeObserver) observers.push(onEvent);
    observers.forEach((observer) => {
      try { observer(frozen); } catch (error) { /* observability cannot change execution */ }
    });
  }

  async function invokeAttempt(input, provider, fallback, beforeAttempt = null) {
    const adapter = adapters.get(provider);
    if (!adapter) throw codedError("PROVIDER_NOT_REGISTERED", `Provider is not registered: ${provider}`);
    if (isCircuitOpen(provider)) throw codedError("PROVIDER_CIRCUIT_OPEN", `Provider circuit is open: ${provider}`);
    const method = input.method === "generate" ? "generate" : "generateStructured";
    if (typeof adapter[method] !== "function") throw codedError("PROVIDER_METHOD_UNSUPPORTED", `${provider}.${method} is unavailable`);
    const lease = input.deadline.lease(input.stage, input.stageCapMs, input.finishReserveMs);
    if (typeof beforeAttempt === "function" && beforeAttempt() === false) {
      throw codedError("PROVIDER_FALLBACK_BUDGET_EXHAUSTED", "The Run fallback budget is exhausted");
    }
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
        Promise.resolve().then(() => adapter[method](Object.assign({}, input.request || {}, {
          provider,
          stage: input.stage,
          timeoutMs: lease.timeoutMs,
          deadlineAt: input.deadline.deadlineAt,
          signal: stageSignal.signal,
        }))),
        abortPromise,
      ]);
      if (stageSignal.signal.aborted) throw codedError(stageSignal.timedOut() ? "PROVIDER_TIMEOUT" : "ABORTED", "Provider call was cancelled");
      let contract = null;
      if (method === "generateStructured") {
        let parsed;
        try {
          parsed = parsePayload(payload);
        } catch (error) {
          throw codedError("PROVIDER_STRUCTURED_OUTPUT_INVALID", "Provider returned invalid structured JSON");
        }
        contract = typeof input.validate === "function" ? input.validate(parsed) : parsed;
      }
      const durationMs = Math.max(0, clock.now() - startedAt);
      markSuccess(provider);
      metrics.record(input.stage, { durationMs, outcome: "success", fallback });
      emit(input.onEvent, { type: "provider.completed", provider, stage: input.stage, status: "success", latencyMs: durationMs, providerUsed: true, fallback });
      return { contract, payload, provider, latencyMs: durationMs };
    } catch (error) {
      const code = errorCode(error);
      const durationMs = Math.max(0, clock.now() - startedAt);
      const cancelled = code === "ABORTED";
      const classification = classifyFallbackEligibility(error);
      const reasonCode = operationalReasonCode(code, classification);
      if (!cancelled) markFailure(provider, reasonCode);
      metrics.record(input.stage, { durationMs, outcome: cancelled ? "cancelled" : "failed", fallback });
      emit(input.onEvent, { type: "provider.failed", provider, stage: input.stage, status: "failed", latencyMs: durationMs, reasonCode, providerUsed: true, fallback });
      // P2R：每次尝试的失败分类随 codedError 透传（failureClass/fallbackEligible/failFast），
      // Trace 统一落点由 Wave 2 收尾。
      throw codedError(code, error && error.message, {
        cause: error,
        attempted: true,
        failureClass: classification.failureClass,
        fallbackEligible: classification.fallbackEligible,
        failFast: classification.failFast,
      });
    } finally {
      stageSignal.cleanup();
    }
  }

  async function runProviderChain(input = {}, method = "generateStructured") {
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
      method,
      stage: String(input.stage || "structured").slice(0, 48),
      stageCapMs: Math.max(1, Number(input.stageCapMs || 3500) || 3500),
      finishReserveMs: Math.max(0, Number(input.finishReserveMs || 500) || 0),
      deadline,
    });
    const fallbackPath = [];
    let actualFirstProvider = "";
    let attemptCount = 0;
    let lastError = null;
    function remainingFallbackBudget() {
      const ledger = input.providerAttemptLedger;
      if (ledger && typeof ledger.snapshot === "function") {
        const snap = ledger.snapshot() || {};
        return Math.max(0, Number(snap.maxFallbacks || 0) - Number(snap.fallbacksUsed || 0));
      }
      return null;
    }
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      const claimFallback = index > 0 && input.providerAttemptLedger
        && typeof input.providerAttemptLedger.claimFallback === "function"
        ? () => input.providerAttemptLedger.claimFallback()
        : null;
      try {
        const result = await invokeAttempt(attemptInput, provider, index > 0, claimFallback);
        attemptCount += 1;
        if (!actualFirstProvider) actualFirstProvider = provider;
        fallbackPath.push(`${provider}:success`);
        return Object.freeze(Object.assign({}, result, {
          intendedProvider,
          actualFirstProvider,
          fallbackPath: Object.freeze(fallbackPath.slice()),
          attemptCount,
        }));
      } catch (error) {
        lastError = error;
        if (error && error.attempted === true) {
          attemptCount += 1;
          if (!actualFirstProvider) actualFirstProvider = provider;
        }
        fallbackPath.push(`${provider}:${errorCode(error)}`);
        // P2R：单一 fallback eligibility 分类。ABORTED 视为 cancelled（fail fast）。
        // failFast（invalid_model/bad_request/401/403/配置缺失/Schema 类等确定性错误）
        // 直接重抛并附完整链路字段，不再推进 fallback Provider；eligible（timeout/network/
        // 429/5xx）与 skipped（熔断/未注册/方法不支持/预算耗尽/租约耗尽）才继续推进——
        // skipped 码在 invokeAttempt 内先于账本 claim 抛出，因此不消耗 fallback 预算。
        const classification = classifyFallbackEligibility(error);
        if (errorCode(error) === "ABORTED" || classification.failFast) {
          throw Object.assign(error, {
            intendedProvider,
            actualFirstProvider,
            fallbackProvider: providers[1] || "",
            fallbackPath: Object.freeze(fallbackPath.slice()),
            attemptCount,
            failureClass: classification.failureClass,
            fallbackEligible: false,
            failFast: true,
            fallbackReason: classification.reason,
            remainingFallbackBudget: remainingFallbackBudget(),
          });
        }
      }
    }
    const exhaustionClassification = classifyFallbackEligibility(lastError);
    throw codedError("PROVIDER_CHAIN_EXHAUSTED", "Structured Provider attempts were exhausted", {
      cause: lastError,
      intendedProvider,
      actualFirstProvider,
      fallbackProvider: providers[1] || "",
      fallbackPath: Object.freeze(fallbackPath.slice()),
      attemptCount,
      failureClass: exhaustionClassification.failureClass,
      fallbackReason: exhaustionClassification.reason,
      remainingFallbackBudget: remainingFallbackBudget(),
    });
  }

  async function generateStructured(input = {}) {
    return runProviderChain(input, "generateStructured");
  }

  async function generate(input = {}) {
    return runProviderChain(input, "generate");
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

  function resetCircuits() {
    circuits.clear();
  }

  return Object.freeze({ diagnostics, generate, generateStructured, probe, resetCircuits });
}

module.exports = {
  createProviderRuntime,
};
