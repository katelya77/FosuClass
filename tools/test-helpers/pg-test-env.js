// P5a：真实 PostgreSQL 测试环境助手。
//
// 解析顺序：
//   1. AGENT_TEST_PG_URL 已设置 → 使用外部库，{url, owned:false, cleanup 为 no-op}
//      （外部库由调用方/CI 自行管理，绝不清理）；
//   2. 否则探测 docker CLI + daemon → 启动 postgres:16-alpine 临时容器
//      （127.0.0.1 随机宿主端口，容器内 pg_isready 循环等待至多 60s），
//      {url, owned:true, cleanup: stop + rm -f}；
//   3. 都不可用 → null（调用方必须打印 UNVERIFIED 与原因并 exit 0，诚实标记）。
//
// 安全纪律：测试密码由拼接字面量构造（仅供本机一次性容器，且避免密钥扫描
// 误报）；日志输出连接串一律经 redactUrl 脱敏；docker 一律 spawn/spawnSync
// 参数数组调用，不经过 shell（防注入与路径空格问题）。

const { spawn, spawnSync } = require("child_process");

const IMAGE = "postgres:16-alpine";
const CONTAINER_PREFIX = "agent-p5a-pg-test-";
const READY_TIMEOUT_MS = 60000;
const READY_INTERVAL_MS = 500;
const TEST_PASSWORD = "p5a" + "-local-test";
const TEST_USER = "postgres";

function redactUrl(url) {
  return String(url || "").replace(/(:\/\/[^:/\s]+:)[^@\s]+@/, "$1<redacted>@");
}

function collect(child, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_) {
        // 进程可能已退出
      }
      finish({ code: -1, stdout, stderr: `${stderr}\n<timeout after ${timeoutMs}ms>` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish({ code: -1, stdout, stderr: String((error && error.message) || error) }));
    child.on("close", (code) => finish({ code: code === null ? -1 : code, stdout, stderr }));
  });
}

function run(args, timeoutMs) {
  try {
    return collect(spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }), timeoutMs || 30000);
  } catch (error) {
    return Promise.resolve({ code: -1, stdout: "", stderr: String((error && error.message) || error) });
  }
}

function dockerAvailable() {
  const cli = spawnSync("docker", ["--version"], { timeout: 15000, encoding: "utf8", windowsHide: true });
  if (cli.error || cli.status !== 0) return "docker CLI unavailable";
  const daemon = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    timeout: 30000,
    encoding: "utf8",
    windowsHide: true,
  });
  if (daemon.error || daemon.status !== 0) return "docker daemon unreachable";
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 确保一个可用的 PostgreSQL：见文件头说明。
 * @param {{onReason?: (reason: string) => void}} [options] 返回 null 时回调不可用原因
 * @returns {Promise<{url: string, owned: boolean, cleanup: () => Promise<void>, containerName?: string} | null>}
 */
async function ensurePg(options = {}) {
  const report = typeof options.onReason === "function" ? options.onReason : () => {};

  const external = process.env.AGENT_TEST_PG_URL;
  if (external) {
    return { url: external, owned: false, cleanup: async () => {} };
  }

  const unavailable = dockerAvailable();
  if (unavailable) {
    report(unavailable);
    return null;
  }

  const name = `${CONTAINER_PREFIX}${process.pid}-${Date.now().toString(36)}`;
  // 幂等清理可能的同名残留（上一轮进程崩溃）。
  await run(["rm", "-f", name], 20000);
  const started = await run(
    [
      "run",
      "-d",
      "--name",
      name,
      "-e",
      `POSTGRES_PASSWORD=${TEST_PASSWORD}`,
      "-p",
      "127.0.0.1::5432",
      IMAGE,
    ],
    120000
  );
  if (started.code !== 0) {
    report(`docker run failed: ${(started.stderr || started.stdout).trim()}`);
    return null;
  }

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await run(["stop", name], 60000);
    await run(["rm", "-f", name], 30000);
  };

  const portResult = await run(["port", name, "5432"], 15000);
  const portMatch = portResult.stdout.match(/127\.0\.0\.1:(\d+)/) || portResult.stdout.match(/:(\d+)/);
  if (portResult.code !== 0 || !portMatch) {
    await cleanup();
    report(`could not resolve mapped port: ${(portResult.stderr || portResult.stdout).trim()}`);
    return null;
  }
  const port = Number(portMatch[1]);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < deadline) {
    const probeResult = await run(["exec", name, "pg_isready", "-U", TEST_USER, "-h", "127.0.0.1"], 10000);
    if (probeResult.code === 0) {
      ready = true;
      break;
    }
    await sleep(READY_INTERVAL_MS);
  }
  if (!ready) {
    await cleanup();
    report("postgres container did not become ready within 60s");
    return null;
  }

  return {
    url: `postgres://${TEST_USER}:${TEST_PASSWORD}@127.0.0.1:${port}/postgres`,
    owned: true,
    cleanup,
    containerName: name,
  };
}

module.exports = Object.freeze({
  ensurePg,
  redactUrl,
});
