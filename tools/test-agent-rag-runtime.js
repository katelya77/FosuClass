#!/usr/bin/env node
// P4d：rag-runtime 单元/集成专项（tasks.md P4d 验收）。
//   - 切块/BM25/融合/rerank 确定性与排序健全性；
//   - 摄取：inline、uri 拒绝矩阵（http/IP/localhost/userinfo/尾点混淆）、
//     fetcher 注入、重定向再校验、大小上限、结构化校园事实 kind 拒绝；
//   - 索引：四模式真实查询链、序列化回读、digest 篡改 fail closed、
//     encoder 世代不匹配硬失败、minScore 空答案门控、引用形态；
//   - 索引服务：稳定 jobId、幂等去重、lkg 只回退更旧版本、崩溃 reclaim、
//     草稿不可见（无索引文件）。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rag = require("../packages/rag-runtime");
const { createRagIndexService } = require("../server/src/services/ai/ragIndexService");

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rag-runtime-${label}-`));
}

const DOC_SET = [
  { docId: "password-reset", title: "Password reset", kind: "note", text: "To reset your password, open account settings and choose security. A reset link is sent to your verified email address." },
  { docId: "notification-prefs", title: "Notification preferences", kind: "note", text: "Notification preferences control which alerts you receive. You can mute channels, set quiet hours, or disable email digests." },
  { docId: "data-export", title: "Data export", kind: "note", text: "You can export your data from the privacy dashboard. Exports are prepared asynchronously and remain downloadable for seven days." },
  { docId: "theme-settings", title: "Theme settings", kind: "note", text: "Theme settings switch between light, dark, and system appearance. The choice is stored per device." },
];

function buildTestIndex() {
  return rag.buildIndex({ kbId: "test-kb", version: 1, documents: DOC_SET, retrieval: { topK: 3, minScore: 0.05 } });
}

async function testTextProcessing() {
  const text = "第一段关于配置发布。\n\n第二段关于回滚语义，回滚只切换指针。";
  const a = rag.chunkDocument({ docId: "d1", title: "t", text });
  const b = rag.chunkDocument({ docId: "d1", title: "t", text });
  assert.deepStrictEqual(a, b, "chunking is deterministic");
  assert.strictEqual(a[0].chunkId, "d1#c0");
  const long = "x".repeat(2500);
  const sliced = rag.chunkDocument({ docId: "d2", title: "t", text: long }, { maxChars: 400 });
  assert.ok(sliced.length >= 6, `long paragraph hard-sliced (got ${sliced.length})`);
  sliced.forEach((chunk, index) => {
    assert.strictEqual(chunk.chunkId, `d2#c${index}`);
    assert.ok(chunk.text.length <= 400);
  });
  assert.deepStrictEqual(rag.chunkDocument({ docId: "d3", title: "t", text: "   " }), [], "empty text yields no chunks");
  console.log("✓ textProcessing: deterministic chunking, hard slicing, empty handling");
}

async function testRetrievalPrimitives() {
  const chunks = DOC_SET.flatMap((doc) => rag.chunkDocument(doc).map((chunk) => Object.assign(chunk, {
    tokens: rag.tokenizeSemantic(`${doc.title}\n${chunk.text}`),
  })));
  const index = rag.buildBm25Index(chunks);
  const first = rag.bm25Search(index, chunks, "password reset link", { topK: 2 });
  assert.strictEqual(first.hits[0].chunkId, "password-reset#c0", "BM25 ranks the relevant chunk first");
  const again = rag.bm25Search(index, chunks, "password reset link", { topK: 2 });
  assert.deepStrictEqual(first.hits, again.hits, "BM25 deterministic");

  const fusedA = rag.rrfFuse([{ name: "l", hits: first.hits }, { name: "v", hits: first.hits.slice().reverse() }]);
  const fusedB = rag.rrfFuse([{ name: "l", hits: first.hits }, { name: "v", hits: first.hits.slice().reverse() }]);
  assert.deepStrictEqual(fusedA, fusedB, "RRF deterministic");
  assert.strictEqual(fusedA[0].chunkId, "password-reset#c0", "RRF keeps the jointly-top candidate first");

  const candidates = fusedA.map((entry) => ({
    chunkId: entry.chunkId,
    title: entry.chunkId.startsWith("password-reset") ? "Password reset" : "Other",
    scores: { lexical: entry.rrf, vector: entry.rrf / 2 },
  }));
  const reranked = rag.deterministicRerank(candidates, { query: "password reset", weights: { lexical: 1, vector: 1, title: 2 } });
  assert.strictEqual(reranked[0].chunkId, "password-reset#c0", "rerank honors title weight");
  assert.ok(reranked[0].rerank >= reranked[reranked.length - 1].rerank, "rerank ordering monotone");
  console.log("✓ retrieval primitives: BM25/RRF/rerank deterministic and sane");
}

async function testIngestion() {
  // uri 拒绝矩阵
  ["http://example.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://example.com@evil.example.com/x", "https://example.local/x"]
    .forEach((uri) => {
      assert.strictEqual(rag.validateDocumentUri(uri).ok, false, `must reject: ${uri}`);
    });
  assert.strictEqual(rag.validateDocumentUri("https://docs.example.com/guide").ok, true, "public https accepted");
  assert.strictEqual(rag.validateDocumentUri("https://docs.example.com./guide").ok, true, "trailing-dot normalizes");

  // fetcher 注入：不触网完成 uri 摄取
  const fakeFetcher = async (url) => ({
    status: 200,
    headers: { get: (name) => (name === "content-type" ? "text/plain; charset=utf-8" : null) },
    body: null,
    text: async () => "Fetched knowledge about session timeout policies.",
  });
  const ingested = await rag.ingestDocuments([
    { docId: "inline-doc", title: "Inline", text: "inline body" },
    { docId: "remote-doc", title: "Remote", uri: "https://docs.example.com/timeout" },
    { docId: "bad-kind", title: "Bad", kind: "course_schedule", text: "Monday class at 8am" },
  ], { fetcher: fakeFetcher });
  assert.strictEqual(ingested.documents.length, 2, "inline + uri documents ingested");
  assert.strictEqual(ingested.documents[1].text.includes("session timeout"), true, "fetcher body ingested");
  assert.strictEqual(ingested.failures.length, 1, "forbidden kind failed");
  assert.strictEqual(ingested.failures[0].errorClass, "RAG_INGEST_KIND_FORBIDDEN", "structured campus fact kind rejected at ingestion");

  // 重定向到内网 → 拒绝
  const redirectFetcher = async () => ({
    status: 302,
    headers: { get: (name) => (name === "location" ? "https://127.0.0.1/internal" : null) },
  });
  const redirected = await rag.ingestDocuments([{ docId: "redir", title: "R", uri: "https://docs.example.com/x" }], { fetcher: redirectFetcher });
  assert.strictEqual(redirected.failures[0].errorClass, "RAG_INGEST_REDIRECT_INVALID", "redirect to private host rejected");

  // 体积上限
  const bigFetcher = async () => ({
    status: 200,
    headers: { get: () => "text/plain" },
    body: null,
    text: async () => "y".repeat(600 * 1024),
  });
  const tooBig = await rag.ingestDocuments([{ docId: "big", title: "B", uri: "https://docs.example.com/big" }], { fetcher: bigFetcher });
  assert.strictEqual(tooBig.failures[0].errorClass, "RAG_INGEST_TOO_LARGE", "oversized body rejected");
  console.log("✓ ingestion: uri matrix, fetcher injection, redirect revalidation, size cap, kind guard");
}

async function testIndexLifecycle() {
  const index = await buildTestIndex();
  assert.strictEqual(index.encoder.encoderType, "deterministic-local-v2");
  assert.ok(index.digest && index.chunks.length >= 4, "index carries digest and chunks");

  // 四模式真实查询链
  const modes = ["lexical", "vector", "hybrid", "hybrid_rerank"];
  for (const mode of modes) {
    const result = rag.queryIndex(index, "how do I reset my password", { mode, topK: 2 });
    assert.strictEqual(result.mode, mode);
    assert.ok(result.hits.length >= 1, `${mode} returns hits`);
    assert.strictEqual(result.hits[0].docId, "password-reset", `${mode} ranks the relevant doc first`);
    assert.strictEqual(result.hits[0].citation.chunkId, result.hits[0].chunkId, "citation mirrors the hit");
    const repeat = rag.queryIndex(index, "how do I reset my password", { mode, topK: 2 });
    assert.deepStrictEqual(result.hits, repeat.hits, `${mode} deterministic`);
  }

  // 空答案门控：无关查询不得发明内容
  const empty = rag.queryIndex(index, "zyxwv qplm unrelated gibberish", { mode: "vector" });
  assert.strictEqual(empty.hits.length, 0, "unrelated query returns no hits");
  assert.ok(["no_candidate", "low_confidence"].includes(empty.reason), `empty reason classified: ${empty.reason}`);

  // 序列化回读 + digest 篡改 fail closed
  const parsed = rag.parseIndex(rag.serializeIndex(index));
  assert.strictEqual(parsed.digest, index.digest, "serialize/parse roundtrip preserves digest");
  const tampered = JSON.parse(rag.serializeIndex(index));
  tampered.chunks[0].text = "tampered content";
  assert.throws(() => rag.parseIndex(JSON.stringify(tampered)), (e) => e.code === "RAG_INDEX_CORRUPT", "tampered index fails closed");

  // encoder 世代不匹配：查询硬失败（不静默换向量空间）
  const drifted = JSON.parse(rag.serializeIndex(index));
  drifted.encoder = { encoderType: "deterministic-local-v0", dimensions: 64 };
  drifted.digest = rag.digestOf ? undefined : undefined;
  const rebuilt = Object.assign({}, drifted);
  delete rebuilt.digest;
  // 重算 digest 以隔离变量：digest 合法但 encoder 世代不同
  const { createRequire } = require("module");
  const ragRuntime = require("../packages/rag-runtime/src/ragRuntime");
  rebuilt.digest = ragRuntime.digestOf(rebuilt);
  const compat = rag.checkIndexCompatibility(ragRuntime.parseIndex(JSON.stringify(rebuilt)));
  assert.strictEqual(compat.compatible, false, "encoder drift detected");
  assert.throws(
    () => rag.queryIndex(ragRuntime.parseIndex(JSON.stringify(rebuilt)), "password", {}),
    (e) => e.code === "RAG_ENCODER_MISMATCH",
    "query on a drifted-encoder index fails hard"
  );
  console.log("✓ index lifecycle: four real modes, empty-answer gate, digest/encoder fail-closed");
}

async function testIndexService() {
  const root = tmpRoot("service");
  const artifacts = {
    1: { documents: DOC_SET.slice(0, 2), retrieval: { topK: 2 } },
    2: { documents: DOC_SET, retrieval: { topK: 2 } },
  };
  const service = createRagIndexService({
    root,
    resolveArtifact: ({ version }) => artifacts[version],
  });

  // 稳定 jobId + 幂等去重
  const first = service.requestBuild({ environment: "trial", artifactId: "a", kbId: "test-kb", version: 1 });
  assert.strictEqual(first.jobId, "rag:trial:test-kb:v1", "stable jobId");
  const dupe = service.requestBuild({ environment: "trial", artifactId: "a", kbId: "test-kb", version: 1 });
  assert.strictEqual(dupe.deduped, true, "same job deduped");
  assert.strictEqual(await service.drainQueueForTest(), true, "queue drains");

  // 查询走钉住版本索引
  const result = await service.query({ environment: "trial", kbId: "test-kb", version: 1, query: "password reset" });
  assert.strictEqual(result.hits[0].docId, "password-reset");
  assert.strictEqual(result.servedVersion, 1);
  assert.strictEqual(result.indexSource, "version");

  // 幂等：已完成的版本再次 requestBuild 不重建
  const again = service.requestBuild({ environment: "trial", artifactId: "a", kbId: "test-kb", version: 1 });
  assert.strictEqual(again.status, "done", "built version is idempotent");

  // v2 构建失败后查询回退 lkg（更旧版本），不发明内容
  artifacts[2] = null; // resolveArtifact 返回 null → 构建失败
  service.requestBuild({ environment: "trial", artifactId: "a", kbId: "test-kb", version: 2 });
  await service.drainQueueForTest();
  let fellBack = null;
  try {
    fellBack = await service.query({ environment: "trial", kbId: "test-kb", version: 2, query: "password reset" });
  } catch (error) {
    // 三次重试未完成时可能仍 pending；等待后再试一次
    await service.drainQueueForTest();
    fellBack = await service.query({ environment: "trial", kbId: "test-kb", version: 2, query: "password reset" });
  }
  assert.strictEqual(fellBack.indexSource, "lkg", "failed new version falls back to lkg");
  assert.strictEqual(fellBack.servedVersion, 1, "lkg serves the older verified version");

  // 草稿不可见：从未发布的 v3 没有索引文件；查询钉住 v3 时只能回退到
  // 已验证的 lkg v1 内容（发布后构建期的正常降级路径），草稿内容永不出现。
  assert.strictEqual(fs.existsSync(path.join(root, "rag-indexes", "trial", "test-kb", "v3.json")), false, "draft has no index file");
  const draftEyes = await service.query({ environment: "trial", kbId: "test-kb", version: 3, query: "password reset" });
  assert.strictEqual(draftEyes.servedVersion, 1, "unbuilt version degrades to the last verified content");
  assert.strictEqual(draftEyes.hits[0].docId, "password-reset", "served content comes from the published version, never the draft");

  // 完全无索引的 KB：fail closed
  assert.throws(
    () => service.loadIndex({ environment: "trial", kbId: "never-built", version: 1 }),
    (e) => e.code === "RAG_INDEX_UNAVAILABLE",
    "unknown KB fails closed"
  );

  // 崩溃 reclaim：伪造 building 残留队列，重建服务实例后任务被重跑
  artifacts[3] = { documents: DOC_SET.slice(1, 3), retrieval: { topK: 2 } };
  const queueFile = path.join(root, "rag-index-queue.json");
  const queue = JSON.parse(fs.readFileSync(queueFile, "utf8"));
  queue.jobs.push({
    jobId: "rag:trial:test-kb:v3", environment: "trial", artifactId: "a", kbId: "test-kb",
    version: 3, status: "building", attempts: 0, errorClass: "",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(queueFile, JSON.stringify(queue));
  const recovered = createRagIndexService({ root, resolveArtifact: ({ version }) => artifacts[version] });
  assert.strictEqual(await recovered.drainQueueForTest(), true, "reclaimed queue drains");
  const crashed = await recovered.query({ environment: "trial", kbId: "test-kb", version: 3, query: "notification preferences" });
  assert.strictEqual(crashed.hits[0].docId, "notification-prefs", "reclaimed job built the index after restart");
  console.log("✓ index service: stable jobId, idempotency, lkg fallback, draft invisibility, crash reclaim");
}

(async () => {
  await testTextProcessing();
  await testRetrievalPrimitives();
  await testIngestion();
  await testIndexLifecycle();
  await testIndexService();
  console.log("\ntest-agent-rag-runtime: PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
