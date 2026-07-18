const crypto = require("crypto");

const CATALOG_TYPES = Object.freeze(["class", "teacher", "classroom", "course", "major"]);
const TYPE_SET = new Set(CATALOG_TYPES);
const SENSITIVE_KEY = /(?:password|passwd|secret|token|cookie|authorization|credential|session)/i;
const SENSITIVE_VALUE = /(?:authorization\s*:\s*bearer|bearer\s+[a-z0-9._~+\/-]{12,}|(?:jsessionid|casticket|cookie)\s*[=:])/i;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const COURSE_FIELDS = new Set(["courseName", "displayCourseName", "canonicalCourseName", "courseCode", "teacherName", "teacherNames", "classroom", "classroomName", "roomName", "className", "classNames", "weekday", "dayOfWeek", "startSection", "endSection", "sections", "weeks", "note", "weekText", "sectionText", "collegeName", "majorName", "credit", "nature", "campus"]);

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

function stringField(item, field, required = false) {
  const value = item[field];
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw typedError(`${field} must be a string`, "INVALID_IMPORT_DOCUMENT");
  }
  const normalized = String(value || "").normalize("NFC").trim();
  if (normalized.length > 4096 || /[\u0000-\u001f\u007f]/.test(normalized)) throw typedError(`${field} contains invalid characters`, "INVALID_IMPORT_DOCUMENT");
  if (required && !normalized) throw typedError(`${field} is required`, "INVALID_IMPORT_DOCUMENT");
  return normalized;
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
  const component = (field) => {
    const value = stringField(item, field, true);
    if (value.includes(":")) throw typedError(`${field} cannot contain ':'`, "INVALID_IMPORT_DOCUMENT");
    return value;
  };
  if (semester.includes(":")) throw typedError("semester cannot contain ':'", "INVALID_IMPORT_DOCUMENT");
  if (type === "class") return `class:${semester}:${component("collegeCode")}:${component("grade")}:${component("majorCode")}:${component("className")}`;
  if (type === "teacher") return `teacher:${semester}:${component("teacherName")}`;
  if (type === "classroom") return `classroom:${semester}:${component("roomName")}`;
  if (type === "course") return `course:${semester}:${component("courseName")}`;
  return `major:${semester}:${component("collegeCode")}:${component("grade")}:${component("majorCode")}`;
}

function validateCourse(course, location, depth = 0) {
  if (!isPlainObject(course) || depth > 8) throw typedError(`${location} must be a bounded object`, "INVALID_IMPORT_DOCUMENT");
  const unknown = Object.keys(course).filter((key) => !COURSE_FIELDS.has(key) || FORBIDDEN_OBJECT_KEYS.has(key));
  if (unknown.length) throw typedError(`${location} contains unknown fields: ${unknown.join(", ")}`, "INVALID_IMPORT_DOCUMENT");
  for (const [key, value] of Object.entries(course)) {
    if (typeof value === "string") stringField({ [key]: value }, key);
    else if (Array.isArray(value)) {
      if (value.length > 500 || value.some((item) => item !== null && !["string", "number", "boolean"].includes(typeof item))) throw typedError(`${location}.${key} is too large or nested`, "INVALID_IMPORT_DOCUMENT");
    } else if (value !== null && !["number", "boolean"].includes(typeof value)) throw typedError(`${location}.${key} has an invalid value`, "INVALID_IMPORT_DOCUMENT");
  }
}

function normalizeImportItem(type, item, documentSemester, index) {
  if (!isPlainObject(item)) throw typedError(`items[${index}] must be an object`, "INVALID_IMPORT_DOCUMENT");
  const allowed = TYPE_FIELDS[type];
  const unknown = Object.keys(item).filter((key) => !allowed.has(key));
  if (unknown.length) throw typedError(`items[${index}] contains unknown fields: ${unknown.join(", ")}`, "INVALID_IMPORT_DOCUMENT", 400, { location: index, fields: unknown });
  if (item.courses !== undefined && !Array.isArray(item.courses)) throw typedError(`items[${index}].courses must be an array`, "INVALID_IMPORT_DOCUMENT");
  if (Array.isArray(item.courses)) {
    if (item.courses.length > 500) throw typedError(`items[${index}].courses is too large`, "INVALID_IMPORT_DOCUMENT");
    item.courses.forEach((course, courseIndex) => validateCourse(course, `items[${index}].courses[${courseIndex}]`));
  }
  const out = stableValue({ ...item, semester: stringField(item, "semester") || documentSemester });
  if (documentSemester && stringField(item, "semester") && stringField(item, "semester") !== documentSemester) throw typedError(`items[${index}].semester does not match document semester`, "SEMESTER_MISMATCH");
  const id = stableId(type, out);
  if (item.id !== undefined && String(item.id) !== id) throw typedError(`items[${index}].id does not match its stable id`, "INVALID_IMPORT_DOCUMENT");
  delete out.id;
  return { id, item: out };
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
  findSensitivePath,
  isPlainObject,
  normalizeImportDocument,
  normalizeListQuery,
  requireType,
  sha256,
  stableId,
  stableStringify,
  stableValue,
  typedError,
};
