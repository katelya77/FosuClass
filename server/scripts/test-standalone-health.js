#!/usr/bin/env node
/**
 * Standalone 平台容器 HEALTHCHECK（server/Dockerfile `standalone` target 专用，
 * 与 Fosu 一体化容器的 scripts/test-health.js 无关，不改其行为）。
 *
 * 按 AGENT_PLATFORM_ROLE 选择探测策略：
 *
 *   server / admin（默认 server）：
 *     GET http://127.0.0.1:${AGENT_PLATFORM_PORT:-8080}/health/ready
 *     HTTP 200 → exit 0；非 200 / 连接失败 / 超时 → exit 1。
 *     readiness 未就绪（如 Provider 未配置导致 trial/dev not ready）视为不健康，
 *     与 compose depends_on 的 service_healthy 语义一致；若运维只要纯存活语义，
 *     可设 AGENT_PLATFORM_HEALTHCHECK_PATH=/health/live 降级。
 *
 *   worker：
 *     worker 不监听 HTTP（或仅暴露 localhost health）。先探 /health/live：
 *       - HTTP 2xx → exit 0；HTTP 其他状态 / 超时 → exit 1；
 *       - 连接被拒绝（ECONNREFUSED，无 HTTP 监听属预期形态）→ 回退进程活性检查：
 *         /proc/1/cmdline 须包含 agentServerMain.js（容器主进程）。满足 → exit 0。
 *
 *   migrate：
 *     一次性任务（跑完 runMigrations 即退出），无需健康检查 → 直接 exit 0。
 *     compose 中对 migrate 同时设置 healthcheck.disable: true，双保险。
 *
 * 退出码纪律：0=healthy，1=unhealthy/超时/异常。
 * 安全纪律：不打印凭据、连接串、完整 URL 查询串或探针响应体。
 */

const fs = require("fs");

const ROLE = String(process.env.AGENT_PLATFORM_ROLE || "server").trim().toLowerCase() || "server";
const PORT = Number(process.env.AGENT_PLATFORM_PORT || 8080) || 8080;
const PROBE_PATH = String(process.env.AGENT_PLATFORM_HEALTHCHECK_PATH || "").trim();
const TIMEOUT_MS = 5000;

function ok(message) {
  console.log(`[standalone-health] role=${ROLE}: ${message}`);
  process.exit(0);
}

function fail(message) {
  console.error(`[standalone-health] role=${ROLE}: ${message}`);
  process.exit(1);
}

async function probe(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    return { kind: "http", status: res.status };
  } catch (error) {
    const code = (error && error.cause && error.cause.code) || (error && error.code) || "";
    if (code === "ECONNREFUSED") return { kind: "refused" };
    const name = error && error.name;
    return { kind: "error", message: name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : `probe error (${name || "unknown"})` };
  } finally {
    clearTimeout(timer);
  }
}

function mainProcessAlive() {
  try {
    return fs.readFileSync("/proc/1/cmdline", "utf8").includes("agentServerMain.js");
  } catch {
    return false;
  }
}

async function main() {
  if (ROLE === "migrate") {
    ok("one-shot migration task; healthcheck not applicable");
  }

  if (ROLE === "worker") {
    const result = await probe(PROBE_PATH || "/health/live");
    if (result.kind === "http") {
      if (result.status >= 200 && result.status < 300) ok(`live probe HTTP ${result.status}`);
      fail(`live probe HTTP ${result.status}`);
    }
    if (result.kind === "refused") {
      // 无 HTTP 监听是 worker 的预期形态：回退为容器主进程活性检查。
      if (mainProcessAlive()) ok("no HTTP listener (expected); main process alive");
      fail("no HTTP listener and main process check failed");
    }
    fail(result.message || "live probe failed");
  }

  // server / admin（未知角色也按 server 语义兜底）
  const result = await probe(PROBE_PATH || "/health/ready");
  if (result.kind === "http" && result.status === 200) ok("ready probe HTTP 200");
  if (result.kind === "http") fail(`ready probe HTTP ${result.status}`);
  fail(result.message || `ready probe failed (${result.kind})`);
}

main().catch((error) => fail(`unexpected ${String((error && error.name) || "error")}`));
