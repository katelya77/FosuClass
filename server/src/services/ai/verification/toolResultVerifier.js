/**
 * Tool result verifier (Phase 5 runtime consumer, M2-T1).
 *
 * Runtime consumer of the per-tool verification policies declared in
 * agent-capability-manifest.json and validated at load time by
 * capabilityManifestService. Policy parsing/grammar lives in
 * verificationPolicy.js — this module only evaluates an already-normalized
 * policy against one tool result and returns a structured verdict.
 *
 * verify({ toolId, policy, result, intent, goalContract }) →
 *   { status: "verified" | "partial" | "failed" | "empty_accepted",
 *     ok: boolean,
 *     violations: [{ code, detail, field? }],
 *     evidence: { fields: string[], approximateFlags: [{ field, label }] } }
 *
 * Status rules:
 * - failed: result missing / success=false, any hard violation (missing or
 *   mistyped required output field, unparseable postcondition, rejected empty
 *   result), or soft violations without partialCompletionPolicy.allowPartial.
 * - partial: only soft violations (postcondition failures, mistyped optional
 *   fields) and partialCompletionPolicy.allowPartial === true; or an empty
 *   result under emptyResultPolicy.mode "partial".
 * - empty_accepted: result.code matches emptyResultPolicy.codes under mode
 *   "accept" (legal empty state — schema/postcondition checks are skipped).
 * - verified: everything else (including a tool with no policy at all).
 *
 * ok === (status !== "failed"): the result is acceptable for composing an
 * answer. Violation details reference field names and declared constraints
 * only — never raw schedule/personal values (脱敏边界).
 */

const {
  EMPTY_RESULT_MODES,
  VERIFICATION_POLICY_KEYS,
  parsePostcondition,
} = require("./verificationPolicy");

const TIME_VALUE_RE = /^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPresent(value) {
  return value !== undefined && value !== null;
}

function isEmptyValue(value) {
  if (!isPresent(value)) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

/**
 * Keep only the five verification policy keys from a manifest tool entry (or
 * an already-normalized policy). Never mutates the source — manifest entries
 * are deep-frozen by capabilityManifestService.
 */
function normalizePolicy(source) {
  const policy = {};
  if (!isPlainObject(source)) return policy;
  VERIFICATION_POLICY_KEYS.forEach((key) => {
    if (source[key] !== undefined) policy[key] = source[key];
  });
  return policy;
}

/** Field names may carry one dotted level (see FIELD_NAME_RE). */
function getFieldValue(result, field) {
  let value = result;
  const parts = String(field).split(".");
  for (let index = 0; index < parts.length; index += 1) {
    if (!isPlainObject(value) && !Array.isArray(value)) return undefined;
    value = value[parts[index]];
  }
  return value;
}

function typeMatches(value, declaredType) {
  switch (declaredType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "time":
      return typeof value === "string" && TIME_VALUE_RE.test(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    default:
      // Unsupported declared types are rejected at manifest load time; stay
      // permissive here rather than inventing violations for a config bug.
      return true;
  }
}

function timeToMinutes(value) {
  if (typeof value !== "string" || !TIME_VALUE_RE.test(value)) return null;
  const parts = value.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function valuesEqual(left, right) {
  if (left === right) return true;
  if (!isPresent(left) || !isPresent(right)) return false;
  const leftText = String(left).trim();
  const rightText = String(right).trim();
  if (!leftText || !rightText) return false;
  const leftNumber = Number(leftText);
  const rightNumber = Number(rightText);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber === rightNumber;
  }
  return leftText.toLowerCase() === rightText.toLowerCase();
}

function lookupSlotValue(intent, key) {
  const slots = intent && isPlainObject(intent.slots) ? intent.slots : {};
  if (slots[key] !== undefined) return { found: true, value: slots[key] };
  const constraints = intent && isPlainObject(intent.constraints) ? intent.constraints : {};
  if (constraints[key] !== undefined) return { found: true, value: constraints[key] };
  return { found: false };
}

function matchesSlotValue(resultValue, slotValue) {
  if (Array.isArray(slotValue)) {
    return slotValue.some((item) => matchesSlotValue(resultValue, item));
  }
  if (Array.isArray(resultValue)) {
    return resultValue.some((item) => valuesEqual(item, slotValue));
  }
  return valuesEqual(resultValue, slotValue);
}

/**
 * Evaluate one declarative postcondition predicate.
 * @returns {{ code: string, detail: string, field?: string, hard: boolean } | null}
 */
function evaluatePostcondition(toolId, predicate, result, intent) {
  const parsed = parsePostcondition(predicate);
  if (!parsed) {
    // Unparseable predicates are rejected at manifest load time; a runtime
    // occurrence means the caller bypassed validation — never silently pass.
    return {
      code: "POSTCONDITION_INVALID",
      detail: `${toolId}: unparseable postcondition "${String(predicate)}"`,
      hard: true,
    };
  }
  const soft = (code, field, detail) => ({ code, field, detail: `${toolId}: ${detail}`, hard: false });

  switch (parsed.kind) {
    case "fieldNonEmpty": {
      const field = parsed.args[0];
      if (isEmptyValue(getFieldValue(result, field))) {
        return soft("FIELD_NON_EMPTY_VIOLATION", field, `field ${field} must be non-empty`);
      }
      return null;
    }
    case "fieldMatchesSlot": {
      const field = parsed.args[0];
      const slotKey = parsed.args[1];
      const slot = lookupSlotValue(intent, slotKey);
      // Slot absent from the intent: the user constrained nothing, so the
      // predicate is vacuous and cannot fail the result.
      if (!slot.found) return null;
      const value = getFieldValue(result, field);
      if (!isPresent(value) || !matchesSlotValue(value, slot.value)) {
        return soft("FIELD_MATCHES_SLOT_VIOLATION", field, `field ${field} does not match intent slot/constraint ${slotKey}`);
      }
      return null;
    }
    case "numericRange": {
      const field = parsed.args[0];
      const min = Number(parsed.args[1]);
      const max = Number(parsed.args[2]);
      const value = getFieldValue(result, field);
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        return soft("NUMERIC_RANGE_VIOLATION", field, `field ${field} must be a number within [${min}, ${max}]`);
      }
      return null;
    }
    case "timeOrder": {
      const earlierField = parsed.args[0];
      const laterField = parsed.args[1];
      const earlier = timeToMinutes(getFieldValue(result, earlierField));
      const later = timeToMinutes(getFieldValue(result, laterField));
      if (earlier === null || later === null || earlier > later) {
        return soft("TIME_ORDER_VIOLATION", earlierField, `field ${earlierField} must be a time not after ${laterField}`);
      }
      return null;
    }
    default:
      return null;
  }
}

/** Empty-result code matching follows goalContract's substring convention. */
function matchesEmptyCode(result, codes) {
  const code = String(result && result.code || "");
  if (!code) return false;
  return codes.some((item) => typeof item === "string" && item && code.indexOf(item) >= 0);
}

/**
 * Resolve the effective empty-result policy: the tool's own emptyResultPolicy
 * wins; goalContract ({ acceptEmpty, emptyCodes }) is only a fallback source
 * when the tool declares none.
 */
function resolveEmptyPolicy(policy, goalContract) {
  const declared = policy.emptyResultPolicy;
  if (isPlainObject(declared) && EMPTY_RESULT_MODES.includes(declared.mode)) {
    return {
      mode: declared.mode,
      codes: Array.isArray(declared.codes) ? declared.codes : [],
    };
  }
  const contract = isPlainObject(goalContract) ? goalContract : null;
  const contractCodes = contract && Array.isArray(contract.emptyCodes) ? contract.emptyCodes : [];
  if (contract && contractCodes.length) {
    return {
      mode: contract.acceptEmpty === false ? "fail" : "accept",
      codes: contractCodes,
    };
  }
  return null;
}

/** Surface the declared evidencePolicy verbatim (defensive copies). */
function buildEvidence(policy) {
  const evidencePolicy = isPlainObject(policy.evidencePolicy) ? policy.evidencePolicy : {};
  const fields = Array.isArray(evidencePolicy.evidenceFields)
    ? evidencePolicy.evidenceFields.filter((field) => typeof field === "string").slice()
    : [];
  const approximateFlags = Array.isArray(evidencePolicy.approximateFlags)
    ? evidencePolicy.approximateFlags
      .filter((flag) => isPlainObject(flag))
      .map((flag) => ({ field: String(flag.field || ""), label: String(flag.label || "") }))
    : [];
  return { fields, approximateFlags };
}

function toPublicViolation(violation) {
  const output = { code: violation.code, detail: violation.detail };
  if (violation.field !== undefined) output.field = violation.field;
  return output;
}

function buildOutcome(policy, violations, evidence) {
  const hasHard = violations.some((violation) => violation.hard);
  const allowPartial = Boolean(
    isPlainObject(policy.partialCompletionPolicy) && policy.partialCompletionPolicy.allowPartial === true
  );
  let status = "verified";
  if (violations.length) {
    status = !hasHard && allowPartial ? "partial" : "failed";
  }
  return {
    status,
    ok: status !== "failed",
    violations: violations.map(toPublicViolation),
    evidence,
  };
}

/**
 * Verify one tool result against its (already normalized) verification policy.
 * Pure and defensive: never mutates inputs, never throws on malformed input.
 */
function verify(input = {}) {
  const toolId = String(input.toolId || "unknown");
  const policy = normalizePolicy(input.policy);
  const result = input.result;
  const intent = isPlainObject(input.intent) ? input.intent : null;
  const goalContract = input.goalContract;
  const evidence = buildEvidence(policy);

  if (!isPlainObject(result) || result.success === false) {
    return buildOutcome(policy, [{
      code: "TOOL_RESULT_FAILED",
      detail: `${toolId}: tool result missing or success=false`,
      hard: true,
    }], evidence);
  }

  const emptyPolicy = resolveEmptyPolicy(policy, goalContract);
  if (emptyPolicy && matchesEmptyCode(result, emptyPolicy.codes)) {
    if (emptyPolicy.mode === "accept") {
      return { status: "empty_accepted", ok: true, violations: [], evidence };
    }
    if (emptyPolicy.mode === "partial") {
      const note = isPlainObject(policy.partialCompletionPolicy) && typeof policy.partialCompletionPolicy.note === "string"
        ? policy.partialCompletionPolicy.note
        : "";
      return {
        status: "partial",
        ok: true,
        violations: [{
          code: "EMPTY_RESULT_PARTIAL",
          detail: `${toolId}: empty result accepted as partial${note ? ` (${note})` : ""}`,
        }],
        evidence,
      };
    }
    return buildOutcome(policy, [{
      code: "EMPTY_RESULT_NOT_ACCEPTED",
      detail: `${toolId}: empty result rejected by emptyResultPolicy mode "fail"`,
      hard: true,
    }], evidence);
  }

  const violations = [];

  // outputSchema: required presence + shallow type checks (declared fields only).
  const schema = isPlainObject(policy.outputSchema) ? policy.outputSchema : null;
  const required = schema && Array.isArray(schema.required) ? schema.required : [];
  required.forEach((field) => {
    if (!isPresent(getFieldValue(result, field))) {
      violations.push({
        code: "OUTPUT_REQUIRED_MISSING",
        field,
        detail: `${toolId}: required output field ${field} is missing`,
        hard: true,
      });
    }
  });
  const declaredFields = schema && isPlainObject(schema.fields) ? schema.fields : {};
  Object.keys(declaredFields).forEach((field) => {
    const value = getFieldValue(result, field);
    if (!isPresent(value)) return; // presence is enforced by required, not fields
    if (!typeMatches(value, declaredFields[field])) {
      violations.push({
        code: "OUTPUT_TYPE_MISMATCH",
        field,
        detail: `${toolId}: output field ${field} must be of type ${declaredFields[field]}`,
        hard: required.includes(field),
      });
    }
  });

  // successPostconditions: declarative predicates over result + intent slots.
  const postconditions = Array.isArray(policy.successPostconditions) ? policy.successPostconditions : [];
  postconditions.forEach((predicate) => {
    const violation = evaluatePostcondition(toolId, predicate, result, intent);
    if (violation) violations.push(violation);
  });

  return buildOutcome(policy, violations, evidence);
}

module.exports = {
  normalizePolicy,
  verify,
};
