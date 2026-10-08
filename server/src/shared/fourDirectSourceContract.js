"use strict";

const { buildResourceCountContract } = require("./resourceCountContract");
const { calculateFingerprint } = require("../utils/stagingFingerprint");
const KINDS = Object.freeze(["class", "teacher", "classroom", "course"]);
const SCOPES = Object.freeze(KINDS.map((kind) => `${kind}Schedules`));
const SENSITIVE_KEY = /^(?:password|passwd|pwd|cookie|set-cookie|authorization|jsessionid|castgc|ticket|execution|username|account|schoolAccount|studentId|studentNumber|studentName|studentNames|students|rawHtml|rawXls|base64|apiKey|secretId|secretKey|accessToken|sessionToken)$/i;
const SENSITIVE_VALUE = /(?:JSESSIONID|CASTGC)\s*[=:]|Bearer\s+[\w.~+/=-]{8,}|(?:[?&](?:ticket|execution|password|token)=)|-----BEGIN .*PRIVATE KEY-----/i;

function rejected(code) { return Object.assign(new Error(code), { code, statusCode: 400 }); }

function assertPublicData(value) {
  if (Array.isArray(value)) { value.forEach(assertPublicData); return; }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (SENSITIVE_KEY.test(key)) throw rejected("STAGING_SENSITIVE");
      assertPublicData(value[key]);
    }
  } else if (typeof value === "string" && (SENSITIVE_VALUE.test(value) || /\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b/.test(value))) {
    throw rejected("STAGING_SENSITIVE");
  }
}

function validateFourSources(data, expectedTerm) {
  assertPublicData(data);
  const errors = [];
  const term = data && (data.term || data.semester);
  if (!term || (expectedTerm && term !== expectedTerm)) errors.push("TERM_MISMATCH");
  if (!data || !data.meta || data.meta.allowDerived !== false) errors.push("DERIVED_NOT_DISABLED");
  const summary = data && (data.directSourceSummary || data.meta && data.meta.directSourceSummary) || {};
  const sources = data && (data.scopeSources || data.meta && data.meta.scopeSources) || {};
  const resourceCounts = buildResourceCountContract(data || {});
  const resources = data && data.resources || {};
  for (const kind of KINDS) {
    const scope = `${kind}Schedules`;
    const stat = summary[kind] || {};
    const schedules = kind === "class" ? data && data.classSchedules : resources[scope];
    if (sources[scope] && sources[scope].sourceMode !== "network-direct" || stat.sourceMode !== "network-direct") errors.push(`${kind}:SOURCE_NOT_DIRECT`);
    if (!sources[scope] || sources[scope].sourceMode !== "network-direct") errors.push(`${kind}:SOURCE_MISSING`);
    for (const metric of ["discoveredEntities", "requestedEntities", "success", "empty", "failed", "scheduleDocuments", "courseEvents"]) {
      if (!Number.isSafeInteger(stat[metric]) || stat[metric] < 0) errors.push(`${kind}:INVALID_${metric}`);
    }
    if (!stat.discoveredEntities || stat.requestedEntities !== stat.discoveredEntities || stat.success + stat.empty + stat.failed !== stat.requestedEntities) errors.push(`${kind}:COVERAGE_INVALID`);
    if (stat.failed || stat.parserErrors || stat.coverageValid !== true) errors.push(`${kind}:INCOMPLETE`);
    if (!Array.isArray(schedules) || !schedules.length || stat.scheduleDocuments !== schedules.length || stat.courseEvents !== resourceCounts[kind].courseEvents) errors.push(`${kind}:COUNT_MISMATCH`);
    const seen = new Set();
    const nameKey = { class: "className", teacher: "teacherName", classroom: "roomName", course: "courseName" }[kind];
    for (const schedule of Array.isArray(schedules) ? schedules : []) {
      const name = String(schedule[nameKey] || schedule.name || "").trim();
      if (!name || /未知|请选择|临班|<|>|密码|登录/.test(name)) errors.push(`${kind}:INVALID_NAME`);
      const id = String(schedule.id || schedule.classId || schedule.teacherId || schedule.roomId || schedule.courseId || name);
      if (seen.has(id)) errors.push(`${kind}:DUPLICATE_ENTITY`);
      seen.add(id);
      const events = new Set();
      for (const event of schedule.courses || []) {
        const key = require("../utils/stagingFingerprint").stableStringify(event);
        if (events.has(key)) errors.push(`${kind}:DUPLICATE_SCHEDULE`);
        events.add(key);
      }
      if (schedule.semester && schedule.semester !== term || schedule.term && schedule.term !== term) errors.push(`${kind}:TERM_MISMATCH`);
    }
    if (kind !== "class") {
      const directory = resources[{ teacher: "teachers", classroom: "classrooms", course: "courses" }[kind]];
      if (!Array.isArray(directory) || directory.length !== stat.discoveredEntities || schedules && schedules.length !== directory.length) errors.push(`${kind}:DIRECTORY_INCOMPLETE`);
    }
  }
  return { valid: errors.length === 0, errors: Array.from(new Set(errors)), directSourceSummary: summary, resourceCounts };
}

function assertFourSources(data, expectedTerm) {
  const result = validateFourSources(data, expectedTerm);
  if (!result.valid) throw Object.assign(rejected("FOUR_DIRECT_SOURCE_INVALID"), { validation: result });
  const canonicalHash = calculateFingerprint(data).canonicalHash;
  if (data.canonicalHash && data.canonicalHash !== canonicalHash) throw rejected("CANONICAL_HASH_MISMATCH");
  return Object.assign(result, { canonicalHash });
}

module.exports = { KINDS, SCOPES, assertFourSources, assertPublicData, validateFourSources };
