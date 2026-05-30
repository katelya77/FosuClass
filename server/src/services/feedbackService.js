const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.join(__dirname, "../../storage");
const FEEDBACK_JSONL_PATH = path.join(STORAGE_DIR, "feedback.jsonl");
const FEEDBACK_JSON_PATH = path.join(STORAGE_DIR, "feedbacks.json");
const STATUS_VALUES = ["open", "processing", "resolved", "ignored"];

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
  fs.writeFileSync(FEEDBACK_JSON_PATH, JSON.stringify(sortFeedbackRecords(records), null, 2), "utf-8");
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

function sortFeedbackRecords(records) {
  return records
    .slice()
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function readAllFeedbackRecords() {
  const merged = new Map();

  readJsonlFile().forEach((record) => {
    if (record && record.id) {
      merged.set(record.id, Object.assign({ status: "open" }, record));
    }
  });

  readJsonArrayFile().forEach((record) => {
    if (!record || !record.id) {
      return;
    }
    const previous = merged.get(record.id) || {};
    merged.set(record.id, Object.assign({ status: "open" }, previous, record));
  });

  return sortFeedbackRecords(Array.from(merged.values()));
}

function createFeedback(payload, req) {
  const record = normalizeFeedback(payload, req);
  const records = readAllFeedbackRecords();
  records.push(record);
  appendJsonLine(record);
  writeJsonArrayFile(records);
  return record;
}

function parseLimit(limit) {
  const parsedLimit = parseInt(limit || "50", 10);
  return Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 500)
    : 50;
}

function getTextForSearch(record) {
  return [
    record.id,
    record.type,
    record.content,
    record.contact,
    record.page,
    record.semester,
    record.appVersion,
    record.dataVersion,
    record.platform,
    record.userAgent,
    record.selectedSchedule ? JSON.stringify(record.selectedSchedule) : "",
    record.selectedClass ? JSON.stringify(record.selectedClass) : "",
  ].join("\n").toLowerCase();
}

function filterFeedback(records, options = {}) {
  const status = toText(options.status, 40);
  const type = toText(options.type, 80);
  const keyword = toText(options.keyword, 200).toLowerCase();
  const days = parseInt(options.days || "", 10);
  const since = Number.isFinite(days) && days > 0
    ? Date.now() - days * 24 * 60 * 60 * 1000
    : 0;

  return records.filter((record) => {
    if (status && status !== "all" && record.status !== status) {
      return false;
    }
    if (type && type !== "all" && record.type !== type) {
      return false;
    }
    if (since) {
      const createdAt = new Date(record.createdAt).getTime();
      if (!Number.isFinite(createdAt) || createdAt < since) {
        return false;
      }
    }
    if (keyword && !getTextForSearch(record).includes(keyword)) {
      return false;
    }
    return true;
  });
}

function listFeedback(options) {
  const query = typeof options === "object" && options !== null ? options : { limit: options };
  return filterFeedback(readAllFeedbackRecords(), query).slice(0, parseLimit(query.limit));
}

function getFeedbackStats(records = readAllFeedbackRecords()) {
  const stats = {
    total: records.length,
    open: 0,
    processing: 0,
    resolved: 0,
    ignored: 0,
  };
  records.forEach((record) => {
    const status = STATUS_VALUES.includes(record.status) ? record.status : "open";
    stats[status] += 1;
  });
  return stats;
}

function getFeedbackTypes(records = readAllFeedbackRecords()) {
  return Array.from(new Set(records.map((record) => record.type).filter(Boolean))).sort((left, right) => {
    return String(left).localeCompare(String(right), "zh-CN", { numeric: true });
  });
}

function getFeedbackById(id) {
  const record = readAllFeedbackRecords().find((item) => item.id === id);
  if (!record) {
    const err = new Error("feedback not found");
    err.statusCode = 404;
    throw err;
  }
  return record;
}

function getFeedbackOverview() {
  const records = readAllFeedbackRecords();
  return {
    stats: getFeedbackStats(records),
    types: getFeedbackTypes(records),
  };
}

function validateStatus(status) {
  const nextStatus = toText(status, 40);
  if (!STATUS_VALUES.includes(nextStatus)) {
    const err = new Error("status must be open, processing, resolved, or ignored");
    err.statusCode = 400;
    throw err;
  }
  return nextStatus;
}

function escapeCsvValue(value) {
  const text = value === null || value === undefined
    ? ""
    : (typeof value === "object" ? JSON.stringify(value) : String(value));
  return `"${text.replace(/"/g, '""')}"`;
}

function exportFeedbackCsv(options = {}) {
  const records = filterFeedback(readAllFeedbackRecords(), options);
  const headers = [
    "id",
    "createdAt",
    "status",
    "type",
    "content",
    "contact",
    "semester",
    "appVersion",
    "dataVersion",
    "platform",
    "page",
    "selectedClass",
    "selectedSchedule",
    "userAgent",
  ];
  const rows = records.map((record) => headers.map((key) => escapeCsvValue(record[key])).join(","));
  return `\uFEFF${headers.join(",")}\n${rows.join("\n")}\n`;
}

function updateFeedbackStatus(id, status) {
  const nextStatus = validateStatus(status);
  if (!id) {
    const err = new Error("id and status are required");
    err.statusCode = 400;
    throw err;
  }

  const records = readAllFeedbackRecords();
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
  exportFeedbackCsv,
  getFeedbackById,
  getFeedbackOverview,
  getFeedbackStats,
  getFeedbackTypes,
  listFeedback,
  updateFeedbackStatus,
};
