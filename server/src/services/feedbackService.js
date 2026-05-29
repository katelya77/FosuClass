const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.join(__dirname, "../../storage");
const FEEDBACK_JSONL_PATH = path.join(STORAGE_DIR, "feedback.jsonl");
const FEEDBACK_JSON_PATH = path.join(STORAGE_DIR, "feedbacks.json");

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function makeId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `fb_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function toText(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!maxLength || text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength);
}

function normalizeFeedback(payload, req) {
  const source = payload || {};
  const content = toText(source.content, 3000);
  if (!content) {
    const err = new Error("feedback content is required");
    err.statusCode = 400;
    throw err;
  }

  return {
    id: makeId(),
    type: toText(source.type || "other", 50),
    content,
    contact: toText(source.contact, 200),
    page: toText(source.page, 200),
    selectedSchedule: source.selectedSchedule || null,
    selectedClass: source.selectedClass || null,
    semester: toText(source.semester, 80),
    appVersion: toText(source.appVersion, 40),
    dataVersion: toText(source.dataVersion, 120),
    platform: toText(source.platform || source.userAgent || req.get("user-agent"), 300),
    userAgent: toText(req.get("user-agent"), 300),
    createdAt: new Date().toISOString(),
    status: "open",
  };
}

function appendJsonLine(record) {
  ensureStorageDir();
  fs.appendFileSync(FEEDBACK_JSONL_PATH, `${JSON.stringify(record)}\n`, "utf-8");
}

function readJsonArrayFile() {
  if (!fs.existsSync(FEEDBACK_JSON_PATH)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(FEEDBACK_JSON_PATH, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

function writeJsonArrayFile(records) {
  ensureStorageDir();
  fs.writeFileSync(FEEDBACK_JSON_PATH, JSON.stringify(records, null, 2), "utf-8");
}

function readJsonlFile() {
  if (!fs.existsSync(FEEDBACK_JSONL_PATH)) {
    return [];
  }
  return fs.readFileSync(FEEDBACK_JSONL_PATH, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function createFeedback(payload, req) {
  const record = normalizeFeedback(payload, req);
  appendJsonLine(record);
  const records = readJsonArrayFile();
  records.push(record);
  writeJsonArrayFile(records);
  return record;
}

function listFeedback(limit) {
  const parsedLimit = parseInt(limit || "50", 10);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 200)
    : 50;
  const jsonRecords = readJsonArrayFile();
  const records = jsonRecords.length ? jsonRecords : readJsonlFile();
  return records
    .slice()
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, safeLimit);
}

function updateFeedbackStatus(id, status) {
  const nextStatus = toText(status, 40);
  if (!id || !nextStatus) {
    const err = new Error("id and status are required");
    err.statusCode = 400;
    throw err;
  }

  const records = readJsonArrayFile().length ? readJsonArrayFile() : readJsonlFile();
  const index = records.findIndex((item) => item.id === id);
  if (index < 0) {
    const err = new Error("feedback not found");
    err.statusCode = 404;
    throw err;
  }

  records[index] = Object.assign({}, records[index], {
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  });
  writeJsonArrayFile(records);
  return records[index];
}

module.exports = {
  createFeedback,
  listFeedback,
  updateFeedbackStatus,
};
