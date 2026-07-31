#!/usr/bin/env node
// P5a WS5：RAG 索引产物 PG 存储 parity + pgvector 专项（migration 0005）。
//
// 覆盖：
//   - migration：vector 扩展存在、三张 RAG 表存在；
//   - file/PG 双后端同一发布物构建：digest 字节级一致（buildIndex 确定性）、
//     查询结果等价（hits/servedVersion/indexSource）；
//   - 损坏 fail closed 双后端一致：版本索引被篡改 → lkg 不服务同版本 →
//     扫描兜底服务更旧已验证版本；re-pin 后自愈重建（rollback 语义保持）；
//   - standalone 重启可读：全新服务实例（空队列 root、无索引文件）直接从 PG
//     读出索引并可查询——不依赖容器文件系统；
//   - pgvector：分块向量列落 PG（计数与索引 chunks 一致、重建幂等无重复），
//     最近邻查询经 rag-runtime 统一接口（createPgVectorSearch）返回确定结果，
//     且与内存版 vector 通道排序一致（同一确定性 encoder，ADR-0007）。
//
// 环境：AGENT_TEST_PG_URL 优先，否则 docker 临时容器（pgvector/pgvector:pg16——
// pgvector 基线镜像）；不可用 → 打印 UNVERIFIED 与原因并 exit 0。

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ensurePg, redactUrl } = require("./test-helpers/pg-test-env");
const { closePool, createPgPool, query } = require("../packages/agent-runtime");
const rag = require("../packages/rag-runtime");
const { createRagIndexService } = require("../server/src/services/ai/ragIndexService");

const DOC_SET = [
  { docId: "password-reset", title: "Password reset", kind: "note", text: "To reset your password, open account settings and choose security. A reset link is sent to your verified email address." },
  { docId: "notification-prefs", title: "Notification preferences", kind: "note", text: "Notification preferences control which alerts you receive. You can mute channels, set quiet hours, or disable email digests." },
  { docId: "data-export", title: "Data export", kind: "note", text: "You can export your data from the privacy dashboard. Exports are prepared asynchronously and remain downloadable for seven days." },
  { docId: "theme-settings", title: "Theme settings", kind: "note", text: "Theme settings switch between light, dark, and system appearance. The choice is stored per device." },
];

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `p5a-rag-pg-${label}-`));
}

function artifacts() {
  return {
    1: { documents: DOC_SET.slice(0, 2), retrieval: { topK: 3, minScore: 0.05 } },
    2: { documents: DOC_SET, retrieval: { topK: 3, minScore: 0.05 } },
    3: null, // v3 构建必失败（resolveArtifact 取不到发布物）
  };
}

async function buildVersion(service, version) {
  await service.requestBuild({ environment: "trial", artifactId: "a", kbId: "kb", version });
  assert.strictEqual(await service.drainQueueForTest(), true, `v${version} queue drains`);
}

async function testMigrationShape(pool) {
  const ext = await query(pool, "SELECT extname FROM pg_extension WHERE extname = 'vector'");
  assert.strictEqual(ext.rows.length, 1, "pgvector extension must exist (migration 0005)");
  for (const table of ["agent_rag_index_versions", "agent_rag_index_lkg", "agent_rag_chunk_vectors"]) {
    const reg = await query(pool, "SELECT to_regclass($1) AS reg", [table]);
    assert.ok(reg.rows[0].reg, `${table} must exist`);
  }
  const column = await query(
    pool,
    "SELECT udt_name FROM information_schema.columns WHERE table_name = 'agent_rag_chunk_vectors' AND column_name = 'embedding'"
  );
  assert.strictEqual(column.rows[0].udt_name, "vector", "embedding column is the pgvector type");
  console.log("✓ migration 0005: vector extension + 三张 RAG 表 + vector 列类型");
}

async function testParityAndFailClosed(pgPersistenceService) {
  const fileRoot = tmpRoot("file");
  const pgRoot = tmpRoot("pg");
  const shared = artifacts();
  const fileService = createRagIndexService({
    root: fileRoot,
    backend: "file",
    indexMemoTtlMs: 0,
    failedRetryCooldownMs: 0,
    resolveArtifact: ({ version }) => shared[version],
  });
  const pgService = createRagIndexService({
    root: pgRoot,
    backend: "postgres",
    indexMemoTtlMs: 0,
    failedRetryCooldownMs: 0,
    resolveArtifact: ({ version }) => shared[version],
  });
  assert.strictEqual(pgService.backend, "postgres", "pg backend selected");

  await buildVersion(fileService, 1);
  await buildVersion(pgService, 1);
  await buildVersion(fileService, 2);
  await buildVersion(pgService, 2);

  // digest 字节级一致（同一发布物 + 确定性构建 → 双后端产物等价）
  const fileV2 = await fileService.loadIndex({ environment: "trial", kbId: "kb", version: 2 });
  const pgV2 = await pgService.loadIndex({ environment: "trial", kbId: "kb", version: 2 });
  assert.strictEqual(pgV2.index.digest, fileV2.index.digest, "PG index is byte-identical to the file index");
  assert.strictEqual(pgV2.index.chunks.length, fileV2.index.chunks.length);

  // 查询等价（四模式逐一对比 hits 序列与服务元数据）
  for (const mode of ["lexical", "vector", "hybrid", "hybrid_rerank"]) {
    const input = { environment: "trial", kbId: "kb", version: 2, query: "how do I reset my password", mode, topK: 2 };
    const fromFile = await fileService.query(input);
    const fromPg = await pgService.query(input);
    assert.deepStrictEqual(
      fromPg.hits.map((hit) => [hit.chunkId, hit.score]),
      fromFile.hits.map((hit) => [hit.chunkId, hit.score]),
      `${mode}: PG backend serves identical hits`
    );
    assert.strictEqual(fromPg.servedVersion, fromFile.servedVersion);
    assert.strictEqual(fromPg.indexSource, fromFile.indexSource);
  }

  // v3 构建失败 → 查询钉住 v3 回退 lkg（双后端一致）
  await buildVersion(fileService, 3);
  await buildVersion(pgService, 3);
  const fileV3 = await fileService.query({ environment: "trial", kbId: "kb", version: 3, query: "password reset" });
  const pgV3 = await pgService.query({ environment: "trial", kbId: "kb", version: 3, query: "password reset" });
  assert.strictEqual(pgV3.indexSource, "lkg");
  assert.strictEqual(pgV3.servedVersion, fileV3.servedVersion, "lkg fallback parity");

  // 损坏 fail closed：v2 被篡改（file 写字节 / PG 改 doc）→ 双后端都不得
  // 服务损坏内容；lkg(v2) 同版本不可服务 → 扫描兜底服务 v1。
  const v2File = path.join(fileRoot, "rag-indexes", "trial", "kb", "v2.json");
  fs.writeFileSync(v2File, '{"format":"rag-index.v1","digest":"tampered"}');
  await query(
    pgPersistenceService.getPool(),
    "UPDATE agent_rag_index_versions SET doc = '{\"format\":\"rag-index.v1\",\"digest\":\"tampered\"}' WHERE environment = 'trial' AND kb_id = 'kb' AND version = 2"
  );
  const fileCorrupt = await fileService.query({ environment: "trial", kbId: "kb", version: 2, query: "password reset" });
  const pgCorrupt = await pgService.query({ environment: "trial", kbId: "kb", version: 2, query: "password reset" });
  assert.strictEqual(pgCorrupt.indexSource, "scan", "corrupt pg index never served (fail closed)");
  assert.strictEqual(fileCorrupt.indexSource, "scan");
  assert.strictEqual(pgCorrupt.servedVersion, 1, "scan fallback serves the older verified version");
  assert.strictEqual(pgCorrupt.servedVersion, fileCorrupt.servedVersion);

  // rollback 自愈：re-pin v2（done 但不可读 → 自动重排队重建）→ 恢复服务自身索引
  const reheal = await pgService.requestBuild({ environment: "trial", artifactId: "a", kbId: "kb", version: 2 });
  assert.strictEqual(reheal.status, "pending", "corrupt done version re-queued in-process");
  assert.strictEqual(await pgService.drainQueueForTest(), true, "reheal builds");
  const pgHealed = await pgService.query({ environment: "trial", kbId: "kb", version: 2, query: "password reset" });
  assert.strictEqual(pgHealed.indexSource, "version");
  assert.strictEqual(pgHealed.servedVersion, 2);
  console.log("✓ parity: digest 一致 / 四模式查询等价 / lkg 回退 / 损坏 fail closed / re-pin 自愈");

  return { pgService, fileService };
}

async function testStandaloneRestart(pgPersistenceService) {
  // 全新服务实例：空队列 root（无任何索引文件），索引内容只能来自 PG。
  const freshRoot = tmpRoot("fresh");
  const restarted = createRagIndexService({
    root: freshRoot,
    backend: "postgres",
    resolveArtifact: () => {
      throw new Error("must not rebuild");
    },
  });
  const loaded = await restarted.loadIndex({ environment: "trial", kbId: "kb", version: 2 });
  assert.strictEqual(loaded.servedVersion, 2, "fresh instance reads the index straight from PG");
  const result = await restarted.query({ environment: "trial", kbId: "kb", version: 2, query: "password reset" });
  assert.strictEqual(result.hits[0].docId, "password-reset");
  assert.strictEqual(
    fs.existsSync(path.join(freshRoot, "rag-indexes")),
    false,
    "standalone serves indexes without touching the container filesystem"
  );
  console.log("✓ standalone restart: 空 root 新实例直接读 PG 索引并可查询（零文件系统依赖）");
}

async function testPgVector(pgPersistenceService, pgService) {
  const pool = pgPersistenceService.getPool();
  const loaded = await pgService.loadIndex({ environment: "trial", kbId: "kb", version: 2 });
  const index = loaded.index;

  // 分块向量列落 PG：计数与索引 chunks 一致
  const count = await query(
    pool,
    "SELECT count(*)::int AS n FROM agent_rag_chunk_vectors WHERE environment = 'trial' AND kb_id = 'kb' AND version = 2"
  );
  assert.strictEqual(count.rows[0].n, index.chunks.length, "one vector row per chunk");

  // 最近邻查询经 rag-runtime 统一接口：与内存版原始向量通道（vectorSearch
  // 同级语义：cosine>0、得分降序、chunkId 决胜，无 queryIndex 的门控链）排序一致。
  const search = rag.createPgVectorSearch({ pool });
  const queryText = "how do I reset my password";
  const queryVector = rag.encodeSemanticVector(queryText);
  const expected = index.chunks
    .map((chunk) => ({ chunkId: chunk.chunkId, score: Number(rag.cosineSimilarity(queryVector, chunk.vector).toFixed(6)) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : 1))
    .slice(0, 3);
  const viaPg = await search.nearest({ environment: "trial", kbId: "kb", version: 2, query: queryText, topK: 3 });
  assert.ok(viaPg.hits.length >= 1, "pgvector returns hits");
  assert.strictEqual(viaPg.hits[0].chunkId, "password-reset#c0", "nearest ranks the relevant chunk first");
  assert.deepStrictEqual(
    viaPg.hits.map((hit) => hit.chunkId),
    expected.map((hit) => hit.chunkId),
    "pgvector ranking matches the in-memory vector channel (same deterministic encoder)"
  );
  // float4 存储舍入容差内的分数一致
  assert.ok(
    Math.abs(viaPg.hits[0].score - expected[0].score) < 1e-3,
    `score within float4 tolerance (${viaPg.hits[0].score} vs ${expected[0].score})`
  );

  // 确定性：同查询两次结果逐位一致
  const again = await search.nearest({ environment: "trial", kbId: "kb", version: 2, query: "how do I reset my password", topK: 3 });
  assert.deepStrictEqual(again, viaPg, "pgvector nearest is deterministic");

  // 重建幂等：v2 已重建过一次（fail-closed 段落），向量行无重复
  const recount = await query(
    pool,
    "SELECT count(*)::int AS n, count(DISTINCT chunk_id)::int AS d FROM agent_rag_chunk_vectors WHERE environment = 'trial' AND kb_id = 'kb' AND version = 2"
  );
  assert.strictEqual(recount.rows[0].n, recount.rows[0].d, "rebuild replaces vectors idempotently (no duplicates)");
  assert.strictEqual(recount.rows[0].n, index.chunks.length);
  console.log("✓ pgvector: 扩展存在 / 分块向量落 PG / 统一接口最近邻与内存通道一致 / 确定性与重建幂等");
}

async function withPgVectorDatabase(env, fn) {
  const adminPool = createPgPool({ connectionString: env.url, max: 2 });
  const dbName = `agent_p5a_rag_${crypto.randomBytes(5).toString("hex")}`;
  await query(adminPool, `CREATE DATABASE ${dbName}`);
  const url = new URL(env.url);
  url.pathname = `/${dbName}`;
  process.env.AGENT_PG_URL = url.toString();
  // 注意：必须在设置 AGENT_PG_URL 之后首次触达 pgPersistenceService。
  const pgPersistenceService = require("../server/src/services/ai/persistence/pgPersistenceService");
  try {
    await pgPersistenceService.runMigrations();
    await fn(pgPersistenceService);
  } finally {
    await pgPersistenceService.closeForTests();
    delete process.env.AGENT_PG_URL;
    await query(adminPool, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await closePool(adminPool);
  }
}

(async () => {
  let reason = "no PostgreSQL available";
  const env = await ensurePg({ image: "pgvector/pgvector:pg16", onReason: (text) => {
    reason = text;
  } });
  if (!env) {
    console.log(`\ntest-agent-p5a-rag-index-store: UNVERIFIED (${reason})`);
    process.exit(0);
  }
  console.log(`pg-test-env: ${env.owned ? `docker container ${env.containerName}` : "external AGENT_TEST_PG_URL"} (${redactUrl(env.url)})`);
  try {
    await withPgVectorDatabase(env, async (pgPersistenceService) => {
      await testMigrationShape(pgPersistenceService.getPool());
      const { pgService } = await testParityAndFailClosed(pgPersistenceService);
      await testStandaloneRestart(pgPersistenceService);
      await testPgVector(pgPersistenceService, pgService);
    });
  } finally {
    await env.cleanup();
  }
  console.log("\ntest-agent-p5a-rag-index-store: PASS");
  process.exit(0);
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
