#!/usr/bin/env node
/**
 * P5b WS-A：standalone 单镜像入口（四角色分发）。
 *
 *   AGENT_PLATFORM_ROLE=server|worker|admin|migrate（默认 server）
 *
 * - server：HTTP（Run API + config-plane + health + Admin 静态托管；compose
 *   默认合一形态 = server 角色已含 admin 面；admin 角色分离只为可扩展，
 *   admin 角色 = config-plane + Admin 静态 + health，不执行聊天主链）。
 * - worker：队列异步任务消费（不监听公网 HTTP；仅 127.0.0.1 健康探针，
 *   AGENT_PLATFORM_WORKER_HEALTH_PORT 控制，"0"/"off" 关闭，默认 8081）。
 * - migrate：runMigrations 后按结果 exit 0/1。
 *
 * 优雅退出：SIGTERM/SIGINT → server 停止接受连接并等待排空（宽限
 * AGENT_PLATFORM_SHUTDOWN_GRACE_MS，默认 8000ms）→ 关闭队列/PG 池 → exit 0；
 * worker 停止 claim、等待在飞任务收敛（未闭环残留由 reclaim 接管）→ exit 0。
 *
 * 日志：结构化 JSON（standaloneLogger），字段 serviceRole/version/arch，业务
 * 事件可附 configVersion/runId/jobId/errorClass；密钥/完整 prompt/敏感记忆
 * 永不在字段白名单内（logger 侧二次拒绝）。
 */

const http = require("http");

const { createStandaloneLogger, errorClassOf } = require("./standaloneLogger");

const ROLES = Object.freeze(["server", "worker", "admin", "migrate"]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function resolveRole(value) {
  const raw = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
  const role = raw || "server";
  if (!ROLES.includes(role)) {
    throw codedError("AGENT_PLATFORM_ROLE_INVALID", `role must be one of ${ROLES.join("|")}`);
  }
  return role;
}

function intEnv(env, name, fallback, min, max) {
  const value = Number(env && env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/** 组合根/worker 使用 entry 式 logger({event, ...fields})；适配到结构化行。 */
function entryLoggerOf(log) {
  return (entry, level) => {
    const source = entry && typeof entry === "object" ? entry : { event: String(entry || "event") };
    const fields = Object.assign({}, source);
    const event = String(fields.event || "event");
    delete fields.event;
    log(event, fields, level || "info");
  };
}

async function closePgPool() {
  try {
    await require("../services/ai/persistence/pgPersistenceService").closeForTests();
  } catch (_) {
    /* 进程即退，尽力而为 */
  }
}

async function runServerRole(role, env, log) {
  const { createStandaloneApp } = require("./createStandaloneApp");
  const version = String(env.AGENT_PLATFORM_VERSION || env.GIT_REVISION || "0.1.0");
  const { app, composition } = createStandaloneApp({
    role,
    env,
    version,
    logger: entryLoggerOf(log),
  });
  const port = intEnv(env, "AGENT_PLATFORM_PORT", 8080, 1, 65535);
  const host = String(env.AGENT_PLATFORM_HOST || "0.0.0.0");
  const graceMs = intEnv(env, "AGENT_PLATFORM_SHUTDOWN_GRACE_MS", 8000, 0, 60000);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  log("standalone-listening", {
    port: address && address.port,
    host,
    repositoryBackend: composition.repositoryBackend,
    queue: composition.hasQueue ? "redis-streams" : "file-in-process",
  });

  // init（迁移+种子+索引恢复）异步推进；探针经 startupState 如实报告，
  // config-plane/Run 创建链经 init 门等待同一 memoized promise。
  composition.start().then(
    () => log("standalone-started", { backend: composition.repositoryBackend }),
    (error) => log("standalone-startup-failed", { errorClass: errorClassOf(error), causeCode: String(error && error.causeCode || "") }, "error")
  );

  let closing = false;
  await new Promise((resolve) => {
    const shutdown = (signal) => {
      if (closing) return;
      closing = true;
      log("standalone-shutdown", { signal });
      server.close(() => resolve());
      // 宽限后强制收尾（长连接/在飞 Run 不无限期悬挂）。
      setTimeout(resolve, graceMs).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  });
  try {
    await composition.close();
  } catch (_) {
    /* 尽力而为 */
  }
  await closePgPool();
  log("standalone-stopped", {});
  return 0;
}

async function runWorkerRole(env, log) {
  const { createWorkerRuntime } = require("./workerMain");
  const { createHealthRoutes } = require("./healthRoutes");
  const express = require("express");
  const worker = createWorkerRuntime({ env, logger: entryLoggerOf(log) });
  const version = String(env.AGENT_PLATFORM_VERSION || env.GIT_REVISION || "0.1.0");
  const graceMs = intEnv(env, "AGENT_PLATFORM_SHUTDOWN_GRACE_MS", 10000, 0, 60000);

  // 仅 localhost 健康探针；"0"/"off" 关闭。
  const healthPortRaw = String(env.AGENT_PLATFORM_WORKER_HEALTH_PORT === undefined ? "8081" : env.AGENT_PLATFORM_WORKER_HEALTH_PORT).trim().toLowerCase();
  let healthServer = null;
  if (healthPortRaw !== "0" && healthPortRaw !== "off") {
    const app = express();
    app.disable("x-powered-by");
    app.use("/health", createHealthRoutes({ role: "worker", composition: worker.readinessAdapter, version }));
    healthServer = http.createServer(app);
    const port = intEnv({ AGENT_PLATFORM_WORKER_HEALTH_PORT: healthPortRaw }, "AGENT_PLATFORM_WORKER_HEALTH_PORT", 8081, 1, 65535);
    await new Promise((resolve, reject) => {
      healthServer.once("error", reject);
      healthServer.listen(port, "127.0.0.1", resolve);
    });
    log("worker-health-listening", { port });
  }

  let stopping = false;
  const stopPromise = new Promise((resolve) => {
    const shutdown = (signal) => {
      if (stopping) return;
      stopping = true;
      log("worker-shutdown", { signal });
      resolve();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  });
  const runPromise = worker.start().catch((error) => {
    log("worker-failed", { errorClass: errorClassOf(error) }, "error");
    return error && error.code ? error.code : "WORKER_FAILED";
  });
  const outcome = await Promise.race([
    runPromise,
    stopPromise.then(async () => {
      await worker.stop(graceMs);
      return runPromise.then(() => "stopped", () => "stopped");
    }),
  ]);
  if (healthServer) {
    await new Promise((resolve) => healthServer.close(resolve));
  }
  await closePgPool();
  return outcome === "stopped" || stopping ? 0 : 1;
}

async function main(env = process.env) {
  let role;
  try {
    role = resolveRole(env.AGENT_PLATFORM_ROLE);
  } catch (error) {
    const log = createStandaloneLogger({ serviceRole: "unknown" });
    log("role-invalid", { errorClass: errorClassOf(error) }, "error");
    return 1;
  }
  const log = createStandaloneLogger({ serviceRole: role });
  if (role === "migrate") {
    const { runMigrate } = require("./migrateMain");
    return runMigrate({ logger: log });
  }
  if (role === "worker") {
    return runWorkerRole(env, log);
  }
  return runServerRole(role, env, log);
}

if (require.main === module) {
  process.on("uncaughtException", (error) => {
    const log = createStandaloneLogger({ serviceRole: "fatal" });
    log("uncaught-exception", { errorClass: errorClassOf(error) }, "error");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    const log = createStandaloneLogger({ serviceRole: "fatal" });
    log("unhandled-rejection", { errorClass: errorClassOf(reason) }, "warn");
  });
  main().then(
    (code) => process.exit(code),
    (error) => {
      const log = createStandaloneLogger({ serviceRole: "fatal" });
      log("main-failed", { errorClass: errorClassOf(error) }, "error");
      process.exit(1);
    }
  );
}

module.exports = Object.freeze({
  ROLES,
  main,
  resolveRole,
});
