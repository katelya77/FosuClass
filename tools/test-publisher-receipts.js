const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const storageRoot = path.join(os.tmpdir(), `fosu-receipts-${process.pid}-${Date.now()}`);
process.env.FOSU_STORAGE_DIR = storageRoot;

const receiptService = require("../server/src/services/publisherReceiptService");

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
