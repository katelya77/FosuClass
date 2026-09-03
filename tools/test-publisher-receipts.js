const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const storageRoot = path.join(os.tmpdir(), `fosu-receipts-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = storageRoot;

const receiptService = require("../server/src/services/publisherReceiptService");
const { sanitizeReceiptForUpload } = require("./fosu-publisher/publish");

const compactUpload = sanitizeReceiptForUpload({
  runId: "large-receipt-test",
  success: true,
  mode: "routine",
  term: "2026-2027-1",
  canonicalHash: "abcdef1234567890",
  oracleStatus: "published",
  cloudbaseStatus: "mirrored",
  stageTimings: { crawling: { durationMs: 1234 } },
  performanceSummary: { totalKnownMs: 5678 },
  oracleVerification: { raw: "x".repeat(2 * 1024 * 1024) },
  liveSmoke: { success: true, raw: "y".repeat(2 * 1024 * 1024) },
  diffSummary: { raw: "z".repeat(2 * 1024 * 1024) },
  token: "must-not-upload",
});
const compactJson = JSON.stringify(compactUpload);
assert(compactJson.length < 64 * 1024, "publisher receipt upload should stay below the admin body limit");
assert.strictEqual(compactUpload.runId, "large-receipt-test");
assert.strictEqual(compactUpload.cloudbaseStatus, "mirrored");
assert.strictEqual(compactUpload.dualSourceStatus, "healthy");
assert.strictEqual(compactUpload.receiptTruncated, true, "oversized summaries should fall back to the minimal receipt contract");
assert(!Object.prototype.hasOwnProperty.call(compactUpload, "oracleVerification"), "full verification probes must remain local");
assert(!compactJson.includes("must-not-upload"), "publisher upload summary must not include secrets");

const saved = receiptService.saveReceipt({
  runId: "receipt-test",
  mode: "routine",
  term: "2025-2026-2",
  status: "partial-success",
  canonicalHash: "abcdef1234567890",
  previousCanonicalHash: "0123456789abcdef",
  oracleStatus: "published",
  cloudbaseStatus: "cloudbase-mirror-pending",
  liveSmoke: { success: false },
  counts: { classSchedules: 1200 },
  token: "secret-token-value",
  cookie: "JSESSIONID=secret",
  receiptPaths: {
    state: "C:\\Users\\Katelya\\Documents\\VScode\\FosuClass\\.local\\publisher-runs\\receipt-test\\state.json",
  },
  error: { code: "CLOUDBASE_PRECHECK_FAILED", message: "Bearer secret-token-value" },
});

assert.strictEqual(saved.success, true);
const latest = receiptService.getLatestReceipt();
assert(latest.run, "latest receipt should exist");
assert.strictEqual(latest.run.runId, "receipt-test");
assert.strictEqual(latest.run.summary.cloudbaseStatus, "cloudbase-mirror-pending");

const raw = fs.readFileSync(path.join(receiptService.RECEIPT_DIR, "receipt-test.json"), "utf8");
assert(!raw.includes("secret-token-value"), "receipt storage should redact token values");
assert(!raw.includes("JSESSIONID=secret"), "receipt storage should redact cookies");
assert(!raw.includes("C:\\Users\\Katelya"), "receipt storage should strip local absolute paths");
assert(raw.includes("[local-path]"), "receipt storage should preserve path context without user paths");

fs.rmSync(storageRoot, { recursive: true, force: true });
console.log("test-publisher-receipts passed");
