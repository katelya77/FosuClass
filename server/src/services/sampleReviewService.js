"use strict";
const fs = require("fs");
const path = require("path");
const { assertPublicData } = require("../shared/fourDirectSourceContract");
const { stableStringify } = require("../utils/stagingFingerprint");

function fail(code, statusCode = 409) { throw Object.assign(new Error(code), { code, statusCode }); }
function reviewPath(runId) {
  if (!/^sc-[A-Za-z0-9-]+$/.test(runId || "")) fail("SAMPLE_REVIEW_REJECTED", 400);
  const storage = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
  return path.join(storage, "ops", "schedule-samples", "reviews", runId + ".json");
}
function safeRecord(run, uploadId, summary) {
  if (run.mode !== "sample" || summary.sampleOnly !== true || summary.publishable !== false || summary.coverageValid !== false || !/^[a-f0-9]{64}$/.test(summary.canonicalHash || "")) fail("SAMPLE_REVIEW_REJECTED");
  const record = {
    protocol: "collector-manual.v1", runId: run.id, uploadId,
    term: run.term, canonicalHash: summary.canonicalHash,
    sampleKind: run.samplePolicy.kind, samplePolicy: run.samplePolicy,
    requestBudget: run.samplePolicy.requestBudget,
    schoolRequestCount: summary.schoolRequestCount,
    directSourceSummary: summary.directSourceSummary,
    sampleOnly: true, publishable: false, coverageValid: false,
    stagingState: "sample-review", releaseState: "not-built", runtimeState: "inactive",
  };
  assertPublicData(record); return record;
}
function saveReview(run, uploadId, summary) {
  const record = safeRecord(run, uploadId, summary), file = reviewPath(run.id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    if (stableStringify(JSON.parse(fs.readFileSync(file, "utf8"))) !== stableStringify(record)) fail("SAMPLE_REVIEW_CONFLICT");
  } else fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return record;
}
function readReview(run) {
  const file = reviewPath(run.id);
  if (!fs.existsSync(file)) fail("SAMPLE_REVIEW_PENDING", 404);
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  if (stored.runId !== run.id || stored.uploadId !== run.uploadId) fail("SAMPLE_REVIEW_CONFLICT");
  const upload = require("./stagingUploadService").getUploadStatus(run.uploadId, { type: "full-sync", id: run.id });
  const expected = safeRecord(run, run.uploadId, upload.summary || {});
  if (stableStringify(stored) !== stableStringify(expected)) fail("SAMPLE_REVIEW_CONFLICT");
  return Object.assign({}, expected, { result: run.result || "SAMPLE_VALIDATED", ownershipConfirmed: true });
}
module.exports = { saveReview, readReview };
