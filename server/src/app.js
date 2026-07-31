/**
 * 后端服务入口文件：初始化 Express 应用，挂载安全、跨域及限流中间件，挂载 API 路由并启动 HTTP 监听。
 */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const path = require("path");
const config = require("./config");
const { globalLimiter } = require("./utils/rateLimit");
const { safeLog } = require("./utils/safeLogger");
const { verifyStaticAccessTicket } = require("./utils/staticAccessTicket");
const { recordSecurityEvent } = require("./services/securityEventService");
const { getSecurityMode } = require("./services/securityModeService");
const releaseService = require("./services/releaseService");
const releaseLifecycleService = require("./services/releaseLifecycleService");
const releaseWorkerManager = require("./services/releaseWorkerManager");
const storageLifecycleService = require("./services/storageLifecycleService");
const termRegistryService = require("./services/termRegistryService");
const runtimePointerService = require("./services/runtimePointerService");
const performanceMonitorService = require("./services/performanceMonitorService");
const campusMapAssetService = require("./services/campusMapAssetService");
const adminAuth = require("./services/adminAuth");
const { defaultCourseReminderDispatchService } = require("./services/ai/reminders/courseReminderDispatchService");

// 路由引入
const healthRouter = require("./routes/health");
const fosuRouter = require("./routes/fosu");
const adminRouter = require("./routes/admin");
const adminPageRouter = require("./routes/adminPages");
const contributeRouter = require("./routes/contribute");
const feedbackRouter = require("./routes/feedback");
const personalRouter = require("./routes/personal");
const fosuApaasImportRouter = require("./routes/fosuApaasImport");
const relayRouter = require("./routes/relay");
const aiRouter = require("./routes/ai");
const cozeToolGatewayRouter = require("./routes/cozeToolGateway");
const platformComposition = require("./services/ai/platformComposition");

// Integrated deployment composition root: API, Agent Runtime and compatibility
// transports are bound to one platform singleton before Express mounts routes.
aiRouter.configureAgentRunHandlers(platformComposition.getRunHandlers());

const app = express();

app.set("trust proxy", (ip) => {
  const { isTrustedProxyIp } = require("./utils/clientIp");
  return isTrustedProxyIp(ip);
});

// 1. 安全加固 (Helmet)
app.use(helmet());

// 2. CORS 跨域配置
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowedOrigins = [
      ...config.CORS_ALLOWED_ORIGINS,
      ...config.FOSU_ALLOWED_ADMIN_ORIGINS,
      ...config.FOSU_ALLOWED_PUBLIC_ORIGINS,
    ].filter((item) => item && item !== "*");
    const developmentOpen = config.NODE_ENV === "development" && process.env.FOSU_STRICT_CORS !== "true";
    if (
      allowedOrigins.includes(origin) ||
      developmentOpen
    ) {
      return callback(null, true);
    }
    
    safeLog("cors-rejected", { origin });
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};
app.use(cors(corsOptions));

// 3. 全局 API 访问频率限制
app.use(globalLimiter);
app.use(performanceMonitorService.middleware);
app.use(compression({ threshold: 1024 }));

// 4. 解析请求体。普通 API 保持轻量，大上传/导入路径单独放宽，避免 2C12G
// 环境下任意 JSON 请求占用过多内存。
const DEFAULT_JSON_BODY_LIMIT = process.env.FOSU_JSON_BODY_LIMIT || "2mb";
const LARGE_JSON_BODY_LIMIT = process.env.FOSU_LARGE_JSON_BODY_LIMIT || "30mb";
const PERSONAL_XLS_BODY_LIMIT = process.env.FOSU_PERSONAL_XLS_BODY_LIMIT || "20mb";
const DEFAULT_URLENCODED_BODY_LIMIT = process.env.FOSU_URLENCODED_BODY_LIMIT || "1mb";
const defaultJsonParser = express.json({ limit: DEFAULT_JSON_BODY_LIMIT });
const largeJsonParser = express.json({ limit: LARGE_JSON_BODY_LIMIT });
const personalXlsJsonParser = express.json({ limit: PERSONAL_XLS_BODY_LIMIT });

function selectJsonParser(req) {
  const routePath = String(req.path || "");
  if (routePath === "/api/fosu/personal/import-xls") return personalXlsJsonParser;
  if (
    routePath.indexOf("/api/admin/sync/") === 0 ||
    routePath.indexOf("/api/admin/release/activate") === 0 ||
    routePath.indexOf("/api/relay/staging/upload") === 0 ||
    routePath === "/api/admin/campus-map/assets/upload"
  ) {
    return largeJsonParser;
  }
  return defaultJsonParser;
}

app.use((req, res, next) => selectJsonParser(req)(req, res, next));
app.use(express.urlencoded({ extended: true, limit: DEFAULT_URLENCODED_BODY_LIMIT }));

app.use(express.static(path.join(__dirname, "../public"), {
  maxAge: config.NODE_ENV === "production" ? "1h" : 0,
}));

app.get("/api/admin/ui-mode", (req, res) => {
  res.json({
    success: true,
    primary: "legacy",
    effectivePrimary: "legacy",
    adminNextEnabled: false,
    paths: { legacy: "/admin/" },
  });
});

function staticReleaseAccessGuard(req, res, next) {
  const method = String(req.method || "GET").toUpperCase();
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("X-Frame-Options", "DENY");

  if (!["GET", "HEAD"].includes(method)) {
    return res.status(405).json({ success: false, code: "STATIC_METHOD_NOT_ALLOWED" });
  }

  const security = getSecurityMode();
  if (!security.requireStaticTicket) {
    return next();
  }

  const requestPath = `${req.baseUrl || "/static/releases"}${req.path || ""}`;
  const match = requestPath.match(/^\/static\/releases\/([^/]+)(?:\/|$)/);
  const releaseVersion = match ? decodeURIComponent(match[1]) : "";
  const ticket = req.headers["x-fosu-static-ticket"];
  const result = verifyStaticAccessTicket(ticket, {
    method,
    releaseVersion,
    path: requestPath,
  });

  if (result.valid) {
    return next();
  }

  recordSecurityEvent(result.code === "STATIC_TICKET_EXPIRED" ? "security-static-ticket-expired" : "security-static-ticket-invalid", {
    route: "/static/releases",
    method,
    mode: security.mode,
    reasonCode: result.code || "STATIC_TICKET_INVALID",
  });

  if (security.observeOnly || security.staticAccessMode === "observe") {
    res.setHeader("X-Fosu-Static-Ticket-Observed", result.code || "STATIC_TICKET_INVALID");
    return next();
  }

  return res.status(ticket ? 403 : 401).json({
    success: false,
    code: ticket ? "STATIC_TICKET_INVALID" : "STATIC_TICKET_REQUIRED",
    reasonCode: ticket ? "STATIC_TICKET_INVALID" : "STATIC_TICKET_REQUIRED",
    message: "Static release access denied.",
  });
}

app.use("/static/releases", staticReleaseAccessGuard);
app.use("/static/releases", express.static(releaseService.PUBLIC_RELEASES_DIR, {
  fallthrough: false,
  immutable: true,
  maxAge: "1y",
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Fosu-Static-Policy", "cacheable-public-release-pack");
  },
}));

app.use("/static/runtime", express.static(path.join(releaseService.PUBLIC_RELEASES_DIR, "..", "runtime"), {
  fallthrough: false,
  maxAge: "60s",
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Fosu-Static-Policy", "cacheable-public-runtime-pointer");
  },
}));

campusMapAssetService.ensureInitialized();
app.use("/static/campus-maps", express.static(campusMapAssetService.PUBLIC_ROOT, {
  fallthrough: false,
  maxAge: "1y",
  setHeaders: (res, filePath) => {
    if (String(filePath || "").endsWith(`${path.sep}config.json`)) {
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    } else {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Fosu-Static-Policy", "cacheable-campus-map-asset");
  },
}));

app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    safeLog("payload-too-large", {
      path: req.path,
      method: req.method,
      limit: err.limit,
      length: err.length,
    });
    return res.status(413).json({
      success: false,
      code: "PAYLOAD_TOO_LARGE",
      message: "上传数据过大，请使用分块上传或缩小同步范围。",
    });
  }

  return next(err);
});

// 5. 挂载路由
app.use("/api/health", healthRouter);
app.use("/health", healthRouter);
app.use("/api/fosu", fosuRouter);
app.use("/api/fosu/personal", personalRouter);
app.use("/api/schedule-import/fosu", fosuApaasImportRouter);
app.use("/api/ai", aiRouter);
app.use("/api/coze/tools", cozeToolGatewayRouter);
app.use("/api/admin", adminRouter);

function redirectAdminAlias(prefix) {
  return function adminAliasRedirect(req, res) {
    const originalUrl = String(req.originalUrl || prefix);
    const suffix = originalUrl.slice(prefix.length);
    const targetSuffix = suffix && suffix !== "/" ? suffix : "/";
    return res.redirect(302, `/admin${targetSuffix}`);
  };
}

// Legacy is the only admin UI. Historical bookmarks keep their deep path and query.
app.use("/admin-next", redirectAdminAlias("/admin-next"));
app.use("/admin-legacy", redirectAdminAlias("/admin-legacy"));

// P4e：Agent 控制面静态页（apps/agent-admin/public，无构建纯静态）。
// 页面本身只是 UI 外壳，数据全部来自 /api/admin/agent-platform/* 真实 API；
// 未登录先跳 Legacy 登录页（与 adminPages 同一 Cookie 会话）。
app.use("/admin/agent-platform", (req, res, next) => {
  if (!adminAuth.isAdminCookieValid(req)) {
    const nextTarget = encodeURIComponent(String(req.originalUrl || "/admin/agent-platform"));
    return res.redirect(302, `/admin/login?next=${nextTarget}`);
  }
  return next();
}, express.static(path.join(__dirname, "../../apps/agent-admin/public"), {
  index: "agent-platform.html",
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    );
  },
}));

app.use("/admin", adminPageRouter);

app.use("/api/relay", relayRouter);
app.use("/api/contribute", contributeRouter);
app.use("/api/feedback", feedbackRouter);

// 6. 404 错误处理
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: "Requested resources not found.",
  });
});

// 7. 全局异常处理
app.use((err, req, res, next) => {
  safeLog("uncaught-error", { message: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    message: "Internal server error.",
    error: config.NODE_ENV === "development" ? err.message : undefined,
  });
});

// 8. 启动配置有效性检查（默认 migration-safe；仅 FOSU_CONFIG_HARD_FAIL=true 时 hard-fail）
try {
  const { validateStartupConfig } = require("./services/configValidation");
  const configValidation = validateStartupConfig();
  if (configValidation.warnings.length) {
    console.warn(`[FosuClass Server] Config warnings: ${configValidation.warnings.join("; ")}`);
  }
  if (configValidation.derivedAdminApiToken) {
    console.warn(
      "[FosuClass Server] [HIGH] ADMIN_API_TOKEN is password-derived. Set an independent ADMIN_API_TOKEN for production. (Token value never logged.)"
    );
  }
  const adminCapabilitiesService = require("./services/adminCapabilitiesService");
  adminCapabilitiesService.assertWriteModulesConfigSafe();
} catch (error) {
  if (error && (error.code === "CONFIG_VALIDATION_FAILED" || error.code === "WRITE_MODULES_STAR_FORBIDDEN")) {
    console.error(`[FosuClass Server] ${error.message}`);
    process.exit(1);
  }
  safeLog("startup-config-validation-failed", { error: error.message });
}

// 9. 启动监听
function startServer(port = config.PORT) {
  return app.listen(port, () => {
  console.log(`[FosuClass Server] Server is running at http://localhost:${port}`);
  console.log(`[FosuClass Server] Environment: ${config.NODE_ENV}`);
  try {
    termRegistryService.migrateLegacyTermState();
  } catch (error) {
    safeLog("startup-term-registry-migration-failed", { error: error.message });
  }
  try {
    releaseLifecycleService.reconcileLifecycle({ reason: "startup" });
  } catch (error) {
    safeLog("startup-lifecycle-reconcile-failed", { error: error.message });
  }
  try {
    runtimePointerService.ensureActivePointer();
  } catch (error) {
    safeLog("startup-runtime-pointer-ensure-failed", { code: error.code || "", error: error.message });
  }
  try {
    storageLifecycleService.scheduleMaintenance();
  } catch (error) {
    safeLog("startup-maintenance-schedule-failed", { error: error.message });
  }
  try {
    defaultCourseReminderDispatchService.schedule();
  } catch (error) {
    safeLog("startup-course-reminder-dispatch-failed", { code: error.code || "" });
  }
  if (process.env.STATIC_RELEASE_SYNC_ENABLED === "true") {
    const delayMs = Math.max(1000, Number(process.env.STATIC_RELEASE_RECONCILE_START_DELAY_MS || 5000) || 5000);
    const timer = setTimeout(() => {
      try {
        releaseWorkerManager.startReleaseJob("static-release-reconcile", { reason: "startup" });
      } catch (error) {
        safeLog("startup-static-reconcile-schedule-failed", { code: error.code || "", error: error.message });
      }
    }, delayMs);
    if (timer.unref) timer.unref();
  }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
