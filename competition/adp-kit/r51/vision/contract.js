"use strict";

const {
  containsVisionCredential,
  findForbiddenDynamicFields,
  isolateUntrustedVisualText,
} = require("./security.js");

const VISION_TRUST = "unverified_visual_observation";
const VISION_KINDS = Object.freeze([
  "schedule_screenshot",
  "academic_system_screenshot",
  "notice_poster",
  "classroom_notice",
  "table_image",
  "generic_image",
]);
const ALLOWED_KEYS = Object.freeze([
  "assetId", "mediaType", "kind", "extractedText", "entityCandidates",
  "temporalCandidates", "observations", "trust",
]);

function finiteConfidence(value) {
  return value == null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}

function validEntity(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const keys = Object.keys(candidate);
  return keys.every((key) => ["type", "text", "confidence"].includes(key))
    && typeof candidate.type === "string" && candidate.type.trim() !== ""
    && typeof candidate.text === "string" && candidate.text.trim() !== ""
    && finiteConfidence(candidate.confidence);
}

function validTemporal(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const allowed = ["text", "date", "weekday", "week", "periodStart", "periodEnd", "confidence"];
  if (!Object.keys(candidate).every((key) => allowed.includes(key))) return false;
  if (typeof candidate.text !== "string" || candidate.text.trim() === "") return false;
  if (candidate.date != null && typeof candidate.date !== "string") return false;
  for (const key of ["weekday", "week", "periodStart", "periodEnd"]) {
    if (candidate[key] != null && !Number.isInteger(candidate[key])) return false;
  }
  return finiteConfidence(candidate.confidence);
}

function validateVisionObservation(observation) {
  const errors = [];
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    return { ok: false, errors: ["missing VisionObservation"] };
  }
  if (!Object.keys(observation).every((key) => ALLOWED_KEYS.includes(key))) errors.push("VisionObservation contains forbidden fields");
  if (typeof observation.assetId !== "string" || observation.assetId.trim() === "" || /^https?:\/\//i.test(observation.assetId)) errors.push("invalid assetId");
  if (observation.mediaType !== "image") errors.push("mediaType must be image");
  if (!VISION_KINDS.includes(observation.kind)) errors.push("invalid kind");
  if (observation.trust !== VISION_TRUST) errors.push("invalid trust");
  if (!Array.isArray(observation.extractedText) || !observation.extractedText.every((x) => typeof x === "string")) errors.push("invalid extractedText");
  if (!Array.isArray(observation.entityCandidates) || !observation.entityCandidates.every(validEntity)) errors.push("invalid entityCandidates");
  if (!Array.isArray(observation.temporalCandidates) || !observation.temporalCandidates.every(validTemporal)) errors.push("invalid temporalCandidates");
  if (!Array.isArray(observation.observations) || !observation.observations.every((x) => typeof x === "string")) errors.push("invalid observations");
  if (containsVisionCredential(observation)) errors.push("credential content forbidden");
  return { ok: errors.length === 0, errors };
}

function copyCandidate(candidate) {
  const out = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function normalizeVisionToolResult(toolResult) {
  if (!toolResult || typeof toolResult !== "object" || Array.isArray(toolResult)) {
    return { ok: false, error: "invalid_vision_result", errors: ["vision result must be an object"], observation: null, warnings: [] };
  }
  if (toolResult.success === false) {
    return { ok: false, error: "vision_tool_failed", errors: ["vision tool reported failure"], observation: null, warnings: [] };
  }
  const envelopeForbidden = findForbiddenDynamicFields(toolResult);
  if (envelopeForbidden.length > 0) {
    return { ok: false, error: "forged_dynamic_fact", errors: envelopeForbidden, observation: null, warnings: [] };
  }
  const source = toolResult.success === true && toolResult.data && typeof toolResult.data === "object"
    ? toolResult.data
    : toolResult;
  const forbidden = findForbiddenDynamicFields(source);
  if (forbidden.length > 0 || (source.trust != null && source.trust !== VISION_TRUST)) {
    return { ok: false, error: "forged_dynamic_fact", errors: forbidden.length ? forbidden : ["invalid trust"], observation: null, warnings: [] };
  }
  if (containsVisionCredential(source)) {
    return { ok: false, error: "credential_content_detected", errors: ["credential-bearing visual content rejected"], observation: null, warnings: [] };
  }
  const isolatedText = isolateUntrustedVisualText(source.extractedText);
  const isolatedObservations = isolateUntrustedVisualText(source.observations);
  const entityCandidates = Array.isArray(source.entityCandidates)
    ? source.entityCandidates.filter((c) => !detectCandidateInjection(c)).map(copyCandidate)
    : source.entityCandidates;
  const temporalCandidates = Array.isArray(source.temporalCandidates)
    ? source.temporalCandidates.filter((c) => !detectCandidateInjection(c)).map(copyCandidate)
    : source.temporalCandidates;
  const observation = {
    assetId: source.assetId,
    mediaType: source.mediaType,
    kind: source.kind,
    extractedText: isolatedText.lines,
    entityCandidates,
    temporalCandidates,
    observations: isolatedObservations.lines,
    trust: VISION_TRUST,
  };
  const validation = validateVisionObservation(observation);
  if (!validation.ok) {
    return { ok: false, error: "invalid_vision_observation", errors: validation.errors, observation: null, warnings: [] };
  }
  return {
    ok: true,
    error: null,
    errors: [],
    observation,
    warnings: [...new Set([...isolatedText.warnings, ...isolatedObservations.warnings])],
  };
}

function detectCandidateInjection(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  const { detectVisualPromptInjection } = require("./security.js");
  return detectVisualPromptInjection(candidate.text || "").detected;
}

module.exports = {
  VISION_KINDS,
  VISION_TRUST,
  validateVisionObservation,
  normalizeVisionToolResult,
};
