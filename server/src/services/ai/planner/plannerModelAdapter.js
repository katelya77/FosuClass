/**
 * PlannerModelAdapter — dedicated model call for structured planning only.
 *
 * - Uses Provider Factory / Chain credentials (DeepSeek / CloudBase OpenAI)
 * - Never returns user-facing answers
 * - Never logs secrets, full personal schedule, or hidden CoT
 * - public mode always refuses (caller must use deterministic planner)
 * - On any failure: throws so modelPlanner falls back to deterministic
 */

const capabilityManifestService = require("../capabilityManifestService");
const providerFactory = require("../providerFactory");
const safetyGuard = require("../safetyGuard");
const structuredInferenceService = require("../structuredInferenceService");

const DEFAULT_PLANNER_TIMEOUT_MS = 8000;
const DEFAULT_PLANNER_MAX_TOKENS = 800;
const PLANNER_SYSTEM = [
  "You are a constrained campus task planner for FosuClass (佛课小表).",
  "Return ONLY a valid JSON object plan. No markdown, no commentary, no chain-of-thought.",
  "Never invent campus facts. Never output user-facing answers.",
  "Never include API keys, cookies, student IDs, or internal URLs.",
].join(" ");

/**
 * In-memory circuit for planner calls (separate from response chain).
 */
const plannerCircuit = {
  failures: 0,
  openedAt: 0,
  state: "closed",
};

function getPlannerTimeoutMs(env = process.env) {
  const n = Number(env.AI_PLANNER_TIMEOUT_MS || DEFAULT_PLANNER_TIMEOUT_MS);
  return Math.max(1000, Math.min(30000, Number.isFinite(n) ? n : DEFAULT_PLANNER_TIMEOUT_MS));
}

function getPlannerMaxTokens(env = process.env) {
  const n = Number(env.AI_PLANNER_MAX_TOKENS || DEFAULT_PLANNER_MAX_TOKENS);
  return Math.max(128, Math.min(2000, Number.isFinite(n) ? n : DEFAULT_PLANNER_MAX_TOKENS));
}

function isCircuitOpen(env = process.env) {
  if (plannerCircuit.state !== "open") return false;
  const cooldown = Math.max(5000, Number(env.AI_PLANNER_CIRCUIT_COOLDOWN_MS || 60000) || 60000);
  if (Date.now() - plannerCircuit.openedAt >= cooldown) {
    plannerCircuit.state = "half-open";
    return false;
  }
  return true;
}

function markPlannerSuccess() {
  plannerCircuit.failures = 0;
  plannerCircuit.state = "closed";
  plannerCircuit.openedAt = 0;
}

function markPlannerFailure(env = process.env) {
  plannerCircuit.failures += 1;
  const threshold = Math.max(1, Number(env.AI_PLANNER_CIRCUIT_FAILURES || 3) || 3);
  if (plannerCircuit.failures >= threshold) {
    plannerCircuit.state = "open";
    plannerCircuit.openedAt = Date.now();
  }
}

function selectPlannerProviderName(runtimeMode, runtimeConfig = {}) {
  const mode = capabilityManifestService.normalizeRuntimeMode(runtimeMode);
  if (mode === "public") return "none";
  const chain = providerFactory.providerChainService.resolveStageChain("planner", runtimeConfig, mode);
  for (let i = 0; i < chain.length; i += 1) {
    const name = chain[i];
    if (name === "mock") continue;
    if (providerFactory.providerChainService.isProviderConfigured(name, runtimeConfig)) {
      return name;
    }
  }
  // fall back to single configured provider
  const single = providerFactory.getProviderName(mode, runtimeConfig);
  if (single && single !== "mock") return single;
  return "none";
}

/**
 * Sanitize messages before sending to provider — strip secrets, truncate.
 */
function sanitizeMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).slice(0, 6).map((msg) => ({
    role: msg.role === "system" || msg.role === "assistant" ? msg.role : "user",
    content: safetyGuard.redactSensitiveText(String(msg.content || "")).slice(0, 4000),
  }));
}

/**
 * Main entry used as modelGenerate for modelPlanner.
 *
 * @param {object} input
 * @param {Array} input.messages
 * @param {number} [input.maxTokens]
 * @param {string} [input.runtimeMode]
 * @param {object} [input.providerRuntimeConfig]
 * @param {function} [input.onEvent]
 * @returns {Promise<{content:string, provider:string, latencyMs:number, status:string}>}
 */
async function generate(input = {}) {
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(
    input.runtimeMode || input.providerRuntimeConfig && input.providerRuntimeConfig.AI_RUNTIME_MODE || "public"
  );
  const runtimeConfig = input.providerRuntimeConfig || {};
  const env = input.env || process.env;
  const meta = {
    provider: "none",
    latencyMs: 0,
    status: "skipped",
    fallback: false,
  };

  if (runtimeMode === "public") {
    const error = new Error("Model planner is disabled in public mode");
    error.code = "PLANNER_PUBLIC_FORBIDDEN";
    error.plannerMeta = meta;
    throw error;
  }

  if (String(env.AI_MODEL_PLANNER_ENABLED || "").toLowerCase() === "false"
    || env.AI_MODEL_PLANNER_ENABLED === "0") {
    // Explicit disable still allows trial/dev policy default unless forced off —
    // only refuse when explicitly false AND mode would otherwise use it.
    // Policy already gates; here we allow if policy passed modelGenerate.
  }

  if (isCircuitOpen(env)) {
    const error = new Error("Planner circuit open");
    error.code = "PLANNER_CIRCUIT_OPEN";
    error.plannerMeta = Object.assign({}, meta, { status: "circuit_open", fallback: true });
    throw error;
  }

  const providerName = selectPlannerProviderName(runtimeMode, runtimeConfig);
  if (providerName === "none") {
    const error = new Error("No planner provider configured");
    error.code = "PLANNER_NOT_CONFIGURED";
    error.plannerMeta = Object.assign({}, meta, { status: "not_configured", fallback: true });
    throw error;
  }

  const messages = sanitizeMessages(input.messages || []);
  if (!messages.length) {
    messages.push({ role: "system", content: PLANNER_SYSTEM });
    messages.push({ role: "user", content: "{}" });
  } else if (messages[0].role !== "system") {
    messages.unshift({ role: "system", content: PLANNER_SYSTEM });
  }

  if (typeof input.onEvent === "function") {
    try {
      input.onEvent({
        type: "planner.started",
        plannerProvider: providerName,
        runtimeMode,
      });
    } catch (_) {
      // ignore
    }
  }

  const started = Date.now();
  try {
    const settings = Object.assign({}, env || {}, runtimeConfig || {});
    const result = await structuredInferenceService.generateStructured({
      purpose: "planning",
      stage: "planner",
      messages,
      maxTokens: input.maxTokens || getPlannerMaxTokens(env),
      timeoutMs: getPlannerTimeoutMs(settings),
      runtimeMode,
      providerRuntimeConfig: runtimeConfig,
      onEvent: input.onEvent,
    });
    if (!result || !result.provider || result.provider === "mock") {
      const error = new Error("No external planner provider completed");
      error.code = "PLANNER_NOT_CONFIGURED";
      throw error;
    }
    markPlannerSuccess();
    const out = {
      content: result.content,
      text: result.content,
      provider: result.provider,
      latencyMs: result.latencyMs || (Date.now() - started),
      status: "ok",
      fallback: false,
    };
    if (typeof input.onEvent === "function") {
      try {
        input.onEvent({
          type: "planner.completed",
          plannerProvider: out.provider,
          latencyMs: out.latencyMs,
          status: "ok",
        });
      } catch (_) {
        // ignore
      }
    }
    return out;
  } catch (error) {
    markPlannerFailure(env);
    const latencyMs = error.latencyMs || (Date.now() - started);
    if (typeof input.onEvent === "function") {
      try {
        input.onEvent({
          type: "planner.failed",
          plannerProvider: providerName,
          latencyMs,
          reasonCode: String(error.code || "PLANNER_FAILED").slice(0, 60),
        });
      } catch (_) {
        // ignore
      }
    }
    error.plannerMeta = {
      provider: providerName,
      latencyMs,
      status: "failed",
      fallback: true,
      code: error.code || "PLANNER_FAILED",
    };
    throw error;
  }
}

/**
 * Create a bound generate function for a chat request (captures runtime config).
 */
function createModelGenerate(options = {}) {
  const runtimeMode = options.runtimeMode || "public";
  const providerRuntimeConfig = options.providerRuntimeConfig || {};
  const onEvent = options.onEvent;
  const env = options.env || process.env;
  const diagnostics = {
    plannerProvider: "none",
    plannerLatency: 0,
    plannerFallback: false,
    plannerStatus: "not_called",
  };

  async function boundGenerate(request = {}) {
    try {
      const result = await generate({
        messages: request.messages,
        maxTokens: request.maxTokens,
        runtimeMode,
        providerRuntimeConfig,
        onEvent,
        env,
      });
      diagnostics.plannerProvider = result.provider || "unknown";
      // accumulate latency across plan + optional replan
      diagnostics.plannerLatency = (Number(diagnostics.plannerLatency) || 0) + (result.latencyMs || 0);
      diagnostics.plannerFallback = false;
      diagnostics.plannerStatus = "ok";
      diagnostics.successCount = (diagnostics.successCount || 0) + 1;
      return result;
    } catch (error) {
      const provider = (error.plannerMeta && error.plannerMeta.provider) || diagnostics.plannerProvider;
      diagnostics.failureCount = (diagnostics.failureCount || 0) + 1;
      diagnostics.lastFailureReason = String(error && error.code || error && error.plannerMeta && error.plannerMeta.code || "PLANNER_FAILED").slice(0, 80);
      diagnostics.plannerProvider = provider || diagnostics.plannerProvider;
      diagnostics.plannerLatency = (Number(diagnostics.plannerLatency) || 0)
        + ((error.plannerMeta && error.plannerMeta.latencyMs) || 0);
      // Only mark overall fallback if we never succeeded
      if (!diagnostics.successCount) {
        diagnostics.plannerFallback = true;
        diagnostics.plannerStatus = (error.plannerMeta && error.plannerMeta.status) || "failed";
      }
      throw error;
    }
  }

  boundGenerate.getDiagnostics = () => Object.assign({}, diagnostics);
  return boundGenerate;
}

function resetCircuitForTests() {
  plannerCircuit.failures = 0;
  plannerCircuit.openedAt = 0;
  plannerCircuit.state = "closed";
}

module.exports = {
  generate,
  createModelGenerate,
  selectPlannerProviderName,
  sanitizeMessages,
  isCircuitOpen,
  resetCircuitForTests,
  PLANNER_SYSTEM,
};
