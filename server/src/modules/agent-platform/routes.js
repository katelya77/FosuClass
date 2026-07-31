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

router.get("/agent-platform/config/snapshot", adminAuth.verifyAdminAccess, requireConfigRead, handlers.getSnapshot);
router.get("/agent-platform/config/domains", adminAuth.verifyAdminAccess, requireConfigRead, handlers.getDomains);
router.get("/agent-platform/config/versions", adminAuth.verifyAdminAccess, requireConfigRead, handlers.getVersions);
router.get("/agent-platform/config/artifact", adminAuth.verifyAdminAccess, requireConfigRead, handlers.getArtifact);
router.get("/agent-platform/config/draft", adminAuth.verifyAdminAccess, requireConfigRead, handlers.getDraft);
router.get("/agent-platform/config/audit", adminAuth.verifyAdminAccess, requireAuditRead, handlers.getAudit);
router.get("/agent-platform/runs/:runId", adminAuth.verifyAdminAccess, requireConfigRead, handlers.getRunTrace);

// 写操作：verifyAdminWriteAccess 内含来源校验 + Cookie 会话 CSRF + scope 门禁
// （scope 映射见 security/adminRouteScopes.js），审计由 handlers 的 recordWrite 回调写入。
router.put("/agent-platform/config/draft", verifyAdminWriteAccess, handlers.putDraft);
router.post("/agent-platform/config/validate", verifyAdminWriteAccess, handlers.postValidate);
router.post("/agent-platform/config/test", verifyAdminWriteAccess, handlers.postTest);
router.post("/agent-platform/config/publish", verifyAdminWriteAccess, handlers.postPublish);
router.post("/agent-platform/config/rollback", verifyAdminWriteAccess, handlers.postRollback);

module.exports = router;
