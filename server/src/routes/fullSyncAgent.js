const express = require("express");
const { verifySignedRequest } = require("../security/fullSyncSignature");
const collector = require("../services/scheduleCollectorService");
const uploads = require("../services/stagingUploadService");
const worker = require("../services/releaseWorkerManager");
const jobs = require("../services/jobService");

const router = express.Router();

function requireAgent(req, res, next) {
  const result = verifySignedRequest(req, Date.now());
  if (!result.ok) return res.status(result.status).end();
  req.fullSyncAgentId = result.agentId;
  return next();
}

router.post("/heartbeat", requireAgent, (req, res) => {
  res.json(collector.heartbeat(req.fullSyncAgentId, Date.now(), req.body || {}));
});

router.post("/runs/claim", requireAgent, (req, res) => {
  const run = collector.claim(req.fullSyncAgentId);
  if (!run) return res.status(204).end();
  return res.json({ run });
});

router.post("/runs/:runId/report", requireAgent, (req, res) => {
  try {
    res.json({ run: collector.applyReport(req.params.runId, req.body || {}, req.fullSyncAgentId) });
  } catch (error) {
    const status = error.statusCode || 400;
    res.status(status).end();
  }
});

function actor(run) { return { type: "full-sync", id: run.id }; }
function ownedRun(req) { return collector.requireRun(req.params.runId, req.fullSyncAgentId, req.params.claimId || req.body && req.body.claimId); }
function guarded(handler) {
  return (req, res) => { try { return handler(req, res); } catch (error) { return res.status(error.statusCode || 400).json({ success: false, code: error.code || "COLLECTOR_UPLOAD_REJECTED" }); } };
}
function uploadView(upload) {
  return { uploadId: upload.uploadId, status: upload.status, receivedChunks: Object.keys(upload.receivedChunks || {}).map(Number) };
}

router.post("/runs/:runId/upload/init", requireAgent, guarded((req, res) => {
  const run = ownedRun(req), body = req.body || {};
  if (collector.findSensitive(body).length) throw Object.assign(new Error("STAGING_SENSITIVE"), { code: "STAGING_SENSITIVE", statusCode: 400 });
  for (const key of ["canonicalHash", "uploadSha256", "originalSha256"]) if (!/^[a-f0-9]{64}$/.test(body[key] || "")) throw new Error("hash");
  if (body.term !== run.term || body.contentEncoding !== "gzip" || !Number.isSafeInteger(body.originalSize) || body.originalSize < 1 || body.originalSize > 512 * 1024 * 1024 || !Number.isSafeInteger(body.uploadSize) || body.uploadSize > 256 * 1024 * 1024 || !Number.isSafeInteger(body.chunkSize) || body.chunkSize < 1 || body.chunkSize > 8 * 1024 * 1024) throw new Error("size-or-term");
  if (run.uploadId) {
    const previous = uploads.getUploadStatus(run.uploadId, actor(run));
    if (["canonicalHash", "uploadSha256", "originalSha256", "originalSize", "uploadSize", "chunkSize", "totalChunks"].some((key) => previous[key] !== body[key])) throw Object.assign(new Error("UPLOAD_RESUME_MISMATCH"), { code: "UPLOAD_RESUME_MISMATCH", statusCode: 409 });
    return res.json({ upload: uploadView(previous) });
  }
  const input = {};
  for (const key of ["term", "canonicalHash", "uploadSha256", "originalSha256", "originalSize", "uploadSize", "chunkSize", "totalChunks"]) input[key] = body[key];
  const upload = uploads.initUpload(Object.assign(input, { fileName: "staging.json", source: "wyz-schedule-collector", contentEncoding: "gzip", contentType: "application/json" }), actor(run));
  collector.associateUpload(run, upload.uploadId);
  return res.json({ upload: uploadView(upload) });
}));

router.post("/runs/:runId/upload/:uploadId/chunks/:chunkIndex/:claimId", express.raw({ type: "application/octet-stream", limit: "8mb", verify(req, res, buf) { req.rawBody = buf; } }), requireAgent, guarded((req, res) => {
  const run = ownedRun(req);
  if (run.uploadId !== req.params.uploadId) throw new Error("ownership");
  const result = uploads.writeChunk(run.uploadId, req.params.chunkIndex, req.body, actor(run));
  res.json({ success: true, upload: uploadView(result) });
}));

router.post("/runs/:runId/upload/finalize", requireAgent, guarded((req, res) => {
  const run = ownedRun(req);
  if (req.body.uploadId !== run.uploadId) throw new Error("ownership");
  if (run.finalizeJobId) { const job = jobs.readJob(run.finalizeJobId); if (job && job.status !== "failed") return res.status(202).json({ job: { id: job.id, status: job.status } }); }
  const upload = uploads.getUploadStatus(run.uploadId, actor(run));
  const job = worker.startReleaseJob("staging-upload-finalize", { uploadId: run.uploadId, expected: { uploadSha256: upload.uploadSha256, originalSize: upload.originalSize, originalSha256: upload.originalSha256 }, actor: actor(run), collectorRun: { runId: run.id, term: run.term, claimId: req.body.claimId, agentId: req.fullSyncAgentId } });
  collector.associateJob(run, job.id);
  res.status(202).json({ job: { id: job.id, status: job.status } });
}));

router.get("/runs/:runId/upload/status/:claimId", requireAgent, guarded((req, res) => {
  const run = ownedRun(req), job = run.finalizeJobId && jobs.readJob(run.finalizeJobId);
  if (!job) return res.json({ status: "pending" });
  const result = job.result || {};
  res.json({ status: job.status, code: job.status === "failed" ? "STAGING_VALIDATION_FAILED" : undefined, result: job.status === "success" ? { uploadId: run.uploadId, unchanged: Boolean(result.unchanged), canonicalHash: result.canonicalHash || result.data && result.data.canonicalHash } : undefined });
}));

module.exports = router;
