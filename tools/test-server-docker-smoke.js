const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "server");
const imageTag = `fosuclass-api-smoke:${process.pid}`;
const containerName = `fosuclass-api-smoke-${process.pid}`;
const envPath = path.join(SERVER_DIR, `.env.smoke.${process.pid}`);

function sanitize(text) {
  return String(text || "")
    .replace(/(AI_API_KEY|DEEPSEEK_API_KEY|COZE_API_KEY)=([^\s]*)/g, "$1=***")
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1***")
    .replace(/(token|password|secret|key)(["'=:\s]+)([^\s"',;]+)/gi, "$1$2***");
}

function runDocker(args, options = {}) {
  return spawnSync("docker", args, Object.assign({
    cwd: SERVER_DIR,
    encoding: "utf8",
  }, options));
}

function dockerAvailable() {
  const result = runDocker(["version", "--format", "{{.Server.Version}}"], { cwd: ROOT });
  return result.status === 0;
}

function findPort(start = 18319) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const server = net.createServer();
      server.once("error", () => tryPort(port + 1));
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    }
    try {
      tryPort(start);
    } catch (error) {
      reject(error);
    }
  });
}

function requestJson(port, method, pathname, payload, headers = {}) {
  const body = payload ? JSON.stringify(payload) : "";
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: Object.assign({
        "Content-Type": "application/json",
      }, body ? { "Content-Length": Buffer.byteLength(body) } : {}, headers),
      timeout: 5000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch (error) {
          parsed = data;
        }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForRun(port, accepted) {
  let last = null;
  for (let index = 0; index < 40; index += 1) {
    last = await requestJson(
      port,
      "GET",
      `/api/ai/agent/runs/${encodeURIComponent(accepted.runId)}?pollToken=${encodeURIComponent(accepted.pollToken)}`
    );
    if (last.statusCode === 200 && ["completed", "degraded", "failed", "cancelled"].includes(last.body && last.body.status)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`run polling timeout: ${sanitize(JSON.stringify(last && last.body))}`);
}

async function waitForHealth(port) {
  let lastError = null;
  for (let index = 0; index < 60; index += 1) {
    try {
      const response = await requestJson(port, "GET", "/api/health");
      if (response.statusCode >= 200 && response.statusCode < 300) return response;
      lastError = new Error(`health status ${response.statusCode}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw lastError || new Error("health check timeout");
}

function writeSmokeEnv(port) {
  const lines = [
    "NODE_ENV=production",
    "PORT=3000",
    "HOST_BIND_IP=127.0.0.1",
    `HOST_API_PORT=${port}`,
    "PUBLIC_API_ORIGIN=http://127.0.0.1",
    "FOSU_API_BASE_URL=http://127.0.0.1",
    "FOSU_STATIC_RELEASE_BASE_URL=/static/releases",
    "DATA_SOURCE_MODE=cache-first",
    "ADMIN_PASSWORD=smoke-admin-password",
    "ADMIN_API_TOKEN=smoke-admin-token",
    "ADMIN_TOKEN=smoke-admin-token",
    "FOSU_BASE_URL=https://100.fosu.edu.cn",
    "FOSU_AUTH_URL=https://authserver.fosu.edu.cn",
    "CORS_ALLOWED_ORIGINS=http://127.0.0.1",
    "FOSU_ALLOWED_ADMIN_ORIGINS=http://127.0.0.1",
    "FOSU_SECURITY_MODE=observe",
    "FOSU_DYNAMIC_API_SESSION_REQUIRED=false",
    "FOSU_STATIC_ACCESS_MODE=public",
    "FOSU_OPENRESTY_STATIC_SECURITY_MODE=public",
    "STATIC_RELEASE_SYNC_ENABLED=false",
    "FOSU_RELEASE_WORKER_ENABLED=false",
    "FOSU_MAINTENANCE_ENABLED=false",
    "AI_AGENT_ENABLED=false",
    "AI_PROVIDER=mock",
    "AI_PROVIDER_POLICY=auto",
    "AI_ALLOW_PERSONAL_CONTEXT=false",
  ];
  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

function printLogs() {
  const logs = runDocker(["logs", "--tail=200", containerName], { cwd: ROOT });
  const output = `${logs.stdout || ""}${logs.stderr || ""}`.trim();
  if (output) {
    console.log("----- sanitized docker logs -----");
    console.log(sanitize(output));
    console.log("----- end docker logs -----");
  }
}

async function run() {
  if (!dockerAvailable()) {
    const message = "Docker is not available for server smoke test.";
    if (process.env.CI) throw new Error(message);
    console.warn(`${message} Skipping outside CI.`);
    return;
  }

  const port = await findPort();
  writeSmokeEnv(port);
  try {
    // Dockerfile uses the repository root context for server paths.
    let result = runDocker(
      ["build", "-f", "server/Dockerfile", "-t", imageTag, "."],
      { cwd: ROOT }
    );
    if (result.status !== 0) {
      throw new Error(sanitize(`${result.stdout}\n${result.stderr}`));
    }

    result = runDocker([
      "run",
      "-d",
      "--name",
      containerName,
      "--env-file",
      envPath,
      "-e",
      "FOSU_ADMIN_NEXT_WRITE_MODULES=content,feedback,audit,backups",
      "-p",
      `127.0.0.1:${port}:3000`,
      imageTag,
    ]);
    if (result.status !== 0) {
      throw new Error(sanitize(`${result.stdout}\n${result.stderr}`));
    }

    await waitForHealth(port);
    result = runDocker(["exec", containerName, "sh", "-lc", "test ! -e /app/server/public/admin-app && test -f /app/server/src/app.js && test -f /app/packages/agent-runtime/index.js && test -f /app/plugins/fosu-campus/index.js && test -f /app/apps/agent-server/index.js && test -f /app/apps/agent-admin/index.js"], { cwd: ROOT });
    if (result.status !== 0) {
      throw new Error("Docker image platform layout is incomplete or contains retired admin-app assets");
    }

    const topology = await requestJson(port, "GET", "/api/admin/agent-platform/topology", null, {
      "x-admin-token": "smoke-admin-token",
    });
    if (topology.statusCode !== 200
      || !topology.body
      || topology.body.platform.runtimePackage !== "@xiaofu-agent/agent-runtime"
      || !topology.body.platform.pluginIds.includes("fosu-campus")) {
      throw new Error(`topology smoke failed: HTTP ${topology.statusCode} ${sanitize(JSON.stringify(topology.body))}`);
    }

    const accepted = await requestJson(port, "POST", "/api/ai/agent/runs", {
      message: "你是谁？",
      protocolVersion: "agent.v2",
      requestId: "docker-platform-smoke",
      context: { envVersion: "release", memoryMode: "local_only" },
    });
    if (accepted.statusCode !== 202 || !accepted.body || accepted.body.appService !== "@xiaofu-agent/agent-server") {
      throw new Error(`run create smoke failed: HTTP ${accepted.statusCode} ${sanitize(JSON.stringify(accepted.body))}`);
    }
    const runView = await waitForRun(port, accepted.body);
    const eventTypes = (runView.body.events || []).map((event) => event.type);
    if (!runView.body.result
      || !runView.body.result.platformTrace
      || runView.body.result.platformTrace.runtimePackage !== "@xiaofu-agent/agent-runtime"
      || !eventTypes.includes("runtime.entered")
      || !eventTypes.includes("runtime.completed")) {
      throw new Error(`run execution smoke failed: ${sanitize(JSON.stringify(runView.body))}`);
    }
    console.log(`test-server-docker-smoke passed on 127.0.0.1:${port}`);
  } finally {
    printLogs();
    runDocker(["rm", "-f", containerName], { cwd: ROOT });
    runDocker(["rmi", "-f", imageTag], { cwd: ROOT });
    try {
      fs.unlinkSync(envPath);
    } catch (error) {
      // best effort cleanup
    }
  }
}

run().catch((error) => {
  console.error(sanitize(error && error.stack || error));
  process.exit(1);
});
