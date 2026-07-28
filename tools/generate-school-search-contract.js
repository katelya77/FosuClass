#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "server", "config", "school-search-contract.json");
const contractOutputs = [
  path.join(root, "server", "src", "shared", "schoolSearchContract.generated.js"),
  path.join(root, "miniprogram", "shared", "schoolSearchContract.generated.js"),
];
// classroomSearch 单源（M3-T5）：实现正本在仓库顶层 shared/classroomSearch.source.js；
// 原两处实现（server/src/services/ai/classroomSearch.js、miniprogram/utils/classroomSearch.js）
// 已改为 re-export 壳，不再参与抽源。
const classroomSource = path.join(root, "shared", "classroomSearch.source.js");
const classroomOutputs = [
  path.join(root, "server", "src", "shared", "classroomSearch.generated.js"),
  path.join(root, "miniprogram", "shared", "classroomSearch.generated.js"),
];

function generatedContractSource(contract) {
  return `// Generated from server/config/school-search-contract.json. Do not edit by hand.
// Regenerate: node tools/generate-school-search-contract.js
const CONTRACT = Object.freeze(${JSON.stringify(contract, null, 2)});

const CONTRACT_VERSION = CONTRACT.contractVersion;
const ENTITY_TYPES = Object.freeze(CONTRACT.entityTypes.slice());
const REQUEST_FIELDS = Object.freeze(CONTRACT.requestFields.slice());
const RESPONSE_FIELDS = Object.freeze(CONTRACT.responseFields.slice());
const INDEX_SCHEMA_VERSION = CONTRACT.indexSchemaVersion;
const TEACHER_INDEX_SCHEMA_VERSION = CONTRACT.teacherIndexSchemaVersion;
const CACHE_NAMESPACE = CONTRACT.cacheNamespace;
const DECISION = Object.freeze({
  candidateOpenMax: CONTRACT.decision.candidateOpenMax,
  actionCap: CONTRACT.decision.actionCap,
  candidateListMax: CONTRACT.decision.candidateListMax,
  offlineCandidateMax: CONTRACT.decision.offlineCandidateMax,
});
const NAVIGATION_REASON_CODES = Object.freeze({
  detailIdMissing: CONTRACT.navigation.reasonCodes.detailIdMissing,
  releaseVersionMissing: CONTRACT.navigation.reasonCodes.releaseVersionMissing,
});
const NAVIGATION = Object.freeze({
  scheduleViewPath: CONTRACT.navigation.scheduleViewPath,
  schoolPath: CONTRACT.navigation.schoolPath,
  reasonCodes: NAVIGATION_REASON_CODES,
});

function isEntityType(value) {
  return ENTITY_TYPES.indexOf(value) !== -1;
}

function normalizeEntityType(value, fallback) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (isEntityType(text)) return text;
  return isEntityType(fallback) ? fallback : "";
}

function isRequestField(name) {
  return REQUEST_FIELDS.indexOf(name) !== -1;
}

function isResponseField(name) {
  return RESPONSE_FIELDS.indexOf(name) !== -1;
}

function isNavigationReasonCode(code) {
  const text = String(code == null ? "" : code).trim();
  return Object.keys(NAVIGATION_REASON_CODES).some((key) => NAVIGATION_REASON_CODES[key] === text);
}

function clampDecisionLimit(key, value) {
  const cap = Number(DECISION[key]);
  if (!Number.isFinite(cap)) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return cap;
  return Math.max(0, Math.min(cap, Math.floor(parsed)));
}

module.exports = {
  CONTRACT,
  CONTRACT_VERSION,
  ENTITY_TYPES,
  REQUEST_FIELDS,
  RESPONSE_FIELDS,
  INDEX_SCHEMA_VERSION,
  TEACHER_INDEX_SCHEMA_VERSION,
  CACHE_NAMESPACE,
  DECISION,
  NAVIGATION,
  NAVIGATION_REASON_CODES,
  isEntityType,
  normalizeEntityType,
  isRequestField,
  isResponseField,
  isNavigationReasonCode,
  clampDecisionLimit,
};
`;
}

function generatedClassroomSource() {
  // 防循环：抽源基准必须永远是正本，禁止指向任何生成物落点。
  const resolvedSource = path.resolve(classroomSource);
  classroomOutputs.forEach((output) => {
    if (path.resolve(output) === resolvedSource) {
      console.error(
        "classroomSearch extraction base must be shared/classroomSearch.source.js, " +
        "not a generated output (circular self-reference)."
      );
      process.exit(1);
    }
  });
  const base = fs.readFileSync(classroomSource, "utf8");
  return "// Generated from shared/classroomSearch.source.js. Do not edit by hand.\n" +
    "// Regenerate: node tools/generate-school-search-contract.js\n" +
    base;
}

function main() {
  const contract = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const checkOnly = process.argv.includes("--check");
  const pending = [
    { files: contractOutputs, source: generatedContractSource(contract) },
    { files: classroomOutputs, source: generatedClassroomSource() },
  ];
  let changed = false;
  pending.forEach(({ files, source }) => {
    files.forEach((file) => {
      const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (current === source) return;
      changed = true;
      if (!checkOnly) fs.writeFileSync(file, source, "utf8");
    });
  });
  if (checkOnly && changed) {
    console.error("School Search Contract generated files are stale. Run node tools/generate-school-search-contract.js.");
    process.exit(1);
  }
  console.log(checkOnly ? "school-search-contract: current" : "school-search-contract: generated");
}

main();
