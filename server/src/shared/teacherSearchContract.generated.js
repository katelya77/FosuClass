// Generated from server/config/teacher-search-contract.json. Do not edit by hand.
const CONTRACT = Object.freeze({
  "contractVersion": "teacher-search.v1",
  "entityType": "teacher",
  "indexSchemaVersion": 4,
  "cacheNamespace": "fosu-teacher-search",
  "requestFields": [
    "type",
    "q",
    "term",
    "releaseVersion",
    "collegeCode",
    "collegeName",
    "titleCode",
    "limit",
    "offset"
  ],
  "responseFields": [
    "success",
    "type",
    "contractVersion",
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
    "degradedSchema",
    "fromStorage",
    "source",
    "updatedAt",
    "debug"
  ]
});

function text(value, max) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, max || 120);
}

function numberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeRequest(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    type: "teacher",
    q: text(source.q || source.keyword, 120),
    term: text(source.term || source.semester, 40),
    releaseVersion: text(source.releaseVersion || source.version, 80),
    collegeCode: text(source.collegeCode, 24),
    collegeName: text(source.collegeName || source.college, 80),
    titleCode: text(source.titleCode || source.title, 40),
    limit: numberInRange(source.limit, 30, 1, 100),
    offset: numberInRange(source.offset, 0, 0, 100000),
  };
}

function uniqueTextList(value, fallback) {
  const source = Array.isArray(value) ? value : (fallback ? [fallback] : []);
  return Array.from(new Set(source.map((item) => text(item, 80)).filter(Boolean)));
}

function normalizeItem(item, meta) {
  const source = item && typeof item === "object" ? item : {};
  const context = meta && typeof meta === "object" ? meta : {};
  const teacherName = text(source.teacherName || source.name || source.displayName || source.canonicalName, 120);
  const id = text(source.id || source.detailId || source.teacherId, 128);
  const collegeCodes = uniqueTextList(source.collegeCodes, source.collegeCode);
  const collegeNames = uniqueTextList(source.collegeNames, source.collegeName || source.college);
  return Object.assign({}, source, {
    id,
    detailId: text(source.detailId || id, 128),
    teacherName,
    name: teacherName,
    normalizedName: text(source.normalizedName || source.searchableName || teacherName.replace(/\s+/g, "").toLowerCase(), 120),
    collegeCode: text(source.collegeCode || collegeCodes[0], 24),
    collegeCodes,
    collegeName: text(source.collegeName || source.college || collegeNames[0], 80),
    collegeNames,
    courseCount: Math.max(0, Number(source.courseCount || 0) || 0),
    term: text(source.term || source.semester || context.term, 40),
    releaseVersion: text(source.releaseVersion || context.releaseVersion, 80),
    teacherIndexSchemaVersion: Number(source.teacherIndexSchemaVersion || context.teacherIndexSchemaVersion || CONTRACT.indexSchemaVersion) || CONTRACT.indexSchemaVersion,
  });
}

function encode(value) { return encodeURIComponent(text(value, 160)); }

function buildCacheKey(input) {
  const request = normalizeRequest(input);
  return [
    CONTRACT.cacheNamespace,
    CONTRACT.contractVersion,
    "schema-" + CONTRACT.indexSchemaVersion,
    encode(request.term || "unknown"),
    encode(request.releaseVersion || "unknown"),
    encode(request.q),
    encode(request.collegeCode),
    encode(request.collegeName),
    encode(request.titleCode),
    String(request.limit),
    String(request.offset),
  ].join(":");
}

function normalizeResponse(payload, requestInput) {
  const source = payload && payload.data ? payload.data : (payload || {});
  const request = normalizeRequest(Object.assign({}, requestInput || {}, {
    term: requestInput && (requestInput.term || requestInput.semester) || source.term || source.semester,
    releaseVersion: requestInput && (requestInput.releaseVersion || requestInput.version) || source.releaseVersion || source.version,
  }));
  const term = text(source.term || source.semester || request.term, 40);
  const releaseVersion = text(source.releaseVersion || source.version || request.releaseVersion, 80);
  const items = (Array.isArray(source.items) ? source.items : []).map((item) => normalizeItem(item, {
    term, releaseVersion, teacherIndexSchemaVersion: CONTRACT.indexSchemaVersion,
  }));
  return {
    success: source.success !== false,
    type: "teacher",
    contractVersion: CONTRACT.contractVersion,
    teacherIndexSchemaVersion: CONTRACT.indexSchemaVersion,
    term,
    semester: text(source.semester || term, 40),
    releaseVersion,
    version: text(source.version || releaseVersion, 80),
    query: text(source.query || request.q, 120).replace(/\s+/g, "").toLowerCase(),
    total: Math.max(0, Number(source.total == null ? items.length : source.total) || 0),
    limit: numberInRange(source.limit, request.limit, 1, 100),
    offset: numberInRange(source.offset, request.offset, 0, 100000),
    items,
    cacheKey: buildCacheKey(request),
    reasonCode: text(source.reasonCode, 80),
    degradedSchema: source.degradedSchema === true,
    fromStorage: source.fromStorage === true,
    source: text(source.source, 80),
    updatedAt: text(source.updatedAt || source.generatedAt, 48),
    debug: source.debug && typeof source.debug === "object" ? source.debug : null,
  };
}

module.exports = { CONTRACT, buildCacheKey, normalizeItem, normalizeRequest, normalizeResponse };
