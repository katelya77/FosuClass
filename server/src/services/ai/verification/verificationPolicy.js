/**
 * Tool verification policy grammar (Phase 5: semantic verification).
 * Pure, dependency-free validation for the optional per-tool strategy fields in
 * agent-capability-manifest.json. Kept separate from toolResultVerifier so that
 * capabilityManifestService can validate policies at load time without creating
 * a require cycle.
 *
 * Supported fields on a manifest tool entry (all optional):
 * - outputSchema: { required: string[], fields: { [name]: type } } (shallow shape)
 * - successPostconditions: declarative predicate strings:
 *     fieldNonEmpty:<field>
 *     fieldMatchesSlot:<resultField>:<slotOrConstraintKey>
 *     numericRange:<field>:<min>:<max>
 *     timeOrder:<earlierField>:<laterField>
 * - emptyResultPolicy: { mode: "accept" | "partial" | "fail", codes: string[] }
 * - partialCompletionPolicy: { allowPartial: boolean, note: string }
 * - evidencePolicy: { evidenceFields: string[], approximateFlags: [{ field, label }] }
 */

const VERIFICATION_POLICY_KEYS = Object.freeze([
  "outputSchema",
  "successPostconditions",
  "emptyResultPolicy",
  "partialCompletionPolicy",
  "evidencePolicy",
]);

const OUTPUT_FIELD_TYPES = Object.freeze([
  "string",
  "number",
  "integer",
  "boolean",
  "time",
  "array",
  "object",
]);

const EMPTY_RESULT_MODES = Object.freeze(["accept", "partial", "fail"]);

const POSTCONDITION_KINDS = Object.freeze([
  "fieldNonEmpty",
  "fieldMatchesSlot",
  "numericRange",
  "timeOrder",
]);

const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}(\.[A-Za-z][A-Za-z0-9_]{0,59})?$/;

function isFieldName(value) {
  return typeof value === "string" && FIELD_NAME_RE.test(value);
}

/**
 * Parse one postcondition predicate string.
 * @returns {{ kind: string, args: string[] } | null}
 */
function parsePostcondition(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const parts = text.trim().split(":");
  const kind = parts[0];
  if (!POSTCONDITION_KINDS.includes(kind)) return null;
  const args = parts.slice(1);
  switch (kind) {
    case "fieldNonEmpty":
      return args.length === 1 && isFieldName(args[0]) ? { kind, args } : null;
    case "fieldMatchesSlot":
      return args.length === 2 && isFieldName(args[0]) && isFieldName(args[1]) ? { kind, args } : null;
    case "numericRange": {
      if (args.length !== 3 || !isFieldName(args[0])) return null;
      const min = Number(args[1]);
      const max = Number(args[2]);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
      return { kind, args };
    }
    case "timeOrder":
      return args.length === 2 && isFieldName(args[0]) && isFieldName(args[1]) ? { kind, args } : null;
    default:
      return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Validate the optional verification policy fields of one manifest tool entry.
 * @returns {Array<{ code: string, detail: string }>}
 */
function validateToolVerificationPolicy(toolId, tool = {}) {
  const errors = [];
  const id = String(toolId || "unknown");
  const push = (code, detail) => errors.push({ code, detail: `${id}: ${detail}` });

  if (tool.outputSchema !== undefined) {
    const schema = tool.outputSchema;
    if (!isPlainObject(schema)) {
      push("OUTPUT_SCHEMA_INVALID", "outputSchema must be an object");
    } else {
      if (schema.required !== undefined && !isStringArray(schema.required)) {
        push("OUTPUT_SCHEMA_INVALID", "outputSchema.required must be a string array");
      }
      if ((schema.required || []).some((field) => !isFieldName(field))) {
        push("OUTPUT_SCHEMA_INVALID", "outputSchema.required contains an invalid field name");
      }
      if (schema.fields !== undefined) {
        if (!isPlainObject(schema.fields)) {
          push("OUTPUT_SCHEMA_INVALID", "outputSchema.fields must be an object");
        } else {
          Object.keys(schema.fields).forEach((field) => {
            if (!isFieldName(field)) push("OUTPUT_SCHEMA_INVALID", `invalid field name ${field}`);
            if (!OUTPUT_FIELD_TYPES.includes(schema.fields[field])) {
              push("OUTPUT_SCHEMA_INVALID", `field ${field} has unsupported type ${schema.fields[field]}`);
            }
          });
        }
      }
    }
  }

  if (tool.successPostconditions !== undefined) {
    if (!isStringArray(tool.successPostconditions)) {
      push("POSTCONDITIONS_INVALID", "successPostconditions must be a string array");
    } else {
      tool.successPostconditions.forEach((predicate) => {
        if (!parsePostcondition(predicate)) {
          push("POSTCONDITIONS_INVALID", `unparseable predicate "${predicate}"`);
        }
      });
    }
  }

  if (tool.emptyResultPolicy !== undefined) {
    const policy = tool.emptyResultPolicy;
    if (!isPlainObject(policy)) {
      push("EMPTY_RESULT_POLICY_INVALID", "emptyResultPolicy must be an object");
    } else {
      if (!EMPTY_RESULT_MODES.includes(policy.mode)) {
        push("EMPTY_RESULT_POLICY_INVALID", `mode must be one of ${EMPTY_RESULT_MODES.join("/")}`);
      }
      if (policy.codes !== undefined && !isStringArray(policy.codes)) {
        push("EMPTY_RESULT_POLICY_INVALID", "codes must be a string array");
      }
    }
  }

  if (tool.partialCompletionPolicy !== undefined) {
    const policy = tool.partialCompletionPolicy;
    if (!isPlainObject(policy)) {
      push("PARTIAL_POLICY_INVALID", "partialCompletionPolicy must be an object");
    } else {
      if (policy.allowPartial !== undefined && typeof policy.allowPartial !== "boolean") {
        push("PARTIAL_POLICY_INVALID", "allowPartial must be a boolean");
      }
      if (policy.note !== undefined && typeof policy.note !== "string") {
        push("PARTIAL_POLICY_INVALID", "note must be a string");
      }
    }
  }

  if (tool.evidencePolicy !== undefined) {
    const policy = tool.evidencePolicy;
    if (!isPlainObject(policy)) {
      push("EVIDENCE_POLICY_INVALID", "evidencePolicy must be an object");
    } else {
      if (policy.evidenceFields !== undefined) {
        if (!isStringArray(policy.evidenceFields) || policy.evidenceFields.some((field) => !isFieldName(field))) {
          push("EVIDENCE_POLICY_INVALID", "evidenceFields must be valid field-name strings");
        }
      }
      if (policy.approximateFlags !== undefined) {
        const flags = policy.approximateFlags;
        const valid = Array.isArray(flags) && flags.every((flag) => isPlainObject(flag)
          && isFieldName(flag.field)
          && typeof flag.label === "string"
          && /^[A-Z][A-Z0-9_]{2,80}$/.test(flag.label));
        if (!valid) {
          push("EVIDENCE_POLICY_INVALID", "approximateFlags must be [{ field, label }] with UPPER_SNAKE labels");
        }
      }
    }
  }

  return errors;
}

module.exports = {
  EMPTY_RESULT_MODES,
  FIELD_NAME_RE,
  OUTPUT_FIELD_TYPES,
  POSTCONDITION_KINDS,
  VERIFICATION_POLICY_KEYS,
  isFieldName,
  parsePostcondition,
  validateToolVerificationPolicy,
};
