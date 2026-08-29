const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.resolve(ROOT, "..", "..", "mock-data", "competition-demo-v1.json");

async function reservePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startServer(t, extraEnv) {
  const port = await reservePort();
  const child = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      CAMPUS_DATA_PATH: DATA_PATH,
      LOG_LEVEL: "error",
    }, extraEnv),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  t.after(() => {
    if (!child.killed) child.kill();
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode != null) throw new Error(`服务启动失败：${stderr}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return { base, child };
    } catch {
      // 启动窗口内预期连接失败，继续短轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`服务启动超时：${stderr}`);
}

function scheduleRequest(base, headers) {
  return fetch(`${base}/api/query_schedule`, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: JSON.stringify({ entityType: "teacher", entityName: "教师003", week: 1, weekday: 1 }),
  });
}

test("token 鉴权、统一未授权错误与 IP 限流", async (t) => {
  const token = "unit-test-token";
  const { base } = await startServer(t, {
    CAMPUS_API_AUTH_MODE: "token",
    CAMPUS_API_TOKEN: token,
    CAMPUS_API_SIGNING_SECRET: "",
    RATE_LIMIT_BURST: "1",
    RATE_LIMIT_RPM: "0",
  });

  const denied = await scheduleRequest(base);
  assert.equal(denied.status, 401);
  const deniedBody = await denied.json();
  assert.equal(deniedBody.success, false);
  assert.equal(deniedBody.error.code, "UNAUTHORIZED");

  const allowed = await scheduleRequest(base, { Authorization: `Bearer ${token}` });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).success, true);

  const limited = await scheduleRequest(base, { Authorization: `Bearer ${token}` });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "RATE_LIMITED");
});

test("HMAC 鉴权接受有效签名并拒绝过期签名", async (t) => {
  const secret = "unit-test-signing-secret";
  const { base } = await startServer(t, {
    CAMPUS_API_AUTH_MODE: "hmac",
    CAMPUS_API_TOKEN: "",
    CAMPUS_API_SIGNING_SECRET: secret,
  });
  const pathname = "/api/query_schedule";
  const timestamp = String(Date.now());
  const signature = crypto.createHmac("sha256", secret)
    .update(`${timestamp}\nPOST\n${pathname}`)
    .digest("hex");
  const accepted = await scheduleRequest(base, {
    "X-Campus-Timestamp": timestamp,
    "X-Campus-Signature": signature,
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).success, true);

  const expiredTimestamp = String(Date.now() - 10 * 60 * 1000);
  const expiredSignature = crypto.createHmac("sha256", secret)
    .update(`${expiredTimestamp}\nPOST\n${pathname}`)
    .digest("hex");
  const expired = await scheduleRequest(base, {
    "X-Campus-Timestamp": expiredTimestamp,
    "X-Campus-Signature": expiredSignature,
  });
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).error.code, "UNAUTHORIZED");
});

test("默认数据路径仍被 competition-demo 守卫接受", () => {
  const script = `delete process.env.CAMPUS_DATA_PATH; const d=require(${JSON.stringify(path.join(ROOT, "src", "data.js"))}).loadDataset(); if(d.dataVersion!=="competition-demo-v1") process.exit(9);`;
  const result = require("child_process").spawnSync(process.execPath, ["-e", script], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { CAMPUS_DATA_PATH: "" }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});
