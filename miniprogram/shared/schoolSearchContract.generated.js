// Generated from server/config/school-search-contract.json. Do not edit by hand.
// Regenerate: node tools/generate-school-search-contract.js
const CONTRACT = Object.freeze({
  "contractVersion": "school-search.v1",
  "entityTypes": [
    "teacher",
    "class",
    "classroom",
    "course"
  ],
  "indexSchemaVersion": 4,
  "teacherIndexSchemaVersion": 4,
  "cacheNamespace": "fosu-school-search",
  "requestFields": [
    "type",
    "q",
    "term",
    "releaseVersion",
    "collegeCode",
    "collegeName",
    "titleCode",
    "grade",
    "majorCode",
    "majorName",
    "campus",
    "limit",
    "offset"
  ],
  "responseFields": [
    "success",
    "type",
    "contractVersion",
    "indexSchemaVersion",
    "teacherIndexSchemaVersion",
    "term",
    "semester",
    "releaseVersion",
    "version",
    "query",
    "total",
    "limit",
    "offset",
    "items",
    "cacheKey",
    "reasonCode",
    "code",
    "degradedSchema",
    "fromStorage",
    "offline",
    "searchFallback",
    "source",
    "dataSource",
    "etag",
    "updatedAt",
    "debug"
  ],
  "decision": {
    "candidateOpenMax": 3,
    "actionCap": 4,
    "candidateListMax": 8,
    "offlineCandidateMax": 6
  },
  "navigation": {
    "scheduleViewPath": "/pages/schedule-view/schedule-view",
    "schoolPath": "/pages/school/school",
    "reasonCodes": {
      "detailIdMissing": "DETAIL_ID_MISSING",
      "releaseVersionMissing": "RELEASE_VERSION_MISSING"
    }
  },
  "migrationNote": "四类（teacher/class/classroom/course）统一 Search Contract。既有 teacher-search.v1 契约链（teacherSearchContract.generated + storage 缓存键 + check:teacher-search-contract）保持兼容：teacher 响应仍经 teacher 契约 normalizeResponse；本契约提供四类统一的过滤谓词、cacheKey、唯一/多候选决策常数与 schedule 导航 URL 语义。schema version 对齐 indexSchemaVersion=4，取代旧 college-enriched-v3 / teacherIndexSchemaVersion:3 自报。"
});

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
