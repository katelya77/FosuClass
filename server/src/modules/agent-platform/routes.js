/**
 * Agent platform control plane (P4e): runtime-backed admin API for the six
 * config domains (draft/validate/test/publish/rollback/history/audit) plus
 * Run Trace inspection. Kept outside admin.js to respect the architecture
 * line-count ceiling; handlers live in apps/agent-admin (generic, injected).
 */
const express = require("express");
const adminAuth = require("../../services/adminAuth");
const { verifyAdminWriteAccess, writeAuditLog } = require("../../services/adminWriteGuard");
const { SCOPES } = require("../../services/serviceTokenService");
const platformComposition = require("../../services/ai/platformComposition");
const { createConfigPlaneHandlers } = require("../../../../apps/agent-admin");

const router = express.Router();

const handlers = createConfigPlaneHandlers({
  getConfigKernel: platformComposition.getConfigKernel,
  listRecentPlatformTraces: platformComposition.listRecentPlatformTraces,
  resolveActor(req) {
    const identity = adminAuth.getAuditIdentity(req);
    return identity && identity.operator || "admin";
  },
  recordWrite(entry, req) {
    writeAuditLog(req, entry.action, "agent-platform-config", entry.target, entry.summary);
  },
});

const requireConfigRead = adminAuth.requireScopes([SCOPES.AGENT_CONFIG_READ]);
const requireAuditRead = adminAuth.requireScopes([SCOPES.AGENT_CONFIG_AUDIT_READ]);

// P5a WS2：init 门。config-plane 全部路由在鉴权之后 await platformReady()；
// init 失败（postgres 迁移/连接或种子存储故障）→ 503 coded
// AGENT_PLATFORM_INIT_FAILED（消息泛化，不透内部细节）。file 模式 init 为
// 本地幂等种子，正常路径无感知。Fosu 业务路由不挂此门。
async function platformReadyGate(req, res, next) {
  try {
    await platformComposition.platformReady();
    return next();
  } catch (error) {
    return res.status(503).json({
      success: false,
      app: "@xiaofu-agent/agent-admin",
      code: "AGENT_PLATFORM_INIT_FAILED",
      message: "Agent platform initialization failed.",
      serverTime: new Date().toISOString(),
    });
  }
}

router.get("/agent-platform/config/snapshot", adminAuth.verifyAdminAccess, requireConfigRead, platformReadyGate, handlers.getSnapshot);
router.get("/agent-platform/config/domains", adminAuth.verifyAdminAccess, requireConfigRead, platformReadyGate, handlers.getDomains);
router.get("/agent-platform/config/versions", adminAuth.verifyAdminAccess, requireConfigRead, platformReadyGate, handlers.getVersions);
router.get("/agent-platform/config/artifact", adminAuth.verifyAdminAccess, requireConfigRead, platformReadyGate, handlers.getArtifact);
router.get("/agent-platform/config/draft", adminAuth.verifyAdminAccess, requireConfigRead, platformReadyGate, handlers.getDraft);
router.get("/agent-platform/config/audit", adminAuth.verifyAdminAccess, requireAuditRead, platformReadyGate, handlers.getAudit);
router.get("/agent-platform/runs/:runId", adminAuth.verifyAdminAccess, requireConfigRead, platformReadyGate, handlers.getRunTrace);

// 写操作：verifyAdminWriteAccess 内含来源校验 + Cookie 会话 CSRF + scope 门禁
// （scope 映射见 security/adminRouteScopes.js），审计由 handlers 的 recordWrite 回调写入。
router.put("/agent-platform/config/draft", verifyAdminWriteAccess, platformReadyGate, handlers.putDraft);
router.post("/agent-platform/config/validate", verifyAdminWriteAccess, platformReadyGate, handlers.postValidate);
router.post("/agent-platform/config/test", verifyAdminWriteAccess, platformReadyGate, handlers.postTest);
router.post("/agent-platform/config/publish", verifyAdminWriteAccess, platformReadyGate, handlers.postPublish);
router.post("/agent-platform/config/rollback", verifyAdminWriteAccess, platformReadyGate, handlers.postRollback);

module.exports = router;
