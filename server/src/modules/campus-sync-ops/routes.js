const express = require("express");
const adminAuth = require("../../services/adminAuth");
const { verifyAdminWriteAccess, writeAuditLog } = require("../../services/adminWriteGuard");
const ops = require("../../services/campusSyncOpsService");
const policy = require("../../services/campusSyncPolicyService");
const quota = require("../../services/campusSyncQuotaStore");
const telemetry = require("../../services/campusSyncTelemetryService");
const control = require("../../services/campusSyncControl");
const perf = require("../../services/campusSyncAdminPerf");

const router = express.Router();

router.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.set("Cache-Control", "private, no-store");
  const send = res.json.bind(res);
  res.json = (body) => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const io = telemetry.lastIo();
    perf.record({
      route: String(req.path || "").replace(/^\/campus-sync\//, ""),
      durationMs,
      cacheHit: io.cacheHit === true,
      range: req.path.indexOf("timeseries") >= 0 ? String(req.query.range || "24h") : "",
      filesRead: req.path.indexOf("timeseries") >= 0 || req.path.indexOf("overview") >= 0 ? io.filesRead : 0,
    });
    res.set("Server-Timing", `campus-sync;dur=${Math.max(0, Math.round(durationMs))}`);
    return send(body);
  };
  next();
});

router.get("/campus-sync/snapshot", adminAuth.verifyAdminAccess, (req, res) => {
  res.json({ success: true, snapshot: ops.criticalSnapshot() });
});

router.get("/campus-sync/overview", adminAuth.verifyAdminAccess, (req, res) => {
  res.json({ success: true, overview: ops.overview() });
});

router.get("/campus-sync/timeseries", adminAuth.verifyAdminAccess, (req, res) => {
  const range = ["1h", "24h", "7d", "30d"].indexOf(String(req.query.range || "24h")) >= 0 ? String(req.query.range) : "24h";
  res.json({ success: true, range, points: telemetry.timeseries(range) });
});

router.get("/campus-sync/events", adminAuth.verifyAdminAccess, (req, res) => {
  res.json(Object.assign({ success: true }, telemetry.listRecent({
    limit: req.query.limit,
    cursor: req.query.cursor,
    status: req.query.status,
    errorCode: req.query.errorCode,
    from: req.query.from,
    to: req.query.to,
  })));
});

router.get("/campus-sync/security", adminAuth.verifyAdminAccess, (req, res) => {
  res.json({ success: true, security: ops.securitySummary() });
});

router.get("/campus-sync/policy", adminAuth.verifyAdminAccess, (req, res) => {
  const snapshot = policy.snapshot();
  res.json({ success: true, policy: snapshot, revision: snapshot.revision, usage: quota.usage() });
});

router.put("/campus-sync/policy", verifyAdminWriteAccess, (req, res) => {
  try {
    const identity = adminAuth.getAuditIdentity(req);
    const body = Object.assign({}, req.body || {});
    const expectedRevision = body.expectedRevision;
    delete body.expectedRevision;
    const changed = policy.update(body, identity.operator || "admin", expectedRevision);
    writeAuditLog(req, "campus-sync-policy-update", "campus-sync", "policy", JSON.stringify(changed));
    res.json({ success: true, policy: policy.snapshot(), message: "已保存 · 立即生效" });
  } catch (error) {
    const status = error && error.code === "CAMPUS_SYNC_POLICY_CONFLICT" ? 409 : 400;
    res.status(status).json({ success: false, code: error && error.code || "CAMPUS_SYNC_POLICY_REJECTED", message: error && error.publicMessage || "策略数值不在允许范围内。" });
  }
});

router.post("/campus-sync/policy/reset", verifyAdminWriteAccess, (req, res) => {
  const identity = adminAuth.getAuditIdentity(req);
  const changed = policy.reset(identity.operator || "admin");
  writeAuditLog(req, "campus-sync-policy-reset", "campus-sync", "policy", JSON.stringify(changed));
  res.json({ success: true, policy: policy.snapshot(), message: "已恢复默认值 · 立即生效" });
});

router.get("/campus-sync/config", adminAuth.verifyAdminAccess, (req, res) => {
  res.json({ success: true, config: ops.runtimeConfig() });
});

router.post("/campus-sync/actions/pause", verifyAdminWriteAccess, (req, res) => {
  const state = control.pause("admin");
  writeAuditLog(req, "campus-sync-pause", "campus-sync", "maintenance", "暂停新的个人课表同步");
  res.json({ success: true, maintenance: state });
});

router.post("/campus-sync/actions/resume", verifyAdminWriteAccess, (req, res) => {
  const state = control.resume();
  writeAuditLog(req, "campus-sync-resume", "campus-sync", "maintenance", "恢复个人课表同步");
  res.json({ success: true, maintenance: state });
});

router.post("/campus-sync/actions/diagnose", verifyAdminWriteAccess, (req, res) => {
  try {
    const report = ops.diagnose();
    writeAuditLog(req, "campus-sync-diagnose", "campus-sync", "diagnose", "轻量诊断");
    res.json({ success: true, report });
  } catch (error) {
    const status = error && error.code === "DIAGNOSE_COOLDOWN" ? 429 : 500;
    res.status(status).json({ success: false, code: error && error.code || "DIAGNOSE_FAILED", message: "诊断请稍后再试。" });
  }
});

module.exports = router;
