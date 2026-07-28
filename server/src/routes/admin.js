/**
 * 管理员同步 API 路由：接收本地同步工具上传的教务数据并持久化到 storage。
 */

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { promisify } = require("util");
const router = express.Router();

// Progressive domain modules (thin boundaries; no duplicated business logic)
try {
  router.use(require("../modules/audit/routes"));
  router.use(require("../modules/dashboard/routes"));
  router.use(require("../modules/ai-provider/routes"));
} catch (error) {
  // Domain modules must not prevent legacy admin routes from loading.
  console.warn("[admin] optional domain modules failed to load:", error.message);
}
const config = require("../config");
const { safeLog } = require("../utils/safeLogger");
const scheduleNormalizer = require("../utils/scheduleNormalizer");
const adminAuth = require("../services/adminAuth");
const appConfigService = require("../services/appConfigService");
const feedbackService = require("../services/feedbackService");
const adminCapabilitiesService = require("../services/adminCapabilitiesService");
const backupService = require("../services/backupService");
const adminAuditService = require("../services/adminAuditService");
const contentDomainService = require("../modules/content/service");
const settingsDomainService = require("../modules/settings/service");
const catalogDomainService = require("../modules/catalog/service");
const qualityDomainService = require("../modules/quality/service");
const jobService = require("../services/jobService");
const releaseService = require("../services/releaseService");
const termRegistryService = require("../services/termRegistryService");
const termReleaseIndexService = require("../services/termReleaseIndexService");
const termReadinessService = require("../services/termReadinessService");
const semesterActivationTransactionService = require("../services/semesterActivationTransactionService");
const semesterRepairService = require("../services/semesterRepairService");
const releaseWorkerManager = require("../services/releaseWorkerManager");
const relayService = require("../services/relayService");
const stagingUploadService = require("../services/stagingUploadService");
const stagingSafetyService = require("../services/stagingSafetyService");
const staticReleaseSyncService = require("../services/staticReleaseSyncService");
const releaseLifecycleService = require("../services/releaseLifecycleService");
const storageLifecycleService = require("../services/storageLifecycleService");
const publisherReceiptService = require("../services/publisherReceiptService");
const agentService = require("../services/ai/agentService");
const aiProviderConfigService = require("../services/ai/providerConfigService");
const providerChainService = require("../services/ai/providerChainService");
const evaluationService = require("../services/ai/evaluationService");
const knowledgeBaseService = require("../services/ai/knowledgeBaseService");
const { createKnowledgeControlPlane } = require("../services/ai/knowledgeControlPlane");
const agentProtocol = require("../services/ai/agentProtocol");
const knowledgeControlPlane = createKnowledgeControlPlane();
const campusMapService = require("../services/ai/campusMapService");
const campusMapVersionService = require("../services/ai/campusMapVersionService");
const campusMapAssetService = require("../services/campusMapAssetService");
const imageGenerationGateService = require("../services/ai/imageGenerationGateService");
const stagingFingerprint = require("../utils/stagingFingerprint");
const staticAccessTicket = require("../utils/staticAccessTicket");
const { getClientIpInfo } = require("../utils/clientIp");
const { getRateLimitStats } = require("../services/rateLimitService");
const { clearExpiredSecurityEvents, getSecurityEventSummary, recordSecurityEvent } = require("../services/securityEventService");
const { getSecurityStatus } = require("../services/securityModeService");
const { listRouteSecurityPolicies } = require("../security/routeSecurityPolicy");
const {
  buildResourceCountContract,
  flattenLegacyCounts,
} = require("../shared/resourceCountContract");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const zlib = require("zlib");
const gzipAsync = promisify(zlib.gzip);

function getDefaultTerm() {
  const active = termRegistryService.getActiveTerm();
  return active && active.term || termRegistryService.LEGACY_CURRENT_TERM_CONFIG.term;
}

function setJsonUtf8(res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

const SNAPSHOTS_DIR = path.join(STORAGE_DIR, "snapshots");
const HISTORY_DIR = path.join(SNAPSHOTS_DIR, "history");
const RESOURCE_UPLOAD_DIR = path.join(STORAGE_DIR, "resource-upload-staging");
const DIRECT_STAGING_UPLOAD_DIR = path.join(STORAGE_DIR, "staging-direct-upload");
const RAW_UPLOAD_BODY_LIMIT = process.env.FOSU_RAW_UPLOAD_BODY_LIMIT || "150mb";
const STAGING_CHUNK_BODY_LIMIT = process.env.FOSU_STAGING_CHUNK_BODY_LIMIT || "12mb";

const DATA_DIR = path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../data"));
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const CATALOG_META_PATH = path.join(STORAGE_DIR, "catalog-meta.json");
const SYNC_HISTORY_PATH = path.join(DATA_DIR, "sync-history.json");

// 确保目录存在
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}
if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}
if (!fs.existsSync(RESOURCE_UPLOAD_DIR)) {
  fs.mkdirSync(RESOURCE_UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(DIRECT_STAGING_UPLOAD_DIR)) {
  fs.mkdirSync(DIRECT_STAGING_UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

// Vue write-module gate (Legacy UI omits X-Fosu-Admin-Client and is not blocked)
router.use(adminCapabilitiesService.createWriteModuleGateMiddleware());
const requireCatalogWriteEnabled = adminCapabilitiesService.createRequiredWriteModuleMiddleware("catalog");

/**
 * GET /api/admin/capabilities — primary flag + write module switches
 */
router.get("/capabilities", (req, res) => {
  return res.json(adminCapabilitiesService.getCapabilities());
});

/**
 * 自动备份机制
 */
function createBackup(type, sourceFile, fallbackData) {
  try {
    const now = new Date();
    const pad = (num) => String(num).padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const backupName = `${type}-${timestamp}-${crypto.randomBytes(8).toString("hex")}.json`;
    const destPath = path.join(BACKUPS_DIR, backupName);
    if (fs.existsSync(sourceFile)) {
      fs.copyFileSync(sourceFile, destPath);
    } else if (fallbackData !== undefined) {
      fs.writeFileSync(destPath, JSON.stringify(fallbackData, null, 2), "utf8");
    } else {
      return null;
    }
    
    // 保留最近 30 个备份文件
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith(`${type}-`) && f.endsWith(".json"))
      .map(f => ({ name: f, path: path.join(BACKUPS_DIR, f), time: fs.statSync(path.join(BACKUPS_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);
      
    if (files.length > 30) {
      files.slice(30).forEach(f => {
        try { fs.unlinkSync(f.path); } catch (e) {}
      });
    }
    return destPath;
  } catch (error) {
    safeLog("create-backup-failed", { type, error: error.message });
    throw error;
  }
}

function commitWithBackup({ type, sourceFile, fallbackData, commit }) {
  const backupPath = createBackup(type, sourceFile, fallbackData);
  try {
    return commit();
  } catch (error) {
    const conflict = error && error.code === "CONFLICT";
    if (conflict && backupPath && fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
      } catch (cleanupError) {
        cleanupError.code = "BACKUP_ROLLBACK_FAILED";
        cleanupError.statusCode = 500;
        cleanupError.conflict = error;
        throw cleanupError;
      }
    }
    throw error;
  }
}

// 写访问中间件与审计日志写入已提取为共享件（供本文件与 modules/* 管理路由共用）。
const { verifyAdminWriteAccess, writeAuditLog } = require("../services/adminWriteGuard");

function catalogAuditContext(req) {
  const identity = adminAuth.getAuditIdentity(req);
  return {
    operator: identity.operator || "admin",
    tokenName: identity.tokenName || "",
    scopes: Array.isArray(identity.scopes) ? identity.scopes : [],
    sessionIdPrefix: identity.sessionIdPrefix || "",
    authMethod: identity.authMethod || adminAuth.getAdminAuthMethod(req) || "unknown",
    requestId: req.headers["x-request-id"] || "",
    ip: getClientIpInfo(req).anonymizedIp,
  };
}

// 缓存文件路径映射
const FILE_MAP = {
  catalog: path.join(STORAGE_DIR, "catalog.json"),
  majors: path.join(STORAGE_DIR, "majors.json"),
  "class-schedules": path.join(STORAGE_DIR, "class-schedules.json"),
  "teacher-schedules": path.join(STORAGE_DIR, "teacher-schedules.json"),
  "classroom-schedules": path.join(STORAGE_DIR, "classroom-schedules.json"),
  "course-schedules": path.join(STORAGE_DIR, "course-schedules.json"),
  "sync-meta": path.join(STORAGE_DIR, "sync-meta.json"),
  contributions: path.join(STORAGE_DIR, "contributions.json"),
};

const RESOURCE_FILE_BY_TYPE = {
  teacher: "teacher-schedules",
  classroom: "classroom-schedules",
  course: "course-schedules",
};

const RESOURCE_NAME_KEY_BY_TYPE = {
  teacher: "teacherName",
  classroom: "roomName",
  course: "courseName",
};

const serviceTokenService = require("../services/serviceTokenService");

/**
 * 校验管理员 / 服务 Token（支持 scoped service tokens）
 */
function verifyAdminToken(req, res, next) {
  const authHeader = String(req.headers.authorization || "");
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = req.headers["x-admin-token"] || (bearerMatch ? bearerMatch[1] : "");
  const identity = serviceTokenService.resolveServiceToken(token);

  if (!identity) {
    if (!config.ADMIN_API_TOKEN && !config.ADMIN_TOKEN && !(process.env.ADMIN_SERVICE_TOKENS || "").trim()) {
      safeLog("admin-sync-auth-failed", { reason: "no service tokens configured on server" });
      return res.status(401).json({
        success: false,
        message: "服务器未配置 ADMIN_API_TOKEN，拒绝写入请求",
      });
    }
    safeLog("admin-sync-auth-failed", { reason: "Invalid or missing token" });
    return res.status(401).json({
      success: false,
      message: "管理员令牌无效",
    });
  }

  adminAuth.attachIdentity(req, {
    ...identity,
    authMethod: identity.kind === "static-admin-token" ? "admin-token" : "service-token",
  });
  return next();
}

/** Scope-aware middleware factory (admin:full always passes). */
function requireAdminScopes(...scopes) {
  return [verifyAdminWriteAccess, adminAuth.requireScopes(scopes)];
}

router.post("/login", adminAuth.adminLoginLimiter, (req, res) => {
  if (!adminAuth.isAdminConfiguredForCurrentEnv()) {
    return res.status(503).json({
      success: false,
      message: "生产环境未配置 ADMIN_TOKEN 或 ADMIN_PASSWORD，后台已关闭",
    });
  }

  const credential = (req.body && (req.body.password || req.body.token)) || "";
  if (!adminAuth.isLoginCredentialValid(credential)) {
    recordSecurityEvent("security-admin-login-failed", {
      route: req.path,
      method: req.method,
      anonymizedIp: getClientIpInfo(req).anonymizedIp,
      reasonCode: "INVALID_CREDENTIAL",
    });
    safeLog("admin-login-failed", { reason: "invalid credential", ip: getClientIpInfo(req).anonymizedIp });
    return res.status(401).json({
      success: false,
      message: "后台密码或令牌不正确",
    });
  }

  const sessionToken = adminAuth.createSessionToken();
  adminAuth.setSessionCookie(res, sessionToken);
  return res.json({
    success: true,
    message: "登录成功",
    csrfToken: adminAuth.createCsrfToken(sessionToken),
    expiresIn: 12 * 60 * 60,
  });
});

router.post("/logout", (req, res) => {
  adminAuth.clearSessionCookie(res);
  return res.json({
    success: true,
    message: "已退出后台",
  });
});

router.get("/session", (req, res) => {
  const cookieToken = adminAuth.getAdminCookieToken(req);
  return res.json({
    success: true,
    authenticated: adminAuth.isAdminRequest(req),
    configured: adminAuth.isAdminConfiguredForCurrentEnv(),
    authMethod: adminAuth.getAdminAuthMethod(req),
    csrfToken: cookieToken ? adminAuth.createCsrfToken(cookieToken) : "",
  });
});

const NON_CLIENT_BOOTSTRAP_FAILURE_REASONS = new Set([
  "WX_CODE_REQUIRED",
  "INVALID_JSON_BODY",
  "INVALID_JSON_SCHEMA",
]);

function getEventReasonCount(events, eventName, reasonCode) {
  const byEvent = events && events.eventReasonCounts && events.eventReasonCounts[eventName] || {};
  return Number(byEvent[reasonCode] || 0) || 0;
}

function buildSecurityReadiness(security, events, rateLimit) {
  const counts = events.counts || {};
  const clientCheck = events.clientCheck || {};
  const bootstrapSuccess = counts["security-session-bootstrap-success"] || 0;
  const bootstrapFailed = counts["security-session-bootstrap-failed"] || 0;
  const ignoredBootstrapFailed = Array.from(NON_CLIENT_BOOTSTRAP_FAILURE_REASONS)
    .reduce((sum, reason) => sum + getEventReasonCount(events, "security-session-bootstrap-failed", reason), 0);
  const clientBootstrapFailed = Math.max(0, bootstrapFailed - ignoredBootstrapFailed);
  const invalidSession = counts["security-session-invalid"] || 0;
  const totalSessionSignals = bootstrapSuccess + bootstrapFailed + invalidSession;
  const bootstrapSuccessRate = bootstrapSuccess + clientBootstrapFailed > 0
    ? bootstrapSuccess / (bootstrapSuccess + clientBootstrapFailed)
    : 0;
  const hasRecentClientCheck = Boolean(clientCheck.latest && clientCheck.latest.clientBuildId);
  const blocking = [];
  const warnings = [];

  if (!security.sessionSecretConfigured) blocking.push("Session Secret 未配置");
  if (!security.wechatAppidConfigured || !security.wechatSecretConfigured) blocking.push("微信 AppID/AppSecret 未完整配置");
  if (!hasRecentClientCheck) warnings.push("尚未收到客户端端到端 client-check");
  if (bootstrapSuccess + clientBootstrapFailed > 0 && bootstrapSuccessRate < 0.95) warnings.push("最近 Session Bootstrap 成功率低于 95%");
  if (totalSessionSignals > 0 && invalidSession / totalSessionSignals > 0.05) warnings.push("缺失或无效 Session 比例偏高");
  if ((rateLimit && rateLimit.keyCount || 0) >= (rateLimit && rateLimit.maxKeys || Number.MAX_SAFE_INTEGER)) warnings.push("限速状态键接近上限");
  if (security.warnings && security.warnings.length) warnings.push(...security.warnings);

  return {
    canEnterSessionEnforce: blocking.length === 0 && warnings.length === 0 && hasRecentClientCheck,
    recommendedMode: blocking.length === 0 && hasRecentClientCheck ? "session-enforce-ready" : "observe",
    blocking,
    warnings,
    bootstrapSuccessRate,
    bootstrapClientFailureCount: clientBootstrapFailed,
    bootstrapIgnoredFailureCount: ignoredBootstrapFailed,
    sessionHeaderAttachedRate: hasRecentClientCheck ? 1 : 0,
  };
}

function buildStaticReleaseSecurity(security) {
  const openRestyMode = String(security.openRestySecurityMode || "public").toLowerCase();
  return {
    dynamicApiSecurityLevel: security.requireDynamicSession ? "session-enforced" : "observe",
    staticReleaseSecurityLevel: security.requireStaticTicket ? "ticket-enforced" : (security.staticAccessMode || "public"),
    applicationTicketReady: Boolean(security.staticTicketSecretConfigured),
    openRestyTicketReady: openRestyMode === "ticket",
    cloudflareEdgeProtection: process.env.FOSU_CLOUDFLARE_EDGE_STATIC_SECURITY || "unknown",
    anonymousStaticAccessExpected: !security.requireStaticTicket,
    honestDescription: security.requireStaticTicket
      ? "静态 Release 只有在应用层、OpenResty/边缘均执行 Ticket 校验时才算真正强制保护。"
      : "当前静态 Release 仍按公开缓存处理，CORS/Referer 不构成真正防盗链。"
  };
}

function buildSecurityStatusPayload() {
  const security = getSecurityStatus();
  const events = getSecurityEventSummary();
  const rateLimit = getRateLimitStats();
  const activeRelease = releaseService.getActiveReleaseInfo() || {};
  const readiness = buildSecurityReadiness(security, events, rateLimit);
  return {
    success: true,
    security: Object.assign({}, security, {
      deploymentCommitSha: process.env.FOSU_DEPLOY_COMMIT_SHA || process.env.GITHUB_SHA || "",
      activeReleaseVersion: activeRelease.releaseVersion || activeRelease.version || "",
      clientBuildId: events.clientCheck && events.clientCheck.latest && events.clientCheck.latest.clientBuildId || process.env.FOSU_CLIENT_BUILD_ID || "",
    }),
    rateLimit,
    events,
    readiness,
    staticReleaseSecurity: buildStaticReleaseSecurity(security),
    deployment: {
      commitSha: process.env.FOSU_DEPLOY_COMMIT_SHA || process.env.GITHUB_SHA || "",
      activeReleaseVersion: activeRelease.releaseVersion || activeRelease.version || "",
      activeTerm: activeRelease.term || activeRelease.semester || "",
    },
    routePolicies: listRouteSecurityPolicies(),
  };
}

router.get("/security/status", adminAuth.verifyAdminAccess, (req, res) => {
  return res.json(buildSecurityStatusPayload());
});

function makeSecurityCheck(id, title, status, message) {
  return { id, title, status, ok: status !== "block", message };
}

function runSecurityChecks(basePayload) {
  const security = basePayload.security || {};
  const events = basePayload.events || {};
  const checks = [];
  checks.push(makeSecurityCheck(
    "configuration",
    "配置完整性",
    security.configurationValid === false ? "block" : "pass",
    security.configurationValid === false ? "当前模式存在阻断配置项。" : "当前模式配置满足启动要求。"
  ));
  checks.push(makeSecurityCheck(
    "secret-kid",
    "Secret KID 一致性",
    security.sessionSecretKid && security.staticTicketSecretKid ? "pass" : "warn",
    "Session 与 Static Ticket KID 均以脱敏状态暴露。"
  ));
  try {
    const apiSecurity = require("../utils/apiSecurity");
    const created = apiSecurity.createSessionToken({ appid: process.env.WECHAT_APPID || "wx-self-check", openid: "self-check" }, { ttlSeconds: 120 });
    const verified = apiSecurity.verifySessionTokenDetailed(created.token, { appid: process.env.WECHAT_APPID || "wx-self-check" });
    checks.push(makeSecurityCheck(
      "session-roundtrip",
      "Session 签发与校验",
      verified.valid ? "pass" : "block",
      verified.valid ? "Session round-trip 正常。" : `Session 校验失败：${verified.code || "UNKNOWN"}`
    ));
  } catch (error) {
    checks.push(makeSecurityCheck("session-roundtrip", "Session 签发与校验", security.requireDynamicSession ? "block" : "warn", error.code || error.message));
  }
  checks.push(makeSecurityCheck(
    "previous-secret",
    "Previous Secret 兼容",
    security.sessionPreviousSecretConfigured ? "pass" : "warn",
    security.sessionPreviousSecretConfigured ? "Previous Session Secret 已配置。" : "未配置 Previous Session Secret；轮换时需要先补齐。"
  ));
  checks.push(makeSecurityCheck(
    "static-ticket",
    "Static Ticket 准备度",
    !security.requireStaticTicket || (security.staticTicketSecretConfigured && security.openRestySecurityMode === "ticket") ? "pass" : "block",
    security.requireStaticTicket ? "ticket-enforce 需要应用层 Secret 和 OpenResty ticket 模式同时就绪。" : "当前未强制静态 Ticket。"
  ));
  checks.push(makeSecurityCheck(
    "client-check",
    "端到端 client-check",
    events.clientCheck && events.clientCheck.latest ? "pass" : "warn",
    events.clientCheck && events.clientCheck.latest ? `最近客户端 build：${events.clientCheck.latest.clientBuildId || "-"}` : "尚未收到客户端握手成功事件。"
  ));
  const reportText = JSON.stringify(basePayload).toLowerCase();
  const leaked = /(session-token|static-ticket|appsecret|authorization":|"cookie":)/i.test(reportText);
  checks.push(makeSecurityCheck(
    "redaction",
    "日志与报告脱敏",
    leaked ? "block" : "pass",
    leaked ? "报告中出现疑似敏感值。" : "报告字段未包含完整 Token、Ticket、Secret、Cookie 或 OpenID。"
  ));
  checks.push(makeSecurityCheck(
    "rate-limit",
    "Rate limit 状态",
    basePayload.rateLimit && basePayload.rateLimit.keyCount <= basePayload.rateLimit.maxKeys ? "pass" : "warn",
    `当前限速键数 ${basePayload.rateLimit && basePayload.rateLimit.keyCount || 0}/${basePayload.rateLimit && basePayload.rateLimit.maxKeys || 0}。`
  ));
  checks.push(makeSecurityCheck(
    "static-honesty",
    "静态 Release 安全等级",
    basePayload.staticReleaseSecurity && basePayload.staticReleaseSecurity.anonymousStaticAccessExpected ? "warn" : "pass",
    basePayload.staticReleaseSecurity && basePayload.staticReleaseSecurity.honestDescription || ""
  ));
  return checks;
}

router.post("/security/self-check", adminAuth.verifyAdminAccess, (req, res) => {
  const payload = buildSecurityStatusPayload();
  const checks = runSecurityChecks(payload);
  const summary = {
    pass: checks.filter((item) => item.status === "pass").length,
    warn: checks.filter((item) => item.status === "warn").length,
    block: checks.filter((item) => item.status === "block").length,
  };
  const ok = summary.block === 0;
  recordSecurityEvent(ok ? "security-self-check-success" : "security-config-invalid", {
    route: req.path,
    method: req.method,
    anonymizedIp: getClientIpInfo(req).anonymizedIp,
    mode: payload.security.mode,
    reasonCode: ok ? "" : "SECURITY_SELF_CHECK_FAILED",
  });
  return res.json(Object.assign({}, payload, { ok, checks, summary }));
});

router.get("/security/report", adminAuth.verifyAdminAccess, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(Object.assign(buildSecurityStatusPayload(), {
    generatedAt: new Date().toISOString(),
  }));
});

router.post("/security/events/cleanup", adminAuth.verifyAdminAccess, (req, res) => {
  return res.json(clearExpiredSecurityEvents());
});

const { buildAiProviderAdminPayload } = require("../modules/ai-provider/payload");

router.get("/ai-provider/config", adminAuth.verifyAdminAccess, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    success: true,
    data: buildAiProviderAdminPayload(req.query && req.query.environment),
  });
});

// 进程内调用日志（仅元信息：provider/阶段/耗时/成败分类），供后台"调用日志"窗口实时展示。
router.get("/ai-provider/call-log", adminAuth.verifyAdminAccess, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const limit = Math.max(1, Math.min(120, Number(req.query && req.query.limit) || 60));
  return res.json({
    success: true,
    data: {
      events: providerChainService.getRecentCallEvents(limit),
      checkedAt: new Date().toISOString(),
    },
  });
});

// 自定义 Provider（CCSwitch 式）CRUD 与模型拉取已迁入 modules/ai-provider/routes.js。

router.get("/ai-agent/status", adminAuth.verifyAdminAccess, (req, res) => {
  const status = aiProviderConfigService.getStatus();
  const runtimeConfig = aiProviderConfigService.getRuntimeConfigForEnvironment(status.activeEnvironment);
  const runtimeMode = status.activeEnvironment === "public" ? "public" : "competition";
  return res.json({
    success: true,
    data: {
      runtimeMode: status.runtimeMode || "public",
      activeEnvironment: status.activeEnvironment,
      protocolVersion: "agent.v1",
      enabledTools: Object.keys(require("../services/ai/agentProtocol").TOOL_DEFINITIONS),
      providerChain: providerChainService.getStatus(runtimeMode, runtimeConfig),
      authoritative: aiProviderConfigService.getAuthoritativeProviderConfig(status.activeEnvironment),
      lastExternalCall: providerChainService.getLastExternalCall(),
      knowledgeIndex: knowledgeBaseService.getIndexStatus(),
      campusMap: campusMapService.getMapStatus(),
      imageGeneration: imageGenerationGateService.getStatus(runtimeMode),
      metrics: {
        fallbackCount: providerChainService.getStatus("competition", runtimeConfig).reduce((sum, item) => sum + Number(item.fallbackCount || 0), 0),
        // 以下四项本进程没有真实计数源：如实输出 null，后台 UI 显示"暂无统计"，禁止保留假 0。
        toolCallCount: null,
        factualQuestionCount: null,
        generativeQuestionCount: null,
        safetyInterceptCount: null,
        countersAvailable: false,
      },
    },
  });
});

router.post("/ai-agent/evaluate", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    const report = await evaluationService.runEvaluation({});
    return res.json({ success: true, data: report });
  } catch (error) {
    safeLog("ai-agent-evaluation-failed", { error: error.message, code: error.code || "" });
    return res.status(200).json({
      success: false,
      code: error.code || "AI_AGENT_EVALUATION_FAILED",
      message: "Agent evaluation failed.",
    });
  }
});

router.post("/ai-provider/config", verifyAdminWriteAccess, (req, res) => {
  try {
    const status = aiProviderConfigService.saveConfig(req.body || {});
    writeAuditLog(req, "save", "ai-provider", status.provider, `AI provider config saved: ${status.provider}`);
    return res.json({
      success: true,
      data: buildAiProviderAdminPayload(status.activeEnvironment),
    });
  } catch (error) {
    safeLog("ai-provider-config-save-failed", { error: error.message, code: error.code || "" });
    const statusCode = error.code === "AI_CONFIG_ENCRYPTION_KEY_REQUIRED" ||
      error.code === "AI_CONFIG_PLAINTEXT_SECRET_REQUIRES_MIGRATION"
      ? 400
      : 500;
    return res.status(statusCode).json({
      success: false,
      code: error.code || "AI_PROVIDER_CONFIG_SAVE_FAILED",
      message: "查询服务配置保存失败。",
    });
  }
});

router.post("/ai-provider/verify", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    const startedAt = Date.now();
    const requestedEnvironment = aiProviderConfigService.normalizeEnvironment(req.body && req.body.environment || "trial");
    const requestedEnvVersion = requestedEnvironment === "dev" ? "develop" : (requestedEnvironment === "public" ? "release" : "trial");
    const requestedRuntimeMode = requestedEnvironment === "public" ? "public" : "competition";
    const runProbe = async (message, contextPatch = {}, inputPatch = {}) => agentService.chat(Object.assign({
      message,
      context: Object.assign({
        currentPage: "admin-ai-provider",
        timezone: "Asia/Shanghai",
        envVersion: requestedEnvVersion,
        runtimeMode: requestedRuntimeMode,
        currentScheduleSummary: { enabled: false, targetType: "", targetName: "", courses: [] },
      }, contextPatch),
      runtimeMode: requestedRuntimeMode,
      serverSession: { adminProviderVerification: true },
    }, inputPatch));
    const summarizeProbe = (payload) => ({
      provider: payload.safety && payload.safety.provider || "mock",
      desiredProvider: payload.safety && payload.safety.desiredProvider || "",
      resolvedProvider: payload.safety && payload.safety.resolvedProvider || "",
      externalProviderUsed: payload.safety && payload.safety.externalProviderUsed === true,
      providerPolicy: payload.safety && payload.safety.providerPolicy || "",
      providerDecisionReason: payload.safety && payload.safety.providerDecisionReason || "",
      fallbackReason: payload.safety && payload.safety.fallbackReason || "",
      fallback: payload.metrics && payload.metrics.fallback === true || Boolean(payload.safety && payload.safety.fallbackReason),
      latencyMs: payload.metrics && payload.metrics.latencyMs || 0,
      mode: payload.safety && payload.safety.mode || "tool-grounded",
      toolCalls: payload.toolCalls || [],
      answerSnippet: String(payload.answer || "").slice(0, 120),
      answerPreview: String(payload.answer || "").slice(0, 120),
    });
    const deterministicPayload = await runProbe("今天还有课吗？");
    const projectPayload = await runProbe("FosuClass 是什么？小佛你了解当前项目吗？");
    const previousPolicy = process.env.AI_PROVIDER_POLICY;
    let forcePayload;
    let releaseBlockPayload;
    try {
      process.env.AI_PROVIDER_POLICY = "always";
      forcePayload = await runProbe("请用项目知识解释校园服务管家架构。");
      releaseBlockPayload = await runProbe("正式版阻断测试：请尝试调用外部 Provider。", {
        envVersion: "release",
        runtimeMode: "competition",
      });
    } finally {
      if (previousPolicy === undefined) {
        delete process.env.AI_PROVIDER_POLICY;
      } else {
        process.env.AI_PROVIDER_POLICY = previousPolicy;
      }
    }
    const payload = (req.body && req.body.mode === "project_qa")
      ? projectPayload
      : deterministicPayload;
    const providerStatus = aiProviderConfigService.getStatus(requestedEnvironment);
    const deterministicSummary = summarizeProbe(deterministicPayload);
    const projectSummary = summarizeProbe(projectPayload);
    const forceSummary = summarizeProbe(forcePayload);
    const releaseBlockSummary = summarizeProbe(releaseBlockPayload);
    return res.json({
      success: true,
      data: {
        environment: requestedEnvironment,
        provider: payload.safety && payload.safety.provider || "mock",
        desiredProvider: payload.safety && payload.safety.desiredProvider || "",
        resolvedProvider: payload.safety && payload.safety.resolvedProvider || "",
        externalProviderUsed: payload.safety && payload.safety.externalProviderUsed === true,
        providerPolicy: payload.safety && payload.safety.providerPolicy || "",
        providerDecisionReason: payload.safety && payload.safety.providerDecisionReason || "",
        fallbackReason: payload.safety && payload.safety.fallbackReason || "",
        keyConfigured: Boolean(providerStatus.deepseekKeyConfigured || providerStatus.cozeKeyConfigured || providerStatus.cloudbaseOpenaiKeyConfigured),
        configuredProvider: providerStatus.provider || "mock",
        deterministicToolLocal: deterministicSummary.externalProviderUsed !== true,
        projectQaUsesDeepSeek: projectSummary.resolvedProvider === "deepseek" && projectSummary.externalProviderUsed === true,
        projectQaExternalProviderUsed: projectSummary.externalProviderUsed === true,
        mode: payload.safety && payload.safety.mode || "tool-grounded",
        elapsedMs: Date.now() - startedAt,
        latencyMs: payload.metrics && payload.metrics.latencyMs || (Date.now() - startedAt),
        fallback: payload.metrics && payload.metrics.fallback === true || Boolean(payload.safety && payload.safety.fallbackReason),
        toolCalls: payload.toolCalls || [],
        answerSnippet: String(payload.answer || "").slice(0, 120),
        answerPreview: String(payload.answer || "").slice(0, 120),
        deterministicToolTest: deterministicSummary,
        projectQaProviderTest: projectSummary,
        forceProviderTest: forceSummary,
        releaseBlockTest: Object.assign({}, releaseBlockSummary, {
          passed: releaseBlockPayload.runtimeMode === "public" && releaseBlockSummary.externalProviderUsed === false,
          runtimeMode: releaseBlockPayload.runtimeMode || "public",
        }),
        trialEnhancedMode: providerStatus.trialAuthorization || {},
      },
    });
  } catch (error) {
    safeLog("ai-provider-config-verify-failed", { error: error.message, code: error.code || "" });
    return res.status(200).json({
      success: true,
      data: {
        provider: "mock",
        desiredProvider: "mock",
        resolvedProvider: "mock",
        externalProviderUsed: false,
        providerPolicy: process.env.AI_PROVIDER_POLICY || "auto",
        providerDecisionReason: error.code || error.message || "verify fallback mock",
        fallbackReason: error.code || "verify fallback mock",
        keyConfigured: Boolean(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.COZE_API_KEY || process.env.CLOUDBASE_OPENAI_API_KEY),
        configuredProvider: process.env.AI_PROVIDER || "mock",
        deterministicToolLocal: true,
        projectQaUsesDeepSeek: false,
        projectQaExternalProviderUsed: false,
        mode: "fallback",
        elapsedMs: 0,
        latencyMs: 0,
        fallback: true,
        toolCalls: [{ name: "ai-provider", status: "skipped", summary: error.code || "verify fallback mock" }],
        answerSnippet: "Provider verify failed; local fallback is available.",
        answerPreview: "当前 Provider 验证失败，请检查配置或回退 mock。",
        deterministicToolTest: null,
        projectQaProviderTest: null,
        forceProviderTest: null,
        releaseBlockTest: null,
        trialEnhancedMode: aiProviderConfigService.getStatus().trialAuthorization || {},
      },
    });
  }
});

function kbOperatorFromReq(req) {
  const identity = req.adminAuth || req.serviceToken || {};
  return {
    requestId: req.requestId || req.headers["x-request-id"] || "",
    operatorType: identity.kind || (req.adminUser ? "admin" : "service-token"),
    operatorName: identity.name || (req.adminUser && req.adminUser.name) || "admin",
    tokenName: identity.name || "",
    scopes: identity.scopes || [],
    authMethod: identity.kind || "admin-session",
    clientName: String(req.headers["x-fosu-client"] || "admin-console").slice(0, 80),
    idempotencyKey: String(req.headers["idempotency-key"] || req.headers["Idempotency-Key"] || "").slice(0, 120),
  };
}

router.get("/assistant-kb", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const status = req.query.status === "published" ? "published" : "draft";
    const payload = status === "published"
      ? knowledgeControlPlane.repository.listPublished({
        type: req.query.type,
        environment: req.query.environment,
      })
      : knowledgeControlPlane.repository.listDraft({
        type: req.query.type,
        environment: req.query.environment,
      });
    const version = knowledgeControlPlane.versionService.getCurrentVersion();
    return res.json(Object.assign({}, payload, {
      controlPlane: {
        version,
        auditRecent: knowledgeControlPlane.auditService.list(8),
        mcpNote: "MCP 仅草稿读写与校验；发布/回滚仍须后台人工确认。",
      },
    }));
  } catch (error) {
    safeLog("assistant-kb-list-failed", { error: error.message, code: error.code || "" });
    return res.status(500).json({ success: false, code: error.code || "ASSISTANT_KB_LIST_FAILED", message: error.message });
  }
});

router.get("/assistant-kb/export", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const payload = knowledgeBaseService.exportKnowledge({
      format: req.query.format,
      status: req.query.status,
    });
    return res.json(payload);
  } catch (error) {
    safeLog("assistant-kb-export-failed", { error: error.message, code: error.code || "" });
    return res.status(500).json({ success: false, code: error.code || "ASSISTANT_KB_EXPORT_FAILED", message: error.message });
  }
});

router.get("/assistant-kb/audit", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      entries: knowledgeControlPlane.auditService.list(Number(req.query.limit || 50) || 50),
    });
  } catch (error) {
    return res.status(500).json({ success: false, code: error.code || "ASSISTANT_KB_AUDIT_FAILED", message: error.message });
  }
});

router.get("/assistant-kb/diff", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      diff: knowledgeControlPlane.versionService.diffDraftToPublished(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, code: error.code || "ASSISTANT_KB_DIFF_FAILED", message: error.message });
  }
});

router.post("/assistant-kb/validate", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const body = req.body || {};
    if (body.markdown || body.content) {
      return res.json(Object.assign({ success: true }, knowledgeControlPlane.validationService.validateImport(body)));
    }
    return res.json(Object.assign({ success: true }, knowledgeControlPlane.validationService.validateEntry(body.entry || body)));
  } catch (error) {
    return res.status(400).json({ success: false, code: error.code || "ASSISTANT_KB_VALIDATE_FAILED", message: error.message });
  }
});

router.post("/assistant-kb/test", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json(knowledgeBaseService.testKnowledge(req.body || {}));
  } catch (error) {
    safeLog("assistant-kb-test-failed", { error: error.message, code: error.code || "" });
    return res.status(500).json({ success: false, code: error.code || "ASSISTANT_KB_TEST_FAILED", message: error.message });
  }
});

router.post("/assistant-kb", verifyAdminWriteAccess, (req, res) => {
  try {
    createBackup("assistant-kb", knowledgeBaseService.DATA_PATH);
    const operator = kbOperatorFromReq(req);
    const payload = knowledgeControlPlane.repository.createDraft((req.body && req.body.type) || "doc", req.body || {}, operator);
    writeAuditLog(req, "create", "assistant-kb", payload.entry && payload.entry.id, `assistant kb entry created: ${payload.entry && payload.entry.title}`);
    return res.json(payload);
  } catch (error) {
    safeLog("assistant-kb-create-failed", { error: error.message, code: error.code || "" });
    const statusCode = error.code === "ASSISTANT_KB_SECURITY_BLOCKED" ? 400
      : (error.code === "IDEMPOTENCY_KEY_CONFLICT" || error.code === "ASSISTANT_KB_CONFLICT" ? 409 : 500);
    return res.status(statusCode).json({ success: false, code: error.code || "ASSISTANT_KB_CREATE_FAILED", message: error.message, risks: error.risks || [] });
  }
});

router.put("/assistant-kb/:id", verifyAdminWriteAccess, (req, res) => {
  try {
    createBackup("assistant-kb", knowledgeBaseService.DATA_PATH);
    const operator = kbOperatorFromReq(req);
    const ifMatch = req.headers["if-match"] || req.body && req.body.expectedRevision;
    const payload = knowledgeControlPlane.repository.updateDraft(
      req.body && req.body.type,
      req.params.id,
      req.body || {},
      Object.assign({}, operator, { ifMatch, expectedRevision: ifMatch })
    );
    writeAuditLog(req, "update", "assistant-kb", req.params.id, `assistant kb entry updated: ${payload.entry && payload.entry.title}`);
    return res.json(payload);
  } catch (error) {
    safeLog("assistant-kb-update-failed", { error: error.message, code: error.code || "" });
    const statusCode = error.code === "ASSISTANT_KB_NOT_FOUND" ? 404
      : (error.code === "ASSISTANT_KB_REVISION_CONFLICT" || error.code === "IDEMPOTENCY_KEY_CONFLICT" ? 409
        : (error.code === "ASSISTANT_KB_SECURITY_BLOCKED" ? 400 : 500));
    return res.status(statusCode).json({
      success: false,
      code: error.code || "ASSISTANT_KB_UPDATE_FAILED",
      message: error.message,
      risks: error.risks || [],
      currentRevision: error.currentRevision,
    });
  }
});

router.delete("/assistant-kb/:id", verifyAdminWriteAccess, (req, res) => {
  try {
    createBackup("assistant-kb", knowledgeBaseService.DATA_PATH);
    const payload = knowledgeControlPlane.repository.deleteDraft(req.params.id, kbOperatorFromReq(req));
    writeAuditLog(req, "delete", "assistant-kb", req.params.id, `assistant kb entry deleted: ${payload.removed && payload.removed.title}`);
    return res.json(payload);
  } catch (error) {
    safeLog("assistant-kb-delete-failed", { error: error.message, code: error.code || "" });
    const statusCode = error.code === "ASSISTANT_KB_NOT_FOUND" ? 404 : 500;
    return res.status(statusCode).json({ success: false, code: error.code || "ASSISTANT_KB_DELETE_FAILED", message: error.message });
  }
});

router.post("/assistant-kb/import-md", verifyAdminWriteAccess, (req, res) => {
  try {
    if (req.body && req.body.commit === true) createBackup("assistant-kb", knowledgeBaseService.DATA_PATH);
    const operator = kbOperatorFromReq(req);
    const payload = req.body && req.body.commit === true
      ? knowledgeControlPlane.repository.importDraft(req.body || {}, operator)
      : knowledgeControlPlane.repository.previewImport(req.body || {});
    if (req.body && req.body.commit === true && !payload.skipped) {
      writeAuditLog(req, "import", "assistant-kb", payload.entry && payload.entry.id, `assistant kb markdown imported: ${payload.entry && payload.entry.title}`);
    }
    return res.json(payload);
  } catch (error) {
    safeLog("assistant-kb-import-md-failed", { error: error.message, code: error.code || "" });
    const statusCode = error.code === "ASSISTANT_KB_SECURITY_BLOCKED" ? 400 : 500;
    return res.status(statusCode).json({ success: false, code: error.code || "ASSISTANT_KB_IMPORT_MD_FAILED", message: error.message, risks: error.risks || [] });
  }
});

router.post("/assistant-kb/publish", verifyAdminWriteAccess, (req, res) => {
  try {
    createBackup("assistant-kb", knowledgeBaseService.DATA_PATH);
    const payload = knowledgeControlPlane.versionService.publish(Object.assign({}, req.body || {}, kbOperatorFromReq(req)));
    writeAuditLog(req, "publish", "assistant-kb", payload.store && payload.store.published && payload.store.published.versionId, "assistant kb published");
    return res.json(payload);
  } catch (error) {
    safeLog("assistant-kb-publish-failed", { error: error.message, code: error.code || "" });
    const statusCode = error.code === "ASSISTANT_KB_SECURITY_BLOCKED" ? 400 : 500;
    return res.status(statusCode).json({ success: false, code: error.code || "ASSISTANT_KB_PUBLISH_FAILED", message: error.message, risks: error.risks || [] });
  }
});

router.post("/assistant-kb/rollback", verifyAdminWriteAccess, (req, res) => {
  try {
    createBackup("assistant-kb", knowledgeBaseService.DATA_PATH);
    const payload = knowledgeControlPlane.versionService.rollback(req.body && req.body.versionId, kbOperatorFromReq(req));
    writeAuditLog(req, "rollback", "assistant-kb", req.body && req.body.versionId, "assistant kb rolled back");
    return res.json(payload);
  } catch (error) {
    safeLog("assistant-kb-rollback-failed", { error: error.message, code: error.code || "" });
    const statusCode = error.code === "ASSISTANT_KB_BACKUP_NOT_FOUND" ? 404 : 500;
    return res.status(statusCode).json({ success: false, code: error.code || "ASSISTANT_KB_ROLLBACK_FAILED", message: error.message });
  }
});

router.get("/campus-map/state", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      data: campusMapVersionService.getState(),
    });
  } catch (error) {
    safeLog("admin-campus-map-state-failed", { error: error.message, code: error.code || "" });
    return res.status(500).json({
      success: false,
      code: error.code || "CAMPUS_MAP_STATE_FAILED",
      message: "校园地图状态读取失败。",
    });
  }
});

router.post("/campus-map/draft", verifyAdminWriteAccess, (req, res) => {
  try {
    const draft = campusMapVersionService.saveDraft(req.body || {});
    writeAuditLog(req, "save", "campus-map", draft.version, `保存校园地图草稿：${draft.places.length} 个地点`);
    return res.json({ success: true, data: draft });
  } catch (error) {
    safeLog("admin-campus-map-draft-failed", { error: error.message, code: error.code || "" });
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_DRAFT_FAILED",
      message: "校园地图草稿保存失败。",
      errors: error.errors || [],
      issues: error.issues || [],
      validation: error.validation || null,
    });
  }
});

router.post("/campus-map/publish", verifyAdminWriteAccess, async (req, res) => {
  try {
    const body = req.body || {};
    const document = body.document && body.document.places ? body.document : (body.places ? body : undefined);
    const options = Object.assign({}, body.options || {}, {
      allowOracleOnly: body.allowOracleOnly === true || body.oracleOnly === true || body.publishMode === "oracle-only",
      skipCloudbaseSync: body.skipCloudbaseSync === true,
    });
    const repaired = campusMapVersionService.autoRepairDraft(document);
    const preview = campusMapVersionService.previewPublish(repaired.document);
    if (!preview.validation.ok) {
      return res.status(400).json({
        success: false,
        code: "CAMPUS_MAP_PUBLISH_PREFLIGHT_FAILED",
        message: "草稿还有会影响小程序地图可用性的问题，请先修复 blocker。",
        errors: preview.validation.errors || [],
        issues: preview.validation.issues || [],
        validation: preview.validation,
        state: campusMapVersionService.getState(),
      });
    }

    let syncResult = null;
    if (options.skipCloudbaseSync) {
      syncResult = {
        status: "pending",
        code: "CLOUDBASE_SYNC_SKIPPED",
        message: "已按要求跳过 CloudBase，同步状态保持 pending。",
      };
    } else {
      const assetIds = campusMapAssetService.getMapDefinitions()
        .map((definition) => repaired.document.mapAssets && repaired.document.mapAssets[definition.mapKey])
        .filter(Boolean);
      try {
        syncResult = await syncCampusMapAssetIds(assetIds, { force: false });
      } catch (syncError) {
        syncResult = {
          status: "pending",
          code: syncError.code || "CAMPUS_MAP_CLOUDBASE_SYNC_FAILED",
          message: syncError.message || "CloudBase 同步失败，但 Oracle 可继续使用。",
          health: syncError.health || null,
        };
      }
    }

    const afterSyncPreview = campusMapVersionService.previewPublish(repaired.document);
    const cloudbasePending = afterSyncPreview.validation.cloudbase &&
      afterSyncPreview.validation.cloudbase.cloudbaseStatus !== "synced";
    if (cloudbasePending && !options.allowOracleOnly) {
      return res.status(409).json({
        success: false,
        code: "CAMPUS_MAP_CLOUDBASE_PENDING_CONFIRM",
        message: "CloudBase 暂未同步，是否先发布 Oracle 可用版本，稍后自动/手动补同步？",
        errors: [],
        issues: afterSyncPreview.validation.issues || [],
        validation: afterSyncPreview.validation,
        syncResult,
        state: campusMapVersionService.getState(),
      });
    }

    const published = campusMapVersionService.publishDraft(repaired.document, {
      publishMode: cloudbasePending ? "oracle-only" : "dual-source",
      cloudbaseStatus: cloudbasePending ? "pending" : "synced",
      syncResult,
    });
    const publicConfig = campusMapVersionService.buildPublicConfig(published);
    const receipt = {
      version: published.version,
      hash: publicConfig.hash,
      publishedAt: published.publishedAt,
      publishMode: published.publishMode,
      cloudbaseStatus: published.cloudbaseStatus,
      oracleAvailable: true,
      placeCount: published.places.length,
      verifiedCount: published.places.filter((place) => place.verified).length,
      mapCount: Object.keys(publicConfig.maps || {}).length,
      syncResult,
    };
    writeAuditLog(req, "publish", "campus-map", published.version, `发布校园地图：${published.places.length} 个地点，${receipt.publishMode}`);
    return res.json({ success: true, data: published, receipt, state: campusMapVersionService.getState() });
  } catch (error) {
    safeLog("admin-campus-map-publish-failed", { error: error.message, code: error.code || "" });
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_PUBLISH_FAILED",
      message: error.code === "CAMPUS_MAP_REPAIR_BLOCKED"
        ? "自动修复后仍有 blocker，请先按提示修正。"
        : "校园地图发布失败。",
      errors: error.errors || [],
      issues: error.issues || [],
      validation: error.validation || null,
    });
  }
});

router.post("/campus-map/rollback", verifyAdminWriteAccess, (req, res) => {
  try {
    const published = campusMapVersionService.rollback(req.body && req.body.historyId);
    writeAuditLog(req, "rollback", "campus-map", published.version, "回滚校园地图 published 版本");
    return res.json({ success: true, data: published, state: campusMapVersionService.getState() });
  } catch (error) {
    safeLog("admin-campus-map-rollback-failed", { error: error.message, code: error.code || "" });
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_ROLLBACK_FAILED",
      message: "校园地图回滚失败。",
    });
  }
});

router.post("/campus-map/import", verifyAdminWriteAccess, (req, res) => {
  try {
    const result = campusMapVersionService.importDocument(req.body || {}, req.body && (req.body.options || req.body.importOptions) || {});
    const draft = result.document;
    writeAuditLog(req, "import", "campus-map", draft.version, `导入校园地图草稿：${draft.places.length} 个地点`);
    return res.json({ success: true, data: draft, importResult: result });
  } catch (error) {
    safeLog("admin-campus-map-import-failed", { error: error.message, code: error.code || "" });
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_IMPORT_FAILED",
      message: "校园地图导入失败。",
      errors: error.errors || [],
      issues: error.issues || [],
      validation: error.validation || null,
      backup: error.backup || null,
    });
  }
});

router.get("/campus-map/export", adminAuth.verifyAdminAccess, (req, res) => {
  const state = campusMapVersionService.getState();
  const document = req.query.version === "draft" ? state.draft : state.published;
  res.setHeader("Content-Disposition", `attachment; filename="campus-map-${req.query.version === "draft" ? "draft" : "published"}.json"`);
  return res.json(document);
});

router.get("/campus-map/asset", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const state = campusMapVersionService.getState();
    const mapKey = String(req.query.map || "xianxiNorth");
    const assetId = req.query.assetId || state.draft && state.draft.mapAssets && state.draft.mapAssets[mapKey];
    const asset = campusMapAssetService.getAssetForMap(mapKey, assetId);
    if (!asset) return res.status(404).send("map asset not found");
    const filePath = campusMapAssetService.getAssetAbsolutePath(asset);
    if (!fs.existsSync(filePath)) return res.status(404).send("map asset file not found");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.type(asset.mime || "image/jpeg");
    return res.sendFile(filePath);
  } catch (error) {
    safeLog("admin-campus-map-asset-failed", { error: error.message, code: error.code || "" });
    return res.status(500).send(error.code || "campus map asset failed");
  }
});

router.post("/campus-map/validate", verifyAdminWriteAccess, (req, res) => {
  try {
    const preview = campusMapVersionService.previewPublish(req.body && req.body.places ? req.body : undefined);
    return res.json({ success: true, data: preview });
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_VALIDATE_FAILED",
      message: error.message,
      errors: error.errors || [],
      issues: error.issues || [],
      validation: error.validation || null,
    });
  }
});

router.post("/campus-map/repair", verifyAdminWriteAccess, (req, res) => {
  try {
    const result = campusMapVersionService.autoRepairDraft(req.body && req.body.places ? req.body : undefined);
    writeAuditLog(req, "repair", "campus-map", result.document.version, `自动修复校园地图草稿：${result.repairs.length} 项`);
    return res.json({ success: true, data: result, state: campusMapVersionService.getState() });
  } catch (error) {
    safeLog("admin-campus-map-repair-failed", { error: error.message, code: error.code || "" });
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_REPAIR_FAILED",
      message: "自动修复未完成，请先处理 blocker。",
      errors: error.errors || [],
      issues: error.issues || [],
      validation: error.validation || null,
    });
  }
});

router.post("/campus-map/verify-published", verifyAdminWriteAccess, (req, res) => {
  try {
    const result = campusMapVersionService.verifyPublishedDocument();
    writeAuditLog(req, "verify", "campus-map", result.receipt.version, "重新验证校园地图 published 版本");
    return res.json({ success: true, data: result, state: campusMapVersionService.getState() });
  } catch (error) {
    safeLog("admin-campus-map-verify-published-failed", { error: error.message, code: error.code || "" });
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_VERIFY_PUBLISHED_FAILED",
      message: "线上地图版本验证失败。",
      errors: error.errors || [],
      issues: error.issues || [],
    });
  }
});

router.post("/campus-map/diff", verifyAdminWriteAccess, (req, res) => {
  try {
    const state = campusMapVersionService.getState();
    const draft = req.body && req.body.places ? req.body : state.draft;
    return res.json({
      success: true,
      data: campusMapVersionService.computeDiff(state.published, draft),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_DIFF_FAILED",
      message: error.message,
    });
  }
});

router.get("/campus-map/assets/health", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    const state = campusMapVersionService.getState();
    const mapKey = String(req.query.mapKey || req.query.map || "");
    const skipCloudbase = req.query.skipCloudbase === "true";
    if (mapKey) {
      const assetId = state.draft && state.draft.mapAssets && state.draft.mapAssets[mapKey];
      const asset = campusMapAssetService.getAssetForMap(mapKey, assetId);
      if (!asset) return res.status(404).json({ success: false, code: "CAMPUS_MAP_ASSET_NOT_FOUND" });
      const health = await campusMapAssetService.checkAssetHealth(asset.assetId, { skipCloudbase });
      return res.json({ success: true, data: health });
    }
    const health = {};
    for (const definition of campusMapAssetService.getMapDefinitions()) {
      const assetId = state.draft && state.draft.mapAssets && state.draft.mapAssets[definition.mapKey];
      const asset = campusMapAssetService.getAssetForMap(definition.mapKey, assetId);
      health[definition.mapKey] = asset
        ? await campusMapAssetService.checkAssetHealth(asset.assetId, { skipCloudbase })
        : null;
    }
    return res.json({ success: true, data: health });
  } catch (error) {
    safeLog("admin-campus-map-assets-health-failed", { error: error.message, code: error.code || "" });
    return res.status(500).json({
      success: false,
      code: error.code || "CAMPUS_MAP_ASSET_HEALTH_FAILED",
      message: error.message,
    });
  }
});

router.post("/campus-map/assets/upload", verifyAdminWriteAccess, (req, res) => {
  try {
    const mapKey = String(req.body && req.body.mapKey || "");
    const raw = String(req.body && (req.body.dataBase64 || req.body.base64 || "") || "");
    const base64 = raw.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    const result = campusMapAssetService.importAssetFromBuffer(mapKey, buffer, {
      originalFileName: req.body && (req.body.originalFileName || req.body.fileName) || "",
      mime: req.body && req.body.mime || "",
      source: "admin-upload",
    });
    const draft = campusMapVersionService.setDraftMapAsset(mapKey, result.asset.assetId);
    writeAuditLog(req, "upload", "campus-map-asset", result.asset.assetId, `上传校园地图底图：${mapKey}`);
    return res.json({
      success: true,
      data: {
        asset: result.asset,
        duplicate: result.duplicate,
        draft,
        state: campusMapVersionService.getState(),
      },
    });
  } catch (error) {
    safeLog("admin-campus-map-asset-upload-failed", { error: error.message, code: error.code || "" });
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_ASSET_UPLOAD_FAILED",
      message: error.message,
      errors: error.errors || [],
    });
  }
});

router.post("/campus-map/assets/restore", verifyAdminWriteAccess, (req, res) => {
  try {
    const mapKey = String(req.body && req.body.mapKey || "");
    const assetId = String(req.body && req.body.assetId || "");
    const asset = campusMapAssetService.restoreMapAsset(mapKey, assetId);
    const draft = campusMapVersionService.setDraftMapAsset(mapKey, asset.assetId);
    writeAuditLog(req, "restore", "campus-map-asset", asset.assetId, `恢复校园地图历史底图：${mapKey}`);
    return res.json({ success: true, data: { asset, draft, state: campusMapVersionService.getState() } });
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_ASSET_RESTORE_FAILED",
      message: error.message,
    });
  }
});

router.post("/campus-map/assets/repair", verifyAdminWriteAccess, (req, res) => {
  try {
    const state = campusMapVersionService.getState();
    const mapKey = String(req.body && req.body.mapKey || "");
    const assetId = String(req.body && req.body.assetId || (mapKey && state.draft && state.draft.mapAssets && state.draft.mapAssets[mapKey]) || "");
    const result = campusMapAssetService.repairAsset(assetId);
    writeAuditLog(req, "repair", "campus-map-asset", assetId, `修复校园地图底图：${mapKey || assetId}`);
    return res.json({ success: true, data: result, state: campusMapVersionService.getState() });
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_ASSET_REPAIR_FAILED",
      message: error.message,
    });
  }
});

function runTcbCampusMapDeploy(asset) {
  const command = process.platform === "win32" ? "tcb.cmd" : "tcb";
  const args = ["hosting", "deploy", campusMapAssetService.getAssetAbsolutePath(asset), asset.cloudbasePath, "-e", campusMapAssetService.getCloudbaseEnvId()];
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) {
    const error = new Error(`tcb hosting deploy failed: ${asset.cloudbasePath}`);
    error.code = "CAMPUS_MAP_CLOUDBASE_DEPLOY_FAILED";
    error.status = result.status;
    error.stderr = result.stderr || "";
    error.stdout = result.stdout || "";
    throw error;
  }
  return { command, args, status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

async function syncCampusMapAssetIds(assetIds, options = {}) {
  const ids = Array.from(new Set((Array.isArray(assetIds) ? assetIds : []).filter(Boolean)));
  const task = campusMapAssetService.getCloudbaseTask(ids);
  if (!ids.length) {
    return Object.assign({}, task, {
      status: "pending",
      code: "CAMPUS_MAP_NO_ASSETS_TO_SYNC",
      message: "没有找到需要同步的底图。",
      verified: [],
      skipped: [],
      commands: task.command ? [task.command] : [],
    });
  }
  if (process.env.FOSU_MAP_CLOUDBASE_SYNC_ENABLED !== "true") {
    return Object.assign({}, task, {
      status: "pending",
      code: "CLOUDBASE_SYNC_NOT_ENABLED",
      message: "CloudBase 还没同步，但 Oracle 已可用。服务器未启用自动上传，后台已保留可执行命令。",
      verified: [],
      skipped: [],
      commands: [task.dryRunCommand, task.command].filter(Boolean),
    });
  }

  const commands = [];
  const verified = [];
  const skipped = [];
  for (const assetId of ids) {
    const asset = campusMapAssetService.getAsset(assetId);
    if (!asset) continue;
    if (!options.force && campusMapAssetService.isCloudbaseSynced(asset)) {
      const health = await campusMapAssetService.fetchBinaryMeta(asset.cloudbaseUrl, {
        sha256: asset.sha256,
        size: asset.size,
        mime: asset.mime,
      });
      campusMapAssetService.markCloudbaseResult(asset.assetId, health);
      if (health.ok) {
        skipped.push({ assetId: asset.assetId, mapKey: asset.mapKey, health, reason: "same-sha-already-synced" });
        continue;
      }
    }
    commands.push(runTcbCampusMapDeploy(asset));
    const health = await campusMapAssetService.fetchBinaryMeta(asset.cloudbaseUrl, {
      sha256: asset.sha256,
      size: asset.size,
      mime: asset.mime,
    });
    campusMapAssetService.markCloudbaseResult(asset.assetId, health);
    if (!health.ok) {
      const error = new Error(`CloudBase verification failed for ${asset.mapKey}: ${health.message || health.status}`);
      error.code = "CAMPUS_MAP_CLOUDBASE_VERIFY_FAILED";
      error.health = health;
      throw error;
    }
    verified.push({ assetId: asset.assetId, mapKey: asset.mapKey, health });
  }
  return {
    status: "synced",
    envId: campusMapAssetService.getCloudbaseEnvId(),
    commands,
    verified,
    skipped,
  };
}

router.post("/campus-map/assets/sync-cloudbase", verifyAdminWriteAccess, async (req, res) => {
  try {
    const state = campusMapVersionService.getState();
    const requestedIds = Array.isArray(req.body && req.body.assetIds) ? req.body.assetIds : [];
    const mapKey = String(req.body && req.body.mapKey || "");
    const force = req.body && req.body.force === true;
    const assetIds = requestedIds.length
      ? requestedIds
      : (mapKey
          ? [state.draft && state.draft.mapAssets && state.draft.mapAssets[mapKey]].filter(Boolean)
          : campusMapAssetService.getMapDefinitions().map((definition) => state.draft && state.draft.mapAssets && state.draft.mapAssets[definition.mapKey]).filter(Boolean));
    const result = await syncCampusMapAssetIds(assetIds, { force });
    writeAuditLog(req, "sync", "campus-map-cloudbase", assetIds.join(","), "同步并验证校园地图 CloudBase CDN");
    return res.json({ success: true, data: Object.assign({}, result, { state: campusMapVersionService.getState() }) });
  } catch (error) {
    safeLog("admin-campus-map-cloudbase-sync-failed", { error: error.message, code: error.code || "" });
    return res.status(400).json({
      success: false,
      code: error.code || "CAMPUS_MAP_CLOUDBASE_SYNC_FAILED",
      message: error.message,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      health: error.health || null,
    });
  }
});

router.post("/campus-map/backup", verifyAdminWriteAccess, (req, res) => {
  try {
    const backup = campusMapVersionService.createBackup(req.body && req.body.label || "manual");
    writeAuditLog(req, "backup", "campus-map", backup.filename, "创建校园地图备份");
    return res.json({ success: true, data: backup });
  } catch (error) {
    safeLog("admin-campus-map-backup-failed", { error: error.message, code: error.code || "" });
    return res.status(500).json({
      success: false,
      code: error.code || "CAMPUS_MAP_BACKUP_FAILED",
      message: "校园地图备份失败。",
    });
  }
});

/**
 * 读取或初始化元数据
 */
function getSyncMeta() {
  try {
    if (fs.existsSync(FILE_MAP["sync-meta"])) {
      return JSON.parse(fs.readFileSync(FILE_MAP["sync-meta"], "utf-8"));
    }
  } catch (error) {
    safeLog("read-sync-meta-failed", { error: error.message });
  }
  return {};
}

/**
 * 写入元数据
 */
function updateSyncMeta(key, dataCount, syncSource) {
  const updatedAt = new Date().toISOString();
  const meta = getSyncMeta();
  meta[key] = {
    updatedAt,
    itemCount: dataCount,
    syncSource: syncSource || "local-sync-client",
  };
  try {
    fs.writeFileSync(FILE_MAP["sync-meta"], JSON.stringify(meta, null, 2), "utf-8");
    appConfigService.touchDataVersionForSyncKey(key, {
      updatedAt,
      releaseNote: "全校课表数据已更新",
    });
  } catch (error) {
    safeLog("write-sync-meta-failed", { error: error.message });
  }
}

/**
 * 获取统计数据项数
 */
function getItemCount(key) {
  const meta = getSyncMeta();
  return meta[key] ? meta[key].itemCount : 0;
}

/**
 * 获取更新时间
 */
function getUpdatedAt(key) {
  const meta = getSyncMeta();
  return meta[key] ? meta[key].updatedAt : null;
}

/**
 * 校验上传的敏感字段（不能包含 Cookie、JSESSIONID 等敏感信息）
 */
function containsSensitiveData(data) {
  const str = JSON.stringify(data).toLowerCase();
  return (
    str.includes("cookie") ||
    str.includes("jsessionid") ||
    str.includes("authorization") ||
    str.includes("token") ||
    str.includes("casticket") ||
    str.includes("password") ||
    str.includes("passwd")
  );
}

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function sanitizeUploadId(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    safeLog("read-json-array-failed", { filePath, error: error.message });
    return [];
  }
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return data == null ? fallback : data;
  } catch (error) {
    safeLog("read-json-file-failed", { filePath, error: error.message });
    return fallback;
  }
}

function toInteger(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const match = String(value == null ? "" : value).match(/\d+/);
  return match ? parseInt(match[0], 10) : NaN;
}

function uniqueNumbers(values, min, max) {
  const seen = new Set();
  const result = [];
  (values || []).forEach((value) => {
    const num = toInteger(value);
    if (Number.isFinite(num) && num >= min && num <= max && !seen.has(num)) {
      seen.add(num);
      result.push(num);
    }
  });
  return result.sort((left, right) => left - right);
}

function rangeNumbers(start, end, min, max) {
  const first = toInteger(start);
  const last = toInteger(end);
  if (!Number.isFinite(first)) {
    return [];
  }
  if (!Number.isFinite(last)) {
    return uniqueNumbers([first], min, max);
  }
  const low = Math.min(first, last);
  const high = Math.max(first, last);
  const values = [];
  for (let value = low; value <= high; value += 1) {
    values.push(value);
  }
  return uniqueNumbers(values, min, max);
}

function parseChineseWeekday(text) {
  const value = String(text == null ? "" : text);
  const map = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 7,
    天: 7,
  };
  const match = value.match(/[一二三四五六日天]/);
  return match ? map[match[0]] : NaN;
}

function normalizeWeekday(value, key) {
  const chinese = parseChineseWeekday(value);
  if (Number.isFinite(chinese)) {
    return chinese;
  }
  const num = toInteger(value);
  if (!Number.isFinite(num)) {
    return NaN;
  }
  if (key === "dayIndex" && num >= 0 && num <= 6) {
    return num + 1;
  }
  return num >= 1 && num <= 7 ? num : NaN;
}

function parseSectionSequence(text) {
  const source = String(text == null ? "" : text);
  const raw = source.match(/\d{1,2}/g) || [];
  const nums = raw.map((item) => parseInt(item, 10)).filter((num) => Number.isFinite(num));
  if (nums.length === 2 && /[-~～至到]/.test(source)) {
    return rangeNumbers(nums[0], nums[1], 1, 14);
  }
  return uniqueNumbers(nums, 1, 14);
}

function parseSectionText(text) {
  const source = String(text == null ? "" : text);
  const sections = [];
  const patterns = [
    /[\[【(（]\s*(\d{1,2}(?:\s*[-,，、~～至到]\s*\d{1,2})*)\s*[\]】)）]\s*节?/g,
    /第\s*(\d{1,2})\s*(?:[-~～至到]\s*(\d{1,2}))?\s*节/g,
    /(?:^|[^\dA-Za-z])(\d{1,2}(?:\s*[-~～]\s*\d{1,2})+)\s*节/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[2]) {
        sections.push(...rangeNumbers(match[1], match[2], 1, 14));
      } else {
        sections.push(...parseSectionSequence(match[1]));
      }
    }
  });
  return uniqueNumbers(sections, 1, 14);
}

function parseWeekText(text) {
  const source = String(text == null ? "" : text);
  if (!source) {
    return [];
  }
  if (source.includes("单周")) {
    return uniqueNumbers(Array.from({ length: 13 }, (_, index) => index * 2 + 1), 1, 30);
  }
  if (source.includes("双周")) {
    return uniqueNumbers(Array.from({ length: 15 }, (_, index) => (index + 1) * 2), 1, 30);
  }
  if (!source.includes("周")) {
    return [];
  }

  const weeks = [];
  const re = /(\d{1,2})(?:\s*[-~～至到]\s*(\d{1,2}))?\s*周/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (match[2]) {
      weeks.push(...rangeNumbers(match[1], match[2], 1, 30));
    } else {
      weeks.push(toInteger(match[1]));
    }
  }
  return uniqueNumbers(weeks, 1, 30);
}

function normalizeCourseSlot(course) {
  const source = course && typeof course === "object" ? course : {};
  const weekdayKeys = ["weekday", "weekDay", "dayOfWeek", "day", "xqj", "dayIndex"];
  let weekday = NaN;
  for (const key of weekdayKeys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      weekday = normalizeWeekday(source[key], key);
      if (Number.isFinite(weekday)) {
        break;
      }
    }
  }

  let sections = [];
  if (Array.isArray(source.sections)) {
    sections = uniqueNumbers(source.sections, 1, 14);
  }
  if (sections.length === 0) {
    sections = uniqueNumbers([source.section, source.sectionIndex], 1, 14);
  }

  const pairs = [
    ["startSection", "endSection"],
    ["sectionStart", "sectionEnd"],
    ["start", "end"],
  ];
  for (const pair of pairs) {
    if (sections.length > 0) {
      break;
    }
    if (source[pair[0]] !== undefined || source[pair[1]] !== undefined) {
      sections = rangeNumbers(source[pair[0]], source[pair[1]], 1, 14);
    }
  }

  if (sections.length === 0) {
    [
      { text: source.section, loose: true },
      { text: source.sectionIndex, loose: true },
      { text: source.sectionText, loose: true },
      { text: source.sectionsText, loose: true },
      { text: source.rawSection, loose: true },
      { text: source.rawSections, loose: true },
      { text: source.timeText, loose: false },
      { text: source.period, loose: true },
      { text: source.periodText, loose: true },
      { text: source.rawText, loose: false },
    ].some((item) => {
      sections = parseSectionText(item.text);
      if (sections.length === 0 && item.loose && /[-,，、~～至到]/.test(String(item.text == null ? "" : item.text))) {
        sections = parseSectionSequence(item.text);
      }
      return sections.length > 0;
    });
  }

  let weeks = [];
  ["weeks", "weekList", "weekNumbers"].some((key) => {
    if (Array.isArray(source[key])) {
      weeks = uniqueNumbers(source[key], 1, 30);
      return weeks.length > 0;
    }
    return false;
  });
  if (weeks.length === 0) {
    ["weeksText", "rawWeeks", "weekRange", "weekText", "rawText"].some((key) => {
      weeks = parseWeekText(source[key]);
      return weeks.length > 0;
    });
  }

  return {
    weekday: Number.isFinite(weekday) ? weekday : null,
    sections,
    weeks,
  };
}

function getScheduleCourses(schedule) {
  if (!schedule || typeof schedule !== "object") {
    return [];
  }
  const keys = ["courses", "items", "schedule", "lessons", "courseList"];
  for (const key of keys) {
    if (Array.isArray(schedule[key])) {
      return schedule[key];
    }
  }
  return [];
}

function getClassroomNameFromSchedule(schedule, index) {
  const name = normalizeString(schedule && (
    schedule.roomName ||
    schedule.classroom ||
    schedule.displayClassroom ||
    schedule.canonicalClassroom ||
    schedule.name ||
    schedule.title
  ));
  return name || `classroom-${index + 1}`;
}

function getClassroomNameFromCourse(course) {
  return normalizeString(course && (
    course.classroom ||
    course.displayClassroom ||
    course.canonicalClassroom ||
    course.rawClassroom ||
    course.roomName ||
    course.room ||
    course.location ||
    course.venue
  ));
}

function deriveClassroomSchedulesFromClassSchedules(classSchedules) {
  const rooms = new Map();
  (Array.isArray(classSchedules) ? classSchedules : []).forEach((schedule) => {
    getScheduleCourses(schedule).forEach((course) => {
      const roomName = getClassroomNameFromCourse(course);
      if (!roomName) {
        return;
      }
      if (!rooms.has(roomName)) {
        rooms.set(roomName, { roomName, courses: [] });
      }
      rooms.get(roomName).courses.push(course);
    });
  });
  return Array.from(rooms.values());
}

function getActiveSnapshotDataSafe() {
  try {
    if (typeof releaseService.getActiveSnapshotData === "function") {
      return releaseService.getActiveSnapshotData();
    }
    return releaseService.readActiveReleaseSnapshot();
  } catch (error) {
    safeLog("admin-active-snapshot-read-failed", { error: error.message });
    return null;
  }
}

function getSnapshotResourceArray(snapshot, key) {
  if (!snapshot || typeof snapshot !== "object") {
    return [];
  }
  const resources = snapshot.resources || {};
  const map = {
    "class-schedules": snapshot.classSchedules,
    "teacher-schedules": resources.teacherSchedules,
    "classroom-schedules": resources.classroomSchedules || snapshot.classroomSchedules,
    "course-schedules": resources.courseSchedules,
  };
  return Array.isArray(map[key]) ? map[key] : [];
}

function getResourceArrayWithSource(key) {
  const snapshot = getActiveSnapshotDataSafe();
  const snapshotItems = getSnapshotResourceArray(snapshot, key);
  if (snapshotItems.length > 0) {
    return {
      items: snapshotItems,
      source: key === "classroom-schedules" ? "release.resources.classroomSchedules" : `release.${key}`,
      updatedAt: snapshot.updatedAt || null,
      snapshot,
    };
  }

  const filePath = FILE_MAP[key];
  return {
    items: readJsonArray(filePath),
    source: `storage.${key}`,
    updatedAt: fs.existsSync(filePath) ? fs.statSync(filePath).mtime.toISOString() : null,
    snapshot,
  };
}

function buildClassroomHeatmap(options) {
  const opt = options || {};
  const source = opt.source || "unknown";
  let classroomSchedules = Array.isArray(opt.classroomSchedules) ? opt.classroomSchedules : [];
  const classSchedules = Array.isArray(opt.classSchedules) ? opt.classSchedules : [];

  if (classroomSchedules.length === 0 && classSchedules.length > 0) {
    classroomSchedules = deriveClassroomSchedulesFromClassSchedules(classSchedules);
  }

  // 1. 获取并应用动态筛选维度
  const targetSemester = opt.semester;
  const targetWeek = opt.week && opt.week !== "all" ? parseInt(opt.week, 10) : null;
  const targetBuilding = opt.building; // 模糊匹配，如 "C7" 或 "B8"

  let filteredRooms = classroomSchedules;
  if (targetBuilding) {
    filteredRooms = filteredRooms.filter((room, index) => {
      const roomName = getClassroomNameFromSchedule(room, index);
      return roomName.toLowerCase().includes(targetBuilding.toLowerCase());
    });
  }

  const classroomIndex = Array.isArray(opt.classrooms) ? opt.classrooms : [];
  const totalClassrooms = targetBuilding
    ? filteredRooms.length
    : (classroomIndex.length > 0 ? classroomIndex.length : filteredRooms.length);
  const counts = Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => new Set()));
  const roomSlotCounts = new Map();
  
  // 记录每个格子被哪些教室占用以及什么课程，供前端点击展示详情
  const slotDetails = Array.from({ length: 7 }, () => Array.from({ length: 14 }, () => []));

  filteredRooms.forEach((room, index) => {
    const roomName = getClassroomNameFromSchedule(room, index);
    const roomSlots = roomSlotCounts.get(roomName) || new Set();
    
    getScheduleCourses(room).forEach((course) => {
      // 学期过滤
      const courseTerm = course.term || course.semester || room.semester || room.term || opt.updatedSemester;
      if (targetSemester && courseTerm && courseTerm !== targetSemester) {
        return;
      }

      const slot = normalizeCourseSlot(course);
      if (!slot.weekday || slot.sections.length === 0) {
        return;
      }

      // 周次过滤
      if (targetWeek && slot.weeks.length > 0 && !slot.weeks.includes(targetWeek)) {
        return;
      }

      slot.sections.forEach((section) => {
        const dayIndex = slot.weekday - 1;
        const sectionIndex = section - 1;
        counts[dayIndex][sectionIndex].add(roomName);
        roomSlots.add(`${slot.weekday}-${section}`);
        
        // 限制每个格子详情数量为 30 个，防止返回体积过大
        if (slotDetails[dayIndex][sectionIndex].length < 30) {
          slotDetails[dayIndex][sectionIndex].push({
            roomName: roomName,
            courseName: course.courseName || course.name || "未知课程",
            teacher: course.teacherName || course.teacher || "未知教师",
          });
        }
      });
    });
    roomSlotCounts.set(roomName, roomSlots);
  });

  const heatmap = Array.from({ length: 7 }, () => Array(14).fill(0));
  const rawCounts = Array.from({ length: 7 }, () => Array(14).fill(0));
  let totalOccupiedSlots = 0;
  let maxOccupancy = 0;

  // 统计摘要指标
  let maxOccupancyRate = 0;
  let maxOccupancyTime = "";
  let minOccupancyRate = 100;
  let minOccupancyTime = "";
  const weekdaysMap = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  for (let day = 0; day < 7; day += 1) {
    for (let section = 0; section < 14; section += 1) {
      const occupied = counts[day][section].size;
      rawCounts[day][section] = occupied;
      if (occupied > 0) {
        totalOccupiedSlots += 1;
      }
      maxOccupancy = Math.max(maxOccupancy, occupied);
      
      const rate = totalClassrooms > 0
        ? Math.min(100, Math.round((occupied / totalClassrooms) * 100))
        : 0;
      heatmap[day][section] = rate;

      // 寻找最繁忙/最空闲时段
      if (rate > maxOccupancyRate) {
        maxOccupancyRate = rate;
        maxOccupancyTime = `${weekdaysMap[day]} 第${section + 1}节`;
      }
      if (rate < minOccupancyRate) {
        minOccupancyRate = rate;
        minOccupancyTime = `${weekdaysMap[day]} 第${section + 1}节`;
      }
    }
  }

  // 计算工作日与周末平均占用率
  let workdaySum = 0;
  let weekendSum = 0;
  for (let section = 0; section < 14; section += 1) {
    for (let day = 0; day < 5; day += 1) {
      workdaySum += heatmap[day][section];
    }
    for (let day = 5; day < 7; day += 1) {
      weekendSum += heatmap[day][section];
    }
  }
  const workdayAvg = Math.round(workdaySum / (5 * 14));
  const weekendAvg = Math.round(weekendSum / (2 * 14));

  // 晚课占用率 (第 11 节至第 14 节)
  let nightSum = 0;
  for (let day = 0; day < 7; day += 1) {
    for (let section = 10; section < 14; section += 1) {
      nightSum += heatmap[day][section];
    }
  }
  const nightAvg = Math.round(nightSum / (7 * 4));

  // Top 10 繁忙教室
  const topRooms = Array.from(roomSlotCounts.entries())
    .map(([roomName, slots]) => ({
      roomName,
      occupiedSlots: slots.size,
      occupationRate: Math.min(100, Math.round((slots.size / 98) * 100)),
    }))
    .filter((item) => item.occupiedSlots > 0)
    .sort((left, right) => right.occupiedSlots - left.occupiedSlots)
    .slice(0, 10);

  const hasRecognizedSlots = totalOccupiedSlots > 0;
  return {
    classroomHeatmap: heatmap,
    classroomHeatmapCounts: rawCounts,
    classroomHeatmapDetails: slotDetails,
    classroomHeatmapMeta: {
      totalClassrooms,
      totalOccupiedSlots,
      source,
      updatedAt: opt.updatedAt || null,
      maxOccupancy,
      topRooms,
      summary: {
        maxOccupancyRate,
        maxOccupancyTime: maxOccupancyRate > 0 ? maxOccupancyTime : "无 (0%)",
        minOccupancyRate,
        minOccupancyTime: minOccupancyRate === 0 ? minOccupancyTime : "无 (都大于0%)",
        workdayAvg,
        weekendAvg,
        nightAvg
      },
      emptyReason: totalClassrooms === 0
        ? "no-classroom-schedules"
        : (hasRecognizedSlots ? "" : "no-recognized-course-slots"),
    },
  };
}

function resolveClassroomHeatmapData(filterOptions) {
  const classroomSource = getResourceArrayWithSource("classroom-schedules");
  const opts = filterOptions || {};
  if (classroomSource.items.length > 0) {
    return buildClassroomHeatmap(Object.assign({
      classroomSchedules: classroomSource.items,
      classrooms: classroomSource.snapshot?.resources?.classrooms || [],
      source: classroomSource.source,
      updatedAt: classroomSource.updatedAt,
    }, opts));
  }

  const snapshotClassSchedules = getSnapshotResourceArray(classroomSource.snapshot, "class-schedules");
  if (snapshotClassSchedules.length > 0) {
    return buildClassroomHeatmap(Object.assign({
      classSchedules: snapshotClassSchedules,
      source: "derived-from-classSchedules",
      updatedAt: classroomSource.snapshot && classroomSource.snapshot.updatedAt,
    }, opts));
  }

  const storageClassSchedules = readJsonArray(FILE_MAP["class-schedules"]);
  return buildClassroomHeatmap(Object.assign({
    classSchedules: storageClassSchedules,
    source: storageClassSchedules.length > 0 ? "derived-from-classSchedules" : "storage.classroom-schedules",
    updatedAt: getUpdatedAt("class-schedules") || getUpdatedAt("classroom-schedules"),
  }, opts));
}

function buildCollegeDistribution() {
  const classSource = getResourceArrayWithSource("class-schedules");
  const classes = classSource.items;
  const counts = new Map();
  classes.forEach((item) => {
    const name = normalizeString(item.collegeName || item.college || item.schoolName);
    if (!name) {
      return;
    }
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  const max = Math.max(0, ...counts.values());
  return Array.from(counts.entries())
    .map(([name, count]) => ({
      name,
      count,
      pct: max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);
}

function getAdminDataVersion() {
  const dashboard = appConfigService.getAdminDashboard();
  return (dashboard && dashboard.data && dashboard.data.dataVersion) || {};
}

function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { fs.unlinkSync(tempPath); } catch (e) {}
  }
}

function getResourceItemKey(resourceType, item, index) {
  const nameKey = RESOURCE_NAME_KEY_BY_TYPE[resourceType];
  const name = normalizeString(item && (item[nameKey] || item.name || item.title));
  return [
    resourceType,
    normalizeString(item && item.semester),
    name || `index-${index}`,
  ].join("::");
}

function mergeResourceItems(resourceType, existingItems, incomingItems) {
  const merged = new Map();
  existingItems.forEach((item, index) => {
    merged.set(getResourceItemKey(resourceType, item, index), item);
  });
  incomingItems.forEach((item, index) => {
    merged.set(getResourceItemKey(resourceType, item, index), item);
  });
  return Array.from(merged.values());
}

function persistResourceItems(resourceType, key, items, syncSource) {
  const filePath = FILE_MAP[key];
  writeJsonAtomic(filePath, items);
  updateSyncMeta(key, items.length, syncSource || "local-sync-client");
  return {
    success: true,
    resourceType,
    itemCount: items.length,
    updatedAt: new Date().toISOString(),
  };
}

function stageResourceChunk(resourceType, key, body, items) {
  const uploadId = sanitizeUploadId(body.uploadId);
  const totalChunks = parseInt(body.totalChunks || "0", 10);
  const chunkIndex = parseInt(body.chunkIndex || "0", 10);

  if (!uploadId || !Number.isFinite(totalChunks) || totalChunks <= 1) {
    const existing = body.mode === "merge" ? readJsonArray(FILE_MAP[key]) : [];
    const finalItems = body.mode === "merge"
      ? mergeResourceItems(resourceType, existing, items)
      : items;
    return persistResourceItems(resourceType, key, finalItems, body.syncSource);
  }

  if (!Number.isFinite(chunkIndex) || chunkIndex < 1 || chunkIndex > totalChunks) {
    const err = new Error("invalid resource chunk index");
    err.statusCode = 400;
    throw err;
  }

  const typeDir = path.join(RESOURCE_UPLOAD_DIR, resourceType);
  const uploadDir = path.join(typeDir, uploadId);
  const completePath = path.join(typeDir, `${uploadId}.complete.json`);
  fs.mkdirSync(typeDir, { recursive: true });
  if (fs.existsSync(completePath)) {
    return JSON.parse(fs.readFileSync(completePath, "utf-8"));
  }
  fs.mkdirSync(uploadDir, { recursive: true });

  const chunkPath = path.join(uploadDir, `chunk-${String(chunkIndex).padStart(6, "0")}.json`);
  writeJsonAtomic(chunkPath, {
    resourceType,
    chunkIndex,
    totalChunks,
    items,
    receivedAt: new Date().toISOString(),
  });

  const chunkFiles = fs.readdirSync(uploadDir)
    .filter((file) => /^chunk-\d+\.json$/.test(file))
    .sort();
  if (chunkFiles.length < totalChunks) {
    return {
      success: true,
      resourceType,
      uploadId,
      chunkIndex,
      totalChunks,
      stagedCount: chunkFiles.length,
      completed: false,
    };
  }

  const finalItems = [];
  for (let index = 1; index <= totalChunks; index += 1) {
    const filePath = path.join(uploadDir, `chunk-${String(index).padStart(6, "0")}.json`);
    if (!fs.existsSync(filePath)) {
      return {
        success: true,
        resourceType,
        uploadId,
        chunkIndex,
        totalChunks,
        stagedCount: chunkFiles.length,
        completed: false,
      };
    }
    const chunk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    finalItems.push(...(Array.isArray(chunk.items) ? chunk.items : []));
  }

  const result = persistResourceItems(resourceType, key, finalItems, body.syncSource);
  const completedResult = Object.assign(result, {
    uploadId,
    totalChunks,
    completed: true,
  });
  writeJsonAtomic(completePath, completedResult);
  try {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  } catch (error) {
    safeLog("resource-upload-cleanup-failed", { uploadDir, error: error.message });
  }
  return completedResult;
}

function getFallbackSemester() {
  if (process.env.PREFERRED_SEMESTER) {
    return process.env.PREFERRED_SEMESTER;
  }

  try {
    const catalogPath = FILE_MAP.catalog;
    if (fs.existsSync(catalogPath)) {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
      const semester = catalog?.semesters?.[0]?.value;
      if (semester) {
        return semester;
      }
    }
  } catch (error) {
    safeLog("read-fallback-semester-failed", { error: error.message });
  }

  return getDefaultTerm();
}

function parseClassSchedulesPayload(body) {
  if (Array.isArray(body)) {
    return {
      schedules: body,
      semester: "",
    };
  }

  if (body && typeof body === "object") {
    const schedules = body.classSchedules || body.schedules || body.items;
    return {
      schedules,
      semester: normalizeString(body.semester || body.preferredSemester),
    };
  }

  return {
    schedules: null,
    semester: "",
  };
}

function normalizeClassScheduleItem(item, fallbackSemester) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const semester = normalizeString(item.semester || fallbackSemester || getFallbackSemester());
  const collegeCode = normalizeString(item.collegeCode);
  const collegeName = normalizeString(item.collegeName);
  const grade = normalizeString(item.grade);
  const majorCode = normalizeString(item.majorCode || item.code);
  const majorName = normalizeString(item.majorName || item.name);
  const isAggregated = Boolean(item.isAggregated) || normalizeString(item.displayType) === "major-schedule";
  const displayType = normalizeString(item.displayType) || (isAggregated ? "major-schedule" : "class-schedule");
  const className =
    normalizeString(item.className) ||
    (isAggregated
      ? scheduleNormalizer.buildMajorScheduleName({ grade, majorName })
      : `未命名班级-${collegeCode}-${grade}-${majorCode}`);

  return {
    ...item,
    semester,
    collegeCode,
    collegeName,
    grade,
    majorCode,
    majorName,
    className,
    displayType,
    isAggregated,
    courses: Array.isArray(item.courses) ? item.courses : [],
  };
}

function getClassScheduleMajorKey(item) {
  return [
    item.semester,
    item.collegeCode,
    item.grade,
    item.majorCode,
  ].map(normalizeString).join("::");
}

function getClassScheduleCompositeKey(item) {
  return [
    item.semester,
    item.collegeCode,
    item.grade,
    item.majorCode,
    item.className,
  ].map(normalizeString).join("::");
}

function normalizeClassScheduleList(items, fallbackSemester) {
  return items
    .map((item) => normalizeClassScheduleItem(item, fallbackSemester))
    .filter(Boolean);
}

function isStorageMounted() {
  try {
    return (
      fs.existsSync(STORAGE_DIR) &&
      fs.statSync(STORAGE_DIR).isDirectory() &&
      fs.accessSync(STORAGE_DIR, fs.constants.R_OK | fs.constants.W_OK) === undefined
    );
  } catch (error) {
    return false;
  }
}

/**
 * 通用同步处理逻辑
 * @param {string} key 缓存的 key，如 'catalog', 'majors' 等
 * @param {Function} validateFn 校验函数，返回 boolean
 */
function createSyncHandler(key, validateFn) {
  return (req, res) => {
    const payload = req.body;

    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "请求体不能为空或空数组",
      });
    }

    if (containsSensitiveData(payload)) {
      safeLog("sensitive-data-blocked", { type: key });
      return res.status(400).json({
        success: false,
        message: "数据中包含敏感词（如 Cookie/JSESSIONID/密码），已被拒绝写入",
      });
    }

    if (validateFn && !validateFn(payload)) {
      return res.status(400).json({
        success: false,
        message: "数据 Schema 格式校验未通过",
      });
    }

    try {
      const filePath = FILE_MAP[key];
      // 写入物理文件
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
      
      // 计算条目数
      let count = 0;
      if (Array.isArray(payload)) {
        count = payload.length;
      } else if (key === "catalog") {
        count = (payload.colleges || []).length; // 学院数作为指标
      } else {
        count = Object.keys(payload).length;
      }

      // 更新同步元数据
      updateSyncMeta(key, count, "local-sync-client");

      safeLog("admin-sync-success", { key, count });

      return res.json({
        success: true,
        message: "数据同步成功",
        updatedAt: new Date().toISOString(),
        itemCount: count,
      });
    } catch (error) {
      safeLog("admin-sync-failed", { key, error: error.message });
      return res.status(500).json({
        success: false,
        message: `数据持久化失败: ${error.message}`,
      });
    }
  };
}

// 1. 同步 Catalog
router.post(
  "/sync/catalog",
  verifyAdminWriteAccess,
  createSyncHandler("catalog", (data) => {
    return data && Array.isArray(data.colleges) && Array.isArray(data.semesters) && Array.isArray(data.grades);
  })
);

// 2. 同步 Majors (自定义 handler)
router.post(
  "/sync/majors",
  verifyAdminWriteAccess,
  (req, res) => {
    console.log("[DEBUG /sync/majors] Received request, body length:", req.body ? req.body.length : "null");
    const payload = req.body;
    const allowHistorical = req.query.allowHistorical === 'true' || req.body.allowHistorical === true;

    // 1. 基础数组与空校验
    if (!payload || !Array.isArray(payload)) {
      return res.status(400).json({
        success: false,
        message: "请求体不能为空，且必须是专业数据数组",
        detail: "Payload must be a non-empty array of majors",
        hint: "确保客户端上传的数据为 Array 格式"
      });
    }

    if (containsSensitiveData(payload)) {
      safeLog("sensitive-data-blocked", { type: "majors" });
      return res.status(400).json({
        success: false,
        message: "数据中包含敏感词（如 Cookie/JSESSIONID/密码），已被拒绝写入",
      });
    }

    // 脱敏辅助函数，移除敏感信息
    const sanitizeItem = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      const copy = { ...obj };
      const sensitiveKeys = ["cookie", "cookies", "password", "passwd", "session", "sessionid", "jsessionid", "token", "ticket"];
      for (const k of Object.keys(copy)) {
        if (sensitiveKeys.includes(k.toLowerCase())) {
          delete copy[k];
        }
      }
      return copy;
    };

    try {
      // 2. 读取已存 catalog.json 辅助映射与提取学期
      const catalogPath = path.join(STORAGE_DIR, "catalog.json");
      let catalog = {};
      if (fs.existsSync(catalogPath)) {
        try {
          catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
        } catch (e) {
          console.error("Failed to parse catalog.json:", e);
        }
      }

      const collegeMap = {};
      if (catalog.colleges) {
        catalog.colleges.forEach(c => {
          collegeMap[c.code] = c.name;
        });
      }

      const semester = catalog.semesters?.[0]?.value || getDefaultTerm();
      const startYear = parseInt(semester.match(/^(\d{4})/)?.[1] || "2025", 10);

      // 3. 清洗与过滤
      const cleanedMajors = [];
      const seen = new Set();
      const crypto = require("crypto");
      
      const rawCount = payload.length;
      let skippedCount = 0;
      let generatedCodeCount = 0;

      const placeholders = ["请选择", "全部", "全部专业", "--请选择--", "请选择专业"];

      for (let i = 0; i < payload.length; i++) {
        const item = payload[i];
        if (!item || typeof item !== 'object') {
          skippedCount++;
          continue;
        }

        const collegeCodeRaw = item.collegeCode;
        const gradeRaw = item.grade;
        const majorCodeRaw = item.majorCode || item.code || item.value;
        const majorNameRaw = item.majorName || item.name || item.rawLabel || item.text || item.label;

        const collegeCode = collegeCodeRaw !== undefined && collegeCodeRaw !== null ? String(collegeCodeRaw).trim() : '';
        const grade = gradeRaw !== undefined && gradeRaw !== null ? String(gradeRaw).trim() : '';
        
        const majorName = typeof majorNameRaw === 'string' ? majorNameRaw.trim() : (majorNameRaw !== undefined && majorNameRaw !== null ? String(majorNameRaw).trim() : '');
        let majorCode = typeof majorCodeRaw === 'string' ? majorCodeRaw.trim() : (majorCodeRaw !== undefined && majorCodeRaw !== null ? String(majorCodeRaw).trim() : '');

        // 校验基础结构
        if (!collegeCode || !grade) {
          // 如果缺失了必要的属性，在脱敏后返回 400 指出具体字段
          return res.status(400).json({
            success: false,
            message: `数据校验未通过：缺失 collegeCode 或 grade`,
            detail: `第 ${i} 条数据不合规，内容: ${JSON.stringify(sanitizeItem(item))}`,
            hint: "请确保所有专业都包含有效的 collegeCode 和 grade 字段"
          });
        }

        // 跳过无效专业项 (空专业名或占位符)
        if (!majorName || placeholders.includes(majorName) || (!majorCode && !majorName)) {
          skippedCount++;
          continue;
        }

        // 如果没有 majorCode 但 majorName 有效，则使用 stable hash 生成
        if (!majorCode) {
          majorCode = crypto.createHash("md5").update(majorName).digest("hex").substring(0, 8);
          generatedCodeCount++;
        }

        // 非法年级过滤：如果不允许历史年级，则必须在 [startYear - 4, startYear] 范围内
        if (!allowHistorical) {
          const gradeNum = parseInt(grade, 10);
          if (isNaN(gradeNum) || gradeNum < (startYear - 4) || gradeNum > startYear) {
            skippedCount++;
            continue; // 过滤非在校年级
          }
        }

        const uniqueKey = `${collegeCode}_${grade}_${majorCode}`;
        if (seen.has(uniqueKey)) {
          skippedCount++;
          continue; // 去重跳过
        }
        seen.add(uniqueKey);

        cleanedMajors.push({
          collegeCode,
          grade,
          code: majorCode,
          name: majorName
        });
      }

      // 4. 清洗后如果有效专业数量为 0，返回 400
      if (cleanedMajors.length === 0) {
        return res.status(400).json({
          success: false,
          message: "没有有效专业数据",
          code: "NO_VALID_MAJORS",
          hint: "请检查教务联动解析结果。"
        });
      }

      // 5. 组织嵌套的 majors-index.json 数据结构
      const collegesObj = {};
      for (const major of cleanedMajors) {
        const { collegeCode, grade, code, name } = major;
        const collegeName = collegeMap[collegeCode] || "未知学院";

        if (!collegesObj[collegeCode]) {
          collegesObj[collegeCode] = {
            collegeCode,
            collegeName,
            grades: {}
          };
        }

        if (!collegesObj[collegeCode].grades[grade]) {
          collegesObj[collegeCode].grades[grade] = {
            grade,
            majors: []
          };
        }

        collegesObj[collegeCode].grades[grade].majors.push({
          majorCode: code,
          majorName: name,
          rawLabel: name
        });
      }

      const collegesList = Object.values(collegesObj).map(c => {
        return {
          collegeCode: c.collegeCode,
          collegeName: c.collegeName,
          grades: Object.values(c.grades).map(g => {
            g.majors.sort((a, b) => a.majorCode.localeCompare(b.majorCode));
            return g;
          }).sort((a, b) => b.grade.localeCompare(a.grade))
        };
      }).sort((a, b) => a.collegeCode.localeCompare(b.collegeCode));

      const gradesSet = new Set(cleanedMajors.map(m => m.grade));
      const gradesList = Array.from(gradesSet).sort((a, b) => b.localeCompare(a));

      const now = new Date();
      const yy = String(now.getFullYear()).substring(2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const version = `${yy}.${mm}.${dd}.01`;

      const majorsIndexPayload = {
        version,
        semester,
        gradeRange: allowHistorical ? "all" : "active",
        grades: gradesList,
        updatedAt: now.toISOString(),
        colleges: collegesList
      };

      // 6. 持久化存储
      const majorsIndexPath = path.join(STORAGE_DIR, "majors-index.json");
      fs.writeFileSync(majorsIndexPath, JSON.stringify(majorsIndexPayload, null, 2), "utf-8");

      // 更新同步元数据 (注意：元数据中的 itemCount 设为清洗后的专业总数)
      updateSyncMeta("majors", cleanedMajors.length, "local-sync-client");

      safeLog("admin-sync-success", { key: "majors", count: cleanedMajors.length });

      return res.json({
        success: true,
        message: "Majors synced",
        rawCount,
        savedCount: cleanedMajors.length,
        skippedCount,
        generatedCodeCount,
        version
      });

    } catch (err) {
      console.error('[sync/majors] failed:', err);
      return res.status(500).json({
        success: false,
        message: "Failed to save majors cache",
        detail: err.message,
        hint: "检查 server/storage 权限或数据结构"
      });
    }
  }
);

// 3. 同步 Class Schedules (支持 merge 增量合并与 replace 全量覆盖)
router.post(
  "/sync/class-schedules",
  verifyAdminWriteAccess,
  (req, res) => {
    const rawPayload = req.body;
    const { schedules, semester: payloadSemester } = parseClassSchedulesPayload(rawPayload);
    const mode = req.query.mode || "merge"; // 默认增量合并模式

    if (!Array.isArray(schedules)) {
      return res.status(400).json({
        success: false,
        message: "请求体不能为空，且必须是行政班级课表数组",
      });
    }

    if (containsSensitiveData(rawPayload)) {
      safeLog("sensitive-data-blocked", { type: "class-schedules" });
      return res.status(400).json({
        success: false,
        message: "数据中包含敏感词，已被拒绝写入",
      });
    }

    try {
      const filePath = FILE_MAP["class-schedules"];
      const fallbackSemester = payloadSemester || getFallbackSemester();
      const normalizedPayload = normalizeClassScheduleList(schedules, fallbackSemester);
      let finalData = [];

      if (mode === "merge" && fs.existsSync(filePath)) {
        try {
          const existingData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (Array.isArray(existingData)) {
            // 建立 semester + collegeCode + grade + majorCode + className 的稳定唯一 key
            const map = new Map();
            const touchedMajorKeys = new Set(normalizedPayload.map(getClassScheduleMajorKey));
            const payloadMajorInfo = new Map();
            normalizedPayload.forEach((item) => {
              const majorKey = getClassScheduleMajorKey(item);
              const info = payloadMajorInfo.get(majorKey) || { hasAdminClass: false };
              info.hasAdminClass = info.hasAdminClass || (!item.isAggregated && item.displayType !== "major-schedule");
              payloadMajorInfo.set(majorKey, info);
            });
            normalizeClassScheduleList(existingData, fallbackSemester).forEach((item) => {
              const majorKey = getClassScheduleMajorKey(item);
              const sameMajorUploaded = touchedMajorKeys.has(majorKey);
              const incomingInfo = payloadMajorInfo.get(majorKey) || {};
              const staleUnreliableClass =
                sameMajorUploaded &&
                !item.isAggregated &&
                item.displayType !== "major-schedule" &&
                !scheduleNormalizer.isReliableClassName(item.className, { courses: item.courses });
              const staleAggregate =
                sameMajorUploaded &&
                incomingInfo.hasAdminClass &&
                (item.isAggregated || item.displayType === "major-schedule");
              if (staleUnreliableClass) {
                return;
              }
              if (staleAggregate) {
                return;
              }
              map.set(getClassScheduleCompositeKey(item), item);
            });
            // 用 payload 里的数据去覆盖或新增
            normalizedPayload.forEach((item) => {
              map.set(getClassScheduleCompositeKey(item), item);
            });
            finalData = Array.from(map.values());
          } else {
            finalData = normalizedPayload;
          }
        } catch (e) {
          console.error("Failed to parse existing class-schedules.json, fallback to rewrite", e);
          finalData = normalizedPayload;
        }
      } else {
        // replace 模式或者原文件不存在
        finalData = normalizedPayload;
      }

      fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2), "utf-8");
      
      const count = finalData.length;
      updateSyncMeta("class-schedules", count, "local-sync-client");

      safeLog("admin-sync-success", { key: "class-schedules", count, mode });

      return res.json({
        success: true,
        message: `数据同步成功 (${mode === 'merge' ? '增量合并' : '全量覆盖'})`,
        updatedAt: new Date().toISOString(),
        itemCount: count,
        uploadedCount: normalizedPayload.length
      });
    } catch (error) {
      safeLog("admin-sync-failed", { key: "class-schedules", error: error.message });
      return res.status(500).json({
        success: false,
        message: `数据持久化失败: ${error.message}`,
      });
    }
  }
);

// 4. 同步 Teacher Schedules
router.post(
  "/sync/teacher-schedules",
  verifyAdminWriteAccess,
  createSyncHandler("teacher-schedules", (data) => {
    return Array.isArray(data);
  })
);

// 5. 同步 Classroom Schedules
router.post(
  "/sync/classroom-schedules",
  verifyAdminWriteAccess,
  createSyncHandler("classroom-schedules", (data) => {
    return Array.isArray(data);
  })
);

// 6. 同步 Course Schedules
router.post(
  "/sync/course-schedules",
  verifyAdminWriteAccess,
  createSyncHandler("course-schedules", (data) => {
    return Array.isArray(data);
  })
);

router.post(
  "/sync/resources",
  verifyAdminWriteAccess,
  (req, res) => {
    const resourceType = String(req.query.type || req.body.resourceType || "").trim();
    const key = RESOURCE_FILE_BY_TYPE[resourceType];
    if (!key) {
      return res.status(400).json({
        success: false,
        message: "type must be teacher, classroom, or course",
      });
    }

    const body = Array.isArray(req.body) ? { items: req.body } : (req.body || {});
    const items = body.items;
    if (!Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        message: "resources payload must be an array or { items: [] }",
      });
    }
    if (containsSensitiveData(req.body)) {
      safeLog("sensitive-data-blocked", { type: key });
      return res.status(400).json({
        success: false,
        message: "数据中包含敏感字段，已拒绝写入",
      });
    }

    try {
      return res.json(stageResourceChunk(resourceType, key, body, items));
    } catch (error) {
      safeLog("admin-sync-resources-failed", { key, error: error.message });
      return res.status(error.statusCode || 500).json({
        success: false,
        message: `resources persist failed: ${error.message}`,
      });
    }
  }
);

function getActiveSnapshotMeta() {
  const currentJsonPath = path.join(SNAPSHOTS_DIR, "current.json");
  if (!fs.existsSync(currentJsonPath)) {
    return null;
  }
  try {
    const stat = fs.statSync(currentJsonPath);
    if (!global.cachedSnapshotMeta || global.cachedSnapshotMeta.mtime !== stat.mtimeMs) {
      const content = fs.readFileSync(currentJsonPath, "utf-8");
      const snapshot = JSON.parse(content);
      global.cachedSnapshotMeta = {
        mtime: stat.mtimeMs,
        updatedAt: snapshot.updatedAt,
        version: snapshot.version,
        semester: snapshot.semester,
        collegesCount: snapshot.coverage?.collegeCount ?? (snapshot.catalog?.colleges?.length ?? 0),
        majorsCount: snapshot.coverage?.majorCount ?? (snapshot.majors?.length ?? 0),
        classScheduleCount: snapshot.coverage?.classScheduleCount ?? (snapshot.classSchedules?.length ?? 0),
        adminClassCount: snapshot.coverage?.adminClassCount ?? 0,
        majorAggregateCount: snapshot.coverage?.majorAggregateCount ?? 0,
        teacherScheduleCount: snapshot.coverage?.teacherScheduleCount ?? (snapshot.resources?.teacherSchedules?.length ?? 0),
        classroomScheduleCount: snapshot.coverage?.classroomScheduleCount ?? (snapshot.resources?.classroomSchedules?.length ?? 0),
        courseScheduleCount: snapshot.coverage?.courseScheduleCount ?? (snapshot.resources?.courseSchedules?.length ?? 0),
      };
    }
    return global.cachedSnapshotMeta;
  } catch (error) {
    console.error("Failed to read current snapshot metadata:", error);
    return null;
  }
}

router.post(
  "/release/upload",
  verifyAdminWriteAccess,
  express.raw({ type: "*/*", limit: RAW_UPLOAD_BODY_LIMIT }),
  async (req, res) => {
    let uploadPath = "";
    try {
      const uploadBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      if (!uploadBuffer.length) {
        return res.status(400).json({
          success: false,
          message: "release upload body is empty",
        });
      }
      const safeId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      uploadPath = path.join(SNAPSHOTS_DIR, `release-upload-${safeId}.bin`);
      await fs.promises.writeFile(uploadPath, uploadBuffer);
      const job = releaseWorkerManager.startReleaseJob("release-upload", {
        uploadPath,
        uploadSize: uploadBuffer.length,
        uploadedAt: new Date().toISOString(),
        cleanupUpload: true,
      });
      return res.status(202).json({
        success: true,
        message: "release upload queued",
        job,
        size: uploadBuffer.length,
      });
    } catch (error) {
      if (uploadPath) {
        try { await fs.promises.rm(uploadPath, { force: true }); } catch (cleanupError) {}
      }
      safeLog("release-upload-failed", { error: error.message, code: error.code || "" });
      if (error.code === "JOB_ALREADY_RUNNING") {
        return releaseWorkerManager.sendAlreadyRunning(res, error);
      }
      return res.status(error.statusCode || 500).json({
        success: false,
        code: error.code || "RELEASE_UPLOAD_FAILED",
        message: error.message,
      });
    }
  }
);

router.post(
  "/release/activate",
  verifyAdminWriteAccess,
  (req, res) => {
    try {
      const input = {
        version: req.body && req.body.version || "",
        snapshot: req.body && req.body.snapshot || null,
        releaseNote: "全校课表数据已更新",
        auditAction: "activate",
        auditReq: {
          ip: req.ip || "",
          headers: {
            "x-forwarded-for": req.headers["x-forwarded-for"] || "",
          },
        },
        auditSummary: `Activated release ${req.body && req.body.version || req.body && req.body.snapshot && (req.body.snapshot.version || req.body.snapshot.releaseVersion) || ""}`,
      };
      const job = releaseWorkerManager.startReleaseJob("release-activate", input);
      global.cachedSnapshotMeta = null;
      global.cachedSnapshotData = null;
      return res.status(202).json({
        success: true,
        message: "release activation started",
        job,
      });
    } catch (error) {
      const validation = error.validation;
      safeLog("release-activate-failed", { error: error.message, validation });
      return res.status(error.statusCode || (validation ? 400 : 500)).json({
        success: false,
        message: error.code === "JOB_ALREADY_RUNNING" ? "已有 Release 重任务正在运行" : (validation ? "release validation failed" : error.message),
        job: error.job || null,
        errors: validation ? validation.errors : undefined,
      });
    }
  }
);

router.get("/release/status", verifyAdminWriteAccess, (req, res) => {
  res.json({
    success: true,
    ...releaseService.getReleaseStatus(),
  });
});

router.get("/release/list", verifyAdminWriteAccess, (req, res) => {
  res.json({
    success: true,
    releases: releaseService.listReleases(req.query.limit),
  });
});

function sanitizeSnapshotUploadId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) return "";
  return id;
}

function getSnapshotTempPaths(uploadId) {
  const safeId = sanitizeSnapshotUploadId(uploadId);
  if (!safeId) return null;
  return {
    uploadId: safeId,
    tempJsonPath: path.join(SNAPSHOTS_DIR, `temp_upload-${safeId}.json`),
    tempGzPath: path.join(SNAPSHOTS_DIR, `temp_upload-${safeId}.json.gz`),
  };
}

function resolveSnapshotTempPaths(req) {
  const requested = sanitizeSnapshotUploadId(
    (req.body && (req.body.uploadId || req.body.snapshotUploadId)) ||
    req.query.uploadId ||
    req.headers["x-snapshot-upload-id"]
  );
  if (requested) {
    const paths = getSnapshotTempPaths(requested);
    if (paths && fs.existsSync(paths.tempJsonPath) && fs.existsSync(paths.tempGzPath)) {
      return paths;
    }
    return null;
  }
  // Backward compatible fixed names (legacy single-slot).
  const legacyJson = path.join(SNAPSHOTS_DIR, "temp_upload.json");
  const legacyGz = path.join(SNAPSHOTS_DIR, "temp_upload.json.gz");
  if (fs.existsSync(legacyJson) && fs.existsSync(legacyGz)) {
    return {
      uploadId: "legacy",
      tempJsonPath: legacyJson,
      tempGzPath: legacyGz,
      legacy: true,
    };
  }
  return null;
}

// 6.5. 上传快照临时文件（每请求独立 uploadId，避免并发覆盖）
router.post(
  "/snapshot/upload",
  verifyAdminWriteAccess,
  express.raw({ type: "*/*", limit: RAW_UPLOAD_BODY_LIMIT }),
  async (req, res) => {
    try {
      const buffer = req.body;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ success: false, message: "上传内容不能为空" });
      }

      // Check magic bytes for gzip: 1f 8b
      const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
      let jsonStr;
      
      if (isGzip) {
        try {
          jsonStr = zlib.gunzipSync(buffer).toString("utf-8");
        } catch (err) {
          return res.status(400).json({ success: false, message: "无效的 Gzip 压缩数据: " + err.message });
        }
      } else {
        jsonStr = buffer.toString("utf-8");
      }

      // Verify valid JSON
      let snapshotData;
      try {
        snapshotData = JSON.parse(jsonStr);
      } catch (err) {
        return res.status(400).json({ success: false, message: "解析 JSON 失败，数据可能损坏: " + err.message });
      }

      const uploadId = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
      const paths = getSnapshotTempPaths(uploadId);
      const tempJsonPath = paths.tempJsonPath;
      const tempGzPath = paths.tempGzPath;
      // Legacy single-slot paths kept for older clients that activate without uploadId.
      const legacyJsonPath = path.join(SNAPSHOTS_DIR, "temp_upload.json");
      const legacyGzPath = path.join(SNAPSHOTS_DIR, "temp_upload.json.gz");

      if (isGzip) {
        fs.writeFileSync(tempGzPath, buffer);
        fs.writeFileSync(tempJsonPath, jsonStr, "utf-8");
      } else {
        fs.writeFileSync(tempJsonPath, jsonStr, "utf-8");
        const gzBuffer = await gzipAsync(Buffer.from(jsonStr, "utf-8"));
        fs.writeFileSync(tempGzPath, gzBuffer);
      }
      // Best-effort legacy alias (still racy by design for old clients).
      try {
        fs.copyFileSync(tempJsonPath, legacyJsonPath);
        fs.copyFileSync(tempGzPath, legacyGzPath);
      } catch (aliasError) {
        safeLog("snapshot-legacy-alias-failed", { error: aliasError.message });
      }

      return res.json({
        success: true,
        message: "快照上传成功，暂存在临时文件，请调用 activate 接口激活",
        isGzip,
        size: buffer.length,
        uploadId,
        version: snapshotData.version,
        semester: snapshotData.semester
      });
    } catch (error) {
      console.error("Snapshot upload failed:", error);
      return res.status(500).json({ success: false, message: "上传处理失败: " + error.message });
    }
  }
);

// 6.6. 激活临时文件为正式快照
router.post(
  "/snapshot/activate",
  verifyAdminWriteAccess,
  async (req, res) => {
    try {
      const resolved = resolveSnapshotTempPaths(req);
      if (!resolved) {
        return res.status(400).json({ success: false, message: "未找到待激活的快照临时文件，请先上传" });
      }
      const tempJsonPath = resolved.tempJsonPath;
      const tempGzPath = resolved.tempGzPath;

      const jsonStr = fs.readFileSync(tempJsonPath, "utf-8");
      const snapshot = JSON.parse(jsonStr);

      if (!snapshot.version || !snapshot.semester || !snapshot.catalog || !snapshot.majors || !snapshot.classSchedules) {
        return res.status(400).json({ success: false, message: "快照数据校验失败：缺少关键快照属性" });
      }

      const classSchedulesCount = snapshot.classSchedules.length;
      const collegesCount = snapshot.catalog.colleges ? snapshot.catalog.colleges.length : 0;
      const majorsCount = snapshot.majors.length;
      const teacherScheduleCount = snapshot.resources?.teacherSchedules?.length || 0;
      const classroomScheduleCount = snapshot.resources?.classroomSchedules?.length || 0;
      const courseScheduleCount = snapshot.resources?.courseSchedules?.length || 0;

      if (classSchedulesCount <= 0) {
        return res.status(400).json({ success: false, message: "快照校验失败：classSchedules 数量必须大于 0" });
      }
      if (collegesCount <= 0) {
        return res.status(400).json({ success: false, message: "快照校验失败：catalog.colleges 数量必须大于 0" });
      }
      if (majorsCount <= 0) {
        return res.status(400).json({ success: false, message: "快照校验失败：majors 数量必须大于 0" });
      }

      const currentJsonPath = path.join(SNAPSHOTS_DIR, "current.json");
      const currentGzPath = path.join(SNAPSHOTS_DIR, "current.json.gz");

      if (fs.existsSync(currentGzPath)) {
        const timestamp = Date.now();
        let oldSemester = snapshot.semester;
        try {
          if (fs.existsSync(currentJsonPath)) {
            const oldSnapshot = JSON.parse(fs.readFileSync(currentJsonPath, "utf-8"));
            oldSemester = oldSnapshot.semester || oldSemester;
          }
        } catch (e) {}

        const backupGzPath = path.join(HISTORY_DIR, `snapshot-${oldSemester}-${timestamp}.json.gz`);
        fs.copyFileSync(currentGzPath, backupGzPath);
        console.log(`[Snapshot] Old snapshot backed up to: ${backupGzPath}`);

        try {
          const files = fs.readdirSync(HISTORY_DIR)
            .filter(f => f.startsWith("snapshot-") && f.endsWith(".json.gz"))
            .map(f => ({ name: f, path: path.join(HISTORY_DIR, f), time: fs.statSync(path.join(HISTORY_DIR, f)).mtimeMs }));
          
          if (files.length > 5) {
            files.sort((a, b) => a.time - b.time);
            const toDeleteCount = files.length - 5;
            for (let i = 0; i < toDeleteCount; i++) {
              fs.unlinkSync(files[i].path);
              console.log(`[Snapshot] Deleted old history file: ${files[i].path}`);
            }
          }
        } catch (err) {
          console.error("Failed to clean snapshot history:", err);
        }
      }

      fs.renameSync(tempJsonPath, currentJsonPath);
      fs.renameSync(tempGzPath, currentGzPath);

      global.cachedSnapshotMeta = null;
      global.cachedSnapshotData = null;

      const nowStr = new Date().toISOString();
      const meta = getSyncMeta();
      meta["snapshot"] = {
        updatedAt: nowStr,
        version: snapshot.version,
        semester: snapshot.semester,
        itemCount: classSchedulesCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["catalog"] = {
        updatedAt: nowStr,
        itemCount: collegesCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["majors"] = {
        updatedAt: nowStr,
        itemCount: majorsCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["class-schedules"] = {
        updatedAt: nowStr,
        itemCount: classSchedulesCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["teacher-schedules"] = {
        updatedAt: nowStr,
        itemCount: teacherScheduleCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["classroom-schedules"] = {
        updatedAt: nowStr,
        itemCount: classroomScheduleCount,
        syncSource: snapshot.source || "local-sync-client",
      };
      meta["course-schedules"] = {
        updatedAt: nowStr,
        itemCount: courseScheduleCount,
        syncSource: snapshot.source || "local-sync-client",
      };

      fs.writeFileSync(FILE_MAP["sync-meta"], JSON.stringify(meta, null, 2), "utf-8");
      appConfigService.touchDataVersionForSyncKey("snapshot", {
        updatedAt: nowStr,
        releaseVersion: snapshot.version,
        semester: snapshot.semester,
        releaseNote: "全校课表数据已更新",
      });

      return res.json({
        success: true,
        message: "快照激活成功，系统已切换至最新快照",
        version: snapshot.version,
        semester: snapshot.semester,
        counts: {
          collegesCount,
          majorsCount,
          classScheduleCount: classSchedulesCount,
          teacherScheduleCount,
          classroomScheduleCount,
          courseScheduleCount
        }
      });
    } catch (error) {
      console.error("Snapshot activation failed:", error);
      return res.status(500).json({ success: false, message: "激活失败: " + error.message });
    }
  }
);

// 7. 获取当前缓存状态（单一实现；合并历史重复 handler 字段）
router.get("/sync/status", verifyAdminWriteAccess, async (req, res) => {
  setJsonUtf8(res);
  try {
    const meta = getSyncMeta();
    const snapshotMeta = getActiveSnapshotMeta();
    const activeInfo = releaseService.getActiveReleaseInfo();
    const releaseStatus = {
      activeReleaseVersion: activeInfo?.version || null,
      activeReleaseUpdatedAt: activeInfo?.updatedAt || null,
      activeReleaseActivatedAt: activeInfo?.activatedAt || null,
    };
    const releasePackStatus = activeInfo?.version ? releaseService.getReleasePackQuickHealth(activeInfo.version) : null;
    const staticSync = staticReleaseSyncService.getSyncStatus({
      version: activeInfo?.version || releaseStatus.activeReleaseVersion || "",
    });
    const feedbackStats = feedbackService.getFeedbackStats();
    const resourcesUpdatedAt = getUpdatedAt("teacher-schedules") || getUpdatedAt("classroom-schedules") || getUpdatedAt("course-schedules") || (snapshotMeta ? snapshotMeta.updatedAt : null);
    const teacherScheduleCount = getItemCount("teacher-schedules") || (snapshotMeta ? snapshotMeta.teacherScheduleCount : 0);
    const classroomScheduleCount = getItemCount("classroom-schedules") || (snapshotMeta ? snapshotMeta.classroomScheduleCount : 0);
    const courseScheduleCount = getItemCount("course-schedules") || (snapshotMeta ? snapshotMeta.courseScheduleCount : 0);
    const semester = snapshotMeta ? snapshotMeta.semester : (meta.snapshot ? meta.snapshot.semester : getDefaultTerm());
    const classSchedulesUpdatedAt = getUpdatedAt("class-schedules");
    const relayUploads = relayService.listUploads();
    const stagingUploads = stagingUploadService.listUploadRecords({ limit: 1 }).records || [];
    const latestRelayUpload = relayUploads[0] || null;
    const latestJob = jobService.latestJob();
    const runningReleaseJob = jobService.getRunningJobByLockGroup(releaseWorkerManager.RELEASE_HEAVY_LOCK_GROUP);
    const fingerprint = buildFingerprintStatus();
    const intranetDiagnostic = typeof getCachedIntranetDiagnostic === "function"
      ? await getCachedIntranetDiagnostic(req.query.diagnoseNetwork === "true")
      : { intranetAccessible: false, status: "unavailable", checkedAtIso: null };
    const intranetAccessible = intranetDiagnostic.intranetAccessible === true;
    const payload = {
      dataSourceMode: config.DATA_SOURCE_MODE,
      activeReleaseVersion: releaseStatus.activeReleaseVersion,
      activeReleaseUpdatedAt: releaseStatus.activeReleaseUpdatedAt,
      activeReleaseActivatedAt: releaseStatus.activeReleaseActivatedAt,
      snapshotUpdatedAt: snapshotMeta ? snapshotMeta.updatedAt : (meta.snapshot ? meta.snapshot.updatedAt : null),
      snapshotVersion: snapshotMeta ? snapshotMeta.version : (meta.snapshot ? meta.snapshot.version : null),
      releaseVersion: releaseStatus.activeReleaseVersion || (meta.snapshot ? meta.snapshot.version : "-"),
      semester,
      collegesCount: snapshotMeta ? snapshotMeta.collegesCount : getItemCount("catalog"),
      majorsCount: snapshotMeta ? snapshotMeta.majorsCount : getItemCount("majors"),
      classScheduleCount: snapshotMeta ? snapshotMeta.classScheduleCount : getItemCount("class-schedules"),
      adminClassCount: snapshotMeta ? snapshotMeta.adminClassCount : 0,
      majorAggregateCount: snapshotMeta ? snapshotMeta.majorAggregateCount : 0,
      teacherScheduleCount,
      classroomScheduleCount,
      courseScheduleCount,
      resourcesUpdatedAt,
      resourcesVersion: snapshotMeta ? snapshotMeta.version : (releaseStatus.activeReleaseVersion || (meta.snapshot ? meta.snapshot.version : null)),
      feedbackCount: feedbackStats.total,
      openFeedbackCount: feedbackStats.open,
      catalogUpdatedAt: getUpdatedAt("catalog"),
      classSchedulesUpdatedAt,
      classScheduleUpdatedAt: classSchedulesUpdatedAt,
      teacherScheduleUpdatedAt: getUpdatedAt("teacher-schedules"),
      classroomScheduleUpdatedAt: getUpdatedAt("classroom-schedules"),
      courseScheduleUpdatedAt: getUpdatedAt("course-schedules"),
      lastUploadTime: classSchedulesUpdatedAt || resourcesUpdatedAt || (snapshotMeta ? snapshotMeta.updatedAt : null),
      intranetAccessible,
      intranetDiagnosticStatus: intranetDiagnostic.status,
      intranetDiagnosticCheckedAt: intranetDiagnostic.checkedAtIso || null,
      intranetMessage: intranetAccessible
        ? "当前服务器 DNS 能解析教务域名，但主流程仍建议使用本机校园网采集。"
        : "公网服务器无法访问学校内网是预期情况；主流程请在校园网电脑或接力代理端采集。",
      latestRelayUpload,
      latestStagingUpload: stagingUploads[0] || null,
      latestJob: jobService.publicJob(latestJob),
      runningReleaseJob: jobService.publicJob(runningReleaseJob),
      releaseHeavyBusy: Boolean(runningReleaseJob),
      releasePackStatus,
      releasePackHealthy: Boolean(releasePackStatus && releasePackStatus.healthy),
      staticSync,
      activeCanonicalHash: fingerprint.activeCanonicalHash,
      stagingCanonicalHash: fingerprint.stagingCanonicalHash,
      stagingSameAsActive: Boolean(fingerprint.activeCanonicalHash && fingerprint.stagingCanonicalHash && fingerprint.activeCanonicalHash === fingerprint.stagingCanonicalHash),
      stagingNeedsPublish: Boolean(fingerprint.stagingCanonicalHash && fingerprint.activeCanonicalHash !== fingerprint.stagingCanonicalHash),
      staticManifestUrl: staticSync.staticManifestUrl,
      staticClassIndexUrl: staticSync.staticClassIndexUrl,
      staticEmptyRoomIndexUrl: staticSync.staticEmptyRoomIndexUrl,
      openRestyStaticSyncStatus: staticSync.status,
      lastStaticSyncTime: staticSync.lastSyncTime || staticSync.syncedAt || staticSync.updatedAt || null,
      staticRetainedReleases: staticSync.keptReleases || [],
      storageMounted: isStorageMounted(),
      storagePath: STORAGE_DIR,
      metaDetails: meta,
      adminSessionAuthenticated: adminAuth.isAdminRequest(req),
      apiTokenConfigured: Boolean(config.ADMIN_API_TOKEN),
      resourceCounts: activeInfo && activeInfo.resourceCounts || releasePackStatus && releasePackStatus.resourceCounts || null,
    };
    const lifecycleStatus = releaseLifecycleService.buildLifecycleStatus({
      reason: "sync-status",
      uploadLimit: 50,
      reconcile: false,
    });
    Object.assign(payload, lifecycleStatus, {
      releaseVersion: lifecycleStatus.activeReleaseVersion || payload.releaseVersion,
      activeReleaseVersion: lifecycleStatus.activeReleaseVersion || payload.activeReleaseVersion,
      latestStagingUpload: lifecycleStatus.latestStagingUpload || payload.latestStagingUpload,
      releasePackStatus: lifecycleStatus.releasePackStatus || payload.releasePackStatus,
      releasePackHealthy: Boolean(lifecycleStatus.releasePackHealthy || payload.releasePackHealthy),
      staticSync: lifecycleStatus.staticSync || payload.staticSync,
      staticManifestUrl: lifecycleStatus.staticManifestUrl || payload.staticManifestUrl,
      staticClassIndexUrl: lifecycleStatus.staticClassIndexUrl || payload.staticClassIndexUrl,
      staticEmptyRoomIndexUrl: lifecycleStatus.staticEmptyRoomIndexUrl || payload.staticEmptyRoomIndexUrl,
      openRestyStaticSyncStatus: lifecycleStatus.openRestyStaticSyncStatus || payload.openRestyStaticSyncStatus,
      lastStaticSyncTime: lifecycleStatus.lastStaticSyncTime || payload.lastStaticSyncTime,
      staticRetainedReleases: lifecycleStatus.staticRetainedReleases || payload.staticRetainedReleases,
    });
    payload.counts = {
      collegeCount: payload.collegesCount || 0,
      majorCount: payload.majorsCount || 0,
      classScheduleCount: payload.classScheduleCount || 0,
      adminClassCount: payload.adminClassCount || 0,
      majorAggregateCount: payload.majorAggregateCount || 0,
      teacherScheduleCount: payload.teacherScheduleCount || 0,
      classroomScheduleCount: payload.classroomScheduleCount || 0,
      courseScheduleCount: payload.courseScheduleCount || 0,
    };
    attachSyncOpsSummary(payload, {
      publisherRun: getLatestPublisherRunSafe(),
      stagingUploads: lifecycleStatus.stagingUploads || [],
    });

    return res.json({
      success: true,
      data: payload,
      ...payload,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 8. 管理员审核贡献接口
// POST /api/admin/review/contributions
router.post(
  "/review/contributions",
  verifyAdminWriteAccess,
  (req, res) => {
    const { id, action } = req.body;
    if (!id || !action) {
      return res.status(400).json({
        success: false,
        message: "id 和 action 参数是必需的",
      });
    }

    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({
        success: false,
        message: "action 必须是 'approve' 或 'reject'",
      });
    }

    try {
      // 1. 读取贡献数据
      let contributions = [];
      const contribPath = FILE_MAP["contributions"];
      if (fs.existsSync(contribPath)) {
        contributions = JSON.parse(fs.readFileSync(contribPath, "utf-8"));
      }

      const index = contributions.findIndex((c) => c.id === id);
      if (index === -1) {
        return res.status(404).json({
          success: false,
          message: "找不到该贡献记录",
        });
      }

      const contrib = contributions[index];
      
      if (action === "reject") {
        contrib.reviewed = true;
        contrib.rejected = true;
        contrib.updatedAt = new Date().toISOString();
        fs.writeFileSync(contribPath, JSON.stringify(contributions, null, 2), "utf-8");
        return res.json({
          success: true,
          message: "已成功拒绝该贡献课表",
        });
      }

      // 2. approve 合并逻辑
      contrib.reviewed = true;
      contrib.rejected = false;
      contrib.updatedAt = new Date().toISOString();

      const classSchedPath = FILE_MAP["class-schedules"];
      let classSchedules = [];
      if (fs.existsSync(classSchedPath)) {
        classSchedules = JSON.parse(fs.readFileSync(classSchedPath, "utf-8"));
      }

      // 查找相同班级的课表进行覆盖，或者追加
      const classIndex = classSchedules.findIndex(
        (c) => c.className === contrib.className
      );

      const targetClassSchedule = {
        className: contrib.className,
        collegeCode: contrib.collegeCode || "",
        collegeName: contrib.collegeName || "",
        grade: contrib.grade || "",
        majorCode: contrib.majorCode || "",
        majorName: contrib.majorName || "",
        courses: contrib.courses,
      };

      if (classIndex >= 0) {
        classSchedules[classIndex] = targetClassSchedule;
        console.log(`[Review] 已覆盖已有的班级课表: ${contrib.className}`);
      } else {
        classSchedules.push(targetClassSchedule);
        console.log(`[Review] 已追加新班级课表: ${contrib.className}`);
      }

      // 3. 写入文件
      fs.writeFileSync(classSchedPath, JSON.stringify(classSchedules, null, 2), "utf-8");
      fs.writeFileSync(contribPath, JSON.stringify(contributions, null, 2), "utf-8");

      // 4. 更新同步元数据
      updateSyncMeta("class-schedules", classSchedules.length, "user-contribution");

      return res.json({
        success: true,
        message: "贡献审核通过，课表已成功合并进公共缓存",
        className: contrib.className,
      });

    } catch (error) {
      safeLog("review-contribution-failed", { error: error.message });
      return res.status(500).json({
        success: false,
        message: `审核处理失败: ${error.message}`,
      });
    }
  }
);

router.get("/dashboard", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const dashboardData = appConfigService.getAdminDashboard();
    if (dashboardData.success && dashboardData.data) {
      const heatmap = resolveClassroomHeatmapData();
      dashboardData.data.classroomHeatmap = heatmap.classroomHeatmap;
      dashboardData.data.classroomHeatmapCounts = heatmap.classroomHeatmapCounts;
      dashboardData.data.classroomHeatmapDetails = heatmap.classroomHeatmapDetails;
      dashboardData.data.classroomHeatmapMeta = heatmap.classroomHeatmapMeta;
      dashboardData.data.collegeDistribution = buildCollegeDistribution();
    }
    return res.json(dashboardData);
  } catch (error) {
    safeLog("admin-dashboard-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/classroom-heatmap", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { semester, week, building } = req.query;
    const heatmap = resolveClassroomHeatmapData({ semester, week, building });
    return res.json({
      success: true,
      data: heatmap
    });
  } catch (error) {
    safeLog("admin-classroom-heatmap-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/config", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const typed = settingsDomainService.getTypedSettings();
    return res.json({
      success: true,
      data: appConfigService.getAdminConfig(),
      publicConfig: appConfigService.getPublicAppConfig().data,
      settings: typed,
      version: typed.version,
      etag: typed.etag,
    });
  } catch (error) {
    safeLog("admin-config-get-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/settings", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const typed = settingsDomainService.getTypedSettings();
    return res.json({ success: true, ...typed });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/settings/preview", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({ success: true, ...settingsDomainService.previewDiff(req.body || {}) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/settings", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const client = String(req.get("x-fosu-admin-client") || "").toLowerCase();
    const body = req.body || {};
    const prepared = settingsDomainService.prepareTypedSettingsMutation(body, {
      expectedVersion: req.get("if-match") || body.expectedVersion || body.version,
      ifMatch: req.get("if-match"),
      requireIfMatch: client === "next",
    });
    const result = commitWithBackup({
      type: "config",
      sourceFile: appConfigService.CONFIG_PATH,
      fallbackData: prepared.backupData,
      commit: () => settingsDomainService.commitPreparedTypedSettingsMutation(prepared),
    });
    writeAuditLog(req, "save", "settings", "admin-config", "保存类型化系统配置");
    return res.json({
      success: true,
      data: result.data,
      version: result.version,
      etag: result.etag,
      settings: result.settings,
      publicConfig: appConfigService.getPublicAppConfig().data,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      code: error.code,
      currentVersion: error.currentVersion,
    });
  }
});

router.post("/config", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const client = String(req.get("x-fosu-admin-client") || "").toLowerCase();
    createBackup("config", appConfigService.CONFIG_PATH);
    if (client === "next") {
      // Vue should use /settings; keep compat with typed save
      const result = settingsDomainService.saveTypedSettings(req.body || {}, {
        expectedVersion: req.get("if-match") || (req.body && req.body.expectedVersion),
        requireIfMatch: true,
      });
      writeAuditLog(req, "save", "config", "admin-config", "保存系统配置(typed)");
      return res.json({
        success: true,
        data: result.data,
        version: result.version,
        publicConfig: appConfigService.getPublicAppConfig().data,
      });
    }
    const result = appConfigService.saveAdminConfig(req.body || {});
    writeAuditLog(req, "save", "config", "admin-config", "保存系统配置并应用");
    return res.json({
      success: true,
      data: result,
      publicConfig: appConfigService.getPublicAppConfig().data,
    });
  } catch (error) {
    safeLog("admin-config-save-failed", { error: error.message });
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      code: error.code,
      currentVersion: error.currentVersion,
    });
  }
});

router.get("/notices", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      items: contentDomainService.listNotices(),
    });
  } catch (error) {
    safeLog("admin-notices-list-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/notices", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("notices", contentDomainService.NOTICES_PATH);
    const item = contentDomainService.createNotice(req.body || {});
    writeAuditLog(req, "create", "notices", item.id, `创建公告: ${item.title}`);
    return res.json({
      success: true,
      item,
    });
  } catch (error) {
    safeLog("admin-notice-create-failed", { error: error.message });
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      code: error.code || undefined,
    });
  }
});

router.put("/notices/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("notices", contentDomainService.NOTICES_PATH);
    const body = req.body || {};
    const client = String(req.get("x-fosu-admin-client") || "").toLowerCase();
    const ifMatch = req.get("if-match") || body.expectedVersion || body.version;
    const item = contentDomainService.updateNotice(req.params.id, body, {
      expectedVersion: ifMatch,
      ifMatch,
      requireIfMatch: client === "next",
      client,
    });
    writeAuditLog(req, "update", "notices", req.params.id, `编辑公告: ${item.title}`);
    return res.json({
      success: true,
      item,
      etag: item.version,
    });
  } catch (error) {
    safeLog("admin-notice-update-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      code: error.code || undefined,
      currentVersion: error.currentVersion,
    });
  }
});

router.delete("/notices/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("notices", contentDomainService.NOTICES_PATH);
    const deleted = contentDomainService.deleteNotice(req.params.id);
    writeAuditLog(req, "delete", "notices", req.params.id, `删除公告 id: ${req.params.id}`);
    return res.json({
      success: true,
      deleted,
    });
  } catch (error) {
    safeLog("admin-notice-delete-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.get("/news", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      items: contentDomainService.listNews(),
    });
  } catch (error) {
    safeLog("admin-news-list-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/news", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("news", contentDomainService.NEWS_PATH);
    const item = contentDomainService.createNews(req.body || {});
    writeAuditLog(req, "create", "news", item.id, `创建动态: ${item.title}`);
    return res.json({
      success: true,
      item,
    });
  } catch (error) {
    safeLog("admin-news-create-failed", { error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.put("/news/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("news", contentDomainService.NEWS_PATH);
    const body = req.body || {};
    const client = String(req.get("x-fosu-admin-client") || "").toLowerCase();
    const ifMatch = req.get("if-match") || body.expectedVersion || body.version;
    const item = contentDomainService.updateNews(req.params.id, body, {
      expectedVersion: ifMatch,
      ifMatch,
      requireIfMatch: client === "next",
      client,
    });
    writeAuditLog(req, "update", "news", req.params.id, `编辑动态: ${item.title}`);
    return res.json({
      success: true,
      item,
      etag: item.version,
    });
  } catch (error) {
    safeLog("admin-news-update-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      code: error.code || undefined,
      currentVersion: error.currentVersion,
    });
  }
});

router.delete("/news/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    createBackup("news", contentDomainService.NEWS_PATH);
    const deleted = contentDomainService.deleteNews(req.params.id);
    writeAuditLog(req, "delete", "news", req.params.id, `删除动态 id: ${req.params.id}`);
    return res.json({
      success: true,
      deleted,
    });
  } catch (error) {
    safeLog("admin-news-delete-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.get("/feedbacks", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const overview = feedbackService.getFeedbackOverview();
    const items = feedbackService.listFeedback(req.query);
    return res.json({
      success: true,
      items,
      total: items.length,
      stats: overview.stats,
      types: overview.types,
    });
  } catch (error) {
    safeLog("admin-feedbacks-list-failed", { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/feedbacks/:id", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const feedbackFile = path.join(STORAGE_DIR, "feedbacks.json");
    createBackup("feedback", feedbackFile);
    const record = feedbackService.updateFeedbackReview(req.params.id, req.body || {});
    writeAuditLog(req, "update", "feedback", req.params.id, `编辑反馈备注及状态: ${req.body.status || record.status}`);
    return res.json({
      success: true,
      item: record,
      stats: feedbackService.getFeedbackStats(),
    });
  } catch (error) {
    safeLog("admin-feedbacks-update-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.get("/feedback", verifyAdminToken, (req, res) => {
  try {
    const overview = feedbackService.getFeedbackOverview();
    const feedback = feedbackService.listFeedback(req.query);
    return res.json({
      success: true,
      feedback,
      items: feedback,
      total: feedback.length,
      stats: overview.stats,
      types: overview.types,
      filters: {
        limit: req.query.limit || "100",
        status: req.query.status || "",
        type: req.query.type || "",
        keyword: req.query.keyword || "",
        days: req.query.days || "",
      },
    });
  } catch (error) {
    safeLog("admin-feedback-list-failed", { error: error.message });
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/feedback/export.csv", verifyAdminToken, (req, res) => {
  try {
    const csv = feedbackService.exportFeedbackCsv(req.query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="fosu-feedback-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (error) {
    safeLog("admin-feedback-export-failed", { error: error.message });
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/feedback/:id", verifyAdminToken, (req, res) => {
  try {
    return res.json({
      success: true,
      feedback: feedbackService.getFeedbackById(req.params.id),
    });
  } catch (error) {
    safeLog("admin-feedback-detail-failed", { id: req.params.id, error: error.message });
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * 数据质量检测中心检测核心逻辑
 */
function generateQualityReport() {
  const report = qualityDomainService.buildQualityReport();
  return { stats: report.summary, anomalies: report.active };
}
function getCatalogMeta() {
  // Prefer domain service (versioned document, flat entries for list mappers)
  try {
    return catalogDomainService.getCatalogMeta();
  } catch (e) {
    try {
      if (fs.existsSync(CATALOG_META_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CATALOG_META_PATH, "utf-8"));
        if (raw && raw.entries) return raw.entries;
        return raw || {};
      }
    } catch (err) {}
    return {};
  }
}

function saveCatalogMeta(meta) {
  try {
    catalogDomainService.saveCatalogMetaBulk(meta || {});
  } catch (e) {
    safeLog("save-catalog-meta-failed", { error: e.message });
  }
}

/**
 * 1. GET /api/admin/catalog/stats
 * 数据资源指标统计
 */
router.get("/catalog/stats", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const snapshot = getActiveSnapshotDataSafe();
    const catalog = snapshot?.catalog || readJsonFile(FILE_MAP.catalog, { colleges: [], semesters: [], grades: [] });
    const classes = getResourceArrayWithSource("class-schedules").items;
    const teachers = getResourceArrayWithSource("teacher-schedules").items;
    const classrooms = getResourceArrayWithSource("classroom-schedules").items;
    const courses = getResourceArrayWithSource("course-schedules").items;
    
    const meta = getAdminDataVersion();
    
    return res.json({
      success: true,
      data: {
        classCount: classes.length,
        teacherCount: teachers.length,
        classroomCount: classrooms.length,
        courseCount: courses.length,
        collegeCount: (catalog.colleges || []).length,
        semesterCount: (catalog.semesters || []).length,
        gradeCount: (catalog.grades || []).length,
        currentSemester: catalog.semesters?.[0]?.value || getDefaultTerm(),
        updatedAt: meta.classScheduleUpdatedAt || new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/catalog/resources", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({ success: true, ...catalogDomainService.listResources(req.query || {}) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message, code: error.code, details: error.details });
  }
});

router.get("/catalog/relationships", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({ success: true, ...catalogDomainService.getRelationships() });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message, code: error.code });
  }
});

router.get("/catalog/export", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const exported = catalogDomainService.exportRows(req.query || {});
    res.setHeader("Content-Type", exported.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
    res.setHeader("X-Fosu-Catalog-Generation", exported.generationId);
    return res.send(exported.body);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message, code: error.code });
  }
});

router.post("/catalog/import/preview", requireCatalogWriteEnabled, verifyAdminWriteAccess, adminAuth.requireScopes(["catalog:write"]), (req, res) => {
  try {
    return res.json({ success: true, ...catalogDomainService.previewImport(req.body || {}) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message, code: error.code, currentVersion: error.currentVersion, details: error.details });
  }
});

router.post("/catalog/import/apply", requireCatalogWriteEnabled, verifyAdminWriteAccess, adminAuth.requireScopes(["catalog:write"]), (req, res) => {
  try {
    const body = req.body || {};
    const result = catalogDomainService.applyImport(body.previewId, {
      ifMatch: req.get("if-match"),
      confirm: body.confirm,
      auditContext: catalogAuditContext(req),
    });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message, code: error.code, currentVersion: error.currentVersion });
  }
});

/**
 * 2. GET /api/admin/catalog/list
 * 数据分类列表查询 (行政班、教师、教室、课程、学院专业、原始快照)
 */
router.get("/catalog/list", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { type, semester, keyword, page = 1, pageSize = 20 } = req.query;
    const limit = parseInt(pageSize, 10);
    const offset = (parseInt(page, 10) - 1) * limit;
    const kw = String(keyword || "").trim().toLowerCase();
    
    const catMeta = getCatalogMeta();
    let list = [];
    
    if (type === "class") {
      const raw = getResourceArrayWithSource("class-schedules").items;
      list = raw.map(item => {
        const metaInfo = catMeta[`class::${item.className}`] || {};
        return {
          id: item.className,
          className: item.className,
          collegeName: item.collegeName || "其他",
          majorName: item.majorName || "通用",
          grade: item.grade || "-",
          semester: item.semester || semester || "-",
          coursesCount: (item.courses || []).length,
          displayName: metaInfo.displayName || "",
          note: metaInfo.note || "",
          hidden: !!metaInfo.hidden,
          tags: metaInfo.tags || []
        };
      });
      if (semester) {
        list = list.filter(x => x.semester === semester);
      }
      if (kw) {
        list = list.filter(x => 
          x.className.toLowerCase().includes(kw) || 
          x.collegeName.toLowerCase().includes(kw) || 
          x.majorName.toLowerCase().includes(kw) ||
          (x.displayName && x.displayName.toLowerCase().includes(kw))
        );
      }
    } else if (type === "teacher") {
      const raw = getResourceArrayWithSource("teacher-schedules").items;
      list = raw.map(item => {
        const metaInfo = catMeta[`teacher::${item.teacherName}`] || {};
        const classes = Array.from(new Set((item.courses || []).map(c => c.className).filter(Boolean)));
        return {
          id: item.teacherName,
          teacherName: item.teacherName,
          collegeName: item.collegeName || "教务系统",
          semester: item.semester || semester || "-",
          coursesCount: (item.courses || []).length,
          classesCount: classes.length,
          displayName: metaInfo.displayName || "",
          note: metaInfo.note || "",
          hidden: !!metaInfo.hidden,
          tags: metaInfo.tags || []
        };
      });
      if (semester) {
        list = list.filter(x => x.semester === semester);
      }
      if (kw) {
        list = list.filter(x => 
          x.teacherName.toLowerCase().includes(kw) || 
          x.collegeName.toLowerCase().includes(kw) ||
          (x.displayName && x.displayName.toLowerCase().includes(kw))
        );
      }
    } else if (type === "classroom") {
      const raw = getResourceArrayWithSource("classroom-schedules").items;
      list = raw.map(item => {
        const metaInfo = catMeta[`classroom::${item.roomName}`] || {};
        const count = (item.courses || []).length;
        const sectionsSet = new Set();
        (item.courses || []).forEach(c => {
          (c.weeks || []).forEach(w => {
            (c.sections || []).forEach(s => {
              sectionsSet.add(`${w}_${c.dayOfWeek || c.weekday}_${s}`);
            });
          });
        });
        const occupationRate = Math.min(100, Math.round((sectionsSet.size / 98) * 100)); // 估算 7天*14节 = 98节 为满额
        
        let buildingName = "其他";
        const buildingMatch = item.roomName.match(/^([^\d]+)/);
        if (buildingMatch) {
          buildingName = buildingMatch[1].trim();
        }
        
        return {
          id: item.roomName,
          roomName: item.roomName,
          buildingName,
          semester: item.semester || semester || "-",
          coursesCount: count,
          occupationRate: `${occupationRate}%`,
          displayName: metaInfo.displayName || "",
          note: metaInfo.note || "",
          hidden: !!metaInfo.hidden,
          tags: metaInfo.tags || []
        };
      });
      if (semester) {
        list = list.filter(x => x.semester === semester);
      }
      if (kw) {
        list = list.filter(x => 
          x.roomName.toLowerCase().includes(kw) || 
          x.buildingName.toLowerCase().includes(kw) ||
          (x.displayName && x.displayName.toLowerCase().includes(kw))
        );
      }
    } else if (type === "course") {
      const raw = getResourceArrayWithSource("course-schedules").items;
      list = raw.map(item => {
        const metaInfo = catMeta[`course::${item.courseName}`] || {};
        const teachers = Array.from(new Set((item.courses || []).map(c => c.teacherName).filter(Boolean)));
        const classes = Array.from(new Set((item.courses || []).map(c => c.className).filter(Boolean)));
        const classrooms = Array.from(new Set((item.courses || []).map(c => c.classroom).filter(Boolean)));
        return {
          id: item.courseName,
          courseName: item.courseName,
          collegeName: item.collegeName || "教务公开课",
          semester: item.semester || semester || "-",
          teachersCount: teachers.length,
          classesCount: classes.length,
          classroomsCount: classrooms.length,
          displayName: metaInfo.displayName || "",
          note: metaInfo.note || "",
          hidden: !!metaInfo.hidden,
          tags: metaInfo.tags || []
        };
      });
      if (semester) {
        list = list.filter(x => x.semester === semester);
      }
      if (kw) {
        list = list.filter(x => 
          x.courseName.toLowerCase().includes(kw) || 
          x.collegeName.toLowerCase().includes(kw) ||
          (x.displayName && x.displayName.toLowerCase().includes(kw))
        );
      }
    } else if (type === "major") {
      const majorsPayload = readJsonFile(path.join(STORAGE_DIR, "majors-index.json"), { colleges: [] });
      const flat = [];
      (majorsPayload.colleges || []).forEach(college => {
        (college.grades || []).forEach(gradeItem => {
          (gradeItem.majors || []).forEach(m => {
            flat.push({
              collegeCode: college.collegeCode,
              collegeName: college.collegeName,
              grade: gradeItem.grade,
              majorCode: m.majorCode,
              majorName: m.majorName,
              semester: majorsPayload.semester || "-"
            });
          });
        });
      });
      list = flat;
      if (kw) {
        list = list.filter(x => 
          x.majorName.toLowerCase().includes(kw) || 
          x.collegeName.toLowerCase().includes(kw) || 
          x.grade.includes(kw)
        );
      }
    } else if (type === "snapshot") {
      const snapFiles = fs.existsSync(SNAPSHOTS_DIR) ? fs.readdirSync(SNAPSHOTS_DIR) : [];
      list = snapFiles
        .filter(f => f.endsWith(".json"))
        .map(f => {
          const stat = fs.statSync(path.join(SNAPSHOTS_DIR, f));
          return {
            id: f,
            filename: f,
            size: `${Math.round(stat.size / 1024)} KB`,
            createdAt: stat.mtime.toISOString(),
            type: f.includes("normalized") ? "标准化后" : "教务快照"
          };
        });
      if (kw) {
        list = list.filter(x => x.filename.toLowerCase().includes(kw));
      }
    }
    
    const paginated = list.slice(offset, offset + limit);
    
    return res.json({
      success: true,
      items: paginated,
      total: list.length,
      page: parseInt(page, 10),
      pageSize: limit
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 3. GET /api/admin/catalog/detail
 * 获取单项资源的原始和可视化预览数据
 */
router.get("/catalog/detail", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { type, id } = req.query;
    if (!type || !id) {
      return res.status(400).json({ success: false, message: "缺少必要参数 type 或 id" });
    }
    
    let original = null;
    const catMeta = getCatalogMeta();
    const metaKey = `${type}::${id}`;
    const metaInfo = catMeta[metaKey] || {};
    
    if (type === "class") {
      const raw = getResourceArrayWithSource("class-schedules").items;
      original = raw.find(x => x.className === id);
    } else if (type === "teacher") {
      const raw = getResourceArrayWithSource("teacher-schedules").items;
      original = raw.find(x => x.teacherName === id);
    } else if (type === "classroom") {
      const raw = getResourceArrayWithSource("classroom-schedules").items;
      original = raw.find(x => x.roomName === id);
    } else if (type === "course") {
      const raw = getResourceArrayWithSource("course-schedules").items;
      original = raw.find(x => x.courseName === id);
    }
    
    if (!original) {
      return res.status(404).json({ success: false, message: "资源未找到" });
    }
    
    return res.json({
      success: true,
      data: {
        id,
        type,
        metaInfo,
        original,
        courses: original.courses || []
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 4. POST /api/admin/catalog/meta
 * 修改资源别名、备注、标记隐藏、置顶等
 */
router.post("/catalog/meta", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const body = req.body || {};
    const { type, id, displayName, note, hidden, tags } = body;
    if (!type || !id) {
      return res.status(400).json({ success: false, message: "缺少必要参数 type 或 id" });
    }
    const client = String(req.get("x-fosu-admin-client") || "").toLowerCase();
    const key = `${type}::${id}`;
    const prepared = catalogDomainService.prepareCatalogMetaEntryMutation(
      key,
      {
        displayName: String(displayName || "").trim(),
        note: String(note || "").trim(),
        hidden: !!hidden,
        tags: Array.isArray(tags) ? tags : [],
      },
      {
        expectedVersion: req.get("if-match") || body.expectedVersion || body.version,
        requireIfMatch: client === "next",
      }
    );
    const result = commitWithBackup({
      type: "catalog-meta",
      sourceFile: catalogDomainService.CATALOG_META_PATH || CATALOG_META_PATH,
      fallbackData: prepared.backupData,
      commit: () => catalogDomainService.commitPreparedCatalogMetaEntryMutation(prepared),
    });
    writeAuditLog(req, "update", "catalog-meta", key, `修改数据资源 [${type}] ${id} 的元数据别名和备注`);
    return res.json({
      success: true,
      message: "修改成功",
      metaInfo: result.entry,
      version: result.version,
      etag: result.etag,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      code: error.code,
      currentVersion: error.currentVersion,
    });
  }
});

router.get("/catalog/meta", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const doc = catalogDomainService.getCatalogMetaDocument();
    return res.json({ success: true, ...doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

const STAGING_LATEST_PATH = path.join(STORAGE_DIR, "staging-latest.json");

function readJsonIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    return null;
  }
}

function getSnapshotFingerprint(snapshot) {
  if (!snapshot) return null;
  try {
    return stagingFingerprint.calculateFingerprint(snapshot);
  } catch (error) {
    return null;
  }
}

function getActiveCanonicalHash() {
  const active = releaseService.getActiveReleaseInfoFast();
  if (active && active.canonicalHash) return active.canonicalHash;
  return "";
}

function getLatestStagingCanonicalHash() {
  const stagingData = readJsonIfExists(STAGING_LATEST_PATH);
  const fingerprint = getSnapshotFingerprint(stagingData);
  return {
    stagingData,
    canonicalHash: fingerprint && fingerprint.canonicalHash || "",
    fingerprint,
  };
}

function attachStagingFingerprint(stagingData, previousHash = "") {
  const fingerprint = stagingFingerprint.calculateFingerprint(stagingData);
  stagingData.meta = Object.assign({}, stagingData.meta || {}, {
    canonicalHash: fingerprint.canonicalHash,
    previousHash: previousHash || stagingData.meta?.previousHash || "",
    changed: previousHash ? previousHash !== fingerprint.canonicalHash : true,
    counts: Object.assign({}, stagingData.meta?.counts || {}, summarizeStagingData(stagingData).counts),
  });
  stagingData.canonicalHash = fingerprint.canonicalHash;
  return fingerprint;
}

function buildFingerprintStatus(localHash = "") {
  const activeRelease = releaseService.getActiveReleaseInfo();
  const activeHash = getActiveCanonicalHash();
  const latest = getLatestStagingCanonicalHash();
  const normalizedLocal = String(localHash || "").trim().toLowerCase();
  const activeResourceCounts = activeRelease && activeRelease.version
    ? releaseService.getReleaseResourceCounts(activeRelease.version)
    : null;
  return {
    activeCanonicalHash: activeHash,
    stagingCanonicalHash: latest.canonicalHash,
    localCanonicalHash: normalizedLocal,
    sameAsActive: Boolean(normalizedLocal && activeHash && normalizedLocal === activeHash),
    sameAsStaging: Boolean(normalizedLocal && latest.canonicalHash && normalizedLocal === latest.canonicalHash),
    activeResourceCounts,
    activeRelease: activeRelease ? Object.assign({}, activeRelease, {
      resourceCounts: activeRelease.resourceCounts || activeResourceCounts,
    }) : null,
    latestStaging: latest.stagingData ? {
      term: latest.stagingData.term || latest.stagingData.semester || "",
      releaseVersion: latest.stagingData.releaseVersion || latest.stagingData.version || "",
      generatedAt: latest.stagingData.generatedAt || latest.stagingData.updatedAt || "",
    } : null,
  };
}

function getLatestPublisherRunSafe() {
  try {
    const latest = publisherReceiptService.getLatestReceipt();
    return latest && latest.run || null;
  } catch (error) {
    safeLog("publisher-receipt-read-failed", { error: error.message });
    return null;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function normalizeOpsStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return "not-run";
  if (["ok", "success", "completed", "healthy", "synced", "unchanged", "no-change"].includes(status)) return "success";
  if (["failed", "error", "unhealthy", "validation-failed"].includes(status)) return "failed";
  if (["partial-success", "cloudbase-mirror-pending"].includes(status)) return "partial-success";
  return status;
}

function buildPublisherOpsSummary(run) {
  const summary = run && run.summary || {};
  const receipt = run && run.receipt || {};
  const cloudbaseReceipt = receipt.cloudbaseReceipt || {};
  const cloudbaseMirror = cloudbaseReceipt.mirror || receipt.cloudbase || receipt.cloudbaseResult || {};
  const status = normalizeOpsStatus(firstNonEmpty(
    receipt.overallStatus,
    receipt.status,
    summary.partialSuccess ? "partial-success" : "",
    summary.errorCode ? "failed" : "",
    summary.noChange ? "no-change" : "",
    summary.oracleStatus
  ));
  const cloudbaseStatus = normalizeOpsStatus(firstNonEmpty(
    receipt.cloudbaseStatus,
    summary.cloudbaseStatus,
    cloudbaseMirror.status,
    cloudbaseReceipt.status
  ));
  const stageTimings = receipt.stageTimings || {};
  const performanceSummary = receipt.performanceSummary || {};
  return {
    runId: run && run.runId || "",
    mode: firstNonEmpty(receipt.mode, summary.mode),
    term: firstNonEmpty(receipt.term, summary.term),
    status,
    completedAt: firstNonEmpty(receipt.completedAt, receipt.endedAt, summary.completedAt, run && run.updatedAt),
    currentStage: firstNonEmpty(receipt.currentStage, receipt.stage, ""),
    errorCode: firstNonEmpty(receipt.errorCode, summary.errorCode, receipt.error && receipt.error.code),
    errorMessage: firstNonEmpty(receipt.errorMessage, receipt.message, receipt.error && receipt.error.message),
    oracleStatus: normalizeOpsStatus(firstNonEmpty(receipt.oracleStatus, summary.oracleStatus)),
    cloudbaseStatus,
    dualSourceStatus: normalizeOpsStatus(firstNonEmpty(receipt.dualSourceStatus, summary.dualSourceStatus)),
    stageTimings,
    performanceSummary,
  };
}

function buildDataHashState(payload) {
  if (payload.activeCanonicalHash && payload.stagingCanonicalHash) {
    return payload.activeCanonicalHash === payload.stagingCanonicalHash ? "consistent" : "different";
  }
  if (payload.activeCanonicalHash) return "active-only";
  if (payload.stagingCanonicalHash) return "staging-only";
  return "unknown";
}

function buildOpsPendingItems(payload, publisher) {
  const items = [];
  const uploads = Array.isArray(payload.stagingUploads)
    ? payload.stagingUploads
    : (payload.latestStagingUpload ? [payload.latestStagingUpload] : []);
  const userActionStatuses = new Set(["pending-review", "failed", "validation-failed", "publish-blocked", "duplicate", "waiting-confirmation"]);
  uploads.forEach((upload) => {
    const state = upload.stagingState || upload.status || "";
    const blocked = Array.isArray(upload.blockers) && upload.blockers.length;
    if (!userActionStatuses.has(state) && !upload.failureReason && !blocked) return;
    items.push({
      type: "staging",
      status: state || "pending-review",
      severity: state === "failed" || state === "validation-failed" ? "danger" : "warning",
      title: state === "duplicate" ? "重复上传待确认" : "Staging 需要处理",
      detail: upload.failureReason || (blocked ? upload.blockers.join("; ") : "候选 Staging 等待确认或发布"),
      command: state === "duplicate" ? "npm run sync:publish -- --resume" : "npm run sync:publish",
      uploadId: upload.uploadId || upload.stagingId || "",
      term: upload.term || upload.summary && upload.summary.term || "",
    });
  });
  if (payload.stagingNeedsPublish && !items.some((item) => item.type === "staging")) {
    items.push({
      type: "publish",
      status: "pending-review",
      severity: "warning",
      title: "发现新 Staging，等待发布",
      detail: "active hash 与最新 Staging hash 不一致，需要执行发布链路。",
      command: "npm run sync:publish -- --resume",
    });
  }
  const staticStatus = normalizeOpsStatus(payload.openRestyStaticSyncStatus || payload.staticSync && payload.staticSync.status);
  if (staticStatus === "failed") {
    items.push({
      type: "openresty",
      status: "failed",
      severity: "danger",
      title: "OpenResty 静态同步失败",
      detail: payload.staticSync && (payload.staticSync.errorMessage || payload.staticSync.needsSyncReason) || "请重新同步当前 Release 静态目录。",
      command: "npm run sync:publish -- --resume",
    });
  }
  if (publisher && publisher.errorCode) {
    items.push({
      type: "publisher",
      status: "failed",
      severity: "danger",
      title: publisher.errorCode === "SESSION_EXPIRED" ? "100 网 session 已过期" : "最近一次本机同步失败",
      detail: publisher.errorMessage || publisher.errorCode,
      command: publisher.errorCode === "SESSION_EXPIRED" ? "npm run sync:login" : "npm run sync:publish -- --resume",
    });
  }
  if (publisher && ["failed", "partial-success"].includes(publisher.cloudbaseStatus)) {
    items.push({
      type: "cloudbase",
      status: publisher.cloudbaseStatus,
      severity: publisher.cloudbaseStatus === "failed" ? "danger" : "warning",
      title: "CloudBase 镜像未完成",
      detail: "OpenResty active release 可先作为线上源，CloudBase 镜像可单独重试。",
      command: "npm run sync:publish -- --mode=mirror-only",
    });
  }
  return items.slice(0, 8);
}

function attachSyncOpsSummary(payload, options = {}) {
  const publisher = buildPublisherOpsSummary(options.publisherRun || getLatestPublisherRunSafe());
  if (!payload.stagingUploads && options.stagingUploads) payload.stagingUploads = options.stagingUploads;
  const dataHashState = buildDataHashState(payload);
  const cloudbaseStatus = firstNonEmpty(publisher.cloudbaseStatus, payload.cloudbaseStatus, "not-run");
  const lastSyncStatus = firstNonEmpty(publisher.status, payload.latestJob && payload.latestJob.status, payload.latestStagingUpload && payload.latestStagingUpload.status, "not-run");
  const lastSyncTime = firstNonEmpty(publisher.completedAt, payload.latestJob && (payload.latestJob.finishedAt || payload.latestJob.updatedAt), payload.lastUploadTime);
  Object.assign(payload, {
    publisher,
    cloudbaseStatus,
    lastSyncStatus,
    lastSyncTime,
    dataHashState,
    dataHashConsistent: dataHashState === "consistent",
    stageTimings: publisher.stageTimings || {},
    performanceSummary: publisher.performanceSummary || {},
  });
  payload.pendingItems = buildOpsPendingItems(payload, publisher);
  return payload;
}

function getStagingIncludeScopes(data) {
  const scopes = data?.meta?.includeScopes;
  return Array.isArray(scopes) ? scopes : [];
}

function getStagingClassSchedules(data) {
  return data?.classSchedules || data?.resources?.classSchedules || [];
}

function summarizeStagingData(data) {
  return stagingSafetyService.summarizeStagingData(data);
}

function areStagingCountsAllZero(counts) {
  return stagingSafetyService.areStagingCountsAllZero(counts);
}

function validateStagingData(data) {
  return stagingSafetyService.validateStagingData(data);
}

function buildStagingSafety(data, activeSnapshot) {
  return stagingSafetyService.buildStagingSafety(data, activeSnapshot);
}

/**
 * Relay Agent: 管理员创建与审核接力采集任务。
 */
function buildAdminStagingUploadActor(req) {
  const identity = adminAuth.getAuditIdentity(req);
  return {
    type: "admin",
    id: identity.operator || (adminAuth.isAdminRequest(req) ? "admin-session" : "admin-token"),
    authMethod: identity.authMethod || "",
    scopes: identity.scopes || [],
    tokenName: identity.tokenName || "",
  };
}

function buildStagingUploadSummary(stagingData, safety, extra = {}) {
  return Object.assign({
    term: stagingData.term || stagingData.semester || "",
    releaseVersion: stagingData.releaseVersion || stagingData.version || "",
    generatedAt: stagingData.generatedAt || stagingData.updatedAt || "",
    counts: safety?.counts || summarizeStagingData(stagingData).counts,
    resourceCounts: safety?.resourceCounts || summarizeStagingData(stagingData).resourceCounts,
    totalScheduleDocuments: (
      Number(safety?.resourceCounts?.class?.scheduleDocuments || 0) +
      Number(safety?.resourceCounts?.teacher?.scheduleDocuments || 0) +
      Number(safety?.resourceCounts?.classroom?.scheduleDocuments || 0) +
      Number(safety?.resourceCounts?.course?.scheduleDocuments || 0)
    ),
    stagingState: safety && safety.allowPublish ? "pending-review" : "publish-blocked",
    releaseState: "not-built",
    runtimeState: "inactive",
  }, extra);
}

function saveDirectStagingUploadBuffer(buffer) {
  const uploadId = `direct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const filePath = path.join(DIRECT_STAGING_UPLOAD_DIR, `${uploadId}.bin`);
  const payloadBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(JSON.stringify(buffer || {}), "utf-8");
  fs.writeFileSync(filePath, payloadBuffer);
  return { uploadId, filePath, size: payloadBuffer.length };
}

function parseStagingUploadBuffer(buffer) {
  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const jsonStr = isGzip ? zlib.gunzipSync(buffer).toString("utf-8") : buffer.toString("utf-8");
  return JSON.parse(jsonStr);
}

async function processDirectStagingUpload(filePath, reqMeta, job) {
  if (job) job.progress(15, "读取上传临时文件");
  const buffer = fs.readFileSync(filePath);
  if (job) job.progress(30, "解析 Staging JSON");
  let stagingData = stagingUploadService.normalizeStagingData(parseStagingUploadBuffer(buffer));
  const beforeLatest = getLatestStagingCanonicalHash();
  const fingerprint = attachStagingFingerprint(stagingData, beforeLatest.canonicalHash);
  const activeCanonicalHash = getActiveCanonicalHash();

  if (activeCanonicalHash && activeCanonicalHash === fingerprint.canonicalHash) {
    if (job) job.progress(95, "数据无变化，跳过暂存", { canonicalHash: fingerprint.canonicalHash });
    return {
      skipped: true,
      unchanged: true,
      reason: "active-release",
      stagingState: "duplicate",
      releaseState: "published",
      runtimeState: "active",
      message: "数据无变化，不需要发布",
      canonicalHash: fingerprint.canonicalHash,
      activeCanonicalHash,
    };
  }
  if (beforeLatest.canonicalHash && beforeLatest.canonicalHash === fingerprint.canonicalHash) {
    if (job) job.progress(95, "服务器已存在相同 staging", { canonicalHash: fingerprint.canonicalHash });
    return {
      skipped: true,
      unchanged: true,
      reason: "staging",
      stagingState: "duplicate",
      releaseState: "not-built",
      runtimeState: "inactive",
      message: "服务器已存在相同 staging，无需重复上传",
      canonicalHash: fingerprint.canonicalHash,
      stagingCanonicalHash: beforeLatest.canonicalHash,
    };
  }

  const validation = validateStagingData(stagingData);
  if (!validation.valid) {
    const error = new Error(`Staging JSON 格式校验不通过: ${validation.errors.join("; ")}`);
    error.statusCode = 400;
    throw error;
  }

  if (job) job.progress(60, "写入当前 Staging");
  writeJsonAtomic(STAGING_LATEST_PATH, stagingData);
  const activeSnapshot = releaseService.readActiveReleaseSnapshot();
  const safety = buildStagingSafety(stagingData, activeSnapshot);
  if (job) job.progress(90, "Staging 校验完成", { canonicalHash: fingerprint.canonicalHash });
  writeAuditLog(reqMeta, "upload", "staging-direct-upload", reqMeta.uploadId || "", `后台直传 Staging: ${stagingData.term || ""}`);
  return {
    success: true,
    message: "Staging JSON 上传 job 已完成，已暂存",
    canonicalHash: fingerprint.canonicalHash,
    data: {
      term: stagingData.term,
      termStartDate: stagingData.termStartDate,
      releaseVersion: stagingData.releaseVersion,
      generatedAt: stagingData.generatedAt,
      meta: stagingData.meta || null,
      counts: safety.counts,
      resourceCounts: safety.resourceCounts,
      contractComparison: safety.contractComparison,
      safety,
    },
    warnings: validation.warnings.concat(safety.warnings || []),
  };
}

router.get("/staging/upload", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    if (req.query && req.query.reconcile === "true") {
      releaseLifecycleService.reconcileLifecycle({ reason: "staging-upload-list" });
    }
    const result = stagingUploadService.listUploadRecords(req.query || {});
    return res.json({
      success: true,
      uploads: result.records,
      records: result.records,
      total: result.total,
      limit: result.limit,
      cursor: result.cursor,
      nextCursor: result.nextCursor,
      indexPath: result.indexPath,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/staging/upload/rebuild-index", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json(stagingUploadService.rebuildUploadRecordIndex({ reason: "admin-rebuild" }));
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/publisher/receipt", adminAuth.verifyAdminAccess, (req, res) => {
  setJsonUtf8(res);
  try {
    const latest = publisherReceiptService.getLatestReceipt();
    return res.json({ success: true, runsDir: latest.receiptsDir, receiptsDir: latest.receiptsDir, latest: latest.run });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/publisher/receipt", adminAuth.verifyAdminAccess, (req, res) => {
  setJsonUtf8(res);
  try {
    const saved = publisherReceiptService.saveReceipt(req.body || {});
    return res.json({ success: true, runId: saved.runId, savedAt: saved.savedAt, summary: saved.summary });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/staging/status", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const lifecycle = releaseLifecycleService.buildLifecycleStatus({
      reason: "staging-status",
      uploadLimit: req.query.limit || 50,
      reconcile: false,
    });
    const uploadResult = stagingUploadService.listUploadRecords(req.query || { limit: 50 });
    const uploads = uploadResult.records || [];
    const pendingReview = uploads.filter((item) => item.status === "pending-review");
    const fingerprint = Object.assign({}, buildFingerprintStatus(req.query.canonicalHash || ""), {
      activeCanonicalHash: lifecycle.activeCanonicalHash,
      stagingCanonicalHash: lifecycle.stagingCanonicalHash,
    });
    return res.json({
      success: true,
      uploads,
      pendingReview,
      latest: uploads[0] || null,
      total: uploadResult.total,
      limit: uploadResult.limit,
      cursor: uploadResult.cursor,
      nextCursor: uploadResult.nextCursor,
      fingerprint,
      lifecycle,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/terms", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      registry: termRegistryService.readRegistry(),
      terms: termRegistryService.listTerms({ includeDisabled: true }),
      releaseIndex: termReleaseIndexService.readIndex(),
      termReleases: termReleaseIndexService.getTermReleaseSummary(),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, code: error.code || "TERM_LIST_FAILED", message: error.message });
  }
});

router.post("/terms", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const term = termRegistryService.createPlannedTerm(req.body || {});
    writeAuditLog(req, "create", "term", term.term, `Created planned term ${term.term}`);
    return res.json({ success: true, term });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code || "TERM_CREATE_FAILED", errors: error.errors || [], message: error.message });
  }
});

router.patch("/terms/:term", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const term = termRegistryService.updateTerm(req.params.term, req.body || {});
    writeAuditLog(req, "update", "term", term.term, `Updated term ${term.term}`);
    return res.json({ success: true, term });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code || "TERM_UPDATE_FAILED", errors: error.errors || [], message: error.message });
  }
});

router.post("/terms/:term/bind-release", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const releaseVersion = req.body && (req.body.releaseVersion || req.body.version);
    const term = termRegistryService.bindReleaseToTerm(req.params.term, releaseVersion, { status: "ready", source: "admin-bind" });
    termReleaseIndexService.bindRelease(term.term, releaseVersion, { activeTerm: false });
    writeAuditLog(req, "bind-release", "term", term.term, `Bound release ${releaseVersion} to term ${term.term}`);
    return res.json({ success: true, term, releaseIndex: termReleaseIndexService.getTermRelease(term.term) });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code || "TERM_BIND_RELEASE_FAILED", errors: error.errors || [], message: error.message });
  }
});

function buildTermReadiness(term, releaseVersion) {
  return termReadinessService.buildTermReadiness(term, releaseVersion);
}

router.get("/terms/:term/readiness", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const releaseVersion = req.query.releaseVersion || req.query.version || "";
    return res.json({ success: true, readiness: buildTermReadiness(req.params.term, releaseVersion) });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code || "TERM_READINESS_FAILED", message: error.message });
  }
});

router.post("/terms/:term/repair-release/dry-run", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    const result = await semesterRepairService.repairCurrentTermRelease({
      term: req.params.term,
      sourceReleaseVersion: req.body && (req.body.sourceReleaseVersion || req.body.releaseVersion || req.body.version) || "",
      dryRun: true,
      activateAfterBuild: req.body && req.body.activateAfterBuild !== false,
      syncOpenResty: req.body && req.body.syncOpenResty !== false,
    });
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      code: error.code || "SEMESTER_REPAIR_DRY_RUN_FAILED",
      errors: error.errors || [],
      message: error.message,
    });
  }
});

router.post("/terms/:term/repair-release/start", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    storageLifecycleService.assertReleaseCanStart();
    const input = {
      term: req.params.term,
      sourceReleaseVersion: req.body && (req.body.sourceReleaseVersion || req.body.releaseVersion || req.body.version) || "",
      releaseVersion: req.body && (req.body.newReleaseVersion || req.body.targetReleaseVersion || req.body.repairReleaseVersion) || "",
      activateAfterBuild: req.body && req.body.activateAfterBuild !== false,
      syncOpenResty: req.body && req.body.syncOpenResty !== false,
    };
    const job = releaseWorkerManager.startReleaseJob("semester-repair", input);
    writeAuditLog(req, "repair-release", "term", req.params.term, `Started semester release repair for ${req.params.term}`);
    return res.status(202).json({ success: true, job, jobId: job.id });
  } catch (error) {
    return releaseWorkerManager.sendAlreadyRunning(res, error);
  }
});

router.get("/terms/:term/repair-release/status", adminAuth.verifyAdminAccess, (req, res) => {
  return sendJobStatus(res, "semester-repair", req.query.id);
});

router.post("/terms/:term/rebuild-runtime-pointer", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const target = termRegistryService.getTerm(req.params.term);
    const releaseVersion = req.body && (req.body.releaseVersion || req.body.version) ||
      req.query.releaseVersion || req.query.version ||
      target && target.releaseVersion ||
      "";
    const result = termReadinessService.rebuildRuntimePointer(req.params.term, releaseVersion);
    writeAuditLog(req, "rebuild-runtime-pointer", "term", req.params.term, `Rebuilt runtime pointer for ${req.params.term} ${releaseVersion}`);
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      code: error.code || "RUNTIME_POINTER_REBUILD_FAILED",
      message: error.message,
    });
  }
});

router.post("/terms/:term/activate", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    const target = termRegistryService.getTerm(req.params.term);
    const releaseVersion = req.body && (req.body.releaseVersion || req.body.version) || target && target.releaseVersion || "";
    const readiness = buildTermReadiness(req.params.term, releaseVersion);
    if (!readiness.ready) {
      return res.status(400).json({ success: false, code: "TERM_ACTIVATE_BLOCKED", readiness });
    }
    const activatedRelease = await semesterActivationTransactionService.activateTerm(req.params.term, releaseVersion, {
      releaseNote: `Activated term ${req.params.term}`,
    });
    writeAuditLog(req, "activate", "term", req.params.term, `Activated term ${req.params.term} with release ${releaseVersion}`);
    return res.json({ success: true, term: termRegistryService.getTerm(req.params.term), activatedRelease, readiness });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code || "TERM_ACTIVATE_FAILED", errors: error.errors || [], message: error.message });
  }
});

router.post("/terms/:term/archive", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const term = termRegistryService.archiveTerm(req.params.term);
    writeAuditLog(req, "archive", "term", term.term, `Archived term ${term.term}`);
    return res.json({ success: true, term });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code || "TERM_ARCHIVE_FAILED", message: error.message });
  }
});

router.post("/terms/:term/disable", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const term = termRegistryService.disableTerm(req.params.term);
    writeAuditLog(req, "disable", "term", term.term, `Disabled term ${term.term}`);
    return res.json({ success: true, term });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code || "TERM_DISABLE_FAILED", message: error.message });
  }
});

router.get("/staging/fingerprint", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json(Object.assign({
      success: true,
    }, buildFingerprintStatus(req.query.canonicalHash || req.query.hash || "")));
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/staging/:uploadId", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const deleted = stagingUploadService.deleteUpload(req.params.uploadId, buildAdminStagingUploadActor(req));
    if (deleted && deleted.status === "pending-review" && fs.existsSync(STAGING_LATEST_PATH)) {
      fs.unlinkSync(STAGING_LATEST_PATH);
    }
    writeAuditLog(req, "delete", "staging-upload", req.params.uploadId, "删除 Staging 上传记录");
    return res.json({ success: true, message: "Staging 上传记录已删除", deleted });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/staging/upload/init", verifyAdminWriteAccess, adminAuth.requireScopes(["staging:init"]), (req, res) => {
  try {
    const upload = stagingUploadService.initUpload(req.body || {}, buildAdminStagingUploadActor(req));
    return res.json({
      success: true,
      uploadId: upload.uploadId,
      upload,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/staging/upload/unchanged", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const body = req.body || {};
    const canonicalHash = String(body.canonicalHash || "").trim().toLowerCase();
    const fingerprint = buildFingerprintStatus(canonicalHash);
    const sameAsActive = Boolean(canonicalHash && fingerprint.activeCanonicalHash && fingerprint.activeCanonicalHash === canonicalHash);
    const sameAsStaging = Boolean(canonicalHash && fingerprint.stagingCanonicalHash && fingerprint.stagingCanonicalHash === canonicalHash);
    if (!sameAsActive && !sameAsStaging) {
      return res.status(409).json({
        success: false,
        code: "UNCHANGED_MARKER_HASH_NOT_FOUND",
        message: "canonicalHash does not match current active release or existing staging",
        fingerprint,
      });
    }
    const upload = stagingUploadService.recordUnchangedUpload(Object.assign({}, body, {
      reason: sameAsActive ? "active-release" : "staging",
      activeReleaseVersion: body.activeReleaseVersion || fingerprint.activeRelease?.version || fingerprint.activeRelease?.releaseVersion || "",
    }), buildAdminStagingUploadActor(req));
    writeAuditLog(req, "upload-skip", "staging-upload", upload.uploadId, `No-change sync marker: ${upload.term || ""}`);
    return res.json({
      success: true,
      skipped: true,
      unchanged: true,
      reason: sameAsActive ? "active-release" : "staging",
      uploadId: upload.uploadId,
      upload,
      canonicalHash,
      fingerprint,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post(
  "/staging/upload/chunk",
  verifyAdminWriteAccess,
  adminAuth.requireScopes(["staging:chunk"]),
  express.raw({ type: "*/*", limit: STAGING_CHUNK_BODY_LIMIT }),
  (req, res) => {
    try {
      const uploadId = req.query.uploadId || req.headers["x-upload-id"];
      const chunkIndex = req.query.chunkIndex || req.headers["x-chunk-index"];
      const status = stagingUploadService.writeChunk(
        uploadId,
        chunkIndex,
        req.body,
        buildAdminStagingUploadActor(req),
        { chunkSha256: req.headers["x-chunk-sha256"] }
      );
      return res.json({ success: true, upload: status });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
  }
);

router.post("/staging/upload/finalize", verifyAdminWriteAccess, adminAuth.requireScopes(["staging:finalize"]), async (req, res) => {
  const uploadId = req.body && req.body.uploadId;
  try {
    if (!uploadId) {
      return res.status(400).json({ success: false, message: "uploadId is required" });
    }
    const job = releaseWorkerManager.startReleaseJob("staging-upload-finalize", {
      uploadId,
      expected: req.body || {},
      actor: buildAdminStagingUploadActor(req),
      reqMeta: {
        ip: req.ip || "",
        headers: {
          "x-forwarded-for": req.headers["x-forwarded-for"] || "",
        },
      },
    });
    return res.status(202).json({
      success: true,
      accepted: true,
      message: "Staging upload finalize queued",
      uploadId,
      job,
    });
  } catch (error) {
    if (error && error.code !== "JOB_ALREADY_RUNNING") {
      stagingUploadService.markUploadFailed(uploadId, error.message);
    }
    if (error && error.code === "JOB_ALREADY_RUNNING") {
      return releaseWorkerManager.sendAlreadyRunning(res, error);
    }
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.get("/staging/upload/:uploadId/status", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const status = stagingUploadService.getUploadStatus(req.params.uploadId, buildAdminStagingUploadActor(req));
    return res.json({ success: true, upload: status });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/relay/tasks", verifyAdminWriteAccess, adminAuth.requireScopes(["relay:manage"]), (req, res) => {
  try {
    const task = relayService.createTask(req.body || {});
    writeAuditLog(req, "create", "relay-task", task.id, `创建接力任务 ${task.term}`);
    return res.json({
      success: true,
      message: "接力任务已创建",
      task,
      runCommand: `npm run sync:relay-agent -- --server=${req.protocol}://${req.get("host")} --token=${task.relayToken} --term=${task.term}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/relay/tasks", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      tasks: relayService.listTasks(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/relay/tasks/:id/revoke", verifyAdminWriteAccess, adminAuth.requireScopes(["relay:manage"]), (req, res) => {
  try {
    const task = relayService.revokeTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Relay task not found" });
    }
    writeAuditLog(req, "revoke", "relay-task", req.params.id, "Revoke relay task token");
    return res.json({ success: true, message: "Relay task token revoked", task });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/relay/tasks/:id/cancel", verifyAdminWriteAccess, adminAuth.requireScopes(["relay:manage"]), (req, res) => {
  try {
    const task = relayService.cancelTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Relay task not found" });
    }
    writeAuditLog(req, "cancel", "relay-task", req.params.id, "Request relay task cancellation");
    return res.json({ success: true, message: "Relay task cancellation requested", task });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/relay/tasks/:id", verifyAdminWriteAccess, adminAuth.requireScopes(["relay:manage"]), (req, res) => {
  try {
    const deleted = relayService.deleteTask(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Relay task not found" });
    }
    writeAuditLog(req, "delete", "relay-task", req.params.id, "Delete relay task record");
    return res.json({ success: true, message: "Relay task deleted", deleted: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});


router.get("/relay/uploads", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({
      success: true,
      uploads: relayService.listUploads(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/relay/uploads/:id/promote-to-staging", verifyAdminWriteAccess, adminAuth.requireScopes(["relay:manage"]), (req, res) => {
  try {
    const uploadResult = relayService.readUploadPayload(req.params.id);
    if (!uploadResult) {
      return res.status(404).json({ success: false, message: "接力上传记录不存在或文件已丢失" });
    }

    const stagingData = relayService.normalizeStagingData(uploadResult.payload, {
      taskId: uploadResult.upload.taskId,
      uploadId: uploadResult.upload.id,
      uploaderNote: uploadResult.upload.uploaderNote,
    });
    const beforeLatest = getLatestStagingCanonicalHash();
    attachStagingFingerprint(stagingData, beforeLatest.canonicalHash);
    const validation = validateStagingData(stagingData);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: "接力上传无法提升为 Staging，数据校验不通过",
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    writeJsonAtomic(STAGING_LATEST_PATH, stagingData);
    const upload = relayService.markUploadStaged(req.params.id);
    writeAuditLog(req, "promote", "relay-upload", req.params.id, `将接力上传设为当前 Staging: ${stagingData.term}`);

    return res.json({
      success: true,
      message: "接力上传已提升为当前 Staging，请继续核对 diff 后发布",
      upload,
      warnings: validation.warnings,
      summary: relayService.summarizeStagingData(stagingData),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 5. GET /api/admin/sync/status
 * 获取同步中心状态及健康度检查 (带教务网DNS解析测试)
 */
let syncStatusDnsCache = {
  checkedAt: 0,
  intranetAccessible: null,
  status: "not-collected",
};

async function getCachedIntranetDiagnostic(force = false) {
  const now = Date.now();
  if (!force) {
    if (syncStatusDnsCache.checkedAt && now - syncStatusDnsCache.checkedAt < 60 * 1000) {
      return syncStatusDnsCache;
    }
    return syncStatusDnsCache;
  }
  const dns = require("dns").promises;
  let intranetAccessible = false;
  try {
    const hostname = new URL(config.FOSU_BASE_URL || "https://100.fosu.edu.cn").hostname;
    const lookupPromise = dns.lookup(hostname);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 500));
    await Promise.race([lookupPromise, timeoutPromise]);
    intranetAccessible = true;
  } catch (e) {
    intranetAccessible = false;
  }
  syncStatusDnsCache = {
    checkedAt: now,
    checkedAtIso: new Date(now).toISOString(),
    intranetAccessible,
    status: "collected",
  };
  return syncStatusDnsCache;
}

// NOTE: duplicate GET /sync/status removed in phase 1 — single handler above.

function getRequestedReleaseVersion(req) {
  const active = releaseService.getActiveReleaseInfo();
  return String(
    req.body?.version ||
    req.body?.releaseVersion ||
    req.query?.version ||
    req.query?.releaseVersion ||
    active?.version ||
    ""
  ).trim();
}

function sendJobStatus(res, type, id) {
  const job = id ? jobService.readJob(id) : jobService.latestJob(type);
  return res.json({
    success: true,
    job: jobService.publicJob(job),
  });
}

router.get("/jobs", adminAuth.verifyAdminAccess, (req, res) => {
  return res.json({
    success: true,
    jobs: jobService.listJobs(Number(req.query.limit || 30)).map(jobService.publicJob),
  });
});

router.get("/jobs/:id", adminAuth.verifyAdminAccess, (req, res) => {
  const job = jobService.readJob(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, message: "job not found" });
  }
  return res.json({ success: true, job: jobService.publicJob(job) });
});

router.get("/system/load", adminAuth.verifyAdminAccess, (req, res) => {
  const memory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const memoryUsedRatio = totalMemory > 0 ? (totalMemory - freeMemory) / totalMemory : 0;
  const loadAvg = os.loadavg ? os.loadavg() : [0, 0, 0];
  const cpuCount = Math.max(1, os.cpus().length);
  const cpuLoadRatio = loadAvg[0] > 0 ? loadAvg[0] / cpuCount : 0;
  const high = cpuLoadRatio >= 0.85 || memoryUsedRatio >= 0.88;
  return res.json({
    success: true,
    high,
    cpu: {
      count: cpuCount,
      loadAvg,
      loadRatio: Number(cpuLoadRatio.toFixed(3)),
    },
    memory: {
      total: totalMemory,
      free: freeMemory,
      usedRatio: Number(memoryUsedRatio.toFixed(3)),
      rss: memory.rss,
      heapUsed: memory.heapUsed,
    },
    serverTime: new Date().toISOString(),
  });
});

router.post("/sync/reconcile", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const result = releaseLifecycleService.reconcileLifecycle({
      reason: "manual-admin",
      uploadId: req.body && req.body.uploadId || "",
      sourceTaskId: req.body && req.body.sourceTaskId || "",
    });
    return res.json({
      success: true,
      result,
      lifecycle: releaseLifecycleService.buildLifecycleStatus({ reason: "manual-admin-result" }),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      code: error.code || "",
    });
  }
});

router.post("/static-release-sync/start", verifyAdminWriteAccess, adminAuth.requireScopes(["static:sync"]), (req, res) => {
  try {
    storageLifecycleService.assertReleaseCanStart();
    const version = getRequestedReleaseVersion(req);
    const job = releaseWorkerManager.startReleaseJob("static-release-sync", {
      version,
      force: req.body && req.body.force === true,
    });
    return res.status(202).json({ success: true, job });
  } catch (error) {
    return releaseWorkerManager.sendAlreadyRunning(res, error);
  }
});

router.get("/static-release-sync/status", adminAuth.verifyAdminAccess, (req, res) => {
  return sendJobStatus(res, "static-release-sync", req.query.id);
});

router.get("/storage/status", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json(storageLifecycleService.getStorageStatus({
      force: req.query.force === "1" || req.query.force === "true",
    }));
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/storage/scan", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({ success: true, summary: storageLifecycleService.scanStorageSizes() });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/storage/maintenance/preview", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const job = releaseWorkerManager.startReleaseJob("storage-maintenance", { dryRun: true, reason: "manual-preview" });
    return res.status(202).json({ success: true, job });
  } catch (error) {
    return releaseWorkerManager.sendAlreadyRunning(res, error);
  }
});

router.post("/storage/maintenance/run", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const job = releaseWorkerManager.startReleaseJob("storage-maintenance", { dryRun: false, reason: "manual-run" });
    return res.status(202).json({ success: true, job });
  } catch (error) {
    return releaseWorkerManager.sendAlreadyRunning(res, error);
  }
});

router.post("/static-ticket/create", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const ticket = staticAccessTicket.createStaticAccessTicket(req.body || {});
    return res.json({ success: true, ticket });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message, code: error.code || "" });
  }
});

router.post("/static-ticket/verify", adminAuth.verifyAdminAccess, (req, res) => {
  const body = req.body || {};
  return res.json({
    success: true,
    result: staticAccessTicket.verifyStaticAccessTicket(body.ticket, {
      releaseVersion: body.releaseVersion,
      path: body.path,
    }),
  });
});

router.get("/release-pack/quick-health", adminAuth.verifyAdminAccess, (req, res) => {
  const version = getRequestedReleaseVersion(req);
  return res.json({
    success: true,
    health: releaseService.getReleasePackQuickHealth(version),
  });
});

router.post("/release-pack/deep-health/start", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    storageLifecycleService.assertReleaseCanStart();
    const version = getRequestedReleaseVersion(req);
    const job = releaseWorkerManager.startReleaseJob("release-pack-deep-health", { version });
    return res.status(202).json({ success: true, job });
  } catch (error) {
    return releaseWorkerManager.sendAlreadyRunning(res, error);
  }
});

router.get("/release-pack/deep-health/status", adminAuth.verifyAdminAccess, (req, res) => {
  return sendJobStatus(res, "release-pack-deep-health", req.query.id);
});

router.post("/release-pack/rebuild/start", verifyAdminWriteAccess, adminAuth.requireScopes(["release:build"]), (req, res) => {
  try {
    storageLifecycleService.assertReleaseCanStart();
    const version = getRequestedReleaseVersion(req);
    const job = releaseWorkerManager.startReleaseJob("release-pack-rebuild", { version });
    return res.status(202).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.code === "JOB_ALREADY_RUNNING" ? "已有 Release Pack 重建任务正在运行" : error.message,
      job: error.job || null,
    });
  }
});

router.get("/release-pack/rebuild/status", adminAuth.verifyAdminAccess, (req, res) => {
  return sendJobStatus(res, "release-pack-rebuild", req.query.id);
});

router.post("/release-pack/verify/start", verifyAdminWriteAccess, adminAuth.requireScopes(["static:verify"]), (req, res) => {
  try {
    const version = getRequestedReleaseVersion(req);
    const job = releaseWorkerManager.startReleaseJob("release-pack-verify", { version }, { lockGroup: null });
    return res.status(202).json({ success: true, job });
  } catch (error) {
    return releaseWorkerManager.sendAlreadyRunning(res, error);
  }
});

router.get("/release-pack/verify/status", adminAuth.verifyAdminAccess, (req, res) => {
  return sendJobStatus(res, "release-pack-verify", req.query.id);
});

router.post("/sync/staging/publish/start", verifyAdminWriteAccess, adminAuth.requireScopes(["release:publish"]), (req, res) => {
  try {
    storageLifecycleService.assertReleaseCanStart();
    const input = {
      force: req.body.force === true,
      readyOnly: req.body.readyOnly === true,
      releaseNote: req.body.releaseNote || "",
      ip: req.ip || "",
      headers: {
        "x-forwarded-for": req.headers["x-forwarded-for"] || "",
      },
    };
    const job = releaseWorkerManager.startReleaseJob("staging-publish", input);
    return res.status(202).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.code === "JOB_ALREADY_RUNNING" ? "已有发布任务正在运行" : error.message,
      job: error.job || null,
    });
  }
});

router.get("/sync/staging/publish/status", adminAuth.verifyAdminAccess, (req, res) => {
  return sendJobStatus(res, "staging-publish", req.query.id);
});

/**
 * 5.1 POST /api/admin/sync/staging/upload
 * 上传 Staging JSON 数据包并校验，仅写入 staging 不激活
 */
router.post(
  "/sync/staging/upload",
  adminAuth.verifyAdminAccess,
  express.raw({ type: "*/*", limit: RAW_UPLOAD_BODY_LIMIT }),
  async (req, res) => {
    try {
      const buffer = req.body;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ success: false, message: "上传内容不能为空" });
      }
      const saved = saveDirectStagingUploadBuffer(buffer);
      const reqMeta = {
        ip: req.ip || "",
        headers: { "x-forwarded-for": req.headers["x-forwarded-for"] || "" },
        uploadId: saved.uploadId,
      };
      const job = jobService.createJob("staging-upload", {
        uploadId: saved.uploadId,
        filePath: saved.filePath,
        size: saved.size,
      }, async (jobContext, input) => {
        try {
          return await processDirectStagingUpload(input.filePath, reqMeta, jobContext);
        } finally {
          try { fs.unlinkSync(input.filePath); } catch (cleanupError) {}
        }
      });
      return res.status(202).json({
        success: true,
        message: "Staging 上传已进入后台 job，页面将轮询进度",
        uploadId: saved.uploadId,
        job,
      });
    } catch (error) {
      console.error("Staging upload failed:", error);
      return res.status(500).json({ success: false, message: "上传处理失败: " + error.message });
    }
  }
);

router.get("/sync/staging/upload/status", adminAuth.verifyAdminAccess, (req, res) => {
  return sendJobStatus(res, "staging-upload", req.query.id);
});

/**
 * 5.2 GET /api/admin/sync/staging/current
 * 获取当前 Staging 的预览与线上版本对比差异统计
 */
router.get("/sync/staging/current", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const latestUpload = (stagingUploadService.listUploadRecords({ limit: 1 }).records || [])[0] || null;
    if (latestUpload && (latestUpload.summary || latestUpload.canonicalHash)) {
      const summary = latestUpload.summary || {};
      const activeInfo = releaseService.getActiveReleaseInfoFast();
      const activeCanonicalHash = getActiveCanonicalHash();
      const stagingCanonicalHash = latestUpload.canonicalHash || summary.canonicalHash || "";
      const sameAsActive = Boolean(activeCanonicalHash && stagingCanonicalHash && activeCanonicalHash === stagingCanonicalHash);
      return res.json({
        success: true,
        lightweight: true,
        data: {
          term: latestUpload.term || summary.term || "",
          releaseVersion: latestUpload.releaseVersion || summary.releaseVersion || "",
          generatedAt: summary.generatedAt || latestUpload.updatedAt || latestUpload.createdAt || "",
          meta: { stagingUploadId: latestUpload.uploadId || "" },
          canonicalHash: stagingCanonicalHash,
          activeCanonicalHash,
          stagingCanonicalHash,
          sameAsActive,
          needsPublish: Boolean(stagingCanonicalHash && !sameAsActive),
          counts: latestUpload.counts || summary.counts || {},
          resourceCounts: latestUpload.resourceCounts || summary.resourceCounts || null,
          activeRelease: activeInfo ? {
            releaseVersion: activeInfo.releaseVersion || activeInfo.version || "",
            term: activeInfo.term || activeInfo.semester || "",
            status: "active",
          } : null,
          safety: {
            allowPublish: summary.stagingState !== "publish-blocked",
            blockers: summary.blockers || [],
            warnings: summary.warnings || [],
            blockerDetails: summary.blockerDetails || summary.contractComparison && summary.contractComparison.blockers || [],
            blockerCodes: summary.blockerCodes || [],
            warningDetails: summary.warningDetails || summary.contractComparison && summary.contractComparison.warnings || [],
            safetyReport: summary.safetyReport || null,
            contractComparison: summary.contractComparison || null,
          },
          diff: {
            lightweight: true,
            message: "Full staging diff is generated by background validation jobs.",
          },
        },
      });
    }
    if (!fs.existsSync(STAGING_LATEST_PATH)) {
      return res.json({ success: false, message: "暂无暂存的 Staging 数据，请先上传" });
    }

    return res.json({
      success: true,
      lightweight: true,
      data: null,
      message: "Staging summary is pending; rebuild the upload index or wait for the background validation job.",
      code: "STAGING_SUMMARY_PENDING",
    });

    const stagingData = JSON.parse(fs.readFileSync(STAGING_LATEST_PATH, "utf-8"));
    const activeSnapshot = releaseService.readActiveReleaseSnapshot();

    const getStats = (snapshot) => {
      if (!snapshot) return { classCount: 0, courseCount: 0, teacherCount: 0, classroomCount: 0, classNames: [], resourceCounts: null };
      const classSchedules = snapshot.classSchedules || [];
      const classNames = classSchedules.map(c => c.className).filter(Boolean);
      const resourceCounts = snapshot.resourceCounts && Number(snapshot.resourceCounts.countSchemaVersion) === 2
        ? snapshot.resourceCounts
        : buildResourceCountContract(snapshot);
      return {
        classCount: resourceCounts.class.scheduleDocuments,
        courseCount: resourceCounts.course.scheduleDocuments,
        teacherCount: resourceCounts.teacher.scheduleDocuments,
        classroomCount: resourceCounts.classroom.scheduleDocuments,
        resourceCounts,
        classNames
      };
    };

    const stagingStats = getStats(stagingData);
    const activeStats = getStats(activeSnapshot);

    const stagingClassNamesSet = new Set(stagingStats.classNames);
    const activeClassNamesSet = new Set(activeStats.classNames);

    const deletedClasses = activeStats.classNames.filter(name => !stagingClassNamesSet.has(name));
    const addedClasses = stagingStats.classNames.filter(name => !activeClassNamesSet.has(name));

    const baseCount = Math.max(activeStats.classCount, 1);
    const changeRate = (deletedClasses.length + addedClasses.length) / baseCount;
    const isBigChange = changeRate > 0.3;

    const { counts } = summarizeStagingData(stagingData);
    const safety = buildStagingSafety(stagingData, activeSnapshot);
    const localFingerprint = getSnapshotFingerprint(stagingData);
    const activeCanonicalHash = getActiveCanonicalHash();
    const sameAsActive = Boolean(localFingerprint?.canonicalHash && activeCanonicalHash && localFingerprint.canonicalHash === activeCanonicalHash);

    return res.json({
      success: true,
      data: {
        term: stagingData.term,
        termStartDate: stagingData.termStartDate,
        releaseVersion: stagingData.releaseVersion,
        generatedAt: stagingData.generatedAt,
        releaseNote: stagingData.releaseNote || "",
        meta: stagingData.meta || null,
        canonicalHash: localFingerprint?.canonicalHash || stagingData.canonicalHash || "",
        activeCanonicalHash,
        stagingCanonicalHash: localFingerprint?.canonicalHash || stagingData.canonicalHash || "",
        sameAsActive,
        needsPublish: !sameAsActive,
        counts,
        resourceCounts: safety.resourceCounts,
        safety,
        diff: {
          classDelta: stagingStats.classCount - activeStats.classCount,
          courseDelta: stagingStats.courseCount - activeStats.courseCount,
          teacherDelta: stagingStats.teacherCount - activeStats.teacherCount,
          classroomDelta: stagingStats.classroomCount - activeStats.classroomCount,
          deletedClasses: deletedClasses.slice(0, 100),
          deletedCount: deletedClasses.length,
          addedClasses: addedClasses.slice(0, 100),
          addedCount: addedClasses.length,
          changeRate: parseFloat((changeRate * 100).toFixed(2)),
          isBigChange,
          contractComparison: safety.contractComparison,
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 5.3 POST /api/admin/sync/staging/publish
 * 发布当前 Staging JSON 为正式 Release (变动>30%需要force强制参数)
 */
router.post("/sync/staging/publish", verifyAdminWriteAccess, adminAuth.requireScopes(["release:publish"]), async (req, res) => {
  try {
    storageLifecycleService.assertReleaseCanStart();
    if (!fs.existsSync(STAGING_LATEST_PATH)) {
      return res.status(400).json({ success: false, message: "暂存数据不存在，请先上传 Staging JSON" });
    }
    const input = {
      force: req.body.force === true,
      readyOnly: req.body.readyOnly === true,
      releaseNote: req.body.releaseNote || "",
      ip: req.ip || "",
      headers: {
        "x-forwarded-for": req.headers["x-forwarded-for"] || "",
      },
    };
    const job = releaseWorkerManager.startReleaseJob("staging-publish", input);
    return res.status(202).json({
      success: true,
      message: "发布已进入后台 job，请轮询 job 状态",
      job,
    });
  } catch (error) {
    console.error("Staging publish failed:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.code === "JOB_ALREADY_RUNNING" ? "已有发布任务正在运行" : "发布失败: " + error.message,
      job: error.job || null,
    });
  }
});

/**
 * 5.4 GET /api/admin/sync/releases
 * 获取最近发布的历史 Release 快照版本列表 (限 10 条，用于回滚)
 */
router.get("/sync/releases", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const list = releaseService.listReleases(10);
    return res.json({
      success: true,
      releases: list,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 5.5 POST /api/admin/sync/releases/rollback
 * 一键回滚到指定的历史版本
 */
router.post("/sync/releases/rollback", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    const version = req.body.version;
    if (!version) {
      return res.status(400).json({ success: false, message: "缺少必要参数 version" });
    }
    const job = releaseWorkerManager.startReleaseJob("release-activate", {
      version,
      backupActive: true,
      releaseNote: `一键回滚数据至历史版本 ${version}`,
      auditAction: "rollback",
      auditReq: {
        ip: req.ip || "",
        headers: {
          "x-forwarded-for": req.headers["x-forwarded-for"] || "",
        },
      },
      auditSummary: `一键回滚数据至版本 ${version}`,
    });
    return res.status(202).json({
      success: true,
      message: `已启动回滚至版本 ${version} 的后台任务`,
      version,
      job,
    });
  } catch (error) {
    console.error("Rollback failed:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.code === "JOB_ALREADY_RUNNING" ? "已有 Release 重任务正在运行" : "回滚失败: " + error.message,
      job: error.job || null,
    });
  }
});

router.delete("/sync/releases/:version", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const result = releaseService.deleteReleaseVersion(req.params.version);
    writeAuditLog(req, "delete", "sync-release", result.version, `删除历史 Release: ${result.version}`);
    return res.json({
      success: true,
      message: `历史 Release ${result.version} 已删除`,
      deleted: result,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/sync/releases/rebuild-index", adminAuth.verifyAdminAccess, async (req, res) => {
  console.log("👉 [admin.js] 收到重建索引请求, version =", req.body.version);
  try {
    const version = req.body.version;
    if (!version) {
      return res.status(400).json({ success: false, message: "缺少必要参数 version" });
    }
    const job = releaseWorkerManager.startReleaseJob("release-pack-rebuild", { version });
    writeAuditLog(req, "rebuild-index", "sync-release", version, `启动版本 ${version} 的 Release Pack 重建任务`);
    return res.status(202).json({
      success: true,
      message: `已启动版本 ${version} 的 Release Pack 重建任务`,
      job,
    });
  } catch (error) {
    console.error("Rebuild index failed:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.code === "JOB_ALREADY_RUNNING" ? "已有 Release Pack 重建任务正在运行" : "重建索引失败: " + error.message,
      job: error.job || null,
    });
  }
});

router.get("/sync/releases/check-availability", adminAuth.verifyAdminAccess, async (req, res) => {
  try {
    const active = releaseService.getActiveReleaseInfo();
    const result = {
      activeReleaseVersion: active ? active.version : null,
      appConfig: { status: "unknown", message: "" },
      searchIndex: { status: "unknown", details: {} },
      scheduleDetail: { status: "unknown", details: {} },
      emptyRoom: { status: "unknown", details: {} },
      releasePack: { status: "unknown", details: {} }
    };
    
    // 1. Check App Config
    try {
      const publicConfig = appConfigService.getPublicAppConfig();
      if (publicConfig && publicConfig.success && publicConfig.data) {
        result.appConfig.status = "OK";
        result.appConfig.message = `学期: ${publicConfig.data.currentSemester}, 版本: ${publicConfig.data.dataVersion?.releaseVersion || '无'}`;
      } else {
        result.appConfig.status = "Fail";
        result.appConfig.message = "返回 success: false 或无数据";
      }
    } catch (e) {
      result.appConfig.status = "Fail";
      result.appConfig.message = e.message;
    }
    
    // If there is no active release, we cannot check index & details
    if (!active || !active.version) {
      result.searchIndex.status = "Fail";
      result.searchIndex.message = "无当前活跃 Release 版本";
      result.scheduleDetail.status = "Fail";
      result.scheduleDetail.message = "无当前活跃 Release 版本";
      result.releasePack.status = "Fail";
      result.releasePack.message = "无当前活跃 Release 版本";
      return res.json({ success: true, result });
    }

    const packStatus = releaseService.getReleasePackQuickHealth(active.version);
    result.releasePack = {
      status: packStatus.healthy ? "OK" : "Fail",
      details: packStatus,
      message: packStatus.healthy ? "Release Pack 完整" : packStatus.missing.concat(packStatus.hashErrors).join("; "),
    };
    
    // 2. Check Search Index
    try {
      const kinds = ["class", "teacher", "classroom", "course"];
      let allOk = true;
      kinds.forEach((kind) => {
        const indexResult = releaseService.readActiveIndex(kind, active.version);
        if (indexResult && indexResult.success) {
          result.searchIndex.details[kind] = { status: "OK", count: (indexResult.items || []).length };
        } else {
          result.searchIndex.details[kind] = { status: "Fail", message: indexResult ? indexResult.reasonCode : "未知错误" };
          allOk = false;
        }
      });
      result.searchIndex.status = allOk ? "OK" : "Fail";
    } catch (e) {
      result.searchIndex.status = "Fail";
      result.searchIndex.message = e.message;
    }
    
    // 3. Check Schedule Details by reading a few items from index
    try {
      const kinds = ["class", "teacher", "classroom", "course"];
      let allOk = true;
      for (const kind of kinds) {
        const indexResult = releaseService.readActiveIndex(kind, active.version);
        if (indexResult && indexResult.success && indexResult.items && indexResult.items.length > 0) {
          // Take first item and read schedule detail
          const firstItem = indexResult.items[0];
          const firstId = firstItem.id || firstItem.detailId || firstItem.classId;
          if (firstId) {
            const detailResult = releaseService.readActiveSchedule(kind, firstId, active.version);
            if (detailResult && detailResult.success && detailResult.schedule) {
              result.scheduleDetail.details[kind] = { status: "OK", testId: firstId, testName: firstItem.name || "" };
            } else {
              result.scheduleDetail.details[kind] = { status: "Fail", testId: firstId, message: detailResult ? detailResult.reasonCode : "读取失败" };
              allOk = false;
            }
          } else {
            result.scheduleDetail.details[kind] = { status: "Fail", message: "索引项中没有有效的 ID" };
            allOk = false;
          }
        } else {
          result.scheduleDetail.details[kind] = { status: "Empty", message: "没有索引项可测试" };
          allOk = false;
        }
      }
      result.scheduleDetail.status = allOk ? "OK" : "Fail";
    } catch (e) {
      result.scheduleDetail.status = "Fail";
      result.scheduleDetail.message = e.message;
    }

    // 4. Check Empty Room Index
    try {
      const emptyRoomIndex = releaseService.readEmptyRoomIndex(active.version);
      if (emptyRoomIndex && emptyRoomIndex.success) {
        result.emptyRoom.status = "OK";
        result.emptyRoom.details = {
          count: (emptyRoomIndex.rooms || []).length,
          buildings: emptyRoomIndex.buildings || [],
        };
      } else {
        result.emptyRoom.status = "Fail";
        result.emptyRoom.message = emptyRoomIndex ? (emptyRoomIndex.reasonCode || emptyRoomIndex.code) : "读取失败";
      }
    } catch (e) {
      result.emptyRoom.status = "Fail";
      result.emptyRoom.message = e.message;
    }
    
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 5.6 GET /api/admin/sync/command-guide
 * 前端拉取动态生成一键同步脚本运维指南
 */
router.get("/sync/command-guide", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const activeTerm = appConfigService.getAdminConfig().currentSemester || getDefaultTerm();
    const term = req.query.term || activeTerm || termRegistryService.LEGACY_CURRENT_TERM_CONFIG.term;
    const termRecord = termRegistryService.getTerm(term) || termRegistryService.LEGACY_CURRENT_TERM_CONFIG;
    const start = req.query.start || req.query.termStartDate || "YYYY-MM-DD";
    const totalWeeks = req.query.totalWeeks ? Number(req.query.totalWeeks) : Number(termRecord.totalWeeks);
    if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 30) {
      return res.status(400).json({
        success: false,
        message: "totalWeeks is required in Term Registry before generating sync commands",
        code: "TOTAL_WEEKS_REQUIRED",
        term,
      });
    }
    const operations = [
      {
        id: "sync:publish",
        displayName: "生成本机一键同步命令",
        command: "npm run sync:publish",
        displayScene: "日常全校课表同步与发布",
        sceneCode: "publisher-routine",
        intranetRequired: true,
        usesCatalogCache: true,
        usesDynamicCache: false,
        upload: true,
        publish: true,
        activate: true,
        estimatedDuration: "3 ~ 15 分钟",
        estimatedRequests: "full-campus",
        estimatedRequestsCode: "full-campus",
        risk: "medium",
        riskDisplay: "中",
      },
      {
        id: "sync:publish:full",
        displayName: "新学期 / 深度全量采集",
        command: `npm run sync:publish -- --mode=full --term=${term} --term-start-date=${start} --total-weeks=${totalWeeks}`,
        displayScene: "新学期、目录变化或异常修复",
        sceneCode: "publisher-full",
        intranetRequired: true,
        usesCatalogCache: false,
        usesDynamicCache: false,
        upload: true,
        publish: true,
        activate: true,
        estimatedDuration: "10 ~ 30 分钟",
        estimatedRequests: "full-campus",
        estimatedRequestsCode: "full-campus",
        risk: "high",
        riskDisplay: "高",
      },
      {
        id: "sync:publish:resume",
        displayName: "恢复本机 Publisher 中断任务",
        command: "npm run sync:publish -- --mode=resume --run-id=<runId>",
        displayScene: "电脑断电、终端关闭或网络中断后续跑",
        sceneCode: "publisher-resume",
        intranetRequired: false,
        usesCatalogCache: true,
        usesDynamicCache: false,
        upload: true,
        publish: true,
        activate: true,
        estimatedDuration: "取决于中断阶段",
        estimatedRequests: "resume-dependent",
        estimatedRequestsCode: "resume-dependent",
        risk: "low",
        riskDisplay: "低",
      },
      {
        id: "sync:publish:mirror",
        displayName: "重试 CloudBase 镜像",
        command: "npm run sync:publish -- --mode=mirror-only",
        displayScene: "Oracle 已发布但 CloudBase 镜像待重试",
        sceneCode: "publisher-mirror-only",
        intranetRequired: false,
        usesCatalogCache: false,
        usesDynamicCache: false,
        upload: false,
        publish: false,
        activate: true,
        estimatedDuration: "1 ~ 5 分钟",
        estimatedRequests: "cloudbase-only",
        estimatedRequestsCode: "cloudbase-only",
        risk: "low",
        riskDisplay: "低",
      },
      {
        id: "sync:export-cloudbase",
        displayName: "导出人工上传包",
        command: "npm run sync:export-cloudbase -- --release=<releaseVersion>",
        displayScene: "CloudBase 自动上传失败时人工补救",
        sceneCode: "cloudbase-manual-export",
        intranetRequired: false,
        usesCatalogCache: false,
        usesDynamicCache: false,
        upload: false,
        publish: false,
        activate: false,
        estimatedDuration: "1 ~ 3 分钟",
        estimatedRequests: "local-only",
        estimatedRequestsCode: "local-only",
        risk: "low",
        riskDisplay: "低",
      },
    ];
    return res.json({
      success: true,
      shell: "powershell",
      cachePolicy: {
        catalog: "reuse-validated",
        dynamicSchedules: "network-only",
        progress: "ignore",
        negativeCache: "ignore",
        oldScheduleMerge: false,
      },
      commands: operations.map((item) => ({
        id: item.id,
        name: item.displayName || item.name,
        command: item.command,
        scene: item.displayScene || item.scene,
        sceneCode: item.sceneCode || item.scene || "",
        precondition: item.intranetRequired
          ? "请在已连接校园网或 VPN 的 Windows 电脑上运行；公网服务器不会直接抓取 100 网。"
          : "不访问 100 网，只处理本地文件或服务端校验。",
        duration: item.estimatedDuration,
        intranetRequired: item.intranetRequired,
        usesCatalogCache: item.usesCatalogCache,
        usesDynamicCache: item.usesDynamicCache,
        upload: item.upload,
        publish: item.publish,
        activate: item.activate,
        estimatedRequests: item.estimatedRequests,
        estimatedRequestsCode: item.estimatedRequestsCode,
        risk: item.risk,
        riskDisplay: item.riskDisplay || item.risk,
        failureReason: item.intranetRequired ? "校园网或 VPN 未连接、登录会话失效，或 100 网限流。" : "文件、Token 或服务端校验不通过。",
        solution: item.intranetRequired ? "重新连接校园网/VPN，重新登录后重试；已有 runId 时优先恢复中断任务。" : "检查文件旁路元数据、上传 Token 和管理员权限。",
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 6. GET /api/admin/sync/history
 * 同步历史查询
 */
router.get("/sync/history", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const history = readJsonArray(SYNC_HISTORY_PATH);
    return res.json({
      success: true,
      items: history.slice(0, 100) // 最多取 100 条
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 7. POST /api/admin/sync/record
 * 记录一次同步结果
 */
router.post("/sync/record", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { type, semester, source, count, success, errorMsg } = req.body;
    const history = readJsonArray(SYNC_HISTORY_PATH);
    
    const record = {
      id: `sync_${Date.now()}`,
      time: new Date().toISOString(),
      type: type || "manual",
      semester: semester || getDefaultTerm(),
      source: source || "web-admin",
      count: parseInt(count, 10) || 0,
      success: success !== false,
      errorMsg: errorMsg || "",
      operator: "admin"
    };
    
    history.unshift(record);
    writeJsonAtomic(SYNC_HISTORY_PATH, history.slice(0, 500)); // 保持 500 条
    writeAuditLog(req, "sync", "sync-history", type, `上报同步数据: ${type}, 导入: ${count} 条`);
    
    return res.json({ success: true, record });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 8. GET /api/admin/quality/report
 * 获取数据质量报告
 */
router.get("/quality/report", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const report = qualityDomainService.buildQualityReport();
    return res.json({
      success: true,
      data: report
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 9. POST /api/admin/quality/mark
 * 标记质量异常为已知/忽略
 */
router.post("/quality/mark", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const body = req.body || {};
    const { type, target, ignore } = body;
    if (!type || !target) {
      return res.status(400).json({ success: false, message: "缺少必要参数 type 或 target" });
    }
    const client = String(req.get("x-fosu-admin-client") || "").toLowerCase();
    const fingerprint = `${type}::${target}`;
    const opts = {
      expectedVersion: req.get("if-match") || body.expectedVersion || body.version,
      requireIfMatch: client === "next",
    };
    let prepared;
    if (ignore) {
      prepared = qualityDomainService.prepareMarkIgnoreMutation(
        {
          fingerprint,
          category: type,
          reason: body.reason || `ignore ${target}`,
          severity: body.severity || "info",
        },
        opts
      );
    } else {
      prepared = qualityDomainService.prepareUnmarkIgnoreMutation(fingerprint, opts);
    }
    const result = commitWithBackup({
      type: "quality",
      sourceFile: qualityDomainService.QUALITY_IGNORES_PATH,
      fallbackData: prepared.backupData,
      commit: () => qualityDomainService.commitPreparedQualityMutation(prepared),
    });
    writeAuditLog(req, "ignore", "quality", `${type}:${target}`, `${ignore ? "标记忽略" : "取消忽略"} 质量缺陷`);
    return res.json({
      success: true,
      ignores: result.rules,
      version: result.version,
      etag: result.etag,
      lockWarning: result.lockWarning || undefined,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      code: error.code,
      currentVersion: error.currentVersion,
    });
  }
});

router.get("/quality/ignores", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const doc = qualityDomainService.listIgnores();
    return res.json({ success: true, ...doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/quality/recheck/start", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const job = qualityDomainService.startQualityRecheck(req.body || {});
    writeAuditLog(req, "recheck", "quality", job.id, "启动质量复检任务");
    return res.status(202).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      code: error.code,
      job: error.job,
    });
  }
});

router.get("/quality/recheck/:id", adminAuth.verifyAdminAccess, (req, res) => {
  const job = qualityDomainService.getQualityRecheck(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "质量复检任务不存在" });
  return res.json({ success: true, job });
});

/**
 * 10. GET /api/admin/export
 * 数据导出 API (支持导出 JSON / CSV)
 */
router.get("/export", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { type, id, format = "json" } = req.query;
    if (!type || !id) {
      return res.status(400).json({ success: false, message: "缺少 type 或 id" });
    }
    
  let original = null;
  if (type === "class") {
    original = getResourceArrayWithSource("class-schedules").items.find(x => x.className === id);
  } else if (type === "teacher") {
    original = getResourceArrayWithSource("teacher-schedules").items.find(x => x.teacherName === id);
  } else if (type === "classroom") {
    original = getResourceArrayWithSource("classroom-schedules").items.find(x => x.roomName === id);
  } else if (type === "course") {
    original = getResourceArrayWithSource("course-schedules").items.find(x => x.courseName === id);
  }
    
    if (!original) {
      return res.status(404).json({ success: false, message: "资源未找到" });
    }
    
    if (format === "csv") {
      const headers = ["courseName", "teacherName", "classroom", "weekday", "sections", "weeks", "note"];
      const rows = (original.courses || []).map(c => [
        `"${String(c.courseName || "").replace(/"/g, '""')}"`,
        `"${String(c.teacherName || "").replace(/"/g, '""')}"`,
        `"${String(c.classroom || "").replace(/"/g, '""')}"`,
        c.dayOfWeek || c.weekday || 1,
        `"${(c.sections || []).join("-")}"`,
        `"${(c.weeks || []).join(",")}"`,
        `"${String(c.note || "").replace(/"/g, '""')}"`
      ].join(","));
      
      const csv = `\uFEFF${headers.join(",")}\n${rows.join("\n")}\n`;
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(id)}.csv"`);
      res.type("text/csv");
      return res.send(csv);
    }
    
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(id)}.json"`);
    res.type("json");
    return res.json(original);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 11. GET /api/admin/backups
 * 备份文件管理 API
 */
router.get("/backups", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    return res.json({ success: true, items: backupService.listBackups() });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get("/backups/download", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const { filePath } = backupService.getBackupFile(req.query.filename);
    return res.download(filePath);
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      success: false,
      message: e.message,
      code: e.code || undefined,
    });
  }
});

router.post("/backups/preflight", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const filename = (req.body && req.body.filename) || req.query.filename;
    const preflight = backupService.preflightRestore(filename);
    return res.json({ success: true, preflight });
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      success: false,
      message: e.message,
      code: e.code || undefined,
    });
  }
});

router.post("/backups/restore", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const body = req.body || {};
    const filename = body.filename;
    const confirm = String(body.confirm || "");
    const dryRun = body.dryRun === true;
    const idempotencyKey = body.idempotencyKey || req.get("idempotency-key") || "";
    if (!filename) {
      return res.status(400).json({ success: false, message: "filename is required" });
    }
    const result = backupService.restoreBackup(filename, {
      dryRun,
      confirm,
      idempotencyKey,
    });
    if (!dryRun && result.restored) {
      writeAuditLog(
        req,
        "restore",
        "backups",
        path.basename(String(filename)),
        `恢复备份: ${filename}; hash=${result.beforeHash || ""}`
      );
    }
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      success: false,
      message: e.message,
      code: e.code || undefined,
      preflight: e.preflight,
      rollbackStatus: e.rollbackStatus,
      safetyBackup: e.safetyBackup,
    });
  }
});

/**
 * Snapshot list/download — aligned with backups contract.
 * GET /api/admin/snapshots
 * GET /api/admin/snapshots/download?filename=
 */
router.get("/snapshots", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const items = [];
    const currentJson = path.join(SNAPSHOTS_DIR, "current.json");
    const currentGz = path.join(SNAPSHOTS_DIR, "current.json.gz");
    if (fs.existsSync(currentJson)) {
      const stat = fs.statSync(currentJson);
      items.push({
        filename: "current.json",
        kind: "snapshot-current",
        size: `${Math.round(stat.size / 1024)} KB`,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        downloadPath: "/api/admin/snapshots/download?filename=current.json",
      });
    }
    if (fs.existsSync(currentGz)) {
      const stat = fs.statSync(currentGz);
      items.push({
        filename: "current.json.gz",
        kind: "snapshot-current",
        size: `${Math.round(stat.size / 1024)} KB`,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        downloadPath: "/api/admin/snapshots/download?filename=current.json.gz",
      });
    }
    if (fs.existsSync(HISTORY_DIR)) {
      fs.readdirSync(HISTORY_DIR)
        .filter((f) => f.startsWith("snapshot-") && (f.endsWith(".json") || f.endsWith(".json.gz")))
        .forEach((f) => {
          const filePath = path.join(HISTORY_DIR, f);
          const stat = fs.statSync(filePath);
          items.push({
            filename: f,
            kind: "snapshot-history",
            size: `${Math.round(stat.size / 1024)} KB`,
            sizeBytes: stat.size,
            createdAt: stat.mtime.toISOString(),
            downloadPath: `/api/admin/snapshots/download?filename=${encodeURIComponent(f)}`,
          });
        });
    }
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return res.json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get("/snapshots/download", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const file = path.basename(String(req.query.filename || ""));
    if (!file) {
      return res.status(400).json({ success: false, message: "filename is required" });
    }
    let filePath = "";
    if (file === "current.json" || file === "current.json.gz") {
      filePath = path.join(SNAPSHOTS_DIR, file);
    } else if (file.startsWith("snapshot-")) {
      filePath = path.join(HISTORY_DIR, file);
    } else {
      return res.status(400).json({ success: false, message: "invalid snapshot filename" });
    }
    const resolved = path.resolve(filePath);
    if (
      !resolved.startsWith(path.resolve(SNAPSHOTS_DIR)) ||
      !fs.existsSync(resolved)
    ) {
      return res.status(404).json({ success: false, message: "快照文件不存在" });
    }
    return res.download(resolved);
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.delete("/backups", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const file = req.query.filename || (req.body && req.body.filename);
    const confirm =
      (req.body && req.body.confirm) || req.query.confirm || req.get("x-confirm-filename") || "";
    const client = String(req.get("x-fosu-admin-client") || "").toLowerCase();
    const deleted = backupService.deleteBackup(file, {
      confirm,
      requireConfirm: client === "next" || Boolean(confirm),
    });
    writeAuditLog(req, "delete", "backups", deleted.filename, `删除数据备份: ${deleted.filename}`);
    return res.json({ success: true, message: "删除备份成功", ...deleted });
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      success: false,
      message: e.message,
      code: e.code || undefined,
    });
  }
});

/**
 * 12. GET /api/admin/audit-logs
 * 审计日志 API
 */
router.get("/audit-logs", adminAuth.verifyAdminAccess, (req, res) => {
  try {
    const entries = adminAuditService.readAll();
    return res.json({ success: true, items: entries.reverse().slice(0, 100) });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router._test = {
  buildClassroomHeatmap,
  deriveClassroomSchedulesFromClassSchedules,
  normalizeCourseSlot,
  verifyAdminWriteAccess,
  summarizeStagingData,
  validateStagingData,
  buildStagingSafety,
  buildSecurityReadiness,
};

module.exports = router;
