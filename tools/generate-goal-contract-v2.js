#!/usr/bin/env node
/**
 * Generates server/src/services/ai/understanding/goalContractV2.generated.js
 * from the Capability Manifest (the single capability authority).
 *
 * The generator must classify every Manifest goal with a requested effect.
 * Goals the generic rules cannot classify need an explicit EFFECT_SUPPLEMENT
 * entry; an unclassifiable goal or a stale supplement entry fails the build
 * instead of silently shipping an incomplete GOAL_EFFECTS map.
 *
 * Usage:
 *   node tools/generate-goal-contract-v2.js           # write generated file
 *   node tools/generate-goal-contract-v2.js --check   # fail if stale
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "server", "config", "agent-capability-manifest.json");
const output = path.join(root, "server", "src", "services", "ai", "understanding", "goalContractV2.generated.js");

const CONTRACT_VERSION = "goal-contract.v2";
const REQUESTED_EFFECTS = ["read", "write", "navigate", "conversation"];

// Calibrated to the Manifest slot vocabulary: the V1 entityType set
// (teacher/class/classroom/course/campus) plus the entity kinds addressed by
// reminder, preference, navigation and knowledge goals. "none" marks a goal
// without a primary entity.
const ENTITY_ROLES = [
  "teacher", "class", "classroom", "course", "campus",
  "course_reminder", "preference", "page", "knowledge", "none",
];

// Skills whose primary outcome is place/page navigation.
const NAVIGATE_SKILLS = new Set(["campus_place_navigation", "next_course_location"]);

// Explicit effect overrides for goals the Manifest metadata alone cannot
// classify. Every key must reference an existing Manifest intent; stale
// entries fail the build so Manifest drift surfaces here.
const EFFECT_SUPPLEMENT = {
  clarify_missing_slot: "conversation",
  generate_image: "write",
};

function fail(message) {
  console.error(`goal-contract-v2: ${message}`);
  process.exit(1);
}

function deriveEffect(goalId, intent, tools) {
  const toolIds = Array.isArray(intent.allowedTools) ? intent.allowedTools : [];
  const toolEntries = toolIds.map((id) => ({ id, tool: tools[id] || null }));
  // Explicit write operations (reminder writes, preference updates, schedule
  // target changes) dominate every other classification.
  if (toolEntries.some((entry) => entry.tool && entry.tool.operation === "write")) return "write";
  if (NAVIGATE_SKILLS.has(String(intent.skill || ""))) return "navigate";
  if (Object.prototype.hasOwnProperty.call(EFFECT_SUPPLEMENT, goalId)) {
    return EFFECT_SUPPLEMENT[goalId];
  }
  // Tool-less goals are conversational by definition (help, project Q&A,
  // personal memory small talk).
  if (!toolIds.length) return "conversation";
  if (toolEntries.every((entry) => entry.tool && entry.tool.operation === "read")) return "read";
  // Legacy tool entries predate the explicit operation field; low/medium risk
  // lookups default to read. Missing/unknown tools stay unclassified so the
  // generator fails instead of silently misclassifying a drifted goal.
  if (toolEntries.every((entry) => entry.tool
    && (entry.tool.operation === "read"
      || (entry.tool.operation === undefined && ["low", "medium"].includes(entry.tool.safetyLevel))))) {
    return "read";
  }
  return null;
}

function generatedSource({ goalIds, effects, hash, generatedAt }) {
  return `// Generated from server/config/agent-capability-manifest.json. Do not edit by hand.
// Source sha256: ${hash}
// Generated at: ${generatedAt}
// Regenerate with: npm run generate:goal-contract-v2
const CONTRACT_VERSION = ${JSON.stringify(CONTRACT_VERSION)};

// Every goal id declared by the Capability Manifest (intents keys).
const GOAL_IDS = Object.freeze(${JSON.stringify(goalIds, null, 2)});

// Entity roles a GoalContract V2 entity may address.
const ENTITY_ROLES = Object.freeze(${JSON.stringify(ENTITY_ROLES, null, 2)});

const REQUESTED_EFFECTS = Object.freeze(${JSON.stringify(REQUESTED_EFFECTS, null, 2)});

// goalId -> requested effect. Derived from Manifest tool operations and skill
// semantics; the generator fails rather than ship an incomplete map.
const GOAL_EFFECTS = Object.freeze(${JSON.stringify(effects, null, 2)});

// Frozen schema snapshot of the normalized GoalContract V2 shape. Consumed by
// tools/test-goal-contract-v2.js for schema/normalizer consistency checks.
const GOAL_CONTRACT_V2_SCHEMA = Object.freeze({
  $id: CONTRACT_VERSION,
  type: "object",
  additionalProperties: false,
  required: [
    "contractVersion",
    "goalId",
    "candidateGoals",
    "entities",
    "constraints",
    "followUpMode",
    "missingSlots",
    "ambiguity",
    "confidence",
    "provenance",
  ],
  properties: {
    contractVersion: { const: CONTRACT_VERSION },
    goalId: { enum: GOAL_IDS },
    candidateGoals: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["goalId", "confidence", "provenance"],
        properties: {
          goalId: { enum: GOAL_IDS },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          provenance: { enum: ["model", "deterministic", "rule", "fallback", "adapter"] },
        },
      },
    },
    entities: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "value", "normalizedValue", "confidence", "provenance"],
        properties: {
          role: { enum: ENTITY_ROLES },
          value: { type: "string", minLength: 1 },
          normalizedValue: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          provenance: { enum: ["model", "deterministic", "rule", "fallback", "adapter"] },
        },
      },
    },
    constraints: { type: "object" },
    followUpMode: {
      enum: [
        "none",
        "new_goal",
        "inherit_active_goal",
        "inherit_last_entity",
        "replace_constraints",
        "fill_pending_clarification",
        "correction",
      ],
    },
    missingSlots: { type: "array", maxItems: 8, items: { type: "string" } },
    ambiguity: {
      type: "object",
      additionalProperties: false,
      required: ["isAmbiguous", "reason", "candidates"],
      properties: {
        isAmbiguous: { type: "boolean" },
        reason: { type: "string" },
        candidates: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["value", "confidence"],
            properties: {
              goalId: { enum: GOAL_IDS },
              entityRole: { enum: ENTITY_ROLES },
              value: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
    requestedEffect: { enum: REQUESTED_EFFECTS },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    provenance: {
      type: "object",
      additionalProperties: false,
      required: ["source", "provider", "model", "understandingSource"],
      properties: {
        source: { enum: ["model", "deterministic", "rule", "fallback", "adapter"] },
        provider: { type: "string" },
        model: { type: "string" },
        understandingSource: { type: "string" },
      },
    },
  },
  forbiddenFields: ["toolName", "tool", "url", "route", "db", "command", "sql"],
});

module.exports = {
  CONTRACT_VERSION,
  ENTITY_ROLES,
  GOAL_CONTRACT_V2_SCHEMA,
  GOAL_EFFECTS,
  GOAL_IDS,
  REQUESTED_EFFECTS,
};
`;
}

// The generatedAt line carries wall-clock time; comparisons ignore it so the
// --check guard only reacts to content drift.
function stripGeneratedAt(source) {
  return source.replace(/^\/\/ Generated at: .*$/m, "// Generated at: <normalized>");
}

function main() {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const manifest = JSON.parse(raw);
  const intents = manifest.intents && typeof manifest.intents === "object" ? manifest.intents : {};
  const tools = manifest.tools && typeof manifest.tools === "object" ? manifest.tools : {};
  const goalIds = Object.keys(intents);
  if (!goalIds.length) fail("manifest declares no intents");

  Object.keys(EFFECT_SUPPLEMENT).forEach((goalId) => {
    if (!intents[goalId]) fail(`EFFECT_SUPPLEMENT references unknown goal: ${goalId}`);
    if (!REQUESTED_EFFECTS.includes(EFFECT_SUPPLEMENT[goalId])) {
      fail(`EFFECT_SUPPLEMENT has invalid effect for ${goalId}: ${EFFECT_SUPPLEMENT[goalId]}`);
    }
  });

  const effects = {};
  const unclassified = [];
  goalIds.forEach((goalId) => {
    const effect = deriveEffect(goalId, intents[goalId], tools);
    if (!effect) {
      unclassified.push(goalId);
      return;
    }
    effects[goalId] = effect;
  });
  if (unclassified.length) {
    fail(`no requested effect derivable for goals: ${unclassified.join(", ")}. `
      + "Add an EFFECT_SUPPLEMENT entry or extend the derivation rules.");
  }

  const source = generatedSource({
    goalIds,
    effects,
    hash,
    generatedAt: new Date().toISOString(),
  });
  const checkOnly = process.argv.includes("--check");
  const current = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "";
  const changed = stripGeneratedAt(current) !== stripGeneratedAt(source);
  if (checkOnly) {
    if (changed) {
      console.error("GoalContract V2 generated file is stale. Run npm run generate:goal-contract-v2.");
      process.exit(1);
    }
    console.log("goal-contract-v2: current");
    return;
  }
  if (changed) {
    fs.writeFileSync(output, source, "utf8");
    console.log("goal-contract-v2: generated");
  } else {
    console.log("goal-contract-v2: current");
  }
  const summary = goalIds.map((goalId) => `${goalId}=${effects[goalId]}`).join(", ");
  console.log(`goal-contract-v2: ${goalIds.length} goals classified (${summary})`);
}

main();
