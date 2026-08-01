#!/usr/bin/env node
// P5a WS2：Config Kernel Repository 后端选择专项（FOSU_AGENT_REPOSITORY_BACKEND）。
//   - 默认 file：require 同步建内核，platformReady() 仅跑幂等种子，
//     getCurrentSnapshot 可读（行为与 P5a 前 require 期种子一致）；
//   - postgres：init 先 runMigrations（含 0002 config_kernel_stores）再全环境种子，
//     getCurrentSnapshot 可读；迁移状态含 version 2；
//   - PG 连接失败：platformReady() 以 coded AGENT_PLATFORM_INIT_FAILED 拒绝
//     （causeCode 保留底层 PG_UNAVAILABLE）；同进程 file 模式不受影响；
//   - file 模式即使 AGENT_PG_URL 指向坏地址也完全不触 PG。
// 每个场景跑在独立子进程（platformComposition 是进程级单例）。
// PG 不可用（无 AGENT_TEST_PG_URL 且无 docker）→ postgres 场景 UNVERIFIED 并 exit 0。
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const MODE = process.env.CONFIG_KERNEL_BACKEND_MODE || "parent";

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cfg-backend-${label}-`));
}

// ---------- 子进程场景 ----------
async function childFileDefault() {
  process.env.FOSU_AGENT_CONFIG_KERNEL_PATH = tmpRoot("file");
  delete process.env.FOSU_AGENT_REPOSITORY_BACKEND;
  const composition = require("../server/src/services/ai/platformComposition");
  const ready = await composition.platformReady();
  assert.strictEqual(ready.backend, "file", "default backend is file");
  const snapshot = await composition.getConfigKernel().getCurrentSnapshot("public");
  assert.ok(snapshot && /^cfg-public-\d{4,}-[0-9a-f]{12}$/.test(snapshot.configVersion), "file init seeds the public environment");
  console.log("✓ file default: init seeds all environments; snapshot readable (child)");
}

async function childPostgres() {
  process.env.FOSU_AGENT_CONFIG_KERNEL_PATH = tmpRoot("pg");
  process.env.FOSU_AGENT_REPOSITORY_BACKEND = "postgres";
  process.env.AGENT_PG_URL = process.env.BACKEND_TEST_PG_URL;
  const composition = require("../server/src/services/ai/platformComposition");
  const ready = await composition.platformReady();
  assert.strictEqual(ready.backend, "postgres", "postgres backend selected");
  const snapshot = await composition.getConfigKernel().getCurrentSnapshot("public");
  assert.ok(snapshot && /^cfg-public-\d{4,}-[0-9a-f]{12}$/.test(snapshot.configVersion), "postgres init migrates then seeds");
  const status = await require("../server/src/services/ai/persistence/pgPersistenceService").getMigrationStatus();
  const applied = status.applied.map((row) => row.version);
  assert.ok(applied.includes(2), `migration 0002 applied (got [${applied.join(", ")}])`);
  assert.strictEqual(status.pending.length, 0, "no pending migrations after init");
  console.log(`✓ postgres: init ran migrations [${applied.join(", ")}] + seed; snapshot readable (child)`);
}

async function childPostgresDown() {
  process.env.FOSU_AGENT_CONFIG_KERNEL_PATH = tmpRoot("pgdown");
  process.env.FOSU_AGENT_REPOSITORY_BACKEND = "postgres";
  process.env.AGENT_PG_URL = process.env.BACKEND_TEST_PG_URL; // 指向已关闭端口
  const composition = require("../server/src/services/ai/platformComposition");
  let rejected = null;
  try {
    await composition.platformReady();
  } catch (error) {
    rejected = error;
  }
  assert.ok(rejected, "platformReady must reject when PG is unreachable");
  assert.strictEqual(rejected.code, "AGENT_PLATFORM_INIT_FAILED", `init failure is coded (got ${rejected.code})`);
  assert.strictEqual(rejected.causeCode, "PG_UNAVAILABLE", `underlying cause preserved (got ${rejected.causeCode})`);
  assert.ok(!String(rejected.message).includes("password"), "error message carries no credentials");
  console.log("✓ postgres down: platformReady rejects with coded AGENT_PLATFORM_INIT_FAILED (child)");
}

async function childFileWithBadPgUrl() {
  process.env.FOSU_AGENT_CONFIG_KERNEL_PATH = tmpRoot("filebad");
  delete process.env.FOSU_AGENT_REPOSITORY_BACKEND;
  process.env.AGENT_PG_URL = process.env.BACKEND_TEST_PG_URL; // 坏地址：file 模式永不解析它
  const composition = require("../server/src/services/ai/platformComposition");
  const ready = await composition.platformReady();
  assert.strictEqual(ready.backend, "file");
  const snapshot = await composition.getConfigKernel().getCurrentSnapshot("public");
  assert.ok(snapshot && snapshot.configVersion.startsWith("cfg-public-"), "file mode works regardless of PG reachability");
  console.log("✓ file mode never touches PG even with AGENT_PG_URL set (child)");
}

const CHILDREN = {
  "file-default": childFileDefault,
  postgres: childPostgres,
  "postgres-down": childPostgresDown,
  "file-bad-pg": childFileWithBadPgUrl,
};

// ---------- 父进程 ----------
function runChild(mode, extraEnv = {}) {
  const child = spawnSync(process.execPath, [__filename], {
    env: Object.assign({}, process.env, extraEnv, { CONFIG_KERNEL_BACKEND_MODE: mode }),
    encoding: "utf8",
    timeout: 120000,
  });
  assert.strictEqual(
    child.status,
    0,
    `child ${mode} failed: status=${child.status} signal=${child.signal} error=${child.error ? child.error.message : "none"}\nstdout:\n${child.stdout || "(empty)"}\nstderr:\n${child.stderr || "(empty)"}`
  );
  String(child.stdout || "").split("\n").filter(Boolean).forEach((line) => console.log(`  [${mode}] ${line}`));
}

(async () => {
  if (MODE !== "parent") {
    await CHILDREN[MODE]();
    // 子进程退出前显式关闭共享 PG 池：池内空闲连接会吊住事件循环使进程不退，
    // spawnSync 120s 超时强杀会让父进程拿到非零 status 且管道输出丢失。
    await require("../server/src/services/ai/persistence/pgPersistenceService").closeForTests().catch(() => {});
    return;
  }

  // file 场景不依赖 PG，任何环境下都执行。
  runChild("file-default");
  runChild("file-bad-pg", { BACKEND_TEST_PG_URL: "postgres://postgres:bad@127.0.0.1:1/postgres" });

  const { ensurePg, redactUrl } = require("./test-helpers/pg-test-env");
  const { closePool, createPgPool, query } = require("../packages/agent-runtime");
  let reason = "no PostgreSQL available";
  // P5a WS5：聚合 migration 含 0005（CREATE EXTENSION vector）→ 基线镜像 pgvector/pgvector:pg16。
  const env = await ensurePg({ image: "pgvector/pgvector:pg16", onReason: (text) => {
    reason = text;
  } });
  if (!env) {
    console.log(`\npostgres scenarios: UNVERIFIED (${reason})`);
    console.log("\ntest-agent-config-kernel-backend: PASS (file verified; postgres UNVERIFIED)");
    process.exit(0);
  }
  console.log(`pg-test-env: ${env.owned ? `docker container ${env.containerName}` : "external AGENT_TEST_PG_URL"} (${redactUrl(env.url)})`);
  const adminPool = createPgPool({ connectionString: env.url, max: 2 });
  const dbName = `ck_backend_${crypto.randomBytes(5).toString("hex")}`;
  try {
    await query(adminPool, `CREATE DATABASE ${dbName}`);
    const url = new URL(env.url);
    url.pathname = `/${dbName}`;
    runChild("postgres", { BACKEND_TEST_PG_URL: url.toString() });
  } finally {
    await query(adminPool, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await closePool(adminPool);
    await env.cleanup();
  }
  // 连接失败场景：容器/外部库在，但指向已关闭端口（1 端口立即 ECONNREFUSED）。
  runChild("postgres-down", { BACKEND_TEST_PG_URL: "postgres://postgres:bad@127.0.0.1:1/postgres" });

  console.log("\ntest-agent-config-kernel-backend: PASS");
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
