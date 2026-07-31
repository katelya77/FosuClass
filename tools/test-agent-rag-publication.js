#!/usr/bin/env node
// P4d：RAG 发布适配器 + 组合级闭环专项（tasks.md P4d 验收）。
//   - 声明式校验矩阵：标识形态/重复 docId/标题/标签/文本与 uri 二选一/
//     检索策略边界/密钥字段名与凭据形态文本/结构化校园事实 kind 全量拒绝；
//   - 种子 = 内置只读示例 KB（standalone 空环境即可构建/查询）；
//   - 组合级闭环：发布 → 新快照绑定 → 异步构建 → 真实查询命中新内容 →
//     在途旧快照内容不变 → 草稿不可见 → rollback 后查询恢复旧内容；
//   - 负向锁定：结构化校园事实继续只走 Tool（全 forbidden kind 矩阵）。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRagPublicationAdapter, FORBIDDEN_DOCUMENT_KINDS } = require("../packages/rag-runtime");

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rag-publication-${label}-`));
}

function validDoc(extra) {
  return Object.assign({ docId: "run-recovery", title: "Run recovery", kind: "note", text: "Runs resume from the last acknowledged cursor." }, extra || {});
}

function testValidation() {
  const adapter = createRagPublicationAdapter();
  assert.strictEqual(adapter.validate(adapter.seedPayload()).ok, true, "seed (builtin example KB) validates");

  const base = { kbId: "platform-guide", documents: [validDoc()] };
  const cases = [
    ["bad kbId", { kbId: "KB Upper", documents: [validDoc()] }],
    ["missing documents", { kbId: "x" }],
    ["too many documents", { kbId: "x", documents: Array.from({ length: 201 }, (_, i) => validDoc({ docId: `d${i}` })) }],
    ["duplicate docId", { kbId: "x", documents: [validDoc(), validDoc()] }],
    ["bad docId shape", { kbId: "x", documents: [validDoc({ docId: "DROP TABLE" })] }],
    ["empty title", { kbId: "x", documents: [validDoc({ title: "  " })] }],
    ["bad kind shape", { kbId: "x", documents: [validDoc({ kind: "Kind-Upper" })] }],
    ["too many tags", { kbId: "x", documents: [validDoc({ tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] })] }],
    ["both text and uri", { kbId: "x", documents: [validDoc({ uri: "https://docs.example.com/x" })] }],
    ["neither text nor uri", { kbId: "x", documents: [{ docId: "empty-doc", title: "Empty" }] }],
    ["empty text", { kbId: "x", documents: [validDoc({ text: "   " })] }],
    ["oversized text", { kbId: "x", documents: [validDoc({ text: "y".repeat(20001) })] }],
    ["credential-shaped text", { kbId: "x", documents: [validDoc({ text: "api_key: abcd1234efgh5678" })] }],
    ["credential-shaped title", { kbId: "x", documents: [validDoc({ title: "password: hunter22" })] }],
    ["credential-shaped tag", { kbId: "x", documents: [validDoc({ tags: ["apikey: abcd1234"] })] }],
    ["credential-shaped uri query", { kbId: "x", documents: [{ docId: "u4", title: "U", uri: "https://docs.example.com/x?token=sk-abcdef0123456789" }] }],
    ["oversized uri", { kbId: "x", documents: [{ docId: "u5", title: "U", uri: `https://docs.example.com/${"p".repeat(501)}` }] }],
    ["http uri", { kbId: "x", documents: [{ docId: "u1", title: "U", uri: "http://docs.example.com/x" }] }],
    ["userinfo uri", { kbId: "x", documents: [{ docId: "u2", title: "U", uri: "https://docs.example.com@evil.example.com/x" }] }],
    ["ip uri", { kbId: "x", documents: [{ docId: "u3", title: "U", uri: "https://10.0.0.4/x" }] }],
    ["secret field name", Object.assign({}, base, { apiToken: "x" })],
    ["secret nested in document", { kbId: "x", documents: [Object.assign(validDoc(), { password: "hunter2" })] }],
    ["non-declarative top field", Object.assign({}, base, { execute: "evil" })],
    ["non-declarative doc field", { kbId: "x", documents: [validDoc({ script: "evil" })] }],
    ["bad retrieval field", Object.assign({}, base, { retrieval: { unknownKnob: 1 } })],
    ["bad defaultMode", Object.assign({}, base, { retrieval: { defaultMode: "magic" } })],
    ["topK out of range", Object.assign({}, base, { retrieval: { topK: 99 } })],
    ["minScore out of range", Object.assign({}, base, { retrieval: { minScore: 2 } })],
    ["weight out of range", Object.assign({}, base, { retrieval: { rerankWeights: { vector: 9 } } })],
    ["unknown weight field", Object.assign({}, base, { retrieval: { rerankWeights: { freshness: 1 } } })],
  ];
  cases.forEach(([name, payload]) => {
    const report = adapter.validate(payload);
    assert.strictEqual(report.ok, false, `must reject: ${name}`);
    assert.ok(report.errors.length > 0, `must report errors: ${name}`);
  });

  // 结构化校园事实负向锁定：全 forbidden kind 矩阵（事实只能走 Tool）
  FORBIDDEN_DOCUMENT_KINDS.forEach((kind) => {
    const report = adapter.validate({ kbId: "x", documents: [validDoc({ docId: `fact-${kind.replace(/_/g, "-")}`, kind })] });
    assert.strictEqual(report.ok, false, `structured campus fact kind must be rejected: ${kind}`);
  });

  const ok = adapter.validate({
    kbId: "platform-guide",
    documents: [
      validDoc(),
      { docId: "remote-guide", title: "Remote guide", uri: "https://docs.example.com/guide", tags: ["remote"] },
    ],
    retrieval: { defaultMode: "hybrid", topK: 8, minScore: 0.2, rerankWeights: { lexical: 2, vector: 1, title: 1 } },
  });
  assert.strictEqual(ok.ok, true, `valid KB must pass: ${ok.errors}`);
  assert.strictEqual(ok.normalized.retrieval.defaultMode, "hybrid");
  assert.strictEqual(ok.normalized.retrieval.rerankWeights.lexical, 2);

  // 发布前测试：inline 文档可切块；uri 文档构建期验证（不触网）
  const rehearsal = adapter.test(ok.normalized);
  assert.strictEqual(rehearsal.ok, true);
  assert.strictEqual(rehearsal.results.inlineDocuments, 1);
  assert.strictEqual(rehearsal.results.uriVerifiedAtBuild, true, "uri documents deferred to post-publish build");

  // M-1：resolveRuntime 深冻结——被 (env, version) 缓存共享的运行时
  // 不得被任何消费方的嵌套变异跨请求污染。
  const runtime = adapter.resolveRuntime({ payload: adapter.seedPayload() });
  assert.ok(Object.isFrozen(runtime) && Object.isFrozen(runtime.documents)
    && Object.isFrozen(runtime.documents[0]) && Object.isFrozen(runtime.retrieval)
    && Object.isFrozen(runtime.retrieval.rerankWeights), "runtime is deeply frozen");
  try { runtime.documents.push({ docId: "evil" }); } catch (_) { /* strict mode 抛错同样接受 */ }
  assert.strictEqual(runtime.documents.length, 1, "nested mutation cannot pollute the cached runtime");
  console.log("✓ declarative validation: full rejection matrix + campus-fact kind lock + valid KB passes");
}

async function testCompositionRoundtrip() {
  const root = tmpRoot("compose");
  process.env.FOSU_AGENT_CONFIG_KERNEL_PATH = root;
  const composition = require("../server/src/services/ai/platformComposition");
  const kernel = composition.getConfigKernel();
  const indexService = composition.getRagIndexService();

  // 种子：内置示例 KB 绑定 v1；异步构建后真实可查
  const snapshotV1 = kernel.getCurrentSnapshot("trial");
  const seedArtifact = composition.resolveRagArtifactForSnapshot(snapshotV1);
  assert.strictEqual(seedArtifact.kbId, "platform-example", "seed = builtin read-only example KB");
  assert.strictEqual(await indexService.drainQueueForTest(), true, "seed index builds");
  const seedQuery = await composition.queryRagForSnapshot(snapshotV1, { query: "how does publish and rollback work" });
  assert.ok(seedQuery.hits.length >= 1, "seed KB answers real queries");
  assert.strictEqual(seedQuery.hits[0].docId, "config-publication");
  assert.strictEqual(seedQuery.servedVersion, 1);

  // 发布 v2：追加 run-recovery 文档
  const draftInput = {
    domain: "rag",
    artifactId: "fosu-campus",
    environment: "trial",
    payload: {
      kbId: "platform-example",
      documents: seedArtifact.documents.concat([{
        docId: "run-recovery",
        title: "Run recovery",
        kind: "note",
        text: "A run resumes from the last acknowledged cursor. Final results stay recoverable after reconnects.",
      }]),
      retrieval: seedArtifact.retrieval,
    },
    actor: "p4d-test",
  };
  kernel.saveDraft(draftInput);
  assert.strictEqual(kernel.validateDraft(draftInput).ok, true);
  assert.strictEqual(kernel.testDraft(draftInput).ok, true);

  // 草稿不可见：发布前查询仍只见到 v1 内容
  const beforePublish = await composition.queryRagForSnapshot(kernel.getCurrentSnapshot("trial"), { query: "run resume cursor reconnect" });
  assert.ok(beforePublish.hits.every((hit) => hit.docId !== "run-recovery"), "draft content invisible before publish");
  assert.strictEqual(fs.existsSync(path.join(root, "rag-indexes", "trial", "platform-example", "v2.json")), false, "no index for the draft");

  kernel.publishDraft(draftInput);
  const snapshotV2 = kernel.getCurrentSnapshot("trial");
  assert.notStrictEqual(snapshotV2.configVersion, snapshotV1.configVersion);
  composition.resolveRagArtifactForSnapshot(snapshotV2); // 触发 v2 构建
  assert.strictEqual(await indexService.drainQueueForTest(), true, "v2 index builds");
  const afterPublish = await composition.queryRagForSnapshot(snapshotV2, { query: "run resume cursor reconnect" });
  assert.strictEqual(afterPublish.hits[0].docId, "run-recovery", "published content becomes queryable");
  assert.strictEqual(afterPublish.servedVersion, 2, "new snapshot binds the new index version");

  // 在途 v1 快照：仍服务旧内容（发布不影响在途 Run）
  const inFlight = await composition.queryRagForSnapshot(snapshotV1, { query: "run resume cursor reconnect" });
  assert.strictEqual(inFlight.servedVersion, 1, "in-flight snapshot keeps the old index");
  assert.ok(inFlight.hits.every((hit) => hit.docId !== "run-recovery"), "in-flight content unchanged");

  // rollback：新快照回钉 v1，查询恢复种子内容
  kernel.rollback({ domain: "rag", artifactId: "fosu-campus", environment: "trial", toVersion: 1, actor: "p4d-test" });
  const snapshotV3 = kernel.getCurrentSnapshot("trial");
  const rolledBack = await composition.queryRagForSnapshot(snapshotV3, { query: "run resume cursor reconnect" });
  assert.strictEqual(rolledBack.servedVersion, 1, "rollback restores the verified old index");
  assert.ok(rolledBack.hits.every((hit) => hit.docId !== "run-recovery"), "rollback content matches the old version");
  console.log("✓ composition roundtrip: publish → build → real query → in-flight stability → draft invisibility → rollback");
}

(async () => {
  testValidation();
  await testCompositionRoundtrip();
  console.log("\ntest-agent-rag-publication: PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
