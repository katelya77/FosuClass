"use strict";
// R51 ToolCallPreflight / Canonical Slot Normalizer
// 在工具调用前确定性校验 / 规范化参数；允许值从现有 OpenAPI operation contract 派生。
// 非法值：在 Tool 调用前 fail-closed（INVALID_PARAM），不先发送一次错误请求再重试。
const path = require("path");

const OPENAPI_PATH = path.join(__dirname, "..", "..", "r49-ma", "tools", "openapi", "campus-agent-tools.adp-import.json");
const openapi = require(OPENAPI_PATH);
const aliases = require(path.join(__dirname, "..", "data", "canonical-aliases.json"));

function schemaByName(name) {
  return (openapi.components && openapi.components.schemas && openapi.components.schemas[name]) || null;
}

// 解析 operation → input schema 的参数字段（含 enum）
function loadOperationContracts() {
  const contracts = {};
  for (const [, item] of Object.entries(openapi.paths || {})) {
    for (const [method, op] of Object.entries(item)) {
      if (typeof op !== "object" || !op.operationId) continue;
      const body = op.requestBody && op.requestBody.content && op.requestBody.content["application/json"];
      const ref = body && body.schema && body.schema.$ref;
      if (!ref) continue;
      const schemaName = ref.split("/").pop();
      const schema = schemaByName(schemaName);
      if (!schema) continue;
      const params = {};
      for (const [name, prop] of Object.entries(schema.properties || {})) {
        params[name] = { type: prop.type, enum: prop.enum ? prop.enum.slice() : undefined };
      }
      contracts[op.operationId] = { schema: schemaName, params };
    }
  }
  return contracts;
}

function enumValuesForField(field) {
  const set = new Set();
  const contracts = loadOperationContracts();
  for (const c of Object.values(contracts)) {
    const meta = c.params[field];
    if (meta && meta.enum) for (const v of meta.enum) set.add(v);
  }
  return [...set];
}

function aliasTableFor(field) {
  return aliases[field === "secondEntityType" ? "entityType" : field] || null;
}

// 别名/规范值 → 规范 enum；无法确定 → null
function resolveAlias(field, value) {
  if (value === null || value === undefined || value === "") return null;
  const table = aliasTableFor(field);
  if (table && table[value]) return table[value];
  const enums = enumValuesForField(field);
  if (enums.includes(value)) return value;
  return null;
}

function normalizeEntityType(value) {
  return resolveAlias("entityType", value);
}

// 在 Tool 调用前完成校验与规范化。失败时不发起任何请求（fail-closed）。
function preflightToolCall(toolName, params) {
  const contracts = loadOperationContracts();
  const contract = contracts[toolName];
  if (!contract) return { ok: false, error: "UNKNOWN_TOOL", field: null, params: params || {} };

  const out = Object.assign({}, params || {});
  for (const [name, meta] of Object.entries(contract.params)) {
    if (!meta.enum) continue;
    const value = out[name];
    if (value === null || value === undefined || value === "") continue; // 可选空缺不伪造
    const norm = resolveAlias(name, String(value));
    if (norm === null) {
      return {
        ok: false,
        error: "INVALID_PARAM",
        field: name,
        allowed: meta.enum,
        params: out,
      };
    }
    out[name] = norm;
  }
  return { ok: true, params: out };
}

module.exports = {
  OPENAPI_PATH,
  loadOperationContracts,
  enumValuesForField,
  resolveAlias,
  normalizeEntityType,
  preflightToolCall,
};