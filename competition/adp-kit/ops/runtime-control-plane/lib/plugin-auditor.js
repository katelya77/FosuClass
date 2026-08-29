"use strict";

const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const yaml = require("yaml");
const { containsCredential } = require("./redact.js");
const { loadDesiredState } = require("./desired-state.js");

const EXPECTED_OPERATIONS = Object.freeze([
  "campus_schedule_query",
  "campus_schedule_range_query",
  "campus_classroom_search",
  "campus_risk_check",
  "campus_day_plan",
  "campus_overview",
  "campus_teacher_load_query",
  "campus_entity_search",
  "campus_academic_context",
  "campus_common_free_time_query",
  "campus_room_utilization_query",
  "campus_reschedule_feasibility",
  "campus_group_plan",
]);
const DECISION_OPERATIONS = new Set([
  "campus_classroom_search",
  "campus_teacher_load_query",
  "campus_common_free_time_query",
  "campus_room_utilization_query",
  "campus_reschedule_feasibility",
  "campus_group_plan",
]);
const STALE_METADATA = /competition-demo-v\d|\bR\d+(?:\.\d+)*\b|\bRuntime\b|test\s*case|研发|测试版本/i;

function findOperations(doc) {
  const output = [];
  for (const [route, item] of Object.entries((doc && doc.paths) || {})) {
    for (const [method, operation] of Object.entries(item || {})) {
      if (operation && typeof operation === "object" && operation.operationId) output.push({ route, method, operation, doc });
    }
  }
  return output;
}

function resolveSchema(doc, schema) {
  if (!schema || typeof schema !== "object") return {};
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/components/schemas/")) {
    return ((doc.components || {}).schemas || {})[schema.$ref.split("/").pop()] || {};
  }
  return schema;
}

function requestProperties(doc, operation) {
  const schema = operation.requestBody && operation.requestBody.content && operation.requestBody.content["application/json"] && operation.requestBody.content["application/json"].schema;
  return resolveSchema(doc, schema).properties || {};
}

function responseProperties(doc, operation) {
  const response = operation.responses && (operation.responses["200"] || operation.responses[200]);
  const schema = response && response.content && response.content["application/json"] && response.content["application/json"].schema;
  return resolveSchema(doc, schema).properties || {};
}

function hasBearerWithoutToken(doc) {
  const schemes = ((doc.components || {}).securitySchemes) || {};
  return Object.values(schemes).some((scheme) => scheme && (scheme.scheme === "bearer" || scheme.type === "apiKey"))
    && !containsCredential(JSON.stringify(doc));
}

function auditPluginExport(zipPath) {
  if (!zipPath || !fs.existsSync(zipPath)) throw new Error(`plugin export zip not found: ${zipPath || "<missing>"}`);
  const zip = new AdmZip(zipPath);
  const yamlEntries = zip.getEntries().filter((entry) => !entry.isDirectory && /\.ya?ml$/i.test(entry.entryName));
  const errors = [];
  const operations = [];
  for (const entry of yamlEntries) {
    let doc;
    try {
      doc = yaml.parse(entry.getData().toString("utf8"));
    } catch (error) {
      errors.push({ code: "INVALID_YAML", file: entry.entryName, detail: error.message });
      continue;
    }
    const found = findOperations(doc);
    if (found.length !== 1) errors.push({ code: "YAML_OPERATION_COUNT", file: entry.entryName, actual: found.length });
    for (const row of found) {
      row.file = entry.entryName;
      operations.push(row);
      const { operationId, description = "" } = row.operation;
      if (row.route !== `/api/${operationId}` || row.method.toLowerCase() !== "post") errors.push({ code: "SERVER_PATH_SHAPE", file: entry.entryName, operationId });
      if (!Array.isArray(doc.servers) || !doc.servers.some((server) => /^https:\/\/.+\/campusflow-adp-tools\/?$/.test(server.url || ""))) errors.push({ code: "SERVER_PATH_SHAPE", file: entry.entryName, operationId });
      if (STALE_METADATA.test(description)) errors.push({ code: "STALE_TOOL_METADATA", file: entry.entryName, operationId });
      if (!/当前已核验校园数据源/.test(description) || !/确定性 CampusTools 服务/.test(description)) errors.push({ code: "UNSTABLE_TOOL_METADATA", file: entry.entryName, operationId });
      if (!hasBearerWithoutToken(doc)) errors.push({ code: "BEARER_OR_CREDENTIAL", file: entry.entryName, operationId });
      const hasInput = Object.hasOwn(requestProperties(doc, row.operation), "decisionPreferences");
      const hasOutput = Object.hasOwn(responseProperties(doc, row.operation), "decision");
      if (DECISION_OPERATIONS.has(operationId)) {
        if (!hasInput || !hasOutput) errors.push({ code: "DECISION_CONTRACT_MISSING", file: entry.entryName, operationId });
      } else if (hasInput || hasOutput) {
        errors.push({ code: "DECISION_CONTRACT_UNEXPECTED", file: entry.entryName, operationId });
      }
    }
  }
  const operationIds = operations.map((x) => x.operation.operationId);
  if (yamlEntries.length !== 13) errors.push({ code: "YAML_COUNT", expected: 13, actual: yamlEntries.length });
  if (operationIds.length !== 13 || new Set(operationIds).size !== 13) errors.push({ code: "OPERATION_UNIQUENESS", expected: 13, actual: operationIds.length, unique: new Set(operationIds).size });
  const missing = EXPECTED_OPERATIONS.filter((id) => !operationIds.includes(id));
  const extra = operationIds.filter((id) => !EXPECTED_OPERATIONS.includes(id));
  if (missing.length || extra.length) errors.push({ code: "OPERATION_SET", missing, extra });
  const expectedBindings = loadDesiredState().bindings;
  return { pass: errors.length === 0, yamlCount: yamlEntries.length, operationIds, expectedBindings, errors };
}

function renderAuditMarkdown(result, source) {
  const lines = [
    "# Plugin Export Audit",
    "",
    `- Source: \`${path.basename(source)}\``,
    `- Result: **${result.pass ? "PASS" : "FAIL"}**`,
    `- YAML: ${result.yamlCount}/13`,
    `- Operations: ${result.operationIds.length}/13 (unique ${new Set(result.operationIds).size})`,
    "- Decision contract: exactly six allowlisted operations",
    `- Expected Agent bindings: ${result.expectedBindings.length}/14 (Main 0)`,
    "- Credential values retained: NO",
    "",
    "## Findings",
    "",
  ];
  if (!result.errors.length) lines.push("- None.");
  for (const error of result.errors) lines.push(`- ${error.code}: ${error.operationId || error.file || "export"}`);
  return `${lines.join("\n")}\n`;
}

module.exports = { DECISION_OPERATIONS, EXPECTED_OPERATIONS, STALE_METADATA, auditPluginExport, renderAuditMarkdown };
