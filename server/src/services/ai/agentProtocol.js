const crypto = require("crypto");
const actionCommandContract = require("./actionCommandContract");
const capabilityManifestService = require("./capabilityManifestService");
const generatedPayloadContract = require("./generatedPayloadContract");
const safetyGuard = require("./safetyGuard");

const PROTOCOL_VERSION = "agent.v1";
const PROTOCOL_V2 = "agent.v2";
const LATEST_PROTOCOL_VERSION = PROTOCOL_V2;
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([PROTOCOL_VERSION, PROTOCOL_V2]);
const manifest = capabilityManifestService.getManifest();

const INTENT_DEFINITIONS = Object.freeze(Object.values(manifest.intents).reduce((output, item) => {
  output[item.id] = Object.freeze({
    public: item.publicAllowed === true,
    trial: item.runtimeModes.includes("trial"),
    dev: item.runtimeModes.includes("dev"),
    competition: item.runtimeModes.includes("trial"),
    fact: item.factualTask === true,
    skill: item.skill,
    externalProviderAllowed: item.externalProviderAllowed === true,
  });
  return output;
}, {}));

const TOOL_DEFINITIONS = Object.freeze(Object.values(manifest.tools).reduce((output, item) => {
  output[item.id] = Object.freeze({
    public: item.runtimeModes.includes("public"),
    trial: item.runtimeModes.includes("trial"),
    dev: item.runtimeModes.includes("dev"),
    competition: item.runtimeModes.includes("trial"),
  });
  return output;
}, {}));

const CARD_TYPES = new Set(generatedPayloadContract.ALLOWED_CARD_TYPES);
const ACTION_TYPES = new Set(generatedPayloadContract.ALLOWED_ACTION_TYPES);
const MAX_PLAN_STEPS = manifest.limits.maxPlanSteps;
const BLOCKED_PROTOCOL_KEY = /(api.?key|secret|token|password|passwd|cookie|authorization|system.?prompt|internal.?url|base.?url|provider.?config|endpoint|deployment|whitelist)/i;

function safeProtocolText(value, maxLength = 0) {
  let text = safetyGuard.redactSensitiveText(String(value == null ? "" : value));
  text = text
    .replace(/\b(?:https?|wss?):\/\/[^\s，。；;"'<>]+/gi, "[链接已省略]")
    .replace(/\b(?:javascript|data|file|wxfile):[^\s，。；;"'<>]*/gi, "[链接已省略]")
    .replace(/\b(?:system\s*prompt|developer\s*prompt|internal\s*prompt)\b/gi, "[内部提示已省略]")
    .replace(/系统(?:级)?提示(?:词)?|内部提示(?:词)?/g, "[内部提示已省略]");
  const limit = Math.max(0, Number(maxLength || 0) || 0);
  return limit > 0 ? text.slice(0, limit) : text;
}

function sanitizeProtocolValue(value, depth = 0) {
  if (depth > 8) return "[已省略]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return safeProtocolText(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeProtocolValue(item, depth + 1));
  const output = {};
  Object.keys(value).forEach((key) => {
    if (!BLOCKED_PROTOCOL_KEY.test(key)) {
      output[key] = sanitizeProtocolValue(value[key], depth + 1);
    }
  });
  return output;
}

function createRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function createRunId() {
  return `run_${createRequestId()}`;
}

function normalizeProtocolVersion(value) {
  const version = String(value || "").trim();
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version) ? version : PROTOCOL_VERSION;
}

function isSupportedProtocolVersion(value) {
  return !value || SUPPORTED_PROTOCOL_VERSIONS.includes(String(value));
}

function normalizeRuntimeMode(value) {
  return capabilityManifestService.normalizeRuntimeMode(value);
}

function toLegacyRuntimeMode(value) {
  return normalizeRuntimeMode(value) === "public" ? "public" : "competition";
}

function serializeRuntimeMode(value, protocolVersion) {
  return normalizeProtocolVersion(protocolVersion) === PROTOCOL_VERSION
    ? toLegacyRuntimeMode(value)
    : normalizeRuntimeMode(value);
}

function isKnownIntent(name) {
  return Object.prototype.hasOwnProperty.call(INTENT_DEFINITIONS, String(name || ""));
}

function isKnownTool(name) {
  return Object.prototype.hasOwnProperty.call(TOOL_DEFINITIONS, String(name || ""));
}

function isPublicIntent(name) {
  const item = INTENT_DEFINITIONS[String(name || "")];
  return Boolean(item && item.public);
}

function isFactIntent(name) {
  const item = INTENT_DEFINITIONS[String(name || "")];
  return Boolean(item && item.fact);
}

function isAllowedToolForRuntime(name, runtimeMode) {
  return capabilityManifestService.isToolAllowedForRuntime(name, runtimeMode);
}

function stableSlots(slots = {}) {
  const source = slots && typeof slots === "object" && !Array.isArray(slots) ? slots : {};
  return sanitizeProtocolValue(safetyGuard.sanitizeToolResult(source));
}

function buildPlanStep(toolName, args = {}, reason = "") {
  return {
    toolName: String(toolName || ""),
    args: stableSlots(args),
    reason: safetyGuard.redactSensitiveText(String(reason || "")).slice(0, 160),
  };
}

function normalizePlan(plan = [], runtimeMode = "public") {
  // Accept legacy array of steps OR structured plan { steps, plannerType, ... }
  let list = [];
  if (Array.isArray(plan)) {
    list = plan;
  } else if (plan && typeof plan === "object" && Array.isArray(plan.steps)) {
    list = plan.steps;
  }
  return list
    .map((item) => buildPlanStep(
      item.toolName || item.name,
      item.args || item.input || {},
      item.reason || item.reasonCode || item.label || ""
    ))
    .filter((item) => item.toolName && isAllowedToolForRuntime(item.toolName, runtimeMode))
    .slice(0, MAX_PLAN_STEPS);
}

/**
 * Preserve structured planner metadata for diagnostics / UI trajectory.
 * Does not include raw prompts or hidden reasoning.
 */
function normalizeStructuredPlanMeta(plan = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  const plannerType = String(plan.plannerType || "").slice(0, 32);
  if (!plannerType && !plan.goal && !Array.isArray(plan.steps)) return null;
  return {
    plannerType: plannerType || "deterministic",
    goal: safeProtocolText(plan.goal || "", 160),
    intent: safeProtocolText(plan.intent || "", 80),
    replanCount: Math.max(0, Number(plan.replanCount || 0) || 0),
    needsClarification: plan.needsClarification === true,
    plannerProvider: safeProtocolText(plan.plannerProvider || "", 40),
    plannerLatencyMs: Math.max(0, Number(plan.plannerLatencyMs || 0) || 0),
    stepCount: Array.isArray(plan.steps) ? plan.steps.length : 0,
  };
}

function summarizeEvidenceItem(call = {}) {
  const result = call.result || {};
  const meta = result.meta || result.metadata || {};
  return {
    toolName: String(call.name || call.toolName || "").slice(0, 80),
    status: String(call.status || (result.success === false ? "failed" : "success")).slice(0, 24),
    sourceId: String(result.sourceId || result.source || meta.sourceId || "").slice(0, 120),
    updatedAt: String(result.updatedAt || meta.updatedAt || "").slice(0, 40),
    checksum: String(result.checksum || meta.checksum || "").slice(0, 80),
    factCount: Number(result.total || result.courseCount || (Array.isArray(result.items) ? result.items.length : 0) || 0) || 0,
  };
}

function buildProtocolEnvelope(payload = {}) {
  const protocolVersion = normalizeProtocolVersion(payload.protocolVersion);
  const canonicalRuntimeMode = normalizeRuntimeMode(payload.runtimeMode);
  const toolCalls = Array.isArray(payload.rawToolCalls || payload.toolCalls)
    ? (payload.rawToolCalls || payload.toolCalls)
    : [];
  return {
    protocolVersion,
    requestId: payload.requestId || createRequestId(),
    conversationId: String(payload.conversationId || "").slice(0, 80),
    runtimeMode: serializeRuntimeMode(canonicalRuntimeMode, protocolVersion),
    canonicalRuntimeMode,
    intent: payload.intent && payload.intent.name || payload.intent || "conversational_help",
    slots: stableSlots(payload.intent && payload.intent.slots || payload.slots || {}),
    plan: normalizePlan(payload.plan || [], canonicalRuntimeMode),
    evidenceItems: toolCalls.map(summarizeEvidenceItem).filter((item) => item.toolName),
  };
}

function validateCards(cards = []) {
  return (Array.isArray(cards) ? cards : []).map((card) => {
    const stable = generatedPayloadContract.stableCard(card);
    if (!stable || !CARD_TYPES.has(stable.type)) return null;
    return sanitizeProtocolValue(stable);
  }).filter(Boolean).slice(0, 8);
}

function validateCardsForIntent(cards = [], intentName = "conversational_help") {
  const capability = capabilityManifestService.getIntent(intentName);
  if (!capability) return [];
  const allowed = new Set(capability.allowedCardTypes || []);
  return validateCards(cards).filter((card) => allowed.has(card.type));
}

function validateActions(cards = []) {
  return validateCards(cards).flatMap((card) => card.actions || []).every((action) => ACTION_TYPES.has(action.type));
}

function validateResponse(payload = {}) {
  const intentName = payload.intent && payload.intent.name || payload.intent || "conversational_help";
  const globallyValidCards = validateCards(payload.cards);
  const cards = validateCardsForIntent(payload.cards, intentName);
  const errors = [];
  if (!isSupportedProtocolVersion(payload.protocolVersion || PROTOCOL_VERSION)) {
    errors.push({ code: "PROTOCOL_VERSION_UNSUPPORTED" });
  }
  if (!isKnownIntent(intentName)) {
    errors.push({ code: "INTENT_UNKNOWN" });
  }
  if (cards.length !== globallyValidCards.length) {
    errors.push({ code: "CARD_NOT_ALLOWED_FOR_INTENT" });
  }
  const plan = normalizePlan(payload.plan || [], payload.runtimeMode);
  const rawPlanSteps = Array.isArray(payload.plan)
    ? payload.plan
    : (payload.plan && Array.isArray(payload.plan.steps) ? payload.plan.steps : []);
  const invalidPlan = rawPlanSteps.filter((step) => !isKnownTool(step.toolName || step.name));
  if (invalidPlan.length) errors.push({ code: "TOOL_NOT_WHITELISTED" });
  if (!validateActions(cards)) errors.push({ code: "ACTION_NOT_WHITELISTED" });
  return { ok: errors.length === 0, errors, cards, plan };
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function stableV2Plan(plan, runtimeMode) {
  return normalizePlan(plan, runtimeMode).map((step, index) => ({
    id: `plan-${index + 1}`,
    label: safeProtocolText(step.reason || `执行 ${step.toolName}`, 120),
    tool: step.toolName,
    status: "planned",
  }));
}

function stableExecutionSteps(steps = []) {
  return (Array.isArray(steps) ? steps : []).slice(0, MAX_PLAN_STEPS).map((step, index) => ({
    id: String(step.id || step.key || `step-${index + 1}`).slice(0, 80),
    label: safeProtocolText(step.label || "", 120),
    status: ["planned", "running", "success", "failed", "skipped", "done"].includes(step.status) ? step.status : "success",
    tool: String(step.tool || step.toolName || "").slice(0, 80),
    durationMs: Math.max(0, Number(step.durationMs || 0) || 0),
    errorCode: safeProtocolText(step.errorCode || "", 80),
    retried: step.retried === true,
  }));
}

function stableObservations(observations = []) {
  return (Array.isArray(observations) ? observations : []).slice(0, MAX_PLAN_STEPS).map((item, index) => ({
    id: String(item.id || `observation-${index + 1}`).slice(0, 80),
    tool: String(item.tool || item.toolName || item.name || "").slice(0, 80),
    status: String(item.status || "success").slice(0, 24),
    code: String(item.code || item.errorCode || "").slice(0, 80),
    summary: safeProtocolText(item.summary || "", manifest.limits.maxObservationChars),
    sourceId: safeProtocolText(item.sourceId || "", 120),
    factCount: Math.max(0, Number(item.factCount || 0) || 0),
  }));
}

function buildV2Response(payload = {}) {
  const envelope = buildProtocolEnvelope(Object.assign({}, payload, { protocolVersion: PROTOCOL_V2 }));
  const intent = payload.intent && typeof payload.intent === "object"
    ? payload.intent
    : { name: envelope.intent, slots: envelope.slots };
  const skill = payload.skill || null;
  const errors = Array.isArray(payload.errors) ? payload.errors.map((item) => ({
    code: String(item && item.code || "UNKNOWN_ERROR").slice(0, 80),
    message: safeProtocolText(item && item.message || "", 240),
  })) : [];
  const cardValidation = validateResponse({
    protocolVersion: PROTOCOL_V2,
    runtimeMode: envelope.canonicalRuntimeMode,
    intent,
    plan: payload.plan,
    cards: payload.cards,
  });
  const protocolErrors = errors.concat(cardValidation.errors.filter((item) =>
    !errors.some((existing) => existing.code === item.code)
  ));
  const response = {
    protocolVersion: PROTOCOL_V2,
    requestId: envelope.requestId,
    conversationId: envelope.conversationId,
    runtimeMode: envelope.canonicalRuntimeMode,
    runId: String(payload.runId || createRunId()).slice(0, 100),
    status: payload.status || (protocolErrors.length ? "partial" : "completed"),
    success: payload.success !== false,
    intent: envelope.intent,
    confidence: normalizeConfidence(intent.confidence),
    slots: envelope.slots,
    skill: skill ? {
      id: String(skill.id || skill).slice(0, 80),
      version: String(skill.version || "").slice(0, 32),
      description: safeProtocolText(skill.description || "", 180),
    } : null,
    plan: stableV2Plan(payload.plan, envelope.canonicalRuntimeMode),
    planMeta: normalizeStructuredPlanMeta(payload.plan) || payload.planMeta || null,
    steps: stableExecutionSteps(payload.steps || payload.taskSteps),
    toolCalls: (Array.isArray(payload.toolCalls) ? payload.toolCalls : []).slice(0, MAX_PLAN_STEPS).map((call) => ({
      name: safeProtocolText(call && (call.name || call.toolName), 80),
      status: safeProtocolText(call && call.status, 24),
      summary: safeProtocolText(call && call.summary, 160),
    })),
    observations: stableObservations(payload.observations),
    goalContract: payload.goalContract && typeof payload.goalContract === "object"
      ? sanitizeProtocolValue(safetyGuard.sanitizeToolResult(payload.goalContract))
      : null,
    verificationGoalContract: payload.verificationGoalContract && typeof payload.verificationGoalContract === "object"
      ? sanitizeProtocolValue(safetyGuard.sanitizeToolResult(payload.verificationGoalContract))
      : null,
    understanding: payload.understanding && typeof payload.understanding === "object"
      ? sanitizeProtocolValue(safetyGuard.sanitizeToolResult({
        source: payload.understanding.source,
        providerUsed: payload.understanding.providerUsed || false,
        externalProviderUsed: payload.understanding.externalProviderUsed === true,
        fallback: payload.understanding.fallback === true,
        reasonCode: payload.understanding.reasonCode || "",
        latencyMs: Math.max(0, Number(payload.understanding.latencyMs || 0) || 0),
      }))
      : null,
    providerStages: payload.providerStages && typeof payload.providerStages === "object"
      ? sanitizeProtocolValue(safetyGuard.sanitizeToolResult(payload.providerStages))
      : null,
    verification: payload.verification && typeof payload.verification === "object"
      ? sanitizeProtocolValue(safetyGuard.sanitizeToolResult({
        ok: payload.verification.ok !== false,
        evidenceComplete: payload.verification.evidenceComplete !== false,
        errors: Array.isArray(payload.verification.errors) ? payload.verification.errors.slice(0, 8) : [],
      }))
      : null,
    answer: safeProtocolText(payload.answer || "", 1600),
    cards: cardValidation.cards,
    // Action Command Bus 协议字段：模型只能引用 manifest.actions 中的 command，
    // 写操作只携带确认请求，由小程序端在用户确认后执行。
    actions: actionCommandContract.stableActionCommands(payload.actions, envelope.canonicalRuntimeMode),
    suggestions: (Array.isArray(payload.suggestions) ? payload.suggestions : []).slice(0, 6)
      .map((item) => safeProtocolText(item, 120)).filter(Boolean),
    evidence: sanitizeProtocolValue(safetyGuard.sanitizeToolResult(payload.evidence || {})),
    // Presentation contract for mini-program (agent.v2 additive fields)
    presentationMode: safeProtocolText(payload.presentationMode || "", 32),
    presentation: payload.presentation && typeof payload.presentation === "object"
      ? sanitizeProtocolValue(safetyGuard.sanitizeToolResult({
        presentationMode: payload.presentation.presentationMode,
        runSummary: payload.presentation.runSummary,
        taskTrajectory: payload.presentation.taskTrajectory,
        feedback: payload.presentation.feedback,
        meta: payload.presentation.meta,
      }))
      : null,
    runSummary: payload.runSummary && typeof payload.runSummary === "object"
      ? sanitizeProtocolValue(safetyGuard.sanitizeToolResult(payload.runSummary))
      : null,
    taskTrajectory: payload.taskTrajectory && typeof payload.taskTrajectory === "object"
      ? sanitizeProtocolValue(safetyGuard.sanitizeToolResult(payload.taskTrajectory))
      : null,
    evidenceDisplay: payload.evidenceDisplay && typeof payload.evidenceDisplay === "object"
      ? sanitizeProtocolValue(safetyGuard.sanitizeToolResult(payload.evidenceDisplay))
      : null,
    safety: sanitizeProtocolValue(safetyGuard.sanitizeToolResult(payload.safety || {})),
    metrics: sanitizeProtocolValue(safetyGuard.sanitizeToolResult(payload.metrics || {})),
    errors: protocolErrors,
    contextSlots: stableSlots(payload.contextSlots || {}),
    fallback: payload.fallback === true,
    fallbackLayer: String(payload.fallbackLayer || "none").slice(0, 24),
    fallbackReason: safeProtocolText(payload.fallbackReason || "", 160),
    fallbackAllowed: payload.fallbackAllowed === true,
    externalProviderUsed: payload.externalProviderUsed === true,
    memory: stableMemory(payload.memory),
    memoryPreferencePatch: stableMemoryPreferencePatch(payload.memoryPreferencePatch),
    serverTime: payload.serverTime || new Date().toISOString(),
  };
  if (envelope.canonicalRuntimeMode === "public") {
    delete response.understanding;
    delete response.providerStages;
    if (response.planMeta && typeof response.planMeta === "object") {
      response.planMeta = Object.assign({}, response.planMeta);
      delete response.planMeta.plannerProvider;
    }
  }
  return response;
}

function stableMemoryPreferencePatch(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = {};
  const preferredName = safeProtocolText(source.preferredName || "", 24)
    .replace(/[，。！？,.!?]+$/g, "");
  if (/^[\u3400-\u9fffA-Za-z0-9·\-\s]{1,24}$/.test(preferredName)) {
    output.preferredName = preferredName;
  }
  if (["仙溪校区", "江湾校区"].includes(source.campus)) {
    output.campus = source.campus;
  }
  const lead = Number(source.defaultReminderLeadMinutes);
  if (Number.isFinite(lead) && lead >= 5 && lead <= 180) {
    output.defaultReminderLeadMinutes = Math.round(lead);
  }
  return output;
}

function stableMemory(memory = {}) {
  const source = memory && typeof memory === "object" && !Array.isArray(memory) ? memory : {};
  const mode = ["local_only", "session_state", "cloud_sync"].includes(String(source.mode || ""))
    ? String(source.mode)
    : "local_only";
  return {
    mode,
    authenticated: source.authenticated === true,
    persisted: source.persisted === true,
    synced: mode === "cloud_sync" && source.synced === true,
    revision: Math.max(0, Number(source.revision || 0) || 0),
    expiresAt: safeProtocolText(source.expiresAt || "", 40),
    summaryAvailable: source.summaryAvailable === true,
    canClear: source.canClear === true,
  };
}

module.exports = {
  ACTION_TYPES,
  CARD_TYPES,
  INTENT_DEFINITIONS,
  LATEST_PROTOCOL_VERSION,
  MAX_PLAN_STEPS,
  PROTOCOL_V2,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOL_DEFINITIONS,
  buildPlanStep,
  buildProtocolEnvelope,
  buildV2Response,
  createRequestId,
  createRunId,
  isAllowedToolForRuntime,
  isFactIntent,
  isKnownIntent,
  isKnownTool,
  isPublicIntent,
  isSupportedProtocolVersion,
  normalizePlan,
  normalizeStructuredPlanMeta,
  normalizeProtocolVersion,
  normalizeRuntimeMode,
  serializeRuntimeMode,
  stableActionCommands: actionCommandContract.stableActionCommands,
  stableExecutionSteps,
  stableMemory,
  stableObservations,
  stableSlots,
  toLegacyRuntimeMode,
  validateResponse,
};
