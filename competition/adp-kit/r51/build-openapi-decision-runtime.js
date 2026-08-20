#!/usr/bin/env node
"use strict";

// Idempotent OpenAPI augmentation for Decision Runtime Activation.  It changes
// no operation count: six existing multi-candidate handlers gain an optional
// preference input and optional sanitized decision output.
const fs = require("fs");
const path = require("path");

const OPENAPI_DIR = path.join(__dirname, "..", "r49-ma", "tools", "openapi");
const FILES = [
  path.join(OPENAPI_DIR, "campus-agent-tools.openapi.json"),
  path.join(OPENAPI_DIR, "campus-agent-tools.adp-import.json"),
  path.join(OPENAPI_DIR, "campus-agent-tools.r49.4-existing-plugin-additions.json"),
  path.join(OPENAPI_DIR, "campus-agent-tools.r50-existing-plugin-additions.json"),
];
const CHECK = process.argv.includes("--check");

const ACTIVATED = Object.freeze({
  campus_classroom_search: ["ClassroomSearchInput", "ClassroomSearchResponse"],
  campus_teacher_load_query: ["TeacherLoadQueryInput", "TeacherLoadQueryResponse"],
  campus_common_free_time_query: ["CommonFreeTimeInput", "CommonFreeTimeResponse"],
  campus_room_utilization_query: ["RoomUtilizationInput", "RoomUtilizationResponse"],
  campus_reschedule_feasibility: ["RescheduleFeasibilityInput", "RescheduleFeasibilityResponse"],
  campus_group_plan: ["GroupPlanInput", "GroupPlanResponse"],
});

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const DECISION_SCHEMAS = {
  DecisionPreferenceInput: {
    type: "object",
    description: "结构化 soft preference；服务端只接受白名单字段并确定性评分",
    properties: {
      preferEarlier: { type: "boolean", description: "更早时段优先" },
      preferLarger: { type: "boolean", description: "更大容量优先" },
      preferSameCampus: { type: "boolean", description: "同校区优先（仅在已有规范校区约束时生效）" },
      preferWeekdays: {
        type: "array",
        description: "优先星期集合",
        items: { type: "integer", minimum: 1, maximum: 7 },
        minItems: 1,
        maxItems: 7,
      },
    },
    additionalProperties: false,
  },
  PublicDecisionChoice: {
    type: "object",
    properties: {
      label: { type: "string" },
      reasons: { type: "array", items: { type: "string" } },
    },
    required: ["label", "reasons"],
    additionalProperties: false,
  },
  PublicDecisionAction: {
    type: "object",
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: ["sys.chat"] },
      label: { type: "string" },
      payload: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    required: ["type", "label", "payload"],
    additionalProperties: false,
  },
  PublicDecisionReceipt: {
    type: "object",
    properties: {
      receiptVersion: { type: "string", enum: ["1.0"] },
      decisionId: { type: "string", pattern: "^decision-[a-f0-9]{64}$" },
      recommendation: { ...ref("PublicDecisionChoice"), nullable: true },
      alternatives: { type: "array", items: ref("PublicDecisionChoice") },
      nextAction: {
        type: "object",
        nullable: true,
        properties: { label: { type: "string" }, query: { type: "string" } },
        required: ["label", "query"],
        additionalProperties: false,
      },
      verified: { type: "boolean" },
      decision: { type: "string", enum: ["recommend", "no_viable_option"] },
    },
    required: ["receiptVersion", "decisionId", "recommendation", "alternatives", "nextAction", "verified", "decision"],
    additionalProperties: false,
  },
  DecisionResultCard: {
    type: "object",
    description: "现有小序校园智序 result-card 的脱敏投影",
    properties: {
      version: { type: "string" },
      variant: { type: "string" },
      status: { type: "string" },
      layoutMode: { type: "string", enum: ["result-card"] },
      title: { type: "string" },
      subtitle: { type: "string" },
      summary: { type: "string" },
      context: { type: "string" },
      verified: { type: "boolean" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: { label: { type: "string" }, value: { type: "string" }, hint: { type: "string" } },
                required: ["label", "value"],
              },
            },
          },
          required: ["title", "rows"],
        },
      },
      actions: { type: "array", items: ref("PublicDecisionAction"), maxItems: 3 },
      displayMeta: { type: "object", additionalProperties: true },
      weekBoardTitle: { type: "string" },
      weekBoardSubtitle: { type: "string" },
      days: { type: "array", items: { type: "object" } },
    },
    required: ["variant", "status", "layoutMode", "title", "summary", "verified", "sections", "actions"],
  },
  RuntimeDecision: {
    type: "object",
    description: "服务端基于当前 verified tool candidates 生成的脱敏确定性决策；原 facts/items 保持不变",
    properties: {
      status: { type: "string", enum: ["recommended", "needs_more_facts", "needs_user_choice", "no_feasible_candidate"] },
      preferred: { ...ref("PublicDecisionChoice"), nullable: true },
      alternatives: { type: "array", items: ref("PublicDecisionChoice") },
      reasons: { type: "array", items: { type: "string" } },
      tradeoffs: { type: "array", items: ref("PublicDecisionChoice") },
      nextActions: { type: "array", items: ref("PublicDecisionAction"), maxItems: 3 },
      receipt: ref("PublicDecisionReceipt"),
      resultCard: ref("DecisionResultCard"),
    },
    required: ["status", "preferred", "alternatives", "reasons", "tradeoffs", "nextActions", "receipt", "resultCard"],
    additionalProperties: false,
  },
};

function operationById(spec, operationId) {
  for (const pathItem of Object.values(spec.paths || {})) {
    for (const operation of Object.values(pathItem || {})) {
      if (operation && operation.operationId === operationId) return operation;
    }
  }
  return null;
}

function augment(spec) {
  const output = JSON.parse(JSON.stringify(spec));
  output.info.version = "1.6.0";
  Object.assign(output.components.schemas, DECISION_SCHEMAS);
  for (const [operationId, [inputName, responseName]] of Object.entries(ACTIVATED)) {
    const operation = operationById(output, operationId);
    if (!operation) continue;
    const input = output.components.schemas[inputName];
    const response = output.components.schemas[responseName];
    if (!input || !response) throw new Error(`${operationId} schema missing`);
    input.properties.decisionPreferences = ref("DecisionPreferenceInput");
    response.properties.decision = ref("RuntimeDecision");
    if (!operation.description.includes("authoritative decision")) {
      operation.description = `${operation.description} 服务端在 verified candidates 仍位于 handler 内时附加 authoritative decision；调用方不得重新排序后声称已核验。`;
    }
  }
  return output;
}

let failed = false;
for (const file of FILES) {
  const current = fs.readFileSync(file, "utf8");
  const next = `${JSON.stringify(augment(JSON.parse(current)), null, 2)}\n`;
  if (CHECK) {
    if (current !== next) {
      failed = true;
      console.error(`[fail] Decision Runtime OpenAPI drift: ${path.basename(file)}`);
    }
  } else {
    fs.writeFileSync(file, next, "utf8");
    console.log(`[ok] Decision Runtime OpenAPI: ${path.basename(file)}`);
  }
}
if (failed) process.exit(1);
if (CHECK) console.log(`[pass] Decision Runtime OpenAPI consistent (${Object.keys(ACTIVATED).length} existing operations, 0 new tools)`);

module.exports = { ACTIVATED, DECISION_SCHEMAS, augment };
