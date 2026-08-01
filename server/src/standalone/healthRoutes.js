/**
 * P5b WS-A：standalone 健康三探针（与 Fosu server/src/routes/health.js 无关，
 * 不复用其 Release Pack/worker 语义）。
 *
 * - GET /health/live：进程存活（事件循环可响应即 200）。
 * - GET /health/startup：首次迁移 + 种子 + 索引恢复完成才 200；进行中/失败 503
 *   （failed 携带 coded errorClass，不透了内部细节）。
 * - GET /health/ready：九项细分 postgres/redis/migration/artifactRepository/
 *   configSnapshot/workerQueue/ragBackend/provider/publishedConfigVersion，
 *   逐项 {status: ok|not_ready|unknown, reason, ...}。
 *
 * 整体就绪判定（写死在本文件，勿散）：
 * - blocking 项：postgres / migration / artifactRepository / configSnapshot /
 *   ragBackend / publishedConfigVersion——任一 not_ready 则整体 503；
 * - redis / workerQueue：异步任务传输层。未配置 = unknown 不阻断（server 角色
 *   退化为进程内即时消费或如实降级）；配置了但不可达 = not_ready 同样不阻断
 *   整体（在线 Run 主链不依赖它），但如实呈现；
 * - provider：永不阻断。未配置只影响本项与 capabilities.strictModelFirstReady
 *   标注——public deterministic（确定性示例 Skill）不受 Provider 影响；
 *   readiness 报告的是配置级事实（probed:false），绝无 Mock 冒充。
 */

const express = require("express");

const BLOCKING_ITEMS = Object.freeze([
  "postgres",
  "migration",
  "artifactRepository",
  "configSnapshot",
  "ragBackend",
  "publishedConfigVersion",
]);

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
}

/**
 * @param {{role: string, composition: object, version?: string}} options
 */
function createHealthRoutes(options = {}) {
  const role = String(options.role || "server");
  const composition = options.composition;
  const version = String(options.version || process.env.AGENT_PLATFORM_VERSION || process.env.GIT_REVISION || "0.1.0");
  const router = express.Router();
  const startedAtMs = Date.now();

  router.get("/live", (req, res) => {
    noStore(res);
    res.json({
      status: "alive",
      serviceRole: role,
      version,
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
      serverTime: new Date().toISOString(),
    });
  });

  router.get("/startup", (req, res) => {
    noStore(res);
    const state = composition.startupState || {};
    if (state.started) {
      return res.json({
        status: "started",
        serviceRole: role,
        startedAt: state.startedAt || "",
        serverTime: new Date().toISOString(),
      });
    }
    const failed = String(state.failed || "");
    return res.status(503).json({
      status: failed ? "failed" : "starting",
      serviceRole: role,
      code: failed || "STARTUP_IN_PROGRESS",
      serverTime: new Date().toISOString(),
    });
  });

  router.get("/ready", async (req, res) => {
    noStore(res);
    let items;
    try {
      items = await composition.readinessItems();
    } catch (error) {
      return res.status(503).json({
        status: "not_ready",
        serviceRole: role,
        code: String(error && error.code || "READINESS_CHECK_FAILED").slice(0, 100),
        serverTime: new Date().toISOString(),
      });
    }
    const annotated = {};
    Object.keys(items).forEach((name) => {
      const item = items[name] || { status: "unknown", reason: "NOT_EVALUATED" };
      const blocking = name === "provider" || name === "redis" || name === "workerQueue"
        ? false
        : BLOCKING_ITEMS.includes(name);
      annotated[name] = Object.assign({}, item, { blocking });
    });
    const ready = BLOCKING_ITEMS.every((name) => annotated[name] && annotated[name].status === "ok");
    const providerReady = annotated.provider && annotated.provider.status === "ok";
    return res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      serviceRole: role,
      items: annotated,
      capabilities: {
        // public deterministic：无 Provider 也能跑内置只读确定性示例（本阶段
        // 五阶段全确定性，外部调用恒 0）；strict_model_first 属 trial/dev 能力，
        // 仅当真实 Provider 凭据配置存在时才标注 ready。
        publicDeterministic: true,
        strictModelFirstReady: providerReady === true,
        externalProviderCallsInPublic: 0,
      },
      serverTime: new Date().toISOString(),
    });
  });

  return router;
}

module.exports = Object.freeze({
  BLOCKING_ITEMS,
  createHealthRoutes,
});
