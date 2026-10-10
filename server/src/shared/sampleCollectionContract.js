"use strict";
const { KINDS, assertPublicData } = require("./fourDirectSourceContract");
const { calculateFingerprint, stableStringify } = require("../utils/stagingFingerprint");
const APPROVAL_TTL_MS = 30 * 60 * 1000;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 32 * 1024 * 1024;
const METRICS = ["discoveredEntities", "requestedEntities", "success", "empty", "failed", "parserErrors", "requestCount", "scheduleDocuments", "courseEvents"];
function fail(code) { throw Object.assign(new Error(code), { code, statusCode: 400 }); }
function policy(kind, budget) {
  if (!["class", "four"].includes(kind) || !Number.isSafeInteger(budget) || budget < 1 || budget > 120) fail("SAMPLE_POLICY_REJECTED");
  return { kind, entityLimit: 1, requestBudget: budget, scopes: (kind === "four" ? KINDS : ["class"]).map(k => k + "Schedules") };
}
function assertSample(data, term, approved, termConfig) {
  if (!approved) fail("SAMPLE_POLICY_REJECTED");
  const scope = policy(approved.kind, approved.requestBudget);
  assertPublicData(data);
  if (!data || (data.term || data.semester) !== term || data.meta?.allowDerived !== false || data.meta?.sampleOnly !== true || data.meta.sampleKind !== scope.kind) fail("SAMPLE_CONTRACT_REJECTED");
  const requests = data.meta.actualNetworkRequestCount;
  if (!Number.isSafeInteger(requests) || requests < 1 || requests > scope.requestBudget) fail("SCHOOL_REQUEST_BUDGET_EXCEEDED");
  const totalWeeks=data.termConfig?.totalWeeks;
  if(data.termConfig?.term!==term || !Number.isSafeInteger(totalWeeks) || totalWeeks<1 || totalWeeks>30)fail("SAMPLE_DATA_INVALID");
  if (termConfig && ["term", "termStartDate", "totalWeeks", "weekStart"].some(key => data.termConfig[key] !== termConfig[key])) fail("SAMPLE_TERM_CONFIG_MISMATCH");
  const summary = data.directSourceSummary || {}, sources = data.scopeSources || {};
  let directRequests = 0;
  for (const kind of KINDS) {
    const schedules = kind === "class" ? data.classSchedules : data.resources?.[kind + "Schedules"];
    if (!scope.scopes.includes(kind + "Schedules")) {
      const directory = data.resources?.[{ teacher: "teachers", classroom: "classrooms", course: "courses" }[kind]];
      if (schedules?.length || directory?.length || data[kind + "Schedules"]?.length || summary[kind] || sources[kind + "Schedules"]) fail("SAMPLE_SCOPE_EXCEEDED");
      continue;
    }
    const stat = summary[kind];
    if (!stat || ["discoveredEntities","requestedEntities","success","empty","failed","parserErrors","requestCount","scheduleDocuments","courseEvents"].some(k=>!Number.isSafeInteger(stat[k])||stat[k]<0))fail("SAMPLE_SOURCE_INCOMPLETE");
    if (!stat || stat.sourceMode !== "network-direct" || sources[kind + "Schedules"]?.sourceMode !== "network-direct" ||
        stat.discoveredEntities !== 1 || stat.requestedEntities !== 1 || stat.success + stat.empty !== 1 ||
        stat.failed !== 0 || stat.parserErrors !== 0 || stat.requestCount !== 1 ||
        !Array.isArray(schedules) || !schedules.length || schedules.length > (kind === "class" ? 500 : 1) ||
        stat.scheduleDocuments !== schedules.length) fail("SAMPLE_SOURCE_INCOMPLETE");
    directRequests += stat.requestCount;
    if (kind === "class") {
      // One administrative endpoint request can return several classes from the
      // same college/grade/major group. It cannot authorize several groups.
      const groups = new Set(schedules.map(s => [s.collegeCode, s.grade, s.majorCode].join(":")));
      if (groups.size !== 1 || schedules.some(s => !s.collegeCode || !s.grade || !s.majorCode)) fail("SAMPLE_REQUEST_GROUP_EXCEEDED");
    } else {
      const directory = data.resources?.[{ teacher: "teachers", classroom: "classrooms", course: "courses" }[kind]];
      if (!Array.isArray(directory) || directory.length !== 1) fail("SAMPLE_DIRECTORY_EXCEEDED");
      const nameKey = { teacher: "teacherName", classroom: "roomName", course: "courseName" }[kind];
      if (directory[0][nameKey] !== schedules[0][nameKey] || directory[0].id && schedules[0].id && directory[0].id !== schedules[0].id) fail("SAMPLE_DIRECTORY_MISMATCH");
    }
    const seen = new Set(); let events = 0;
    for (const schedule of schedules) {
      const name = schedule[{ class: "className", teacher: "teacherName", classroom: "roomName", course: "courseName" }[kind]];
      if (typeof name !== "string" || !name.trim() || /未知|请选择|<|>|密码|登录/.test(name) || !Array.isArray(schedule.courses) ||
          schedule.semester && schedule.semester !== term || schedule.term && schedule.term !== term) fail("SAMPLE_DATA_INVALID");
      const id = String(schedule.id || schedule.classId || schedule.teacherId || schedule.roomId || schedule.courseId || name);
      if (seen.has(id)) fail("SAMPLE_DATA_INVALID");
      seen.add(id); const courseKeys = new Set();
      for (const event of schedule.courses) {
        if(!event || typeof event.courseName!=="string" || !event.courseName.trim() ||
          !Number.isInteger(event.weekday) || event.weekday<1 || event.weekday>7 ||
          !Number.isInteger(event.startSection) || event.startSection<1 || !Number.isInteger(event.endSection) || event.endSection<event.startSection ||
          !Array.isArray(event.weeks) || !event.weeks.length || new Set(event.weeks).size!==event.weeks.length || event.weeks.some(w=>!Number.isInteger(w)||w<1||w>totalWeeks) ||
          event.semester && event.semester!==term || event.term && event.term!==term)fail("SAMPLE_DATA_INVALID");
        const key = stableStringify(event);
        if (courseKeys.has(key)) fail("SAMPLE_DATA_INVALID");
        courseKeys.add(key); events++;
      }
    }
    if (stat.courseEvents !== events) fail("SAMPLE_DATA_INVALID");
  }
  if (requests < directRequests) fail("SAMPLE_REQUEST_COUNT_INVALID");
  const canonicalHash = calculateFingerprint(data).canonicalHash;
  if (data.canonicalHash !== canonicalHash) fail("CANONICAL_HASH_MISMATCH");
  const safeSummary = {};
  for (const kind of KINDS) if (summary[kind]) {
    safeSummary[kind] = { sourceMode: "network-direct", coverageValid: false };
    for (const metric of METRICS) safeSummary[kind][metric] = summary[kind][metric];
    if (kind === "class") safeSummary[kind].entityUnit = "major-request-group";
  }
  return { term, canonicalHash, directSourceSummary: safeSummary, schoolRequestCount: requests, samplePolicy: scope, sampleOnly: true, coverageValid: false, publishable: false };
}
module.exports = { APPROVAL_TTL_MS, MAX_UPLOAD_BYTES, MAX_ORIGINAL_BYTES, policy, assertSample };
