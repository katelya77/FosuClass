#!/usr/bin/env node
// P4a：Config Kernel Repository 契约测试（conformance suite）。
// 通用契约由 packages/agent-runtime 的 runConfigKernelRepositoryConformance
// 提供，P5a WS2 起对 file 与 postgresql 两种适配器各跑一遍（runner/用例均
// 为 async，文件适配器的同步返回被 await 透明容忍）。
// 文件适配器专项：digest 校验对存储篡改 fail closed。
// PG 适配器专项：并发写经 advisory lock 串行无撕裂、digest 篡改 fail closed、
// 并发 putVersion 只有一个成功（VERSION_EXISTS）。
// PG 不可用（无 AGENT_TEST_PG_URL 且无 docker）→ postgresql 段打印 UNVERIFIED
// 并 exit 0（file 段结果不受影响），诚实标记不伪造验证。
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createConfigKernelFileRepository,
  createConfigKernelPgRepository,
  createMigrationRunner,
  createPgPool,
  closePool,
  query,
  runConfigKernelRepositoryConformance,
  sha256Digest,
} = require("../packages/agent-runtime");
const { CONFIG_KERNEL_MIGRATIONS } = require("../server/src/services/ai/persistence/migrations/0002ConfigKernel");
const { ensurePg, redactUrl } = require("./test-helpers/pg-test-env");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "config-kernel-repo-"));
}

async function throwsCode(fn, code) {
  await assert.rejects(async () => {
    await fn();
  }, (error) => error && error.code === code);
}

async function runFileSection() {
  const executed = await runConfigKernelRepositoryConformance({
    assert,
    label: "file",
    createRepository: () => createConfigKernelFileRepository({ root: tmpRoot() }),
    sha256Digest,
  });
  executed.forEach((name) => console.log(`✓ ${name}`));

  // 文件适配器专项：篡改版本文档内容后 digest 校验必须 fail closed。
  const root = tmpRoot();
  const repo = createConfigKernelFileRepository({ root });
  const content = {
    schemaVersion: "config-artifact.v1",
    domain: "skill",
    artifactId: "conformance",
    environment: "trial",
    version: 1,
    payload: { skills: [{ id: "alpha" }] },
    origin: "admin",
    sourceDigest: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "conformance",
  };
  const doc = Object.assign({}, content, { digest: sha256Digest(content) });
  await repo.putVersion(doc);
  const file = path.join(root, "artifacts", "skill", "conformance", "trial", "v1.json");
  fs.writeFileSync(file, JSON.stringify(Object.assign({}, doc, { payload: { skills: [{ id: "tampered" }] } })));
  await throwsCode(() => repo.getVersion("skill", "conformance", "trial", 1), "CONFIG_KERNEL_STORAGE_CORRUPT");

  // current 引用不是合法 JSON：读取方必须得到 coded corruption，而非静默空配置。
  fs.mkdirSync(path.join(root, "current"), { recursive: true });
  fs.writeFileSync(path.join(root, "current", "trial.json"), "{{{", "utf8");
  await throwsCode(() => repo.readCurrentRef("trial"), "CONFIG_KERNEL_STORAGE_CORRUPT");
  console.log("✓ file: tampered documents fail closed on digest/parse verification");
}

// 每个契约用例需要全新空存储：PG 侧以为每个 repository 实例建独立数据库
// （并对该库应用 0002 migration）实现同等隔离；跟踪创建物以便统一清理。
async function runPostgresqlSection(env) {
  const adminPool = createPgPool({ connectionString: env.url, max: 2 });
  const created = [];
  async function createRepository() {
    const dbName = `ck_conf_${crypto.randomBytes(5).toString("hex")}`;
    await query(adminPool, `CREATE DATABASE ${dbName}`);
    const url = new URL(env.url);
    url.pathname = `/${dbName}`;
    const pool = createPgPool({ connectionString: url.toString(), max: 4 });
    const runner = createMigrationRunner({ pool, migrations: CONFIG_KERNEL_MIGRATIONS.slice() });
    await runner.migrate();
    created.push({ dbName, pool });
    return createConfigKernelPgRepository({ pool });
  }
  try {
    const executed = await runConfigKernelRepositoryConformance({
      assert,
      label: "postgresql",
      createRepository,
      sha256Digest,
    });
    executed.forEach((name) => console.log(`✓ ${name}`));

    // PG 专项 1：并发写经 advisory lock 串行——同一存储上的两个 repo 实例对
    // 同一环境并发 writePointers（各自 20 次、内容与 seq 互不重叠），全部完成
    // 后读回的文档必须逐字等于某一次完整写入（seq 与 artifacts 永不撕裂混搭），
    // 且两个实例读到的最终状态一致。
    const shared = created[created.length - 1];
    {
      const sharedA = createConfigKernelPgRepository({ pool: shared.pool });
      const sharedB = createConfigKernelPgRepository({ pool: shared.pool });
      const writes = [];
      const candidates = [];
      for (let i = 0; i < 20; i += 1) {
        const docA = { environment: "trial", seq: i + 1, artifacts: { [`a:${i}`]: i + 1 }, updatedAt: `a-${i}` };
        const docB = { environment: "trial", seq: 1000 + i + 1, artifacts: { [`b:${i}`]: i + 1 }, updatedAt: `b-${i}` };
        candidates.push(docA, docB);
        writes.push(sharedA.writePointers(docA), sharedB.writePointers(docB));
      }
      await Promise.all(writes);
      const finalA = await sharedA.readPointers("trial");
      const finalB = await sharedB.readPointers("trial");
      assert.deepStrictEqual(finalA, finalB, "both instances observe the same final pointers");
      const winner = candidates.find((doc) => doc.seq === finalA.seq);
      assert.ok(winner, "final seq must come from one complete write");
      assert.deepStrictEqual(finalA, winner, "stored document is never a torn mix of concurrent writes");
      console.log("✓ postgresql: concurrent writePointers serialize via advisory lock (no torn documents)");
    }

    // PG 专项 2：并发 putVersion 同一版本——跨实例只有一个成功，其余
    // CONFIG_KERNEL_VERSION_EXISTS（DB 级互斥等效文件实现的不可变语义）。
    {
      const instanceA = createConfigKernelPgRepository({ pool: shared.pool });
      const instanceB = createConfigKernelPgRepository({ pool: shared.pool });
      const content = {
        schemaVersion: "config-artifact.v1",
        domain: "skill",
        artifactId: "concurrency",
        environment: "trial",
        version: 1,
        payload: { skills: [{ id: "alpha" }] },
        origin: "admin",
        sourceDigest: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "conformance",
      };
      const doc = Object.assign({}, content, { digest: sha256Digest(content) });
      const outcomes = await Promise.all([
        instanceA.putVersion(doc).then(() => "ok", (error) => error && error.code),
        instanceB.putVersion(doc).then(() => "ok", (error) => error && error.code),
      ]);
      assert.deepStrictEqual(outcomes.sort(), ["CONFIG_KERNEL_VERSION_EXISTS", "ok"], "exactly one concurrent putVersion wins");
      assert.deepStrictEqual(await instanceA.listVersions("skill", "concurrency", "trial"), [1]);
      console.log("✓ postgresql: concurrent putVersion yields exactly one success (VERSION_EXISTS)");
    }

    // PG 专项 3：digest 篡改 fail closed——digest 列与 doc 内部 digest 双校验。
    // 分两步隔离变量：篡改 jsonb payload（内部 digest 失配）与仅篡改 digest 列
    // （doc 内部自洽但列不一致）都必须 CONFIG_KERNEL_STORAGE_CORRUPT。
    {
      const repo = createConfigKernelPgRepository({ pool: shared.pool });
      const originalDoc = JSON.parse(JSON.stringify(await repo.getVersion("skill", "concurrency", "trial", 1)));
      const where = "WHERE environment = 'trial' AND domain = 'skill' AND artifact_id = 'concurrency' AND version = 1";
      const tamperedDoc = JSON.parse(JSON.stringify(originalDoc));
      tamperedDoc.payload = { skills: [{ id: "tampered" }] };
      await query(shared.pool, `UPDATE config_versions SET doc = $1 ${where}`, [JSON.stringify(tamperedDoc)]);
      await throwsCode(() => repo.getVersion("skill", "concurrency", "trial", 1), "CONFIG_KERNEL_STORAGE_CORRUPT");
      await query(shared.pool, `UPDATE config_versions SET doc = $1, digest = $2 ${where}`, [JSON.stringify(originalDoc), sha256Digest({ bogus: true })]);
      await throwsCode(() => repo.getVersion("skill", "concurrency", "trial", 1), "CONFIG_KERNEL_STORAGE_CORRUPT");
      console.log("✓ postgresql: tampered digest column or jsonb doc fails closed (STORAGE_CORRUPT)");
    }
  } finally {
    for (const entry of created) {
      await closePool(entry.pool);
      await query(adminPool, `DROP DATABASE IF EXISTS ${entry.dbName} WITH (FORCE)`);
    }
    await closePool(adminPool);
  }
}

(async () => {
  await runFileSection();

  let reason = "no PostgreSQL available";
  const env = await ensurePg({ onReason: (text) => {
    reason = text;
  } });
  if (!env) {
    console.log(`\npostgresql section: UNVERIFIED (${reason})`);
    console.log("\ntest-config-kernel-repository-conformance: PASS (file verified; postgresql UNVERIFIED)");
    process.exit(0);
  }
  console.log(`pg-test-env: ${env.owned ? `docker container ${env.containerName}` : "external AGENT_TEST_PG_URL"} (${redactUrl(env.url)})`);
  try {
    await runPostgresqlSection(env);
  } finally {
    await env.cleanup();
  }
  console.log("\ntest-config-kernel-repository-conformance: PASS");
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
