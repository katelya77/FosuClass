#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "server", "config", "teacher-search-contract.json");
const outputs = [
  path.join(root, "server", "src", "shared", "teacherSearchContract.generated.js"),
  path.join(root, "miniprogram", "shared", "teacherSearchContract.generated.js"),
];

function generatedSource(contract) {
  return `// Generated from server/config/teacher-search-contract.json. Do not edit by hand.\n` +
`const CONTRACT = Object.freeze(${JSON.stringify(contract, null, 2)});\n\n` +
`function text(value, max) {\n` +
`  return String(value == null ? "" : value).trim().replace(/\\s+/g, " ").slice(0, max || 120);\n` +
`}\n\n` +
`function numberInRange(value, fallback, min, max) {\n` +
`  const parsed = Number(value);\n` +
`  if (!Number.isFinite(parsed)) return fallback;\n` +
`  return Math.max(min, Math.min(max, Math.floor(parsed)));\n` +
`}\n\n` +
`function normalizeRequest(input) {\n` +
`  const source = input && typeof input === "object" ? input : {};\n` +
`  return {\n` +
`    type: "teacher",\n` +
`    q: text(source.q || source.keyword, 120),\n` +
`    term: text(source.term || source.semester, 40),\n` +
`    releaseVersion: text(source.releaseVersion || source.version, 80),\n` +
`    collegeCode: text(source.collegeCode, 24),\n` +
`    collegeName: text(source.collegeName || source.college, 80),\n` +
`    titleCode: text(source.titleCode || source.title, 40),\n` +
`    limit: numberInRange(source.limit, 30, 1, 100),\n` +
`    offset: numberInRange(source.offset, 0, 0, 100000),\n` +
`  };\n` +
`}\n\n` +
`function uniqueTextList(value, fallback) {\n` +
`  const source = Array.isArray(value) ? value : (fallback ? [fallback] : []);\n` +
`  return Array.from(new Set(source.map((item) => text(item, 80)).filter(Boolean)));\n` +
`}\n\n` +
`function normalizeItem(item, meta) {\n` +
`  const source = item && typeof item === "object" ? item : {};\n` +
`  const context = meta && typeof meta === "object" ? meta : {};\n` +
`  const teacherName = text(source.teacherName || source.name || source.displayName || source.canonicalName, 120);\n` +
`  const id = text(source.id || source.detailId || source.teacherId, 128);\n` +
`  const collegeCodes = uniqueTextList(source.collegeCodes, source.collegeCode);\n` +
`  const collegeNames = uniqueTextList(source.collegeNames, source.collegeName || source.college);\n` +
`  return Object.assign({}, source, {\n` +
`    id,\n` +
`    detailId: text(source.detailId || id, 128),\n` +
`    teacherName,\n` +
`    name: teacherName,\n` +
`    normalizedName: text(source.normalizedName || source.searchableName || teacherName.replace(/\\s+/g, "").toLowerCase(), 120),\n` +
`    collegeCode: text(source.collegeCode || collegeCodes[0], 24),\n` +
`    collegeCodes,\n` +
`    collegeName: text(source.collegeName || source.college || collegeNames[0], 80),\n` +
`    collegeNames,\n` +
`    courseCount: Math.max(0, Number(source.courseCount || 0) || 0),\n` +
`    term: text(source.term || source.semester || context.term, 40),\n` +
`    releaseVersion: text(source.releaseVersion || context.releaseVersion, 80),\n` +
`    teacherIndexSchemaVersion: Number(source.teacherIndexSchemaVersion || context.teacherIndexSchemaVersion || CONTRACT.indexSchemaVersion) || CONTRACT.indexSchemaVersion,\n` +
`  });\n` +
`}\n\n` +
`function encode(value) { return encodeURIComponent(text(value, 160)); }\n\n` +
`function buildCacheKey(input) {\n` +
`  const request = normalizeRequest(input);\n` +
`  return [\n` +
`    CONTRACT.cacheNamespace,\n` +
`    CONTRACT.contractVersion,\n` +
`    "schema-" + CONTRACT.indexSchemaVersion,\n` +
`    encode(request.term || "unknown"),\n` +
`    encode(request.releaseVersion || "unknown"),\n` +
`    encode(request.q),\n` +
`    encode(request.collegeCode),\n` +
`    encode(request.collegeName),\n` +
`    encode(request.titleCode),\n` +
`    String(request.limit),\n` +
`    String(request.offset),\n` +
`  ].join(":");\n` +
`}\n\n` +
`function normalizeResponse(payload, requestInput) {\n` +
`  const source = payload && payload.data ? payload.data : (payload || {});\n` +
`  const request = normalizeRequest(Object.assign({}, requestInput || {}, {\n` +
`    term: requestInput && (requestInput.term || requestInput.semester) || source.term || source.semester,\n` +
`    releaseVersion: requestInput && (requestInput.releaseVersion || requestInput.version) || source.releaseVersion || source.version,\n` +
`  }));\n` +
`  const term = text(source.term || source.semester || request.term, 40);\n` +
`  const releaseVersion = text(source.releaseVersion || source.version || request.releaseVersion, 80);\n` +
`  const items = (Array.isArray(source.items) ? source.items : []).map((item) => normalizeItem(item, {\n` +
`    term, releaseVersion, teacherIndexSchemaVersion: CONTRACT.indexSchemaVersion,\n` +
`  }));\n` +
`  return {\n` +
`    success: source.success !== false,\n` +
`    type: "teacher",\n` +
`    contractVersion: CONTRACT.contractVersion,\n` +
`    teacherIndexSchemaVersion: CONTRACT.indexSchemaVersion,\n` +
`    term,\n` +
`    semester: text(source.semester || term, 40),\n` +
`    releaseVersion,\n` +
`    version: text(source.version || releaseVersion, 80),\n` +
`    query: text(source.query || request.q, 120).replace(/\\s+/g, "").toLowerCase(),\n` +
`    total: Math.max(0, Number(source.total == null ? items.length : source.total) || 0),\n` +
`    limit: numberInRange(source.limit, request.limit, 1, 100),\n` +
`    offset: numberInRange(source.offset, request.offset, 0, 100000),\n` +
`    items,\n` +
`    cacheKey: buildCacheKey(request),\n` +
`    reasonCode: text(source.reasonCode, 80),\n` +
`    degradedSchema: source.degradedSchema === true,\n` +
`    fromStorage: source.fromStorage === true,\n` +
`    source: text(source.source, 80),\n` +
`    updatedAt: text(source.updatedAt || source.generatedAt, 48),\n` +
`    debug: source.debug && typeof source.debug === "object" ? source.debug : null,\n` +
`  };\n` +
`}\n\n` +
`module.exports = { CONTRACT, buildCacheKey, normalizeItem, normalizeRequest, normalizeResponse };\n`;
}

function main() {
  const contract = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const source = generatedSource(contract);
  const checkOnly = process.argv.includes("--check");
  let changed = false;
  outputs.forEach((file) => {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (current === source) return;
    changed = true;
    if (!checkOnly) fs.writeFileSync(file, source, "utf8");
  });
  if (checkOnly && changed) {
    console.error("Teacher Search Contract generated files are stale. Run npm run generate:teacher-search-contract.");
    process.exit(1);
  }
  console.log(checkOnly ? "teacher-search-contract: current" : "teacher-search-contract: generated");
}

main();
