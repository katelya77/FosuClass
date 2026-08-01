#!/usr/bin/env node
// P4d：Golden query 四组对照评测（tasks.md P4d 验收；ADR-0007 §5 如实报告）。
//   - 语料：12 篇通用平台文档（无任何校园事实）；
//   - 查询：11 组带相关性标注 + 2 组空答案探针；
//   - 四组模式：lexical / vector / hybrid / hybrid_rerank；
//   - 指标：Recall@5、MRR、引用正确率、空答案正确率，逐模式打印对照表；
//   - 断言只锁定必须为真的不变量（确定性、引用形态、空答案、直达查询底噪），
//     提升幅度只报告不断言（本地 encoder 是离线基线，不夸大）。
const assert = require("node:assert");
const rag = require("../packages/rag-runtime");

const CORPUS = [
  { docId: "password-reset", title: "Password reset", kind: "note", text: "Reset your password from the account settings security section. A reset link is sent to your verified email address." },
  { docId: "account-security", title: "Two-factor authentication", kind: "note", text: "Two-factor authentication adds a second verification step at sign in. You can use an authenticator app or SMS codes." },
  { docId: "notification-prefs", title: "Notification preferences", kind: "note", text: "Notification preferences control which alerts reach you. Mute channels, set quiet hours, or pause email digests." },
  { docId: "email-digest", title: "Weekly email digest", kind: "note", text: "The weekly email digest summarizes unread activity. Digest delivery can be paused from notification settings." },
  { docId: "data-export", title: "Data export", kind: "note", text: "Export your data from the privacy dashboard. Exports are prepared asynchronously and stay downloadable for seven days." },
  { docId: "data-deletion", title: "Account deletion", kind: "note", text: "Deleting your account removes personal data after a thirty day grace period. Some audit logs are retained as required by law." },
  { docId: "theme-settings", title: "Theme settings", kind: "note", text: "Switch between light, dark, and system appearance. The theme choice is stored per device." },
  { docId: "keyboard-shortcuts", title: "Keyboard shortcuts", kind: "note", text: "Keyboard shortcuts speed up navigation. Press the question mark key to open the shortcut reference." },
  { docId: "offline-mode", title: "Offline mode", kind: "note", text: "Offline mode caches recent documents on your device. Changes sync automatically when connectivity returns." },
  { docId: "sync-conflicts", title: "Sync conflicts", kind: "note", text: "Sync conflicts happen when two devices edit the same item. The conflict resolver keeps both versions for review." },
  { docId: "storage-limits", title: "Storage limits", kind: "note", text: "Storage limits depend on your plan. Large attachments count against the shared team quota." },
  { docId: "session-timeout", title: "Session timeout", kind: "note", text: "Sessions expire after a period of inactivity. Administrators can adjust the timeout window for their organization." },
];

const QUERIES = [
  { id: "q1", query: "how do I reset my password", relevant: ["password-reset"] },
  { id: "q2", query: "enable two factor authentication", relevant: ["account-security"] },
  { id: "q3", query: "mute alerts and set quiet hours", relevant: ["notification-prefs"] },
  { id: "q4", query: "pause the weekly summary email", relevant: ["email-digest", "notification-prefs"] },
  { id: "q5", query: "download a copy of my data", relevant: ["data-export"] },
  { id: "q6", query: "what happens when I delete my account", relevant: ["data-deletion"] },
  { id: "q7", query: "dark mode appearance", relevant: ["theme-settings"] },
  { id: "q8", query: "shortcut reference for navigation", relevant: ["keyboard-shortcuts"] },
  { id: "q9", query: "work without an internet connection", relevant: ["offline-mode"] },
  { id: "q10", query: "two devices edited the same item", relevant: ["sync-conflicts"] },
  { id: "q11", query: "retention of audit logs after deletion", relevant: ["data-deletion"] },
  { id: "q12", query: "xyzzy plover nonsense tokens", relevant: [] },
  { id: "q13", query: "quantum entanglement microwave", relevant: [] },
];

const TOP_K = 5;
const MODES = ["lexical", "vector", "hybrid", "hybrid_rerank"];

function evaluate(index, mode) {
  let recallSum = 0;
  let rrSum = 0;
  let topCitationCorrect = 0;
  let emptyCorrect = 0;
  const relevantQueries = QUERIES.filter((q) => q.relevant.length);
  const emptyProbes = QUERIES.filter((q) => !q.relevant.length);

  QUERIES.forEach((q) => {
    const result = rag.queryIndex(index, q.query, { mode, topK: TOP_K, minScore: 0.05 });
    if (!q.relevant.length) {
      if (!result.hits.length) emptyCorrect += 1;
      return;
    }
    const hitDocIds = result.hits.map((hit) => hit.docId);
    const found = q.relevant.filter((docId) => hitDocIds.includes(docId)).length;
    recallSum += found / q.relevant.length;
    const firstRank = hitDocIds.findIndex((docId) => q.relevant.includes(docId));
    rrSum += firstRank >= 0 ? 1 / (firstRank + 1) : 0;
    // 引用正确率 = 首位命中（回答实际引用对象）落在相关集内的比例
    if (result.hits.length && q.relevant.includes(result.hits[0].citation.docId)) topCitationCorrect += 1;
  });

  return {
    mode,
    recallAtK: recallSum / relevantQueries.length,
    mrr: rrSum / relevantQueries.length,
    citationAccuracy: topCitationCorrect / relevantQueries.length,
    emptyAnswerAccuracy: emptyProbes.length ? emptyCorrect / emptyProbes.length : 1,
  };
}

(async () => {
  const index = await rag.buildIndex({
    kbId: "golden-platform",
    version: 1,
    documents: CORPUS,
    retrieval: { topK: TOP_K, minScore: 0.05 },
  });
  assert.ok(index.chunks.length >= CORPUS.length, "corpus indexed");

  // 确定性：同一模式两次评测结果逐位一致
  MODES.forEach((mode) => {
    const a = rag.queryIndex(index, "pause the weekly summary email", { mode, topK: TOP_K });
    const b = rag.queryIndex(index, "pause the weekly summary email", { mode, topK: TOP_K });
    assert.deepStrictEqual(a.hits, b.hits, `${mode} deterministic`);
  });

  // 直达查询底噪：明确匹配的查询在四种模式下首位都必须是相关文档。
  // q2（"two factor" 分词与 "two-factor" 连字符形态不齐）是已标注的硬查询：
  // 只断言相关文档落在 topK 内（如实纳入 Recall/MRR，不挑选顺风查询）。
  MODES.forEach((mode) => {
    ["q1", "q7"].forEach((id) => {
      const q = QUERIES.find((item) => item.id === id);
      const result = rag.queryIndex(index, q.query, { mode, topK: TOP_K });
      assert.ok(result.hits.length >= 1, `${mode}/${id} returns hits`);
      assert.ok(q.relevant.includes(result.hits[0].docId), `${mode}/${id} top hit must be relevant (got ${result.hits[0].docId})`);
      assert.strictEqual(result.hits[0].citation.docId, result.hits[0].docId, "citation mirrors the hit");
    });
    const hard = QUERIES.find((item) => item.id === "q2");
    const hardResult = rag.queryIndex(index, hard.query, { mode, topK: TOP_K });
    assert.ok(
      hardResult.hits.some((hit) => hard.relevant.includes(hit.docId)),
      `${mode}/q2 relevant doc must land within topK (hyphen-tokenization hard case)`
    );
  });

  // 空答案正确性：探针查询在四模式下都不得发明内容
  MODES.forEach((mode) => {
    ["q12", "q13"].forEach((id) => {
      const q = QUERIES.find((item) => item.id === id);
      const result = rag.queryIndex(index, q.query, { mode, topK: TOP_K });
      assert.strictEqual(result.hits.length, 0, `${mode}/${id} must stay silent on nonsense queries`);
    });
  });

  // 对照表（如实报告，不断言提升方向）
  const report = MODES.map((mode) => evaluate(index, mode));
  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  console.log("\n  golden query comparison (13 queries, 12 docs, Recall@5):");
  report.forEach((row) => {
    console.log(
      `  ${row.mode.padEnd(14)} recall@5=${pct(row.recallAtK)}  mrr=${pct(row.mrr)}  citation=${pct(row.citationAccuracy)}  empty=${pct(row.emptyAnswerAccuracy)}`
    );
  });
  const lexical = report.find((row) => row.mode === "lexical");
  const hybridRerank = report.find((row) => row.mode === "hybrid_rerank");
  console.log(
    `  hybrid_rerank vs lexical recall delta: ${((hybridRerank.recallAtK - lexical.recallAtK) * 100).toFixed(1)}pp ` +
    `(encoder=${index.encoder.encoderType}; local baseline, honest report)`
  );
  console.log("\ntest-agent-rag-golden-queries: PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
