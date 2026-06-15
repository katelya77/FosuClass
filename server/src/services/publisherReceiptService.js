const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const RECEIPT_DIR = path.join(STORAGE_DIR, "publisher-receipts");
const DEFAULT_COMPLETED_RETENTION_DAYS = 30;
const DEFAULT_FAILED_RETENTION_DAYS = 60;

const SENSITIVE_KEY_PATTERN = /(token|cookie|password|passwd|secret|api[-_]?key|authorization|openid|session)/i;
const ABSOLUTE_PATH_PATTERN = /[A-Za-z]:\\[^"'\s]+/g;

function ensureDir() {
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function safeRunId(value) {
  const text = String(value || "").trim();
  return (text || `receipt-${Date.now()}`).replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 120);
}

function shortHash(value) {
  const text = String(value || "");
  return text ? `${text.slice(0, 12)}${text.length > 12 ? "..." : ""}` : "";
}

function stripLocalPath(value) {
  return String(value || "")
    .replace(ABSOLUTE_PATH_PATTERN, "[local-path]")
    .replace(/\/Users\/[^"'\s]+/g, "[local-path]")
    .replace(/\/home\/[^"'\s]+/g, "[local-path]");
}

function sanitizeValue(value, key = "") {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    if (key === "canonicalHash" || key === "previousCanonicalHash") return shortHash(value);
    return "[redacted]";
  }
  if (typeof value === "string") {
    if (/Bearer\s+[A-Za-z0-9._~+/=-]+/i.test(value)) return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/i, "Bearer [redacted]");
    if (/JSESSIONID=/i.test(value)) return "[redacted-cookie]";
    return stripLocalPath(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, key));
  }
  if (typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((childKey) => {
      if (childKey === "events" || childKey === "logs" || childKey === "raw") return;
      out[childKey] = sanitizeValue(value[childKey], childKey);
    });
    return out;
  }
  return value;
}

function buildReceiptSummary(receipt) {
  const source = receipt || {};
  const diff = source.diffSummary || source.diff || {};
  const counts = source.counts || source.summary && source.summary.counts || {};
  return {
    schemaVersion: 1,
    runId: source.runId || "",
    mode: source.mode || source.originalMode || "",
    term: source.term || "",
    startedAt: source.startedAt || "",
    completedAt: source.completedAt || source.endedAt || source.updatedAt || nowIso(),
    crawlDurationMs: source.crawlDurationMs || source.duration && source.duration.crawlMs || null,
    networkRequestCount: source.networkRequestCount || source.actualNetworkRequestCount || source.meta && source.meta.actualNetworkRequestCount || null,
    canonicalHash12: shortHash(source.canonicalHash),
    previousCanonicalHash12: shortHash(source.previousCanonicalHash),
    counts,
    diffSummary: diff,
    oracleStatus: source.oracleStatus || "",
    cloudbaseStatus: source.cloudbaseStatus || "",
    dualSourceStatus: source.dualSourceStatus || source.liveSmoke && (source.liveSmoke.success ? "healthy" : "failed") || "",
    noChange: source.status === "no-change" || source.overallStatus === "no-change",
    partialSuccess: source.status === "partial-success" || source.overallStatus === "partial-success",
    errorCode: source.errorCode || source.error && source.error.code || "",
    warnings: Array.isArray(source.warnings) ? source.warnings.slice(0, 20) : [],
  };
}

function atomicWriteJson(filePath, payload) {
  ensureDir();
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_) {}
}

function saveReceipt(receipt) {
  ensureDir();
  const sanitized = sanitizeValue(receipt || {});
  const runId = safeRunId(sanitized.runId);
  const savedAt = nowIso();
  const payload = {
    schemaVersion: 1,
    savedAt,
    runId,
    receipt: sanitized,
    summary: buildReceiptSummary(sanitized),
  };
  const filePath = path.join(RECEIPT_DIR, `${runId}.json`);
  atomicWriteJson(filePath, payload);
  applyRetention();
  return { success: true, runId, receiptPath: filePath, savedAt, summary: payload.summary };
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function listReceipts(options = {}) {
  ensureDir();
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
  const files = fs.readdirSync(RECEIPT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(RECEIPT_DIR, entry.name);
      const stat = fs.statSync(filePath);
      const payload = readJsonIfExists(filePath);
      return {
        runId: payload && payload.runId || entry.name.replace(/\.json$/i, ""),
        filePath,
        updatedAt: payload && (payload.savedAt || payload.summary && payload.summary.completedAt) || new Date(stat.mtimeMs).toISOString(),
        summary: payload && payload.summary || null,
        receipt: payload && payload.receipt || null,
      };
    })
    .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
  return { receiptsDir: RECEIPT_DIR, records: files.slice(0, limit), total: files.length };
}

function getLatestReceipt() {
  const listed = listReceipts({ limit: 1 });
  return { receiptsDir: RECEIPT_DIR, run: listed.records[0] || null };
}

function isFailureRecord(item) {
  const summary = item && item.summary || {};
  return Boolean(summary.errorCode || summary.partialSuccess || summary.oracleStatus === "failed" || summary.cloudbaseStatus === "cloudbase-mirror-pending");
}

function applyRetention(options = {}) {
  ensureDir();
  const now = Date.now();
  const completedDays = Number(options.completedDays || DEFAULT_COMPLETED_RETENTION_DAYS);
  const failedDays = Number(options.failedDays || DEFAULT_FAILED_RETENTION_DAYS);
  const listed = listReceipts({ limit: 2000 }).records;
  let deleted = 0;
  listed.forEach((item) => {
    const ageMs = now - Date.parse(item.updatedAt || "");
    if (!Number.isFinite(ageMs) || ageMs < 0) return;
    const retentionDays = isFailureRecord(item) ? failedDays : completedDays;
    if (ageMs <= retentionDays * 24 * 60 * 60 * 1000) return;
    try {
      fs.unlinkSync(item.filePath);
      deleted += 1;
    } catch (_) {}
  });
  return { success: true, deleted, receiptsDir: RECEIPT_DIR };
}

module.exports = {
  RECEIPT_DIR,
  applyRetention,
  buildReceiptSummary,
  getLatestReceipt,
  listReceipts,
  sanitizeValue,
  saveReceipt,
};
