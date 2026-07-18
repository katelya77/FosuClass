const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { isPlainObject, normalizeCourse, requireType, sha256, stableId, stableStringify, typedError } = require("./contracts");
const durableStore = require("./durableStore");
const { calculateFingerprint } = require("../../utils/stagingFingerprint");
const { acquireExclusiveFileLock, acquireExclusiveFileLocks } = require("../../services/exclusiveFileLockService");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));
const DATA_DIR = path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../data"));
const RELEASES_DIR = path.join(STORAGE_DIR, "releases");
const ACTIVE_RELEASE_PATH = path.join(RELEASES_DIR, "active.json");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const CATALOG_STAGING_DIR = path.join(DATA_DIR, "admin-catalog-staging");
const GENERATIONS_DIR = path.join(CATALOG_STAGING_DIR, "generations");
const CURRENT_GENERATION_PATH = path.join(CATALOG_STAGING_DIR, "current.json");
const BOOTSTRAP_JOURNAL_PATH = path.join(CATALOG_STAGING_DIR, "bootstrap.json");
const LOCKS_DIR = path.join(CATALOG_STAGING_DIR, "locks");
const META_PATH = path.join(STORAGE_DIR, "catalog-meta.json");
const LEGACY_PATHS = Object.freeze({
  catalog: path.join(STORAGE_DIR, "catalog.json"),
  class: path.join(STORAGE_DIR, "class-schedules.json"),
  teacher: path.join(STORAGE_DIR, "teacher-schedules.json"),
  classroom: path.join(STORAGE_DIR, "classroom-schedules.json"),
  course: path.join(STORAGE_DIR, "course-schedules.json"),
  major: path.join(STORAGE_DIR, "majors-index.json"),
});
const FILE_NAMES = Object.freeze({ catalog: "catalog.json", class: "class-schedules.json", teacher: "teacher-schedules.json", classroom: "classroom-schedules.json", course: "course-schedules.json", major: "majors-index.json" });
const RESOURCE_TYPES = Object.freeze(["class", "teacher", "classroom", "course", "major"]);

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function stringValue(value, fallback = "") {
  return String(value === undefined || value === null ? fallback : value).normalize("NFC").trim();
}

function assertChild(root, candidate, code = "CATALOG_TARGET_INVALID") {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw typedError("catalog path escaped its managed root", code, 500);
  return resolved;
}

function assertNoSymlink(root, candidate) {
  let cursor = path.resolve(candidate);
  const base = path.resolve(root);
  while (cursor.startsWith(base)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw typedError("catalog staging symlinks are not allowed", "CATALOG_TARGET_INVALID", 500);
    if (cursor === base) break;
    cursor = path.dirname(cursor);
  }
}

function assertManagedStagingRoots() {
  if (fs.existsSync(CATALOG_STAGING_DIR)) {
    const stat = fs.lstatSync(CATALOG_STAGING_DIR);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("catalog staging root is unsafe", "CATALOG_TARGET_INVALID", 500);
  }
  if (fs.existsSync(GENERATIONS_DIR)) {
    const stat = fs.lstatSync(GENERATIONS_DIR);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("catalog generations root is unsafe", "CATALOG_TARGET_INVALID", 500);
  }
  if (fs.existsSync(LOCKS_DIR)) {
    const stat = fs.lstatSync(LOCKS_DIR);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("catalog locks root is unsafe", "CATALOG_TARGET_INVALID", 500);
  }
}

function parseRaw(type, bytes, label = "catalog source") {
  let raw;
  try { raw = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch (_) { throw typedError(`${label} is malformed`, "CATALOG_SOURCE_MALFORMED", 500); }
  if (type === "catalog") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.colleges || []) || !Array.isArray(raw.grades || [])) throw typedError(`${label} must be a catalog object`, "CATALOG_SOURCE_MALFORMED", 500);
  } else if (type === "major") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.colleges || []) || !stringValue(raw.semester)) throw typedError(`${label} must be a semester-scoped majors object`, "CATALOG_SOURCE_MALFORMED", 500);
  } else if (!Array.isArray(raw)) throw typedError(`${label} must be an array`, "CATALOG_SOURCE_MALFORMED", 500);
  return raw;
}

function sourceError(message, details) {
  return typedError(message, "CATALOG_SOURCE_INVALID", 500, details);
}

function requireSourceString(value, label, options = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw sourceError(`${label} must be a string`);
  const normalized = stringValue(value);
  if (options.required !== false && !normalized) throw sourceError(`${label} is required`);
  if (normalized.includes(":")) throw sourceError(`${label} cannot contain ':'`);
  return normalized;
}

function catalogSemesterValues(catalog) {
  const values = [];
  for (const entry of catalog.semesters || []) {
    const value = isPlainObject(entry) ? stringValue(entry.value || entry.id || entry.semester) : stringValue(entry);
    if (!value) throw sourceError("catalog.semesters contains an empty or invalid term");
    values.push(value);
  }
  return new Set(values);
}

function validateCatalogDimensions(catalog, options = {}) {
  if (!isPlainObject(catalog) || !Array.isArray(catalog.colleges) || !Array.isArray(catalog.grades)) throw sourceError("catalog dimensions are malformed");
  const collegeCodes = new Set();
  for (let index = 0; index < catalog.colleges.length; index += 1) {
    const college = catalog.colleges[index];
    if (!isPlainObject(college)) throw sourceError(`catalog.colleges[${index}] must be an object`);
    const code = requireSourceString(college.code || college.collegeCode, `catalog.colleges[${index}].code`);
    requireSourceString(college.name || college.collegeName, `catalog.colleges[${index}].name`);
    if (collegeCodes.has(code)) throw sourceError(`catalog contains duplicate college code: ${code}`);
    collegeCodes.add(code);
  }
  const gradeValues = [];
  for (let index = 0; index < catalog.grades.length; index += 1) gradeValues.push(requireSourceString(catalog.grades[index], `catalog.grades[${index}]`));
  if (new Set(gradeValues).size !== gradeValues.length) throw sourceError("catalog contains duplicate grades");
  const semesterValues = catalogSemesterValues(catalog);
  if (options.requiredTerm && !semesterValues.has(options.requiredTerm)) throw sourceError("catalog does not advertise the release term", { term: options.requiredTerm });
  return { collegeCodes, grades: new Set(gradeValues), semesters: semesterValues };
}

function validateNestedMajors(raw, dimensions, options = {}) {
  if (!isPlainObject(raw) || !Array.isArray(raw.colleges)) throw sourceError("majors index is malformed");
  const semester = requireSourceString(raw.semester, "majors.semester");
  const seen = new Set();
  for (let collegeIndex = 0; collegeIndex < raw.colleges.length; collegeIndex += 1) {
    const college = raw.colleges[collegeIndex];
    if (!isPlainObject(college) || !Array.isArray(college.grades)) throw sourceError(`majors.colleges[${collegeIndex}] is malformed`);
    const collegeCode = requireSourceString(college.collegeCode || college.code, `majors.colleges[${collegeIndex}].collegeCode`);
    requireSourceString(college.collegeName || college.name, `majors.colleges[${collegeIndex}].collegeName`);
    for (let gradeIndex = 0; gradeIndex < college.grades.length; gradeIndex += 1) {
      const grade = college.grades[gradeIndex];
      if (!isPlainObject(grade) || !Array.isArray(grade.majors)) throw sourceError(`majors.colleges[${collegeIndex}].grades[${gradeIndex}] is malformed`);
      const gradeValue = requireSourceString(grade.grade, `majors.colleges[${collegeIndex}].grades[${gradeIndex}].grade`);
      for (let majorIndex = 0; majorIndex < grade.majors.length; majorIndex += 1) {
        const major = grade.majors[majorIndex];
        if (!isPlainObject(major)) throw sourceError("major leaf must be an object");
        const majorCode = requireSourceString(major.majorCode || major.code, "major.majorCode");
        requireSourceString(major.majorName || major.name, "major.majorName");
        const id = stableId("major", { semester, collegeCode, grade: gradeValue, majorCode });
        if (seen.has(id)) throw sourceError(`majors index contains duplicate stable id: ${id}`);
        seen.add(id);
        if (options.rejectOrphans && (!dimensions.collegeCodes.has(collegeCode) || !dimensions.grades.has(gradeValue))) {
          throw sourceError("active release contains an orphan major relationship", { id, collegeCode, grade: gradeValue });
        }
      }
    }
  }
  return { semester, ids: seen };
}

function scheduleIdentity(type, row, location) {
  if (type === "class") {
    requireSourceString(row.className, `${location}.className`);
    requireSourceString(row.collegeCode, `${location}.collegeCode`, { required: false });
    requireSourceString(row.grade, `${location}.grade`);
    requireSourceString(row.majorCode, `${location}.majorCode`, { required: false });
  } else if (type === "teacher") requireSourceString(row.teacherName, `${location}.teacherName`);
  else if (type === "classroom") requireSourceString(row.roomName, `${location}.roomName`);
  else requireSourceString(row.courseName, `${location}.courseName`);
}

function normalizeScheduleRows(type, rows, context) {
  if (!Array.isArray(rows)) throw sourceError(`${type} schedules must be an array`);
  const normalizedRows = [];
  const seen = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const original = rows[index];
    const location = `${type}[${index}]`;
    if (!isPlainObject(original)) throw sourceError(`${location} must be an object`);
    scheduleIdentity(type, original, location);
    if (!Array.isArray(original.courses) || original.courses.length > 5000) throw sourceError(`${location}.courses must be a bounded array`);
    let courses;
    try { courses = original.courses.map((course, courseIndex) => normalizeCourse(course, `${location}.courses[${courseIndex}]`)); }
    catch (error) { throw sourceError(`${location} contains an invalid course`, { cause: error.code || error.message }); }
    const courseTerms = new Set(courses.map((course) => stringValue(course.semester)).filter(Boolean));
    if (courseTerms.size > 1) throw sourceError(`${location} contains courses from multiple terms`);
    let semester = requireSourceString(original.semester, `${location}.semester`, { required: false });
    const courseTerm = Array.from(courseTerms)[0] || "";
    if (!semester) semester = courseTerm || context.provenTerm;
    if (!semester) throw sourceError(`${location} has no safely provable semester`);
    if (semester !== context.provenTerm) throw sourceError(`${location} does not match the single proven generation term`);
    if (courseTerm && courseTerm !== semester) throw sourceError(`${location} course semester does not match its outer semester`);
    if (context.semesters.size && !context.semesters.has(semester)) throw sourceError(`${location} uses a semester absent from catalog dimensions`);
    const row = { ...original, semester, courses };
    for (const field of ["className", "collegeCode", "collegeName", "grade", "majorCode", "majorName", "teacherName", "roomName", "buildingName", "courseName"]) {
      if (row[field] !== undefined) row[field] = requireSourceString(row[field], `${location}.${field}`, { required: !["collegeCode", "collegeName", "majorCode", "majorName", "buildingName"].includes(field) });
    }
    let id;
    try { id = stableId(type, row); } catch (error) { throw sourceError(`${location} has an invalid stable identity`, { cause: error.code || error.message }); }
    if (seen.has(id)) throw sourceError(`${type} schedules contain duplicate stable id: ${id}`);
    seen.add(id);
    normalizedRows.push(row);
  }
  return normalizedRows;
}

function validateAndNormalizeDocuments(rawDocuments, options = {}) {
  const documents = JSON.parse(JSON.stringify(rawDocuments));
  const majors = validateNestedMajors(documents.major, { collegeCodes: new Set(), grades: new Set() }, { rejectOrphans: false });
  if (!Array.isArray(documents.catalog.semesters) || documents.catalog.semesters.length === 0) {
    documents.catalog.semesters = [{ value: majors.semester, label: majors.semester }];
  }
  const dimensions = validateCatalogDimensions(documents.catalog, { requiredTerm: majors.semester });
  validateNestedMajors(documents.major, dimensions, { rejectOrphans: options.rejectOrphans === true });
  for (const type of RESOURCE_TYPES.filter((entry) => entry !== "major")) {
    documents[type] = normalizeScheduleRows(type, documents[type], { provenTerm: majors.semester, semesters: dimensions.semesters });
  }
  return { documents, provenTerm: majors.semester, dimensions };
}

function serializeDocuments(documents) {
  return Object.fromEntries(Object.keys(FILE_NAMES).map((type) => [type, Buffer.from(`${JSON.stringify(documents[type], null, 2)}\n`, "utf8")]));
}

function validateGenerationBytes(fileBytes, options = {}) {
  const documents = Object.fromEntries(Object.keys(FILE_NAMES).map((type) => [type, parseRaw(type, fileBytes[type], options.label || "catalog generation source")]));
  const normalized = validateAndNormalizeDocuments(documents, { rejectOrphans: options.rejectOrphans === true });
  for (const type of Object.keys(FILE_NAMES)) {
    if (stableStringify(documents[type]) !== stableStringify(normalized.documents[type])) {
      throw sourceError(`catalog ${type} source is not canonical`);
    }
  }
  return normalized;
}

function versionForRaw(type, raw, rawSha256) {
  const logicalSha256 = sha256(stableStringify({ type, raw }));
  return { logicalSha256, version: `catalog_${logicalSha256.slice(0, 16)}_${rawSha256.slice(0, 12)}` };
}

function generationDir(generationId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(generationId || ""))) throw typedError("catalog generation id is invalid", "CATALOG_GENERATION_INVALID", 500);
  return assertChild(GENERATIONS_DIR, path.join(GENERATIONS_DIR, generationId), "CATALOG_GENERATION_INVALID");
}

function readCurrentPointer() {
  let pointer;
  try {
    assertNoSymlink(CATALOG_STAGING_DIR, CURRENT_GENERATION_PATH);
    pointer = JSON.parse(fs.readFileSync(CURRENT_GENERATION_PATH, "utf8"));
  } catch (error) {
    if (error && error.code && String(error.code).startsWith("CATALOG_")) throw error;
    throw typedError("catalog staging current generation is missing or malformed", "CATALOG_GENERATION_INVALID", 500);
  }
  if (!pointer || pointer.schemaVersion !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(pointer.generationId || "")) || !/^[0-9a-f]{64}$/i.test(String(pointer.manifestSha256 || ""))) throw typedError("catalog staging current generation pointer is invalid", "CATALOG_GENERATION_INVALID", 500);
  return pointer;
}

function readGeneration(generationId) {
  const dir = generationDir(generationId);
  assertNoSymlink(GENERATIONS_DIR, dir);
  const manifestPath = path.join(dir, "manifest.json");
  let manifestBytes;
  let manifest;
  try { manifestBytes = fs.readFileSync(manifestPath); manifest = JSON.parse(manifestBytes.toString("utf8")); } catch (_) { throw typedError("catalog generation manifest is missing or malformed", "CATALOG_GENERATION_INVALID", 500); }
  if (!manifest || manifest.schemaVersion !== 1 || manifest.generationId !== generationId || !manifest.files || typeof manifest.files !== "object") throw typedError("catalog generation manifest is invalid", "CATALOG_GENERATION_INVALID", 500);
  const expected = Object.keys(FILE_NAMES).sort(compareText);
  if (stableStringify(Object.keys(manifest.files).sort(compareText)) !== stableStringify(expected)) throw typedError("catalog generation file set is invalid", "CATALOG_GENERATION_INVALID", 500);
  const files = {};
  for (const type of expected) {
    const filePath = assertChild(dir, path.join(dir, FILE_NAMES[type]), "CATALOG_GENERATION_INVALID");
    assertNoSymlink(dir, filePath);
    let bytes;
    try { bytes = fs.readFileSync(filePath); } catch (_) { throw typedError("catalog generation is incomplete", "CATALOG_GENERATION_INVALID", 500); }
    const raw = parseRaw(type, bytes, "catalog generation source");
    const record = manifest.files[type];
    const logical = versionForRaw(type, raw, sha256(bytes));
    if (!record || record.filename !== FILE_NAMES[type] || record.rawSha256 !== sha256(bytes) || record.size !== bytes.length || record.logicalSha256 !== logical.logicalSha256 || record.version !== logical.version) throw typedError("catalog generation source hash mismatch", "CATALOG_GENERATION_INVALID", 500);
    files[type] = { type, targetPath: filePath, rawBytes: bytes, raw, rawSha256: record.rawSha256, logicalSha256: record.logicalSha256, version: record.version };
  }
  validateGenerationBytes(Object.fromEntries(Object.entries(files).map(([type, file]) => [type, file.rawBytes])), { label: "catalog generation source" });
  return { generationId, dir, manifest, manifestPath, manifestSha256: sha256(manifestBytes), files };
}

function readCurrentGeneration() {
  if (!fs.existsSync(CURRENT_GENERATION_PATH) || fs.existsSync(BOOTSTRAP_JOURNAL_PATH)) return publishInitialGeneration();
  const pointer = readCurrentPointer();
  const generation = readGeneration(pointer.generationId);
  if (generation.manifestSha256 !== pointer.manifestSha256) throw typedError("catalog generation pointer hash mismatch", "CATALOG_GENERATION_INVALID", 500);
  return generation;
}

function readReleaseFile(filePath, label) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(RELEASES_DIR, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw typedError(`${label} escaped the releases root`, "CATALOG_RELEASE_SEED_INVALID", 503);
  try {
    assertNoSymlink(STORAGE_DIR, resolved);
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    return fs.readFileSync(resolved);
  } catch (error) {
    throw typedError(`${label} is missing or unsafe`, "CATALOG_RELEASE_SEED_UNAVAILABLE", 503, { cause: error.code || error.message });
  }
}

function parseReleaseJson(bytes, label) {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!isPlainObject(value)) throw new Error("not an object");
    return value;
  } catch (error) {
    throw typedError(`${label} is malformed`, "CATALOG_RELEASE_SEED_INVALID", 503, { cause: error.message });
  }
}

function strictReleaseVersion(value) {
  const version = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(version)) throw typedError("active release version is invalid", "CATALOG_RELEASE_SEED_INVALID", 503);
  return version;
}

function oneConsistentValue(values, label, normalizer = stringValue) {
  const normalized = values.filter((value) => value !== undefined && value !== null && String(value).trim() !== "").map(normalizer).filter(Boolean);
  if (!normalized.length || new Set(normalized).size !== 1) throw typedError(`${label} is missing or contradictory`, "CATALOG_RELEASE_SEED_INVALID", 503);
  return normalized[0];
}

function deriveNestedMajors(snapshot, term) {
  if (!Array.isArray(snapshot.majors) || snapshot.majors.length === 0) throw typedError("active release majors are incomplete", "CATALOG_RELEASE_SEED_INVALID", 503);
  const dimensions = validateCatalogDimensions(snapshot.catalog, { requiredTerm: term });
  const collegeNames = new Map((snapshot.catalog.colleges || []).map((college) => [stringValue(college.code || college.collegeCode), stringValue(college.name || college.collegeName)]));
  const colleges = new Map();
  const seen = new Set();
  for (let index = 0; index < snapshot.majors.length; index += 1) {
    const source = snapshot.majors[index];
    if (!isPlainObject(source)) throw typedError("active release contains a malformed major", "CATALOG_RELEASE_SEED_INVALID", 503);
    const collegeCode = requireSourceString(source.collegeCode, `snapshot.majors[${index}].collegeCode`);
    const gradeValue = requireSourceString(source.grade, `snapshot.majors[${index}].grade`);
    const majorCode = requireSourceString(source.majorCode || source.code, `snapshot.majors[${index}].majorCode`);
    const majorName = requireSourceString(source.majorName || source.name, `snapshot.majors[${index}].majorName`);
    const collegeName = requireSourceString(source.collegeName || collegeNames.get(collegeCode), `snapshot.majors[${index}].collegeName`);
    const id = stableId("major", { semester: term, collegeCode, grade: gradeValue, majorCode });
    if (seen.has(id)) throw typedError("active release contains duplicate majors", "CATALOG_RELEASE_SEED_INVALID", 503, { id });
    seen.add(id);
    let college = colleges.get(collegeCode);
    if (!college) {
      college = { collegeCode, collegeName, grades: [] };
      colleges.set(collegeCode, college);
    }
    let grade = college.grades.find((entry) => entry.grade === gradeValue);
    if (!grade) {
      grade = { grade: gradeValue, majors: [] };
      college.grades.push(grade);
    }
    grade.majors.push({ majorCode, majorName });
  }
  const ordered = Array.from(colleges.values()).sort((left, right) => compareText(left.collegeCode, right.collegeCode));
  for (const college of ordered) {
    college.grades.sort((left, right) => compareText(right.grade, left.grade));
    for (const grade of college.grades) grade.majors.sort((left, right) => compareText(left.majorCode, right.majorCode));
  }
  return {
    version: `release_${sha256(stableStringify(snapshot.majors)).slice(0, 20)}`,
    semester: term,
    grades: Array.from(new Set((snapshot.catalog.grades || []).map(stringValue))).sort((left, right) => compareText(right, left)),
    colleges: ordered,
  };
}

function mergeReleaseResourceRows(type, directoryRows, scheduleRows, term) {
  const nameFields = {
    teacher: ["teacherName", "name", "displayName"],
    classroom: ["roomName", "classroomName", "name", "displayName"],
    course: ["courseName", "name", "displayName"],
  }[type];
  const canonicalField = { teacher: "teacherName", classroom: "roomName", course: "courseName" }[type];
  const directory = Array.isArray(directoryRows) ? directoryRows : [];
  const schedules = Array.isArray(scheduleRows) ? scheduleRows : [];
  if (directory.length === 0 && schedules.length === 0) throw typedError(`release snapshot has no ${type} directory or schedules`, "CATALOG_RELEASE_SEED_UNAVAILABLE", 503);
  const byName = new Map();
  const nameFor = (row, location) => {
    if (!isPlainObject(row)) throw typedError(`${location} must be an object`, "CATALOG_RELEASE_SEED_INVALID", 503);
    const candidates = nameFields.map((field) => row[field]).filter((value) => value !== undefined && value !== null && String(value).trim());
    return requireSourceString(candidates[0], `${location}.${canonicalField}`);
  };
  directory.forEach((row, index) => {
    const name = nameFor(row, `resources.${type}s[${index}]`);
    if (byName.has(name)) throw typedError(`release ${type} directory contains duplicate identity`, "CATALOG_RELEASE_SEED_INVALID", 503, { name });
    byName.set(name, { ...row, [canonicalField]: name, semester: term, courses: [] });
  });
  schedules.forEach((row, index) => {
    const name = nameFor(row, `resources.${type}Schedules[${index}]`);
    if (byName.has(name) && byName.get(name).__hasSchedule) throw typedError(`release ${type} schedules contain duplicate identity`, "CATALOG_RELEASE_SEED_INVALID", 503, { name });
    const prior = byName.get(name) || {};
    byName.set(name, { ...prior, ...row, [canonicalField]: name, semester: row.semester || term, courses: row.courses, __hasSchedule: true });
  });
  return Array.from(byName.values()).map((row) => {
    const next = { ...row };
    delete next.__hasSchedule;
    return next;
  }).sort((left, right) => compareText(left[canonicalField], right[canonicalField]));
}

function buildReleaseSeed(version, expectations = {}) {
  const releaseDir = path.join(RELEASES_DIR, strictReleaseVersion(version));
  const snapshotPath = path.join(releaseDir, "snapshot.json");
  const manifestPath = path.join(releaseDir, "manifest.json");
  const snapshotBytes = readReleaseFile(snapshotPath, "active release snapshot");
  const manifestBytes = readReleaseFile(manifestPath, "active release manifest");
  const snapshotSha256 = sha256(snapshotBytes);
  const manifestSha256 = sha256(manifestBytes);
  if (expectations.snapshotSha256 && expectations.snapshotSha256 !== snapshotSha256) throw typedError("journaled release snapshot changed", "CATALOG_RELEASE_SEED_INVALID", 503);
  if (expectations.manifestSha256 && expectations.manifestSha256 !== manifestSha256) throw typedError("journaled release manifest changed", "CATALOG_RELEASE_SEED_INVALID", 503);
  const snapshot = parseReleaseJson(snapshotBytes, "active release snapshot");
  const manifest = parseReleaseJson(manifestBytes, "active release manifest");
  const snapshotVersion = oneConsistentValue([snapshot.version, snapshot.releaseVersion], "snapshot release version", strictReleaseVersion);
  const manifestVersion = oneConsistentValue([manifest.version, manifest.releaseVersion], "manifest release version", strictReleaseVersion);
  const term = oneConsistentValue([snapshot.term, snapshot.semester, snapshot.termConfig && snapshot.termConfig.term], "snapshot release term");
  const manifestTerm = oneConsistentValue([manifest.term, manifest.semester, manifest.termConfig && manifest.termConfig.term], "manifest release term");
  if (snapshotVersion !== version || manifestVersion !== version || !term || manifestTerm !== term) throw typedError("release version or term does not match its path", "CATALOG_RELEASE_SEED_INVALID", 503);
  if (expectations.term && expectations.term !== term) throw typedError("journaled release term changed", "CATALOG_RELEASE_SEED_INVALID", 503);
  const canonicalHash = calculateFingerprint(snapshot).canonicalHash;
  if (!/^[0-9a-f]{64}$/i.test(canonicalHash)
      || manifest.canonicalHash !== canonicalHash
      || (expectations.canonicalHash && expectations.canonicalHash !== canonicalHash)) {
    throw typedError("release canonical fingerprint does not match", "CATALOG_RELEASE_SEED_INVALID", 503);
  }
  if (manifest.success !== true || !manifest.packHealth || manifest.packHealth.valid !== true) throw typedError("release manifest is not healthy", "CATALOG_RELEASE_SEED_INVALID", 503);
  let releaseValidation;
  try { releaseValidation = require("../../services/releaseService").validateReleaseSnapshot(snapshot); }
  catch (error) { throw typedError("release snapshot validation failed", "CATALOG_RELEASE_SEED_INVALID", 503, { cause: error.code || error.message }); }
  if (!releaseValidation || releaseValidation.valid !== true) throw typedError("release snapshot is not valid", "CATALOG_RELEASE_SEED_INVALID", 503, { errors: releaseValidation && releaseValidation.errors || [] });
  const resources = isPlainObject(snapshot.resources) ? snapshot.resources : null;
  if (!resources) throw typedError("release snapshot resources are missing", "CATALOG_RELEASE_SEED_UNAVAILABLE", 503);
  const catalog = JSON.parse(JSON.stringify(snapshot.catalog));
  if (!Array.isArray(catalog.semesters)) catalog.semesters = [];
  if (!catalogSemesterValues(catalog).has(term)) catalog.semesters.push({ value: term, label: term });
  const rawDocuments = {
    catalog,
    major: deriveNestedMajors({ ...snapshot, catalog }, term),
    class: snapshot.classSchedules,
    teacher: mergeReleaseResourceRows("teacher", resources.teachers, resources.teacherSchedules, term),
    classroom: mergeReleaseResourceRows("classroom", resources.classrooms, resources.classroomSchedules, term),
    course: mergeReleaseResourceRows("course", resources.courses, resources.courseSchedules, term),
  };
  let normalized;
  try { normalized = validateAndNormalizeDocuments(rawDocuments, { rejectOrphans: false }); }
  catch (error) {
    if (error.code === "CATALOG_SOURCE_INVALID") throw error;
    throw typedError("release could not be converted into a Catalog generation", "CATALOG_RELEASE_SEED_INVALID", 503, { cause: error.code || error.message });
  }
  const bytes = serializeDocuments(normalized.documents);
  return {
    bytes,
    source: {
      sourceKind: "active-release",
      releaseVersion: version,
      term,
      canonicalHash,
      snapshotSha256,
      manifestSha256,
    },
  };
}

function readActivePointerBytes() {
  try { return readReleaseFile(ACTIVE_RELEASE_PATH, "active release pointer"); }
  catch (error) {
    if (error.code === "CATALOG_RELEASE_SEED_UNAVAILABLE") throw error;
    throw typedError("active release pointer is unavailable", "CATALOG_RELEASE_SEED_UNAVAILABLE", 503);
  }
}

function validateActivePointer(pointer) {
  const version = oneConsistentValue([pointer.version, pointer.releaseVersion], "active release version", strictReleaseVersion);
  const term = oneConsistentValue([pointer.term, pointer.semester, pointer.termConfig && pointer.termConfig.term], "active release term");
  const packStatus = pointer.packStatus;
  if (!term
      || !/^[0-9a-f]{64}$/i.test(String(pointer.canonicalHash || ""))
      || !isPlainObject(packStatus)
      || packStatus.healthy !== true
      || packStatus.manifestExists !== true
      || packStatus.manifestValid !== true
      || packStatus.hashValid !== true
      || !Array.isArray(packStatus.missing)
      || packStatus.missing.length !== 0
      || !Array.isArray(packStatus.hashErrors)
      || packStatus.hashErrors.length !== 0) {
    throw typedError("active release pointer is not healthy", "CATALOG_RELEASE_SEED_INVALID", 503);
  }
  return { version, term, canonicalHash: pointer.canonicalHash };
}

function readStableActiveReleaseSeed() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const firstBytes = readActivePointerBytes();
    const first = validateActivePointer(parseReleaseJson(firstBytes, "active release pointer"));
    let seed;
    let seedError;
    try { seed = buildReleaseSeed(first.version, first); } catch (error) { seedError = error; }
    const secondSnapshotHash = sha256(readReleaseFile(path.join(RELEASES_DIR, first.version, "snapshot.json"), "active release snapshot"));
    const secondManifestHash = sha256(readReleaseFile(path.join(RELEASES_DIR, first.version, "manifest.json"), "active release manifest"));
    const secondBytes = readActivePointerBytes();
    if (sha256(firstBytes) !== sha256(secondBytes)) continue;
    if (seedError) throw seedError;
    if (secondSnapshotHash !== seed.source.snapshotSha256 || secondManifestHash !== seed.source.manifestSha256) continue;
    const second = validateActivePointer(parseReleaseJson(secondBytes, "active release pointer"));
    if (stableStringify(first) !== stableStringify(second)) continue;
    seed.source.activePointerSha256 = sha256(firstBytes);
    return seed;
  }
  throw typedError("active release changed during Catalog bootstrap", "CATALOG_RELEASE_SEED_CONFLICT", 409);
}

function readPinnedReleaseSeed(source) {
  if (!source || source.sourceKind !== "active-release") throw typedError("Catalog bootstrap journal source is invalid", "CATALOG_BOOTSTRAP_INVALID", 500);
  return buildReleaseSeed(source.releaseVersion, source);
}

function buildManifest(generationId, fileBytes, provenance, operationId, createdAt = new Date().toISOString()) {
  validateGenerationBytes(fileBytes, { label: "catalog planned generation" });
  const files = {};
  for (const type of Object.keys(FILE_NAMES)) {
    const bytes = fileBytes[type];
    const rawSha256 = sha256(bytes);
    const raw = parseRaw(type, bytes, "catalog planned generation");
    const logical = versionForRaw(type, raw, rawSha256);
    files[type] = { filename: FILE_NAMES[type], rawSha256, logicalSha256: logical.logicalSha256, version: logical.version, size: bytes.length, seed: provenance && provenance[type] || undefined };
  }
  return { schemaVersion: 1, generationId, sourceKind: "catalog-staging", published: false, label: "Catalog 工作区（未发布）", operationId: operationId || "seed", createdAt, files };
}

function buildingPathFor(generationId, operationId) {
  const operationSegment = String(operationId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!operationSegment || operationSegment.length > 80) throw typedError("catalog generation operation id is invalid", "CATALOG_GENERATION_INVALID", 500);
  return assertChild(CATALOG_STAGING_DIR, path.join(CATALOG_STAGING_DIR, `.building-${generationId}-${operationSegment}`));
}

function expectedGenerationFiles(fileBytes, manifest) {
  const expected = new Map(Object.keys(FILE_NAMES).map((type) => [FILE_NAMES[type], Buffer.from(fileBytes[type])]));
  expected.set("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
  return expected;
}

function durableTempBase(name, candidates) {
  if (!name.startsWith(".") || !name.endsWith(".tmp")) return null;
  return Array.from(candidates).find((candidate) => name.startsWith(`.${candidate}.`) && name.length > candidate.length + 6) || null;
}

function inspectBuildingDirectory(building, generationId, manifest, expected) {
  let stat;
  try { stat = fs.lstatSync(building); } catch (_) { return { exists: false, complete: false, owned: false }; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("catalog generation build target is unsafe", "CATALOG_GENERATION_COLLISION", 500);
  const ownerName = ".owner.json";
  const ownerBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, generationId, operationId: manifest.operationId })}\n`, "utf8");
  const expectedWithOwner = new Map(expected);
  expectedWithOwner.set(ownerName, ownerBytes);
  const allowed = new Set(expectedWithOwner.keys());
  const names = fs.readdirSync(building).sort(compareText);
  for (const name of names) {
    const tempBase = durableTempBase(name, allowed);
    if (!allowed.has(name) && !tempBase) throw typedError("catalog generation build contains an unexpected artifact", "CATALOG_GENERATION_COLLISION", 500);
    const candidate = path.join(building, name);
    const candidateStat = fs.lstatSync(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) throw typedError("catalog generation build contains an unsafe artifact", "CATALOG_GENERATION_COLLISION", 500);
    if (tempBase && !fs.readFileSync(candidate).equals(expectedWithOwner.get(tempBase))) throw typedError("catalog generation partial artifact does not match the signed plan", "CATALOG_GENERATION_COLLISION", 500);
  }
  let owned = names.some((name) => durableTempBase(name, new Set([ownerName])) === ownerName);
  if (names.includes(ownerName)) {
    let owner;
    try { owner = JSON.parse(fs.readFileSync(path.join(building, ownerName), "utf8")); } catch (_) { throw typedError("catalog generation build owner is malformed", "CATALOG_GENERATION_COLLISION", 500); }
    owned = owner && owner.schemaVersion === 1 && owner.generationId === generationId && owner.operationId === manifest.operationId;
    if (!owned) throw typedError("catalog generation build owner does not match the operation", "CATALOG_GENERATION_COLLISION", 500);
  }
  for (const [name, bytes] of expected) {
    if (!names.includes(name)) continue;
    if (!fs.readFileSync(path.join(building, name)).equals(bytes)) throw typedError("catalog generation build bytes do not match the signed plan", "CATALOG_GENERATION_COLLISION", 500);
  }
  const complete = Array.from(expected.keys()).every((name) => names.includes(name)) && !names.some((name) => durableTempBase(name, allowed));
  return { exists: true, complete, owned: owned || names.length === 0, names };
}

function removeRecoverableBuilding(building, inspection) {
  if (!inspection.owned) throw typedError("incomplete catalog generation build has no matching owner", "CATALOG_GENERATION_COLLISION", 500);
  for (const name of inspection.names || []) durableStore.unlinkDurable(CATALOG_STAGING_DIR, path.join(building, name));
  fs.rmdirSync(building);
  durableStore.fsyncDirectory(path.dirname(building));
}

function writeGenerationDirectory(generationId, fileBytes, manifest) {
  durableStore.ensureManagedDirectory(DATA_DIR, CATALOG_STAGING_DIR);
  durableStore.ensureManagedDirectory(DATA_DIR, GENERATIONS_DIR);
  const building = buildingPathFor(generationId, manifest.operationId);
  const finalDir = generationDir(generationId);
  if (fs.existsSync(finalDir)) throw typedError("catalog generation already exists", "CATALOG_GENERATION_COLLISION", 500);
  const expected = expectedGenerationFiles(fileBytes, manifest);
  const prior = inspectBuildingDirectory(building, generationId, manifest, expected);
  if (prior.exists && prior.complete) {
    if (prior.names.includes(".owner.json")) durableStore.unlinkDurable(CATALOG_STAGING_DIR, path.join(building, ".owner.json"));
    durableStore.renameDirectoryDurable(CATALOG_STAGING_DIR, building, finalDir);
    return { finalDir, manifestSha256: sha256(expected.get("manifest.json")) };
  }
  if (prior.exists) removeRecoverableBuilding(building, prior);
  try {
    fs.mkdirSync(building, { recursive: false });
    durableStore.fsyncDirectory(CATALOG_STAGING_DIR);
    durableStore.writeFileAtomic(CATALOG_STAGING_DIR, path.join(building, ".owner.json"), `${JSON.stringify({ schemaVersion: 1, generationId, operationId: manifest.operationId })}\n`, { replace: false, code: "CATALOG_GENERATION_WRITE_FAILED" });
    for (const type of Object.keys(FILE_NAMES)) durableStore.writeFileAtomic(CATALOG_STAGING_DIR, path.join(building, FILE_NAMES[type]), fileBytes[type], { replace: false, code: "CATALOG_GENERATION_WRITE_FAILED" });
    const manifestBytes = expected.get("manifest.json");
    durableStore.writeFileAtomic(CATALOG_STAGING_DIR, path.join(building, "manifest.json"), manifestBytes, { replace: false, code: "CATALOG_GENERATION_WRITE_FAILED" });
    for (const [type, record] of Object.entries(manifest.files)) if (sha256(fs.readFileSync(path.join(building, record.filename))) !== record.rawSha256) throw typedError("catalog generation verification failed", "CATALOG_GENERATION_VERIFY_FAILED", 500);
    durableStore.fsyncDirectory(building);
    durableStore.unlinkDurable(CATALOG_STAGING_DIR, path.join(building, ".owner.json"));
    durableStore.renameDirectoryDurable(CATALOG_STAGING_DIR, building, finalDir);
    return { finalDir, manifestSha256: sha256(manifestBytes) };
  } catch (error) {
    try {
      const failed = inspectBuildingDirectory(building, generationId, manifest, expected);
      if (failed.exists && failed.owned) removeRecoverableBuilding(building, failed);
    } catch (_) {}
    throw error;
  }
}

function writePointerAtomic(pointer, operationId) {
  try {
    durableStore.ensureManagedDirectory(DATA_DIR, CATALOG_STAGING_DIR);
    durableStore.writeFileAtomic(CATALOG_STAGING_DIR, CURRENT_GENERATION_PATH, `${JSON.stringify(pointer, null, 2)}\n`, {
      code: "CATALOG_POINTER_REPLACE_FAILED",
      verify: (temp) => JSON.parse(fs.readFileSync(temp, "utf8")),
    });
  } catch (error) {
    throw typedError(`catalog generation pointer replacement failed: ${error.message || error.code}`, "CATALOG_POINTER_REPLACE_FAILED", 500);
  }
}

function writeBootstrapJournal(journal) {
  assertManagedStagingRoots();
  durableStore.ensureManagedDirectory(DATA_DIR, CATALOG_STAGING_DIR);
  try {
    durableStore.writeFileAtomic(CATALOG_STAGING_DIR, BOOTSTRAP_JOURNAL_PATH, `${JSON.stringify(journal, null, 2)}\n`, { replace: false, code: "CATALOG_BOOTSTRAP_INVALID" });
  } catch (error) {
    if (error && error.code === "EEXIST") throw typedError("catalog bootstrap journal already exists", "CATALOG_BOOTSTRAP_INVALID", 500);
    throw error;
  }
}

function validateBootstrapJournalRecord(journal) {
  const valid = journal
    && journal.schemaVersion === 1
    && /^seed_[0-9a-f]{32}$/i.test(String(journal.operationId || ""))
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(journal.generationId || ""))
    && journal.manifest
    && journal.manifest.generationId === journal.generationId
    && journal.manifest.operationId === journal.operationId
    && journal.manifest.schemaVersion === 1
    && journal.manifest.files
    && typeof journal.manifest.files === "object"
    && journal.source
    && journal.source.sourceKind === "active-release"
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(String(journal.source.releaseVersion || ""))
    && /^[0-9a-f]{64}$/i.test(String(journal.source.canonicalHash || ""))
    && /^[0-9a-f]{64}$/i.test(String(journal.source.snapshotSha256 || ""))
    && /^[0-9a-f]{64}$/i.test(String(journal.source.manifestSha256 || ""))
    && /^[0-9a-f]{64}$/i.test(String(journal.source.activePointerSha256 || ""))
    && journal.sourceHashes
    && Object.keys(FILE_NAMES).every((type) => journal.manifest.files[type] && journal.sourceHashes[type] === journal.manifest.files[type].rawSha256);
  if (!valid) throw typedError("catalog bootstrap journal is invalid", "CATALOG_BOOTSTRAP_INVALID", 500);
  return journal;
}

function readBootstrapJournal() {
  let journal;
  try {
    assertManagedStagingRoots();
    assertNoSymlink(CATALOG_STAGING_DIR, BOOTSTRAP_JOURNAL_PATH);
    const stat = fs.lstatSync(BOOTSTRAP_JOURNAL_PATH);
    if (!stat.isFile() || stat.isSymbolicLink()) throw typedError("catalog bootstrap journal is unsafe", "CATALOG_TARGET_INVALID", 500);
    journal = JSON.parse(fs.readFileSync(BOOTSTRAP_JOURNAL_PATH, "utf8"));
  } catch (error) {
    if (error && error.code && String(error.code).startsWith("CATALOG_")) throw error;
    throw typedError("catalog bootstrap journal is missing or malformed", "CATALOG_BOOTSTRAP_INVALID", 500);
  }
  return validateBootstrapJournalRecord(journal);
}

function recoverBootstrapJournalTemp() {
  if (!fs.existsSync(CATALOG_STAGING_DIR)) return false;
  const candidates = fs.readdirSync(CATALOG_STAGING_DIR).filter((name) => /^\.bootstrap\.json\.[0-9a-f]{20}\.tmp$/i.test(name));
  if (candidates.length === 0) return false;
  if (candidates.length !== 1) throw typedError("catalog bootstrap has multiple journal candidates", "CATALOG_BOOTSTRAP_INVALID", 500);
  try {
    fs.lstatSync(BOOTSTRAP_JOURNAL_PATH);
    throw typedError("catalog bootstrap journal and temporary candidate both exist", "CATALOG_BOOTSTRAP_INVALID", 500);
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  const candidate = path.join(CATALOG_STAGING_DIR, candidates[0]);
  durableStore.assertManagedPath(CATALOG_STAGING_DIR, candidate, { kind: "file", code: "CATALOG_TARGET_INVALID" });
  const bytes = fs.readFileSync(candidate);
  const expectedDigest = candidates[0].slice(".bootstrap.json.".length, -".tmp".length).toLowerCase();
  if (sha256(bytes).slice(0, 20) !== expectedDigest) throw typedError("catalog bootstrap journal candidate is incomplete", "CATALOG_BOOTSTRAP_INVALID", 500);
  let journal;
  try { journal = JSON.parse(bytes.toString("utf8")); }
  catch (_) { throw typedError("catalog bootstrap journal candidate is malformed", "CATALOG_BOOTSTRAP_INVALID", 500); }
  validateBootstrapJournalRecord(journal);
  durableStore.fsyncFile(candidate);
  fs.renameSync(candidate, BOOTSTRAP_JOURNAL_PATH);
  durableStore.fsyncDirectory(CATALOG_STAGING_DIR);
  return true;
}

function inspectBootstrapBuilding(journal) {
  const building = buildingPathFor(journal.generationId, journal.operationId);
  if (!fs.existsSync(building)) return { building, exists: false, complete: false, owned: false, names: [] };
  const stat = fs.lstatSync(building);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw typedError("catalog bootstrap build target is unsafe", "CATALOG_BOOTSTRAP_INVALID", 500);
  const expectedNames = new Set([...Object.values(FILE_NAMES), "manifest.json", ".owner.json"]);
  const names = fs.readdirSync(building).sort(compareText);
  for (const name of names) {
    const tempBase = durableTempBase(name, expectedNames);
    if (!expectedNames.has(name) && !tempBase) throw typedError("catalog bootstrap build contains an unexpected artifact", "CATALOG_BOOTSTRAP_INVALID", 500);
    const candidate = path.join(building, name);
    const candidateStat = fs.lstatSync(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) throw typedError("catalog bootstrap build contains an unsafe artifact", "CATALOG_BOOTSTRAP_INVALID", 500);
    if (tempBase) {
      let expectedBytes;
      if (tempBase === ".owner.json") expectedBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, generationId: journal.generationId, operationId: journal.operationId })}\n`, "utf8");
      else if (tempBase === "manifest.json") expectedBytes = Buffer.from(`${JSON.stringify(journal.manifest, null, 2)}\n`, "utf8");
      else {
        const type = Object.keys(FILE_NAMES).find((entry) => FILE_NAMES[entry] === tempBase);
        expectedBytes = type ? null : undefined;
        if (type) {
          const record = journal.manifest.files[type];
          const actual = fs.readFileSync(candidate);
          if (actual.length !== record.size || sha256(actual) !== record.rawSha256) throw typedError("catalog bootstrap partial source mismatch", "CATALOG_BOOTSTRAP_INVALID", 500);
        }
      }
      if (expectedBytes && !fs.readFileSync(candidate).equals(expectedBytes)) throw typedError("catalog bootstrap partial artifact mismatch", "CATALOG_BOOTSTRAP_INVALID", 500);
    }
  }
  let owned = names.length === 0 || names.some((name) => durableTempBase(name, new Set([".owner.json"])) === ".owner.json");
  if (names.includes(".owner.json")) {
    let owner;
    try { owner = JSON.parse(fs.readFileSync(path.join(building, ".owner.json"), "utf8")); } catch (_) { throw typedError("catalog bootstrap build owner is malformed", "CATALOG_BOOTSTRAP_INVALID", 500); }
    owned = owner && owner.schemaVersion === 1 && owner.generationId === journal.generationId && owner.operationId === journal.operationId;
    if (!owned) throw typedError("catalog bootstrap build owner mismatch", "CATALOG_BOOTSTRAP_INVALID", 500);
  }
  for (const [type, filename] of Object.entries(FILE_NAMES)) {
    if (!names.includes(filename)) continue;
    const bytes = fs.readFileSync(path.join(building, filename));
    const record = journal.manifest.files[type];
    if (bytes.length !== record.size || sha256(bytes) !== record.rawSha256) throw typedError("catalog bootstrap build source mismatch", "CATALOG_BOOTSTRAP_INVALID", 500);
  }
  if (names.includes("manifest.json")) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(building, "manifest.json"), "utf8")); } catch (_) { throw typedError("catalog bootstrap build manifest is malformed", "CATALOG_BOOTSTRAP_INVALID", 500); }
    if (stableStringify(manifest) !== stableStringify(journal.manifest)) throw typedError("catalog bootstrap build manifest mismatch", "CATALOG_BOOTSTRAP_INVALID", 500);
  }
  const complete = [...Object.values(FILE_NAMES), "manifest.json"].every((name) => names.includes(name)) && !names.some((name) => durableTempBase(name, expectedNames));
  if (!complete && !owned) throw typedError("incomplete catalog bootstrap build has no owner", "CATALOG_BOOTSTRAP_INVALID", 500);
  return { building, exists: true, complete, owned, names };
}

function removeBootstrapBuilding(inspection) {
  if (!inspection.exists || !inspection.owned) throw typedError("catalog bootstrap build cannot be safely restarted", "CATALOG_BOOTSTRAP_INVALID", 500);
  for (const name of inspection.names) durableStore.unlinkDurable(CATALOG_STAGING_DIR, path.join(inspection.building, name));
  fs.rmdirSync(inspection.building);
  durableStore.fsyncDirectory(path.dirname(inspection.building));
}

function finishBootstrapPointer(journal, manifestSha256) {
  const expectedPointer = { schemaVersion: 1, generationId: journal.generationId, manifestSha256 };
  const prefix = `.current-${journal.operationId}-`;
  const pointerTemps = fs.readdirSync(CATALOG_STAGING_DIR).filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"));
  if (pointerTemps.length > 1) throw typedError("catalog bootstrap has multiple pointer candidates", "CATALOG_BOOTSTRAP_INVALID", 500);
  if (pointerTemps.length === 1) {
    const candidate = path.join(CATALOG_STAGING_DIR, pointerTemps[0]);
    const stat = fs.lstatSync(candidate);
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(candidate, "utf8")); } catch (_) { throw typedError("catalog bootstrap pointer candidate is malformed", "CATALOG_BOOTSTRAP_INVALID", 500); }
    if (!stat.isFile() || stat.isSymbolicLink() || stableStringify(parsed) !== stableStringify(expectedPointer)) throw typedError("catalog bootstrap pointer candidate is invalid", "CATALOG_BOOTSTRAP_INVALID", 500);
    fs.renameSync(candidate, CURRENT_GENERATION_PATH);
    durableStore.fsyncDirectory(CATALOG_STAGING_DIR);
  } else {
    writePointerAtomic(expectedPointer, journal.operationId);
  }
}

function startBootstrap(seedBundle) {
  const seed = seedBundle.bytes;
  const generationId = crypto.randomUUID();
  const operationId = `seed_${crypto.randomUUID().replace(/-/g, "")}`;
  const provenance = Object.fromEntries(Object.keys(seed).map((type) => [type, {
    sourceKind: "active-release",
    releaseVersion: seedBundle.source.releaseVersion,
    canonicalHash: seedBundle.source.canonicalHash,
    sourceFile: FILE_NAMES[type],
    derivedRawSha256: sha256(seed[type]),
    size: seed[type].length,
  }]));
  const manifest = buildManifest(generationId, seed, provenance, operationId);
  const journal = {
    schemaVersion: 1,
    operationId,
    generationId,
    source: seedBundle.source,
    sourceHashes: Object.fromEntries(Object.keys(seed).map((type) => [type, sha256(seed[type])])),
    manifest,
    createdAt: new Date().toISOString(),
  };
  writeBootstrapJournal(journal);
  return { journal, seed };
}

function publishInitialGeneration() {
  const bootstrapLock = path.join(DATA_DIR, ".admin-catalog-staging-bootstrap");
  const release = acquireExclusiveFileLocks([bootstrapLock], { codePrefix: "CATALOG", waitMs: Number(process.env.FOSU_CATALOG_LOCK_WAIT_MS || 1000), staleMs: Number(process.env.FOSU_CATALOG_LOCK_STALE_MS || 30000) });
  try {
    assertManagedStagingRoots();
    if (!fs.existsSync(BOOTSTRAP_JOURNAL_PATH)) recoverBootstrapJournalTemp();
    if (fs.existsSync(CURRENT_GENERATION_PATH)) {
      const pointer = readCurrentPointer();
      const generation = readGeneration(pointer.generationId);
      if (generation.manifestSha256 !== pointer.manifestSha256) throw typedError("catalog bootstrap pointer is invalid", "CATALOG_GENERATION_INVALID", 500);
      if (fs.existsSync(BOOTSTRAP_JOURNAL_PATH)) {
        const journal = readBootstrapJournal();
        if (journal.generationId !== generation.generationId || stableStringify(journal.manifest) !== stableStringify(generation.manifest)) throw typedError("catalog bootstrap journal does not match the published generation", "CATALOG_BOOTSTRAP_INVALID", 500);
        durableStore.unlinkDurable(CATALOG_STAGING_DIR, BOOTSTRAP_JOURNAL_PATH);
      }
      return generation;
    }
    let state;
    if (fs.existsSync(BOOTSTRAP_JOURNAL_PATH)) {
      const journal = readBootstrapJournal();
      state = { journal, seed: null };
    } else {
      if (fs.existsSync(CATALOG_STAGING_DIR)) {
        const names = fs.readdirSync(CATALOG_STAGING_DIR);
        const emptyGenerations = names.length === 1 && names[0] === "generations" && fs.existsSync(GENERATIONS_DIR) && fs.readdirSync(GENERATIONS_DIR).length === 0;
        if (names.length && !emptyGenerations) throw typedError("catalog staging exists without a bootstrap journal", "CATALOG_BOOTSTRAP_INVALID", 500);
      }
      state = startBootstrap(readStableActiveReleaseSeed());
    }
    const { journal } = state;
    const finalDir = generationDir(journal.generationId);
    let written;
    if (fs.existsSync(finalDir)) {
      const generation = readGeneration(journal.generationId);
      if (stableStringify(generation.manifest) !== stableStringify(journal.manifest)) throw typedError("catalog bootstrap final generation does not match its journal", "CATALOG_BOOTSTRAP_INVALID", 500);
      written = { manifestSha256: generation.manifestSha256 };
    } else {
      const partial = inspectBootstrapBuilding(journal);
      if (partial.complete) {
        if (partial.names.includes(".owner.json")) durableStore.unlinkDurable(CATALOG_STAGING_DIR, path.join(partial.building, ".owner.json"));
        durableStore.ensureManagedDirectory(DATA_DIR, GENERATIONS_DIR);
        durableStore.renameDirectoryDurable(CATALOG_STAGING_DIR, partial.building, finalDir);
        written = { manifestSha256: sha256(Buffer.from(`${JSON.stringify(journal.manifest, null, 2)}\n`, "utf8")) };
      } else {
        const seedBundle = state.seed ? { bytes: state.seed, source: journal.source } : readPinnedReleaseSeed(journal.source);
        const seed = seedBundle.bytes;
        const unchanged = Object.keys(FILE_NAMES).every((type) => sha256(seed[type]) === journal.sourceHashes[type]);
        if (!unchanged) throw typedError("journaled Catalog seed no longer matches its derived generation", "CATALOG_BOOTSTRAP_INVALID", 500);
        written = writeGenerationDirectory(journal.generationId, seed, journal.manifest);
      }
    }
    finishBootstrapPointer(journal, written.manifestSha256);
    durableStore.unlinkDurable(CATALOG_STAGING_DIR, BOOTSTRAP_JOURNAL_PATH);
    return readGeneration(journal.generationId);
  } finally { release(); }
}

function sourceIdentity(type, generation, raw) {
  const semesters = new Set();
  if (type === "major") semesters.add(stringValue(raw.semester));
  else for (const item of raw) if (item && item.semester) semesters.add(stringValue(item.semester));
  return { kind: "catalog-staging", published: false, label: "Catalog 工作区（未发布）", type, generationId: generation.generationId, semesters: Array.from(semesters).filter(Boolean).sort(compareText) };
}

function readSnapshot(type, generation = readCurrentGeneration()) {
  const normalizedType = requireType(type);
  const file = generation.files[normalizedType];
  return { ...file, generationId: generation.generationId, source: sourceIdentity(normalizedType, generation, file.raw) };
}

function readRelationshipSnapshot(generation = readCurrentGeneration()) {
  const file = generation.files.catalog;
  return { ...file, generationId: generation.generationId };
}

function readMeta() {
  try { const raw = JSON.parse(fs.readFileSync(META_PATH, "utf8")); return raw && raw.entries && typeof raw.entries === "object" ? raw.entries : raw || {}; } catch (_) { return {}; }
}

function metadataFor(meta, type, id, legacyName) { return meta[`${type}::${id}`] || meta[`${type}::${legacyName}`] || {}; }
function uniqueCount(courses, field) { return new Set((courses || []).map((course) => stringValue(course && course[field])).filter(Boolean)).size; }

function normalizeScheduleRow(type, item, meta) {
  const semester = stringValue(item.semester);
  if (!semester) throw typedError("every staged catalog row requires an explicit semester", "CATALOG_SOURCE_SEMESTER_REQUIRED", 500);
  const courses = Array.isArray(item.courses) ? item.courses : [];
  const base = { semester };
  let name;
  if (type === "class") {
    name = stringValue(item.className);
    Object.assign(base, { className: name, collegeCode: stringValue(item.collegeCode), collegeName: stringValue(item.collegeName, "其他"), grade: stringValue(item.grade), majorCode: stringValue(item.majorCode), majorName: stringValue(item.majorName, "通用"), coursesCount: courses.length });
  } else if (type === "teacher") {
    name = stringValue(item.teacherName);
    Object.assign(base, { teacherName: name, collegeName: stringValue(item.collegeName, "教务系统"), coursesCount: courses.length, classesCount: uniqueCount(courses, "className") });
  } else if (type === "classroom") {
    name = stringValue(item.roomName);
    const occupied = new Set();
    for (const course of courses) for (const week of Array.isArray(course.weeks) ? course.weeks : []) for (const section of Array.isArray(course.sections) ? course.sections : []) occupied.add(`${week}:${course.dayOfWeek || course.weekday || ""}:${section}`);
    const match = name.match(/^([^\d]+)/);
    Object.assign(base, { roomName: name, buildingName: stringValue(item.buildingName, match ? match[1] : "其他"), coursesCount: courses.length, occupationRate: Math.min(100, Math.round((occupied.size / 98) * 100)) });
  } else {
    name = stringValue(item.courseName);
    Object.assign(base, { courseName: name, collegeName: stringValue(item.collegeName, "教务公开课"), teachersCount: uniqueCount(courses, "teacherName"), classesCount: uniqueCount(courses, "className"), classroomsCount: uniqueCount(courses, "classroom") });
  }
  base.id = stableId(type, { ...item, ...base });
  const info = metadataFor(meta, type, base.id, name);
  return { id: base.id, ...base, displayName: stringValue(info.displayName), note: stringValue(info.note), hidden: info.hidden === true, tags: Array.isArray(info.tags) ? info.tags.map(String) : [] };
}

function flattenMajorEntries(raw) {
  const entries = [];
  const semester = stringValue(raw.semester);
  for (const college of raw.colleges || []) for (const grade of college.grades || []) for (const major of grade.majors || []) {
    const item = { semester, collegeCode: stringValue(college.collegeCode || college.code), collegeName: stringValue(college.collegeName || college.name), grade: stringValue(grade.grade), majorCode: stringValue(major.majorCode || major.code), majorName: stringValue(major.majorName || major.name) };
    entries.push({ id: stableId("major", item), item });
  }
  return entries;
}

function rowsFromRaw(type, raw) {
  const normalizedType = requireType(type);
  const meta = readMeta();
  const rows = normalizedType === "major" ? flattenMajorEntries(raw).map(({ id, item }) => {
    const info = metadataFor(meta, "major", id, item.majorCode);
    return { id, ...item, displayName: stringValue(info.displayName), note: stringValue(info.note), hidden: info.hidden === true, tags: Array.isArray(info.tags) ? info.tags.map(String) : [] };
  }) : raw.map((item) => normalizeScheduleRow(normalizedType, item || {}, meta));
  const seen = new Set();
  for (const row of rows) { if (seen.has(row.id)) throw typedError("catalog source contains duplicate stable ids", "CATALOG_SOURCE_DUPLICATE_ID", 500); seen.add(row.id); }
  return rows.sort((a, b) => compareText(a.id, b.id));
}

function rowsForType(type) {
  const generation = readCurrentGeneration();
  const snapshot = readSnapshot(type, generation);
  return { rows: rowsFromRaw(snapshot.type, snapshot.raw), snapshot, generation };
}

function entriesFromRaw(type, raw) {
  const normalizedType = requireType(type);
  return normalizedType === "major" ? flattenMajorEntries(raw).map(({ id, item }) => ({ id, item })) : raw.map((item) => ({ id: stableId(normalizedType, item), item }));
}

function getRelationships(generation = readCurrentGeneration()) {
  const dependency = readRelationshipSnapshot(generation);
  const major = readSnapshot("major", generation);
  const names = new Map((dependency.raw.colleges || []).map((college) => [stringValue(college.code || college.collegeCode), stringValue(college.name || college.collegeName)]));
  const colleges = (major.raw.colleges || []).map((college) => {
    const id = stringValue(college.collegeCode || college.code);
    return { id, name: names.get(id) || stringValue(college.collegeName || college.name), grades: (college.grades || []).map((grade) => ({ grade: stringValue(grade.grade), majors: (grade.majors || []).map((item) => ({ id: stringValue(item.majorCode || item.code), name: stringValue(item.majorName || item.name) })).sort((a, b) => compareText(a.id, b.id)) })).sort((a, b) => compareText(b.grade, a.grade)) };
  }).sort((a, b) => compareText(a.id, b.id));
  return { colleges, source: major.source, relationshipVersion: dependency.version, generationId: generation.generationId };
}

function validateMajorRelationships(document, dependency, baseSnapshot) {
  if (document.type !== "major") return dependency;
  const snapshot = dependency || readRelationshipSnapshot();
  const colleges = new Set((snapshot.raw.colleges || []).map((item) => stringValue(item.code || item.collegeCode)));
  const grades = new Set((snapshot.raw.grades || []).map(stringValue));
  const grandfathered = new Set(baseSnapshot && baseSnapshot.type === "major" ? entriesFromRaw("major", baseSnapshot.raw).map((entry) => entry.id) : []);
  const failures = [];
  document.items.forEach((item, index) => {
    const id = stableId("major", item);
    if ((!colleges.has(item.collegeCode) || !grades.has(item.grade)) && !grandfathered.has(id)) failures.push(index);
  });
  if (failures.length) throw typedError("major import contains orphan relationships", "ORPHAN_RELATIONSHIP", 400, { itemIndexes: failures });
  return snapshot;
}

function mergeSchedules(snapshot, document) {
  const existingTerms = new Set(snapshot.raw.map((item) => stringValue(item && item.semester)).filter(Boolean));
  if (existingTerms.size !== 1 || !existingTerms.has(document.semester)) throw typedError("schedule staging semester does not match the generation term", "SEMESTER_MISMATCH", 400);
  const byId = new Map(entriesFromRaw(document.type, snapshot.raw).map(({ id, item }) => [id, item]));
  for (const item of document.items) {
    const id = stableId(document.type, item);
    const previous = byId.get(id) || {};
    byId.set(id, { ...previous, ...item, courses: item.courses === undefined ? (previous.courses || []) : item.courses });
  }
  return Array.from(byId.entries()).sort(([a], [b]) => compareText(a, b)).map(([, item]) => item);
}

function mergeMajors(snapshot, document) {
  if (stringValue(snapshot.raw.semester) !== document.semester) throw typedError("major staging semester does not match import semester", "SEMESTER_MISMATCH", 400);
  const out = JSON.parse(JSON.stringify(snapshot.raw));
  for (const item of document.items) {
    let college = out.colleges.find((entry) => stringValue(entry.collegeCode || entry.code) === item.collegeCode);
    if (!college) { college = { collegeCode: item.collegeCode, collegeName: item.collegeName, grades: [] }; out.colleges.push(college); }
    let grade = (college.grades || []).find((entry) => stringValue(entry.grade) === item.grade);
    if (!grade) { grade = { grade: item.grade, majors: [] }; college.grades = (college.grades || []).concat(grade); }
    let major = (grade.majors || []).find((entry) => stringValue(entry.majorCode || entry.code) === item.majorCode);
    if (!major) grade.majors.push({ majorCode: item.majorCode, majorName: item.majorName });
    else { if ("majorCode" in major) major.majorCode = item.majorCode; else major.code = item.majorCode; if ("majorName" in major) major.majorName = item.majorName; else major.name = item.majorName; }
    grade.majors.sort((a, b) => compareText(a.majorCode || a.code, b.majorCode || b.code));
    college.grades.sort((a, b) => compareText(b.grade, a.grade));
  }
  out.colleges.sort((a, b) => compareText(a.collegeCode || a.code, b.collegeCode || b.code));
  out.grades = Array.from(new Set([...(Array.isArray(out.grades) ? out.grades.map(stringValue) : []), ...document.items.map((item) => stringValue(item.grade))])).filter(Boolean).sort((a, b) => compareText(b, a));
  out.version = `majors_${sha256(stableStringify(out.colleges)).slice(0, 20)}`;
  return out;
}

function mergeImport(snapshot, document) {
  if (!snapshot || snapshot.type !== document.type) throw typedError("catalog snapshot target mismatch", "CATALOG_TARGET_INVALID", 500);
  return document.type === "major" ? mergeMajors(snapshot, document) : mergeSchedules(snapshot, document);
}

function acquireMutationLocks(type, previewPath) {
  readCurrentGeneration();
  durableStore.ensureManagedDirectory(DATA_DIR, CATALOG_STAGING_DIR);
  durableStore.ensureManagedDirectory(DATA_DIR, LOCKS_DIR);
  const lockOptions = { codePrefix: "CATALOG", waitMs: Number(process.env.FOSU_CATALOG_LOCK_WAIT_MS || 1000), staleMs: Number(process.env.FOSU_CATALOG_LOCK_STALE_MS || 30000) };
  const releaseGeneration = acquireExclusiveFileLock(CURRENT_GENERATION_PATH, lockOptions);
  const paths = [path.join(LOCKS_DIR, `${requireType(type)}.target`)];
  if (previewPath) paths.push(previewPath);
  if (type === "major") paths.push(path.join(LOCKS_DIR, "catalog.relationship"));
  let releaseRest;
  try { releaseRest = acquireExclusiveFileLocks(paths, lockOptions); } catch (error) { try { releaseGeneration(); } catch (_) {} throw error; }
  return () => {
    let firstError = null;
    let warnings = [];
    try { const result = releaseRest(); if (result && result.warnings) warnings = warnings.concat(result.warnings); } catch (error) { firstError = error; }
    try { const result = releaseGeneration(); if (result && result.warning) warnings.push(result.warning); } catch (error) { if (!firstError) firstError = error; }
    if (firstError) throw firstError;
    return warnings.length ? { warnings } : undefined;
  };
}

function createBackup(snapshot, operationId, metadata = {}) {
  durableStore.ensureManagedDirectory(DATA_DIR, BACKUPS_DIR);
  const id = `catalog-import-${snapshot.type}-${operationId}`;
  const backupPath = path.join(BACKUPS_DIR, `${id}.json`);
  const manifestPath = path.join(BACKUPS_DIR, `${id}.manifest`);
  const manifest = {
    schemaVersion: 1,
    id,
    operationId,
    type: snapshot.type,
    target: FILE_NAMES[snapshot.type],
    sourceKind: "catalog-staging",
    generationId: snapshot.generationId,
    existed: true,
    preWriteSha256: snapshot.rawSha256,
    backupSha256: snapshot.rawSha256,
    size: snapshot.rawBytes.length,
    baseVersion: snapshot.version,
    resultSha256: metadata.resultSha256,
    resultVersion: metadata.resultVersion,
    createdAt: metadata.createdAt,
  };
  if (!Number.isFinite(Date.parse(String(manifest.createdAt || "")))) throw typedError("catalog backup timestamp is invalid", "CATALOG_BACKUP_FAILED", 500);
  const assertRegular = (filePath) => {
    durableStore.assertManagedPath(BACKUPS_DIR, filePath, { code: "CATALOG_TARGET_INVALID" });
    if (!fs.existsSync(filePath)) return false;
    let stat;
    try { stat = fs.lstatSync(filePath); } catch (_) { throw typedError("catalog backup artifact cannot be inspected", "CATALOG_BACKUP_FAILED", 500); }
    if (!stat.isFile() || stat.isSymbolicLink()) throw typedError("catalog backup artifact is unsafe", "CATALOG_BACKUP_FAILED", 500);
    return true;
  };
  try {
    if (assertRegular(backupPath)) {
      const existing = fs.readFileSync(backupPath);
      if (existing.length !== snapshot.rawBytes.length || sha256(existing) !== snapshot.rawSha256) throw typedError("catalog backup bytes do not match the immutable base", "CATALOG_BACKUP_VERIFY_FAILED", 500);
    } else {
      durableStore.writeFileAtomic(BACKUPS_DIR, backupPath, snapshot.rawBytes, { replace: false, code: "CATALOG_BACKUP_FAILED" });
    }
    if (assertRegular(manifestPath)) {
      let existingManifest;
      try { existingManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (_) { throw typedError("catalog backup manifest is malformed", "CATALOG_BACKUP_VERIFY_FAILED", 500); }
      if (stableStringify(existingManifest) !== stableStringify(manifest)) throw typedError("catalog backup manifest does not match the immutable operation", "CATALOG_BACKUP_VERIFY_FAILED", 500);
    } else {
      durableStore.writeFileAtomic(BACKUPS_DIR, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { replace: false, code: "CATALOG_BACKUP_FAILED" });
    }
  } catch (error) {
    if (error && error.code && String(error.code).startsWith("CATALOG_")) throw error;
    throw typedError("catalog backup could not be created", "CATALOG_BACKUP_FAILED", 500);
  }
  if (sha256(fs.readFileSync(backupPath)) !== snapshot.rawSha256
      || stableStringify(JSON.parse(fs.readFileSync(manifestPath, "utf8"))) !== stableStringify(manifest)) {
    throw typedError("catalog backup verification failed", "CATALOG_BACKUP_VERIFY_FAILED", 500);
  }
  return { id, path: backupPath, manifestPath, manifest };
}

function planGeneration(generation, type, raw, operationId, options = {}) {
  const normalizedType = requireType(type);
  const generationId = options.generationId || crypto.randomUUID();
  const createdAt = options.createdAt || new Date().toISOString();
  const bytes = Object.fromEntries(Object.keys(FILE_NAMES).map((key) => [key, generation.files[key].rawBytes]));
  bytes[normalizedType] = Buffer.from(`${JSON.stringify(raw, null, 2)}\n`, "utf8");
  parseRaw(normalizedType, bytes[normalizedType], "catalog planned replacement");
  const provenance = Object.fromEntries(Object.entries(generation.manifest.files).map(([key, value]) => [key, value.seed]));
  const manifest = buildManifest(generationId, bytes, provenance, operationId, createdAt);
  const resultRecord = manifest.files[normalizedType];
  return { generationId, createdAt, baseGenerationId: generation.generationId, type: normalizedType, bytes, manifest, result: { rawSha256: resultRecord.rawSha256, logicalSha256: resultRecord.logicalSha256, version: resultRecord.version } };
}

function commitPlannedGeneration(plan, operationId) {
  let written;
  const finalDir = generationDir(plan.generationId);
  if (fs.existsSync(finalDir)) {
    const existing = readGeneration(plan.generationId);
    if (stableStringify(existing.manifest) !== stableStringify(plan.manifest)) throw typedError("existing planned generation does not match operation journal", "CATALOG_GENERATION_COLLISION", 500);
    written = { finalDir, manifestSha256: existing.manifestSha256 };
  } else {
    written = writeGenerationDirectory(plan.generationId, plan.bytes, plan.manifest);
  }
  writePointerAtomic({ schemaVersion: 1, generationId: plan.generationId, manifestSha256: written.manifestSha256 }, operationId);
  return readGeneration(plan.generationId);
}

function currentGenerationId() {
  return readCurrentGeneration().generationId;
}

function targetPathForType(type) {
  const generation = readCurrentGeneration();
  return readSnapshot(type, generation).targetPath;
}

module.exports = {
  BACKUPS_DIR,
  BOOTSTRAP_JOURNAL_PATH,
  CATALOG_STAGING_DIR,
  CURRENT_GENERATION_PATH,
  DATA_DIR,
  FILE_NAMES,
  GENERATIONS_DIR,
  LEGACY_PATHS,
  META_PATH,
  RESOURCE_TYPES,
  STORAGE_DIR,
  acquireMutationLocks,
  commitPlannedGeneration,
  createBackup,
  currentGenerationId,
  entriesFromRaw,
  getRelationships,
  mergeImport,
  planGeneration,
  readCurrentGeneration,
  readGeneration,
  readRelationshipSnapshot,
  readSnapshot,
  rowsForType,
  rowsFromRaw,
  targetPathForType,
  validateMajorRelationships,
};
