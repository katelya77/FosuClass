const express = require("express");
const adminAuth = require("../../services/adminAuth");
const { verifyAdminWriteAccess, writeAuditLog } = require("../../services/adminWriteGuard");
const collector = require("../../services/scheduleCollectorService");
const admin = require("../../services/scheduleCollectorAdminService");
const tokens = require("../../services/serviceTokenService");

const router = express.Router();
function guardedRead(handler) { return (req, res) => { try { return handler(req, res); } catch (error) { res.status(error.statusCode || 503).json({ success:false, code:/^[A-Z0-9_]{1,80}$/.test(error.code || "") ? error.code : "COLLECTOR_READ_FAILED", message:"采集证据暂不可用，请保留现场并检查记录。" }); } }; }
router.get("/schedule-collector/overview", adminAuth.verifyAdminAccess, guardedRead((req, res) => res.json({ success:true, overview:admin.overview(req.adminIdentity) })));
router.get("/schedule-collector/runs/:runId/review", adminAuth.verifyAdminAccess, adminAuth.requireScopes([tokens.SCOPES.COLLECTOR_REVIEW, tokens.SCOPES.ADMIN_FULL]), guardedRead((req, res) => res.json({ success:true, review:admin.review(req.params.runId) })));

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
    if (mode !== "sample" && (process.env.FOSU_COLLECTOR_SCOPE_APPROVED !== "1" || body.confirmation !== "RUN " + mode.toUpperCase())) throw Object.assign(new Error("SCHOOL_SCOPE_REVIEW_REQUIRED"), { code:"SCHOOL_SCOPE_REVIEW_REQUIRED", statusCode:403 });
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
router.post("/schedule-collector/actions/review", verifyAdminWriteAccess, (req, res) => {
  try {
    const identity=adminAuth.getAuditIdentity(req), run=collector.recordSampleReview(req.body || {}, identity.operator);
    writeAuditLog(req, "schedule-collector-sample-review", "schedule-collector", run.id, run.sampleHumanReview.decision);
    res.json({success:true, run});
  } catch (error) { res.status(error.statusCode || 400).json({success:false, code:error.code || "SAMPLE_HUMAN_REVIEW_REJECTED", message:"审核未保存；请核对样本指纹、权限与确认内容。"}); }
});
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
