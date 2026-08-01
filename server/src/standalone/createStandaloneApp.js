/**
 * P5b WS-A：standalone Express 组合入口（无 Fosu 依赖）。
 *
 * 挂载面：
 * - /health/live|startup|ready（healthRoutes）；
 * - Run API（server 角色）：POST /api/agent/runs、GET /api/agent/runs/:runId、
 *   POST /api/agent/runs/:runId/cancel——主聊天 Run 同步链留在 server 进程内
 *   （Q11 七：不因 worker 存在把主链改异步）；轮询凭据 = pollToken（匿名主体，
 *   与 agentRunEventService 的 anonymous+pollToken 授权模型一致）；
 * - config-plane（server/admin 角色）：/api/admin/agent-platform/config/*，
 *   Bearer 令牌鉴权（AGENT_PLATFORM_ADMIN_TOKEN 全权；AGENT_PLATFORM_SERVICE_TOKENS
 *   JSON 声明 scoped 令牌）。无 Cookie 会话 → 无 CSRF 攻击面，写操作不需要
 *   同源/CSRF 头；未配置任何令牌 → 全部 503 fail closed；
 * - Admin 静态：/admin/agent-platform（apps/agent-admin/public 纯静态产物 +
 *   部署方 runtime-config.js 注入）。注意：本阶段 standalone 无浏览器登录
 *   会话，静态页可打开（200），数据 API 面向持 Bearer 令牌的调用方；
 * - fosu-campus 集成接缝：GET /api/agent/integrations/fosu-campus 恒 501，
 *   reasonCode 区分「未启用」（FOSU_CAMPUS_NOT_ENABLED）与「请求启用但本阶段
 *   未实现装配」（FOSU_CAMPUS_ASSEMBLY_NOT_IMPLEMENTED）。
 *
 * init 门：config-plane 与 Run 创建链 await composition.initPlatform()（memoized；
 * PG 迁移/连接/种子失败 → 503 AGENT_PLATFORM_INIT_FAILED，消息泛化）。
 */

const path = require("path");
const express = require("express");

const { createConfigPlaneHandlers } = require("../../../apps/agent-admin");
const { createStandaloneComposition } = require("./standaloneComposition");
const { createHealthRoutes } = require("./healthRoutes");
const { errorClassOf, sanitizeValue } = require("./standaloneLogger");

const APP_SERVICE = "@xiaofu-agent/agent-server";
const ADMIN_APP = "@xiaofu-agent/agent-admin";
const ADMIN_STATIC_DIR = path.join(__dirname, "../../../apps/agent-admin/public");

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
}

function createStandaloneApp(options = {}) {
  const role = String(options.role || "server");
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const composition = options.composition || createStandaloneComposition(options);
  const version = String(options.version || process.env.AGENT_PLATFORM_VERSION || process.env.GIT_REVISION || "0.1.0");

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", createHealthRoutes({ role, composition, version }));

  // init 门（与 integrated config-plane 同语义；消息泛化不透内部细节）。
  async function platformReadyGate(req, res, next) {
    try {
      await composition.initPlatform();
      return next();
    } catch (error) {
      return res.status(503).json({
        success: false,
        app: ADMIN_APP,
        code: "AGENT_PLATFORM_INIT_FAILED",
        message: "Agent platform initialization failed.",
        serverTime: new Date().toISOString(),
      });
    }
  }

  function requireScope(scope) {
    return (req, res, next) => {
      const outcome = composition.auth.authenticate(req);
      if (!outcome.ok) {
        return res.status(outcome.status || 401).json({
          success: false,
          app: ADMIN_APP,
          code: outcome.code,
          message: outcome.code === "AGENT_AUTH_NOT_CONFIGURED"
            ? "Agent platform auth is not configured."
            : "Authentication required.",
          serverTime: new Date().toISOString(),
        });
      }
      if (!outcome.scopes.includes(scope)) {
        return res.status(403).json({
          success: false,
          app: ADMIN_APP,
          code: "AGENT_AUTH_SCOPE_DENIED",
          message: "The presented credential lacks the required scope.",
          serverTime: new Date().toISOString(),
        });
      }
      req.standaloneAuth = { actor: outcome.actor, scopes: outcome.scopes.slice() };
      return next();
    };
  }

  // ---- Run API（server 角色；admin 角色不执行聊天主链）----
  if (role === "server") {
    app.post("/api/agent/runs", platformReadyGate, composition.runHandlers.createRun);
    app.get("/api/agent/runs/:runId", composition.runHandlers.getRun);
    app.post("/api/agent/runs/:runId/cancel", composition.runHandlers.cancelRun);
  }

  // ---- config-plane（server/admin 角色共用）----
  const configPlaneHandlers = createConfigPlaneHandlers({
    getConfigKernel: () => composition.configKernel,
    listRecentPlatformTraces: composition.listRecentPlatformTraces,
    resolveActor: (req) => (req && req.standaloneAuth && req.standaloneAuth.actor) || "admin",
    recordWrite(entry) {
      logger({
        event: "config-plane-write",
        action: entry && entry.action,
        target: entry && entry.target,
        summary: sanitizeValue(entry && entry.summary),
      });
    },
  });
  const requireRead = requireScope("agent-config:read");
  const requireAuditRead = requireScope("agent-config:audit:read");
  const requireWrite = requireScope("agent-config:write");

  app.get("/api/admin/agent-platform/config/snapshot", requireRead, platformReadyGate, configPlaneHandlers.getSnapshot);
  app.get("/api/admin/agent-platform/config/domains", requireRead, platformReadyGate, configPlaneHandlers.getDomains);
  app.get("/api/admin/agent-platform/config/versions", requireRead, platformReadyGate, configPlaneHandlers.getVersions);
  app.get("/api/admin/agent-platform/config/artifact", requireRead, platformReadyGate, configPlaneHandlers.getArtifact);
  app.get("/api/admin/agent-platform/config/draft", requireRead, platformReadyGate, configPlaneHandlers.getDraft);
  app.get("/api/admin/agent-platform/config/audit", requireAuditRead, platformReadyGate, configPlaneHandlers.getAudit);
  app.get("/api/admin/agent-platform/runs/:runId", requireRead, platformReadyGate, configPlaneHandlers.getRunTrace);
  app.put("/api/admin/agent-platform/config/draft", requireWrite, platformReadyGate, configPlaneHandlers.putDraft);
  app.post("/api/admin/agent-platform/config/validate", requireWrite, platformReadyGate, configPlaneHandlers.postValidate);
  app.post("/api/admin/agent-platform/config/test", requireWrite, platformReadyGate, configPlaneHandlers.postTest);
  app.post("/api/admin/agent-platform/config/publish", requireWrite, platformReadyGate, configPlaneHandlers.postPublish);
  app.post("/api/admin/agent-platform/config/rollback", requireWrite, platformReadyGate, configPlaneHandlers.postRollback);

  // ---- fosu-campus 集成接缝：明确 501 / 未启用语义（本阶段不供给校园数据）----
  app.get("/api/agent/integrations/fosu-campus", (req, res) => {
    noStore(res);
    res.status(501).json({
      success: false,
      code: composition.fosuCampus.reasonCode,
      pluginId: composition.fosuCampus.pluginId,
      requested: composition.fosuCampus.requested,
      assembled: false,
      message: "Campus integration is not available in this standalone build phase.",
      serverTime: new Date().toISOString(),
    });
  });

  // ---- Admin 静态产物（无构建纯静态；部署方运行时注入）----
  app.get("/admin/agent-platform/runtime-config.js", (req, res) => {
    noStore(res);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("application/javascript");
    res.send(`window.AGENT_ADMIN_RUNTIME_CONFIG = ${JSON.stringify({
      brand: "Agent Platform Admin",
      csrfHeader: "X-CSRF-Token",
      loginPath: "/admin/agent-platform/",
      sessionPath: "/health/live",
      dashboardPath: "/admin/agent-platform/",
      apiBase: "/api/admin/agent-platform",
    })};`);
  });
  app.use("/admin/agent-platform", express.static(ADMIN_STATIC_DIR, {
    index: "agent-platform.html",
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  }));

  app.get("/", (req, res) => {
    noStore(res);
    res.json({
      success: true,
      app: APP_SERVICE,
      serviceRole: role,
      version,
      serverTime: new Date().toISOString(),
    });
  });

  // 404 与错误兜底（JSON，不透内部细节）。
  app.use((req, res) => {
    noStore(res);
    res.status(404).json({
      success: false,
      code: "NOT_FOUND",
      message: "Resource not found.",
      serverTime: new Date().toISOString(),
    });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    logger({ event: "standalone-http-error", errorClass: errorClassOf(error) });
    noStore(res);
    res.status(error && error.type === "entity.too.large" ? 413 : 400).json({
      success: false,
      code: error && error.type === "entity.too.large" ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
      message: "Invalid request.",
      serverTime: new Date().toISOString(),
    });
  });

  return Object.freeze({ app, composition });
}

module.exports = Object.freeze({
  createStandaloneApp,
});
