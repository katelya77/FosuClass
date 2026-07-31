#!/usr/bin/env node
// P5a WS1：pg 客户端地基的验证。
// 「无配置 → PG_CONFIG_REQUIRED」「不可达 → PG_UNAVAILABLE 且脱敏」不需要数据库；
// 真实库段（probe / withTransaction / withAdvisoryLock）走 test-helpers/pg-test-env，
// 不可用时该段标记 UNVERIFIED 并 exit 0。

const assert = require("node:assert");
const net = require("node:net");
const { ensurePg, redactUrl } = require("./test-helpers/pg-test-env");
const {
  closePool,
  createPgPool,
  probe,
  query,
  withAdvisoryLock,
  withTransaction,
} = require("../packages/agent-runtime");

const ENV_KEYS = [
  "AGENT_PG_URL",
  "AGENT_PG_HOST",
  "AGENT_PG_PORT",
  "AGENT_PG_USER",
  "AGENT_PG_PASSWORD",
  "AGENT_PG_DATABASE",
  "AGENT_PG_SSL",
];

// 拿到一个刚关闭、确定无人监听的本地端口（连接必然 ECONNREFUSED）。
function closedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function testConfigRequired() {
  const saved = {};
  ENV_KEYS.forEach((key) => {
    saved[key] = process.env[key];
    delete process.env[key];
  });
  try {
    assert.throws(() => createPgPool(), (e) => e.code === "PG_CONFIG_REQUIRED");
    assert.throws(() => createPgPool({}), (e) => e.code === "PG_CONFIG_REQUIRED");
  } finally {
    ENV_KEYS.forEach((key) => {
      if (saved[key] !== undefined) process.env[key] = saved[key];
    });
  }
  console.log("✓ no configuration -> PG_CONFIG_REQUIRED");
}

async function testUnavailable() {
  const probePassword = "pg-client" + "-probe-secret"; // 拼接构造，避免密钥扫描误报
  const port = await closedPort();
  const pool = createPgPool({
    host: "127.0.0.1",
    port,
    user: "probe",
    password: probePassword,
    database: "probe",
    connectionTimeoutMillis: 500,
    max: 1,
  });
  let captured = null;
  await assert.rejects(query(pool, "SELECT 1"), (e) => {
    captured = e;
    return e.code === "PG_UNAVAILABLE";
  });
  assert.ok(!String(captured.message).includes(probePassword), "error message must not contain the password");
  await closePool(pool);
  console.log("✓ unreachable port -> PG_UNAVAILABLE (password never leaks into the error)");
}

async function testRealDatabase(env) {
  const pool = createPgPool({ connectionString: env.url, max: 4 });
  try {
    const health = await probe(pool);
    assert.strictEqual(health.ok, true);
    assert.ok(Number.isFinite(health.latencyMs) && health.latencyMs >= 0, "latencyMs reported");
    assert.ok(typeof health.serverVersion === "string" && health.serverVersion.length > 0, "serverVersion reported");

    const downPool = createPgPool({
      host: "127.0.0.1",
      port: await closedPort(),
      user: "probe",
      password: "probe",
      database: "probe",
      connectionTimeoutMillis: 500,
      max: 1,
    });
    const down = await probe(downPool);
    assert.strictEqual(down.ok, false);
    assert.strictEqual(down.code, "PG_UNAVAILABLE");
    await closePool(downPool);

    // withTransaction 提交路径
    await withTransaction(pool, async (client) => {
      await client.query("CREATE TABLE tx_commit_probe (id integer PRIMARY KEY)");
      await client.query("INSERT INTO tx_commit_probe (id) VALUES (1)");
    });
    const committed = await query(pool, "SELECT COUNT(*)::int AS n FROM tx_commit_probe");
    assert.strictEqual(committed.rows[0].n, 1, "committed work persists");

    // withTransaction 回滚路径：fn 抛错 → 原样 rethrow，表不留半态
    const marker = new Error("intentional rollback probe");
    await assert.rejects(
      withTransaction(pool, async (client) => {
        await client.query("CREATE TABLE tx_rollback_probe (id integer PRIMARY KEY)");
        throw marker;
      }),
      (e) => e === marker
    );
    const rolledBack = await query(pool, "SELECT to_regclass('tx_rollback_probe') AS reg");
    assert.strictEqual(rolledBack.rows[0].reg, null, "rolled-back table must not exist");

    // advisory lock 互斥：同 lockId 的临界区不得交错
    const events = [];
    const critical = async (tag) => {
      events.push(`${tag}:enter`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      events.push(`${tag}:exit`);
    };
    await Promise.all([
      withAdvisoryLock(pool, 991001, () => critical("a")),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 50)); // 让 a 先到达锁
        await withAdvisoryLock(pool, 991001, () => critical("b"));
      })(),
    ]);
    assert.strictEqual(events.length, 4);
    assert.strictEqual(events[1], events[0].replace("enter", "exit"), "critical sections must not interleave");
    assert.strictEqual(events[3], events[2].replace("enter", "exit"), "critical sections must not interleave");

    // lockId 非法 → 定义期 coded error
    await assert.rejects(withAdvisoryLock(pool, 1.5, async () => {}), (e) => e.code === "PG_LOCK_ID_INVALID");
  } finally {
    await closePool(pool);
  }
  console.log("✓ real database: probe ok/down, transaction commit/rollback, advisory lock mutual exclusion");
}

(async () => {
  testConfigRequired();
  await testUnavailable();

  let reason = "no PostgreSQL available";
  const env = await ensurePg({ onReason: (text) => {
    reason = text;
  } });
  if (!env) {
    console.log(`\ntest-agent-pg-client: UNVERIFIED real-database section (${reason})`);
    process.exit(0);
  }
  console.log(`pg-test-env: ${env.owned ? `docker container ${env.containerName}` : "external AGENT_TEST_PG_URL"} (${redactUrl(env.url)})`);
  try {
    await testRealDatabase(env);
  } finally {
    await env.cleanup();
  }
  console.log("\ntest-agent-pg-client: PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
