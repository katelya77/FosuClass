const express = require("express");
const adminAuth = require("../../services/adminAuth");
const { verifyAdminWriteAccess, writeAuditLog } = require("../../services/adminWriteGuard");
const collector = require("../../services/scheduleCollectorService");

const router = express.Router();

router.get("/schedule-collector/status", adminAuth.verifyAdminAccess, (req, res) => {
  res.json({ success: true, status: collector.snapshot() });
});

router.get("/schedule-collector/runs", adminAuth.verifyAdminAccess, (req, res) => {
  res.json({ success: true, runs: collector.snapshot().recent });
});
router.get("/schedule-collector/sample/readiness", adminAuth.verifyAdminAccess, (req, res) => {
  try { res.json(collector.sampleReadiness()); } catch (error) { res.status(error.statusCode || 503).json({ protocol: "collector-manual.v1", ready: false, code: error.code || "SAMPLE_API_UNAVAILABLE" }); }
});

function queue(req, res, mode) {
  try {
    const body = req.body || {};
    if (mode === "sample" && (Object.keys(body).some(key => !["term", "sampleKind", "requestBudget", "idempotencyKey"].includes(key)) || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,80}$/.test(body.idempotencyKey))) throw Object.assign(new Error("SAMPLE_REQUEST_REJECTED"), { code: "SAMPLE_REQUEST_REJECTED", statusCode: 400 });
    const identity = adminAuth.getAuditIdentity(req);
    const queued = collector.requestRun(mode, identity.operator || "admin", Date.now(), { term: body.term, runId: body.runId, sampleKind: body.sampleKind, requestBudget: body.requestBudget, idempotencyKey: body.idempotencyKey });
    writeAuditLog(req, "schedule-collector-" + mode, "schedule-collector", mode, queued.skipped ? "skipped" : "queued");
    res.json({ success: true, queued });
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, code: error && error.code || "COLLECTOR_REJECTED", message: "无法创建采集任务。" });
  }
}

router.post("/schedule-collector/actions/routine", verifyAdminWriteAccess, (req, res) => queue(req, res, "routine"));
router.post("/schedule-collector/actions/full", verifyAdminWriteAccess, (req, res) => queue(req, res, "full"));
router.post("/schedule-collector/actions/sample", verifyAdminWriteAccess, (req, res) => queue(req, res, "sample"));
router.post("/schedule-collector/actions/resume-run", verifyAdminWriteAccess, (req, res) => queue(req, res, "routine"));

router.post("/schedule-collector/actions/pause", verifyAdminWriteAccess, (req, res) => {
  writeAuditLog(req, "schedule-collector-pause", "schedule-collector", "pause", "暂停自动同步");
  res.json({ success: true, status: collector.setPaused(true) });
});

router.post("/schedule-collector/actions/resume", verifyAdminWriteAccess, (req, res) => {
  writeAuditLog(req, "schedule-collector-resume", "schedule-collector", "resume", "恢复自动同步");
  res.json({ success: true, status: collector.setPaused(false) });
});

router.post("/schedule-collector/actions/cancel", verifyAdminWriteAccess, (req, res) => {
  writeAuditLog(req, "schedule-collector-cancel", "schedule-collector", "cancel", "取消当前任务");
  res.json({ success: true, status: collector.cancelCurrent() });
});

module.exports = router;
