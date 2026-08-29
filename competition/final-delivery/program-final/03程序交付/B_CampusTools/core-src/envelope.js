/**
 * CampusTools 统一结果信封与错误结构。
 *
 * 所有工具返回统一结构：
 * { success, queryId, dataVersion, resolvedEntity, items, actions, evidence, error }
 *
 * error 结构：{ code, message, details } —— 供 ADP 工作流做确定性的分支判断。
 */

const crypto = require("crypto");
const { loadDataset } = require("./data");

function makeQueryId() {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `q-${ts}-${crypto.randomBytes(3).toString("hex")}`;
}

function baseEnvelope() {
  const { dataVersion, dataHash } = loadDataset();
  return {
    success: false,
    queryId: makeQueryId(),
    dataVersion,
    resolvedEntity: null,
    items: [],
    actions: [],
    evidence: {
      dataVersion,
      dataHash,
      source: "campus-tools-mcp",
      computedAt: new Date().toISOString(),
      verified: true,
    },
    error: null,
  };
}

function ok({ resolvedEntity, items, actions }) {
  const env = baseEnvelope();
  env.success = true;
  env.resolvedEntity = resolvedEntity || null;
  env.items = Array.isArray(items) ? items : [];
  env.actions = Array.isArray(actions) ? actions : [];
  return env;
}

function fail(code, message, details) {
  const env = baseEnvelope();
  env.success = false;
  env.error = { code, message, details: details || null };
  env.evidence.verified = false;
  return env;
}

const ERR = {
  MISSING_PARAM: "MISSING_PARAM",
  INVALID_PARAM: "INVALID_PARAM",
  ENTITY_NOT_FOUND: "ENTITY_NOT_FOUND",
  AMBIGUOUS_ENTITY: "AMBIGUOUS_ENTITY",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  EMPTY_RESULT: "EMPTY_RESULT",
  DATA_GUARD: "DATA_GUARD",
  UNAUTHORIZED: "UNAUTHORIZED",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "TIMEOUT",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL: "INTERNAL",
};

module.exports = { ok, fail, ERR, makeQueryId };
