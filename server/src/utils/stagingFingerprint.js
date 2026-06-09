const crypto = require("crypto");
const fs = require("fs");

const VOLATILE_KEYS = new Set([
  "activatedAt",
  "cacheEpoch",
  "canonicalHash",
  "changed",
  "dataEpoch",
  "forceRefreshToken",
  "generatedAt",
  "hash",
  "id",
  "joinedPath",
  "jsonPath",
  "meta",
  "pack",
  "packHealth",
  "publishedAt",
  "releasePack",
  "releaseVersion",
  "size",
  "stagingUploadId",
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

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map(stableClone);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output = {};
  Object.keys(value)
    .filter((key) => !VOLATILE_KEYS.has(key))
    .sort()
    .forEach((key) => {
      const next = stableClone(value[key]);
      if (next !== undefined) output[key] = next;
    });
  return output;
}

function canonicalPayload(data) {
  const source = data && typeof data === "object" ? data : {};
  return stableClone({
    schemaVersion: source.schemaVersion || "",
    term: source.term || source.semester || "",
    semester: source.semester || source.term || "",
    termStartDate: source.termStartDate || source.sourceStartDate || source.meta && source.meta.startDate || "",
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

function calculateFingerprint(data) {
  const canonical = canonicalPayload(data);
  const canonicalJson = JSON.stringify(canonical);
  return {
    canonicalHash: sha256(canonicalJson),
    canonicalJson,
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
    actualNetworkRequestCount: Number(meta.actualNetworkRequestCount || 0),
    skippedByProgressCount: Number(meta.skippedByProgressCount || 0),
    skippedByNoScheduleCount: Number(meta.skippedByNoScheduleCount || 0),
    freshRunId: meta.freshRunId || "",
    resourceSource: meta.resourceSource || "",
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
