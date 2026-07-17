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

function requestJson(port, method, pathname, payload) {
  const body = payload ? JSON.stringify(payload) : "";
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: Object.assign({
        "Content-Type": "application/json",
      }, body ? { "Content-Length": Buffer.byteLength(body) } : {}),
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
    // Multi-stage Dockerfile expects monorepo root context (admin-web + server).
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
      "-e",
      "FOSU_ADMIN_PRIMARY=legacy",
      "-e",
      "FOSU_ADMIN_NEXT_ENABLED=true",
      "-p",
      `127.0.0.1:${port}:3000`,
      imageTag,
    ]);
    if (result.status !== 0) {
      throw new Error(sanitize(`${result.stdout}\n${result.stderr}`));
    }

    await waitForHealth(port);
    const chat = await requestJson(port, "POST", "/api/ai/agent/chat", {
      message: "你能做什么",
      context: { clientLocalTime: "2026-06-08T22:00:00+08:00" },
    });
    if (chat.statusCode !== 200 || !chat.body || chat.body.success !== true) {
      throw new Error(`chat smoke failed: HTTP ${chat.statusCode} ${sanitize(JSON.stringify(chat.body))}`);
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
