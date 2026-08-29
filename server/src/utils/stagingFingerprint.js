const crypto = require("crypto");
const fs = require("fs");

const VOLATILE_KEYS = new Set([
  "activatedAt",
  "cacheEpoch",
  "canonicalHash",
  "changed",
  "dataEpoch",
  "duration",
  "durationMs",
  "elapsedMs",
  "forceRefreshToken",
  "generatedAt",
  "hash",
  "joinedPath",
  "jsonPath",
  "log",
  "logs",
  "meta",
  "pack",
  "packHealth",
  "publishedAt",
  "requestDuration",
  "requestDurationMs",
  "releasePack",
  "releaseVersion",
  "size",
  "stagingUploadId",
  "uploadId",
  "updatedAt",
  "version",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getResources(data) {
  const source = data && data.resources && typeof data.resources === "object" ? data.resources : {};
  return {
    teacherSchedules: asArray(source.teacherSchedules).length ? asArray(source.teacherSchedules) : asArray(data && data.teacherSchedules),
    classroomSchedules: asArray(source.classroomSchedules).length ? asArray(source.classroomSchedules) : asArray(data && data.classroomSchedules),
    courseSchedules: asArray(source.courseSchedules).length ? asArray(source.courseSchedules) : asArray(data && data.courseSchedules),
    classrooms: asArray(source.classrooms).length ? asArray(source.classrooms) : asArray(data && data.classrooms),
    teachers: asArray(source.teachers).length ? asArray(source.teachers) : asArray(data && data.teachers),
    courses: asArray(source.courses).length ? asArray(source.courses) : asArray(data && data.courses),
  };
}

function summarizeStagingData(data) {
  const catalog = data && data.catalog && typeof data.catalog === "object" ? data.catalog : {};
  const resources = getResources(data || {});
  const classSchedules = asArray(data && (data.classSchedules || data.resources && data.resources.classSchedules));
  return {
    colleges: asArray(catalog.colleges || data && data.colleges).length,
    majors: asArray(data && data.majors).length,
    classSchedules: classSchedules.length,
    teacherSchedules: resources.teacherSchedules.length,
    classroomSchedules: resources.classroomSchedules.length,
    courseSchedules: resources.courseSchedules.length,
    classrooms: resources.classrooms.length,
    teachers: resources.teachers.length,
    courses: resources.courses.length,
  };
}

function cmpText(left, right) {
  return String(left || "").localeCompare(String(right || ""), "zh-CN", { numeric: true });
}

function firstOf(value, keys) {
  for (const key of keys) {
    if (value && value[key] !== undefined && value[key] !== null && value[key] !== "") {
      return value[key];
    }
  }
  return "";
}

function eventSortKey(item) {
  const source = item && typeof item === "object" ? item : {};
  return [
    Number(firstOf(source, ["weekday", "weekDay", "dayOfWeek"]) || 0),
    Number(firstOf(source, ["startSection", "sectionStart"]) || 0),
    Number(firstOf(source, ["endSection", "sectionEnd"]) || 0),
    Number(firstOf(source, ["startWeek"]) || 0),
    Number(firstOf(source, ["endWeek"]) || 0),
    firstOf(source, ["weekPattern", "weekType", "oddEven", "weekParity", "parity"]),
    firstOf(source, ["courseName", "name"]),
    firstOf(source, ["teacherName", "teacher"]),
    firstOf(source, ["classroom", "roomName", "classroomName"]),
  ].join("\u0001");
}

function entitySortKey(item, path) {
  const source = item && typeof item === "object" ? item : {};
  const key = path[path.length - 1] || "";
  if (key === "colleges") return [firstOf(source, ["code", "collegeCode"]), firstOf(source, ["name", "collegeName"])].join("\u0001");
  if (key === "majors") return [firstOf(source, ["code", "majorCode"]), firstOf(source, ["name", "majorName"]), firstOf(source, ["collegeCode", "collegeName"]), firstOf(source, ["grade"])].join("\u0001");
  if (key === "classSchedules" || key === "classes") return [firstOf(source, ["classId", "id"]), firstOf(source, ["className", "name"])].join("\u0001");
  if (key === "teacherSchedules" || key === "teachers") return [firstOf(source, ["teacherId", "id"]), firstOf(source, ["teacherName", "name"])].join("\u0001");
  if (key === "classroomSchedules" || key === "classrooms") return [firstOf(source, ["roomId", "classroomId", "id"]), firstOf(source, ["roomName", "classroomName", "name"])].join("\u0001");
  if (key === "courseSchedules") return [firstOf(source, ["courseId", "id"]), firstOf(source, ["courseName", "name"])].join("\u0001");
  if (key === "courses" && (source.weekday || source.startSection || source.endSection || source.teacherName || source.classroom)) return eventSortKey(source);
  if (key === "courses") return [firstOf(source, ["courseId", "id"]), firstOf(source, ["courseName", "name"])].join("\u0001");
  if (source.weekday || source.startSection || source.endSection || source.courseName) return eventSortKey(source);
  return stableStringify(source);
}

function stableClone(value, path = []) {
  if (Array.isArray(value)) {
    return value
      .map((item) => stableClone(item, path))
      .sort((left, right) => cmpText(entitySortKey(left, path), entitySortKey(right, path)));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output = {};
  Object.keys(value)
    .filter((key) => !VOLATILE_KEYS.has(key))
    .sort()
    .forEach((key) => {
      const next = stableClone(value[key], path.concat(key));
      if (next !== undefined) output[key] = next;
    });
  return output;
}

function canonicalTermConfig(source) {
  const data = source && typeof source === "object" ? source : {};
  const config = data.termConfig && typeof data.termConfig === "object" ? data.termConfig : {};
  return {
    term: config.term || data.term || data.semester || "",
    semesterText: config.semesterText || data.semesterText || "",
    termStartDate: config.termStartDate || data.termStartDate || data.sourceStartDate || data.meta && data.meta.startDate || "",
    totalWeeks: Number(config.totalWeeks || data.totalWeeks || 0) || 0,
    weekStart: config.weekStart || data.weekStart || "monday",
  };
}

function canonicalTeachingCalendar(source) {
  const data = source && typeof source === "object" ? source : {};
  const calendar = data.teachingCalendar && typeof data.teachingCalendar === "object" ? data.teachingCalendar : {};
  if (!Object.keys(calendar).length) return {};
  return {
    schemaVersion: calendar.schemaVersion || "",
    term: calendar.term || data.term || data.semester || "",
    semesterText: calendar.semesterText || "",
    termStartDate: calendar.termStartDate || "",
    totalWeeks: Number(calendar.totalWeeks || 0) || 0,
    weekStart: calendar.weekStart || "monday",
    source: calendar.source || "",
    sourceStatus: calendar.sourceStatus || "",
    sourceHash: calendar.sourceHash || "",
    weeks: Array.isArray(calendar.weeks) ? calendar.weeks : [],
    specialDates: Array.isArray(calendar.specialDates) ? calendar.specialDates : [],
    cohortMilestones: Array.isArray(calendar.cohortMilestones) ? calendar.cohortMilestones : [],
  };
}

function canonicalPayload(data) {
  const source = data && typeof data === "object" ? data : {};
  return stableClone({
    schemaVersion: source.schemaVersion || "",
    term: source.term || source.semester || "",
    semester: source.semester || source.term || "",
    termStartDate: source.termStartDate || source.sourceStartDate || source.meta && source.meta.startDate || "",
    termConfig: canonicalTermConfig(source),
    teachingCalendar: canonicalTeachingCalendar(source),
    catalog: source.catalog || {},
    majors: source.majors || [],
    classSchedules: source.classSchedules || source.resources && source.resources.classSchedules || [],
    resources: getResources(source),
    timeTable: source.timeTable || {},
  });
}

function stableStringify(value) {
  return JSON.stringify(stableClone(value));
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function canonicalSource(data) {
  const source = data && typeof data === "object" ? data : {};
  return {
    schemaVersion: source.schemaVersion || "",
    term: source.term || source.semester || "",
    semester: source.semester || source.term || "",
    termStartDate: source.termStartDate || source.sourceStartDate || source.meta && source.meta.startDate || "",
    termConfig: canonicalTermConfig(source),
    teachingCalendar: canonicalTeachingCalendar(source),
    catalog: source.catalog || {},
    majors: source.majors || [],
    classSchedules: source.classSchedules || source.resources && source.resources.classSchedules || [],
    resources: getResources(source),
    timeTable: source.timeTable || {},
  };
}

function updateStableJsonHash(hash, value, path = []) {
  if (Array.isArray(value)) {
    const sorted = value
      .map((item, index) => ({ item, index, sortKey: entitySortKey(item, path) }))
      .sort((left, right) => {
        const compared = cmpText(left.sortKey, right.sortKey);
        return compared || left.index - right.index;
      });
    hash.update("[");
    sorted.forEach((entry, index) => {
      if (index > 0) hash.update(",");
      updateStableJsonHash(hash, entry.item === undefined ? null : entry.item, path);
    });
    hash.update("]");
    return;
  }
  if (!value || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    hash.update(encoded === undefined ? "null" : encoded);
    return;
  }
  let first = true;
  hash.update("{");
  Object.keys(value)
    .filter((key) => !VOLATILE_KEYS.has(key))
    .sort()
    .forEach((key) => {
      if (value[key] === undefined) return;
      if (!first) hash.update(",");
      first = false;
      hash.update(JSON.stringify(key));
      hash.update(":");
      updateStableJsonHash(hash, value[key], path.concat(key));
    });
  hash.update("}");
}

function hashCanonicalPayload(data) {
  const hash = crypto.createHash("sha256");
  updateStableJsonHash(hash, canonicalSource(data));
  return hash.digest("hex");
}

function calculateFingerprint(data) {
  return {
    canonicalHash: hashCanonicalPayload(data),
    counts: summarizeStagingData(data),
  };
}

function calculateFingerprintFromFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);
  const fingerprint = calculateFingerprint(data);
  return Object.assign(fingerprint, {
    data,
    rawSizeBytes: Buffer.byteLength(raw, "utf8"),
  });
}

function buildSidecarMeta(data, options = {}) {
  const fingerprint = options.fingerprint || calculateFingerprint(data);
  const previousHash = String(options.previousHash || "").trim();
  const meta = data && data.meta && typeof data.meta === "object" ? data.meta : {};
  const termConfig = data && data.termConfig && typeof data.termConfig === "object" ? data.termConfig : meta.termConfig || null;
  const termConfigHash = termConfig ? sha256(JSON.stringify(termConfig)) : "";
  return {
    term: data && (data.term || data.semester) || "",
    termConfig,
    termConfigHash,
    generatedAt: new Date().toISOString(),
    sourceStartDate: data && (data.termStartDate || data.sourceStartDate) || meta.startDate || "",
    includeScopes: Array.isArray(meta.includeScopes) ? meta.includeScopes : [],
    grades: meta.grades || data && data.grades || "",
    counts: fingerprint.counts || summarizeStagingData(data),
    rawSizeBytes: Number(options.rawSizeBytes || 0) || 0,
    canonicalHash: fingerprint.canonicalHash,
    previousHash,
    changed: previousHash ? previousHash !== fingerprint.canonicalHash : true,
    crawlMode: meta.crawlMode || "",
    usedProgressCache: Boolean(meta.usedProgressCache),
    usedNoScheduleCache: Boolean(meta.usedNoScheduleCache),
    usedClassScheduleCache: Boolean(meta.usedClassScheduleCache),
    resumedFromRunProgress: Boolean(meta.resumedFromRunProgress),
    progressCacheRunId: meta.progressCacheRunId || "",
    cacheSource: meta.cacheSource || "",
    actualNetworkRequestCount: Number(meta.actualNetworkRequestCount || 0),
    skippedByProgressCount: Number(meta.skippedByProgressCount || 0),
    skippedByNoScheduleCount: Number(meta.skippedByNoScheduleCount || 0),
    freshRunId: meta.freshRunId || "",
    resourceSource: meta.resourceSource || "",
    partial: Boolean(meta.partial || data && data.partial),
    failedTargetCount: Number(meta.failedTargetCount || 0),
    scopeSources: meta.scopeSources || data && data.scopeSources || {},
  };
}

function readSidecarHash(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return String(parsed && parsed.canonicalHash || "").trim();
  } catch (error) {
    return "";
  }
}

module.exports = {
  buildSidecarMeta,
  calculateFingerprint,
  calculateFingerprintFromFile,
  canonicalPayload,
  readSidecarHash,
  stableStringify,
  summarizeStagingData,
};
