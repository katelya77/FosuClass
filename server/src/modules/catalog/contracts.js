const crypto = require("crypto");

const CATALOG_TYPES = Object.freeze(["class", "teacher", "classroom", "course", "major"]);
const TYPE_SET = new Set(CATALOG_TYPES);
const SENSITIVE_KEY = /(?:password|passwd|secret|token|cookie|authorization|credential|session)/i;
const SENSITIVE_VALUE = /(?:(?:password|passwd|secret|token|cookie|authorization|credential|session|api[-_]?key|jsessionid|casticket)\s*[=:]\s*\S{4,}|(?:bearer|basic)\s+[a-z0-9._~+\/=:-]{8,})/i;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const COURSE_STRING_FIELDS = new Set([
  "adminClass", "audience", "audienceType", "canonicalClassroom", "canonicalCourseName", "canonicalTeacherName",
  "classId", "className", "classroom", "classroomName", "collegeCode", "collegeName", "color", "courseCode",
  "courseIdentityType", "courseName", "displayClassroom", "displayCourseName", "displayTeacherName", "grade", "id",
  "majorCode", "majorName", "nature", "normalizationReason", "note", "originalClassName", "rawClassText",
  "rawClassroom", "rawCourseName", "rawHtml", "rawTeacherName", "rawText", "remark", "roomName", "sectionText",
  "semester", "source", "sourceType", "teacherName", "teachingClass", "campus", "weekText", "weekType",
]);
const COURSE_MULTILINE_FIELDS = new Set(["rawHtml", "rawText"]);
const COURSE_STRING_ARRAY_FIELDS = new Set(["classNames", "teacherNames", "venueCandidates"]);
const COURSE_INTEGER_FIELDS = new Set(["dayOfWeek", "endSection", "endWeek", "startSection", "startWeek", "weekday"]);
const COURSE_INTEGER_ARRAY_FIELDS = new Set(["sections", "weeks"]);
const COURSE_BOOLEAN_FIELDS = new Set(["isPhysicalEducationLike", "isTeacherFieldActuallyCourseName", "isVenueCandidate", "sourceClassNameUnreliable"]);
const COURSE_NUMBER_FIELDS = new Set(["credit"]);
const COURSE_FIELDS = new Set([
  ...COURSE_STRING_FIELDS,
  ...COURSE_STRING_ARRAY_FIELDS,
  ...COURSE_INTEGER_FIELDS,
  ...COURSE_INTEGER_ARRAY_FIELDS,
  ...COURSE_BOOLEAN_FIELDS,
  ...COURSE_NUMBER_FIELDS,
]);

const TYPE_FIELDS = Object.freeze({
  class: new Set(["id", "className", "semester", "collegeCode", "collegeName", "grade", "majorCode", "majorName", "courses"]),
  teacher: new Set(["id", "teacherName", "semester", "collegeName", "courses"]),
  classroom: new Set(["id", "roomName", "semester", "buildingName", "courses"]),
  course: new Set(["id", "courseName", "semester", "collegeName", "courses"]),
  major: new Set(["id", "majorCode", "majorName", "collegeCode", "collegeName", "grade", "semester"]),
});

function typedError(message, code, statusCode = 400, details) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableValue(value[key]);
    return out;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex");
}

function requireType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!TYPE_SET.has(type)) throw typedError("catalog type must be class, teacher, classroom, course, or major", "INVALID_CATALOG_TYPE");
  return type;
}

function parseInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(String(value));
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw typedError("invalid catalog pagination", "INVALID_PAGINATION");
  }
  return number;
}

function normalizeListQuery(query = {}) {
  return {
    type: requireType(query.type),
    semester: String(query.semester || "").trim(),
    keyword: String(query.keyword || "").trim().toLowerCase(),
    page: parseInteger(query.page, 1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: parseInteger(query.pageSize, 30, 1, 100),
  };
}

function normalizeStringValue(value, field, options = {}) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw typedError(`${field} must be a string`, "INVALID_IMPORT_DOCUMENT");
  }
  const multiline = options.multiline === true;
  const normalized = String(value || "").normalize("NFC").replace(/\r\n?/g, "\n").trim();
  const invalidControl = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  const maximum = multiline ? 64 * 1024 : 4096;
  if (normalized.length > maximum || invalidControl.test(normalized)) throw typedError(`${field} contains invalid characters`, "INVALID_IMPORT_DOCUMENT");
  if (options.required && !normalized) throw typedError(`${field} is required`, "INVALID_IMPORT_DOCUMENT");
  return normalized;
}

function stringField(item, field, required = false) {
  return normalizeStringValue(item[field], field, { required });
}

function findSensitivePath(value, location = "document") {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitivePath(value[index], `${location}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "string" && SENSITIVE_VALUE.test(value)) return location;
  if (!isPlainObject(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) || FORBIDDEN_OBJECT_KEYS.has(key)) return `${location}.${key}`;
    const found = findSensitivePath(child, `${location}.${key}`);
    if (found) return found;
  }
  return null;
}

function stableId(type, item) {
  const semester = stringField(item, "semester", true);
  const component = (field, required = true) => {
    const value = stringField(item, field, required);
    if (value.includes(":")) throw typedError(`${field} cannot contain ':'`, "INVALID_IMPORT_DOCUMENT");
    return value;
  };
  if (semester.includes(":")) throw typedError("semester cannot contain ':'", "INVALID_IMPORT_DOCUMENT");
  if (type === "class") return `class:${semester}:${component("collegeCode", false)}:${component("grade")}:${component("majorCode", false)}:${component("className")}`;
  if (type === "teacher") return `teacher:${semester}:${component("teacherName")}`;
  if (type === "classroom") return `classroom:${semester}:${component("roomName")}`;
  if (type === "course") return `course:${semester}:${component("courseName")}`;
  return `major:${semester}:${component("collegeCode")}:${component("grade")}:${component("majorCode")}`;
}

function normalizeCourse(course, location, depth = 0) {
  if (!isPlainObject(course) || depth > 8) throw typedError(`${location} must be a bounded object`, "INVALID_IMPORT_DOCUMENT");
  const unknown = Object.keys(course).filter((key) => !COURSE_FIELDS.has(key) || FORBIDDEN_OBJECT_KEYS.has(key));
  if (unknown.length) throw typedError(`${location} contains unknown fields: ${unknown.join(", ")}`, "INVALID_IMPORT_DOCUMENT");
  const normalized = {};
  for (const [key, value] of Object.entries(course)) {
    if (COURSE_STRING_FIELDS.has(key)) {
      normalized[key] = normalizeStringValue(value, `${location}.${key}`, { multiline: COURSE_MULTILINE_FIELDS.has(key) });
    } else if (COURSE_STRING_ARRAY_FIELDS.has(key)) {
      if (!Array.isArray(value) || value.length > 500) throw typedError(`${location}.${key} must be a bounded string array`, "INVALID_IMPORT_DOCUMENT");
      normalized[key] = value.map((item, index) => normalizeStringValue(item, `${location}.${key}[${index}]`));
    } else if (COURSE_INTEGER_ARRAY_FIELDS.has(key)) {
      if (!Array.isArray(value) || value.length > 500 || value.some((item) => !Number.isInteger(item))) throw typedError(`${location}.${key} must be a bounded integer array`, "INVALID_IMPORT_DOCUMENT");
      normalized[key] = value.slice();
    } else if (COURSE_INTEGER_FIELDS.has(key)) {
      if (!Number.isInteger(value)) throw typedError(`${location}.${key} must be an integer`, "INVALID_IMPORT_DOCUMENT");
      normalized[key] = value;
    } else if (COURSE_NUMBER_FIELDS.has(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw typedError(`${location}.${key} must be a finite number`, "INVALID_IMPORT_DOCUMENT");
      normalized[key] = value;
    } else if (COURSE_BOOLEAN_FIELDS.has(key)) {
      if (typeof value !== "boolean") throw typedError(`${location}.${key} must be a boolean`, "INVALID_IMPORT_DOCUMENT");
      normalized[key] = value;
    }
  }
  return stableValue(normalized);
}

function normalizeImportItem(type, item, documentSemester, index) {
  if (!isPlainObject(item)) throw typedError(`items[${index}] must be an object`, "INVALID_IMPORT_DOCUMENT");
  const allowed = TYPE_FIELDS[type];
  const unknown = Object.keys(item).filter((key) => !allowed.has(key));
  if (unknown.length) throw typedError(`items[${index}] contains unknown fields: ${unknown.join(", ")}`, "INVALID_IMPORT_DOCUMENT", 400, { location: index, fields: unknown });
  if (item.courses !== undefined && !Array.isArray(item.courses)) throw typedError(`items[${index}].courses must be an array`, "INVALID_IMPORT_DOCUMENT");
  let courses;
  if (Array.isArray(item.courses)) {
    if (item.courses.length > 500) throw typedError(`items[${index}].courses is too large`, "INVALID_IMPORT_DOCUMENT");
    courses = item.courses.map((course, courseIndex) => normalizeCourse(course, `items[${index}].courses[${courseIndex}]`));
  }
  const out = {};
  for (const field of allowed) {
    if (field === "id" || field === "courses" || field === "semester" || item[field] === undefined) continue;
    out[field] = stringField(item, field);
  }
  const itemSemester = stringField(item, "semester");
  out.semester = itemSemester || documentSemester;
  if (courses !== undefined) out.courses = courses;
  if (documentSemester && itemSemester && itemSemester !== documentSemester) throw typedError(`items[${index}].semester does not match document semester`, "SEMESTER_MISMATCH");
  const id = stableId(type, out);
  if (item.id !== undefined && String(item.id) !== id) throw typedError(`items[${index}].id does not match its stable id`, "INVALID_IMPORT_DOCUMENT");
  return { id, item: stableValue(out) };
}

function normalizeImportDocument(input) {
  if (!isPlainObject(input)) throw typedError("catalog import document must be an object", "INVALID_IMPORT_DOCUMENT");
  const deletionKeys = Object.keys(input).filter((key) => /^(?:delete|deleted|replace|remove|mode)$/i.test(key));
  if (deletionKeys.length) throw typedError("catalog import is upsert-only", "DELETE_NOT_ALLOWED");
  const unknown = Object.keys(input).filter((key) => !["type", "semester", "items"].includes(key));
  if (unknown.length) throw typedError(`catalog import contains unknown fields: ${unknown.join(", ")}`, "INVALID_IMPORT_DOCUMENT");
  const sensitivePath = findSensitivePath(input);
  if (sensitivePath) throw typedError(`sensitive data is not allowed at ${sensitivePath}`, "SENSITIVE_DATA_REJECTED");
  const type = requireType(input.type);
  const semester = stringField(input, "semester", true);
  if (!Array.isArray(input.items) || input.items.length === 0) throw typedError("catalog import items must be a non-empty array", "INVALID_IMPORT_DOCUMENT");
  if (input.items.length > 1000 || Buffer.byteLength(stableStringify(input), "utf8") > 5 * 1024 * 1024) throw typedError("catalog import document is too large", "IMPORT_TOO_LARGE", 413);
  const normalized = input.items.map((item, index) => normalizeImportItem(type, item, semester, index));
  const seen = new Set();
  for (const entry of normalized) {
    if (seen.has(entry.id)) throw typedError(`duplicate catalog id: ${entry.id}`, "DUPLICATE_IMPORT_ID");
    seen.add(entry.id);
  }
  normalized.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return { type, semester, items: normalized.map((entry) => entry.item), ids: normalized.map((entry) => entry.id) };
}

module.exports = {
  CATALOG_TYPES,
  TYPE_FIELDS,
  COURSE_FIELDS,
  findSensitivePath,
  isPlainObject,
  normalizeImportDocument,
  normalizeCourse,
  normalizeListQuery,
  requireType,
  sha256,
  stableId,
  stableStringify,
  stableValue,
  typedError,
};
