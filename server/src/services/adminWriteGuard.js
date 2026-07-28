/**
 * 后台写访问中间件 + 审计日志写入。
 * 从 routes/admin.js 提取为共享件，供 admin.js 与 server/src/modules/* 下的
 * 管理路由共同使用（modules 路由不得反向 require admin.js）。
 */
const adminAuth = require("./adminAuth");
const adminAuditService = require("./adminAuditService");
const { recordSecurityEvent } = require("./securityEventService");
const { safeLog } = require("../utils/safeLogger");
const { getClientIpInfo } = require("../utils/clientIp");

/**
 * 审计日志写入（记录明确身份：会话 / 服务令牌名 / scope）
 */
function writeAuditLog(req, action, moduleName, target, summary) {
  try {
    const ipInfo = getClientIpInfo(req);
    const identity = adminAuth.getAuditIdentity(req);
    const logItem = {
      time: new Date().toISOString(),
      action,
      module: moduleName,
      target: target || "",
      operator: identity.operator || "admin",
      operatorName: identity.operator || "admin",
      tokenName: identity.tokenName || "",
      scopes: Array.isArray(identity.scopes) ? identity.scopes : [],
      sessionIdPrefix: identity.sessionIdPrefix || "",
      summary: summary || "",
      ip: ipInfo.anonymizedIp,
      authMethod: identity.authMethod || adminAuth.getAdminAuthMethod(req) || "unknown",
      legacyToken: Boolean(identity.legacy),
      requestId: req.headers["x-request-id"] || ""
    };
    adminAuditService.append(logItem);
  } catch (error) {
    safeLog("write-audit-log-failed", { error: error.message });
  }
}

function verifyAdminWriteAccess(req, res, next) {
  if (!adminAuth.isAdminConfiguredForCurrentEnv()) {
    safeLog("admin-write-auth-failed", { reason: "ADMIN_TOKEN or ADMIN_PASSWORD not configured" });
    return res.status(503).json({
      success: false,
      message: "生产环境未配置 ADMIN_TOKEN 或 ADMIN_PASSWORD，后台已关闭",
    });
  }

  const identity = adminAuth.resolveAdminIdentity(req);
  if (identity) {
    if (!["GET", "HEAD", "OPTIONS"].includes(String(req.method || "GET").toUpperCase()) && !adminAuth.isAdminOriginAllowed(req)) {
      safeLog("admin-write-origin-rejected", { origin: req.headers.origin || "", path: req.path });
      recordSecurityEvent("security-origin-rejected", {
        route: req.path,
        method: req.method,
        anonymizedIp: getClientIpInfo(req).anonymizedIp,
        reasonCode: "ADMIN_ORIGIN_REJECTED",
      });
      return res.status(403).json({
        success: false,
        code: "ADMIN_ORIGIN_REJECTED",
        message: "Admin request origin is not allowed.",
      });
    }
    if (!adminAuth.verifyAdminCsrf(req)) {
      recordSecurityEvent("security-csrf-rejected", {
        route: req.path,
        method: req.method,
        anonymizedIp: getClientIpInfo(req).anonymizedIp,
        reasonCode: "ADMIN_CSRF_REJECTED",
      });
      return res.status(403).json({
        success: false,
        code: "ADMIN_CSRF_REJECTED",
        message: "Admin CSRF token is invalid.",
      });
    }
    adminAuth.attachIdentity(req, identity);
    return adminAuth.enforceRouteScopes(req, res, next);
  }

  safeLog("admin-write-auth-failed", { reason: "missing cookie session or ADMIN_API_TOKEN" });
  return res.status(401).json({
    success: false,
    message: "请先登录后台或提供有效 ADMIN_API_TOKEN",
  });
}

module.exports = { verifyAdminWriteAccess, writeAuditLog };
