#!/usr/bin/env node
// P4d / ADR-0007：encoder 单源与世代治理锁定。
//   - agent-runtime/semanticMemory 委托 rag-runtime/localEncoder（同一实现）；
//   - 黄金值对照：v1（迁移前 semanticMemory 内联实现）捕获的精确输出在
//     v2 下逐位保持——输入全为 CJK/干净 latin，证明 v2 的 latin 词元修正
//     不改变既有记忆/RAG 语料的向量空间（v1→v2 稳定性证明）；
//   - v2 新行为：尾随标点剥离、连字符拆分、单字符噪声丢弃；
//   - 跨进程确定性：相同输入两次编码一致；manifest 字段固定为 v2 世代。
const assert = require("node:assert");

const encoder = require("../packages/rag-runtime/src/localEncoder");
const semanticMemory = require("../packages/agent-runtime/src/semanticMemory");

// 抽取前捕获的黄金值（非零下标 → 值；完整 64 维向量的精确表示）。
const GOLDEN = [
  {
    input: "图书馆在哪里",
    tokens: ["图书", "书馆", "馆在", "在哪", "哪里"],
    nonZero: { 22: 0.447214, 42: 0.447214, 58: 0.447214, 59: 0.447214, 61: 0.447214 },
  },
  {
    input: "preferredName 小明",
    tokens: ["preferredname", "小明", "称呼", "name", "名字", "叫我"],
    nonZero: { 4: 0.353553, 20: 0.707107, 22: 0.353553, 26: 0.353553, 63: 0.353553 },
  },
  {
    input: "明天第一节课是什么",
    tokens: ["明天", "天第", "第一", "一节", "节课", "课是", "是什", "什么"],
    nonZero: { 9: 0.353553, 13: 0.353553, 14: 0.353553, 27: 0.353553, 32: 0.353553, 40: 0.353553, 42: 0.353553, 57: 0.353553 },
  },
  {
    input: "campus 江湾校区 自习室",
    tokens: ["campus", "江湾校区", "江湾", "湾校", "校区", "自习室", "自习", "习室", "仙溪", "楼栋", "building", "教学楼", "空教室"],
    nonZero: { 1: 0.27735, 3: 0.27735, 6: 0.27735, 8: 0.27735, 10: 0.27735, 15: 0.27735, 21: 0.27735, 23: 0.27735, 33: 0.27735, 39: 0.27735, 51: 0.27735, 55: 0.27735, 63: 0.27735 },
  },
  { input: "", tokens: [], nonZero: {} },
];
const GOLDEN_SCORES = { query: "图书馆在哪", document: "图书馆在哪里", lexical: 1, vector: 0.894427 };

function assertVectorMatchesGolden(input, nonZero) {
  const vector = encoder.encodeSemanticVector(input);
  assert.strictEqual(vector.length, 64, "fixed dimensions");
  vector.forEach((value, index) => {
    const expected = nonZero[index] || 0;
    assert.strictEqual(value, expected, `${input} vector[${index}] must equal the pre-extraction golden value`);
  });
}

// 1. 委托一致性：semanticMemory 的每个导出与权威实现同一函数/同一输出。
assert.strictEqual(semanticMemory.encodeSemanticVector, encoder.encodeSemanticVector, "same function reference");
assert.strictEqual(semanticMemory.tokenizeSemantic, encoder.tokenizeSemantic, "same tokenizer reference");
assert.strictEqual(semanticMemory.cosineSimilarity, encoder.cosineSimilarity);
assert.strictEqual(semanticMemory.lexicalSimilarity, encoder.lexicalSimilarity);
assert.strictEqual(semanticMemory.semanticScores, encoder.semanticScores);
assert.strictEqual(semanticMemory.VECTOR_DIMENSIONS, encoder.VECTOR_DIMENSIONS);
console.log("✓ semanticMemory delegates to the authoritative encoder (single source)");

// 2. 黄金值逐位对照（tokenization + 向量 + 相似度）。
GOLDEN.forEach(({ input, tokens, nonZero }) => {
  assert.deepStrictEqual(encoder.tokenizeSemantic(input), tokens, `tokens for ${JSON.stringify(input)}`);
  assertVectorMatchesGolden(input, nonZero);
});
const scores = semanticMemory.semanticScores(GOLDEN_SCORES.query, GOLDEN_SCORES.document);
assert.deepStrictEqual(scores, { lexical: GOLDEN_SCORES.lexical, vector: GOLDEN_SCORES.vector });
console.log("✓ golden values match the pre-extraction implementation bit-for-bit");

// 3. 跨进程/重复调用确定性 + manifest 固定字段。
["图书馆在哪里", "campus 江湾校区 自习室", ""].forEach((input) => {
  assert.deepStrictEqual(encoder.encodeSemanticVector(input), encoder.encodeSemanticVector(input), "deterministic re-encode");
});
const manifest = encoder.encoderManifest();
assert.deepStrictEqual(manifest, {
  encoderType: "deterministic-local-v2",
  dimensions: 64,
  hashAlgorithm: "sha256-u32be-mod",
  tokenizer: "nfkc-lower-alnum-cjkbigram-alias-v2",
});
console.log("✓ deterministic encoding + fixed manifest (deterministic-local-v2)");

// 4. v2 latin 词元修正（v1 缺陷：标点/连字符胶合、单字符噪声）。
const hyphenated = encoder.tokenizeSemantic("enable two-factor authentication");
["two-factor", "two", "factor", "authentication"].forEach((token) => {
  assert.ok(hyphenated.includes(token), `v2 splits hyphenated compounds: missing ${token}`);
});
const punctuated = encoder.tokenizeSemantic("system appearance.");
assert.ok(punctuated.includes("appearance"), "v2 strips trailing punctuation");
assert.ok(!punctuated.includes("appearance."), "glued punctuation token is gone");
const stopwordNoise = encoder.tokenizeSemantic("a I to export data");
assert.ok(!stopwordNoise.includes("a") && !stopwordNoise.includes("i"), "v2 drops single-char stopword noise");
assert.ok(stopwordNoise.includes("export") && stopwordNoise.includes("data"), "meaningful tokens kept");
assert.ok(encoder.tokenizeSemantic("arm64 build v2").includes("v2"), "digit-bearing short tokens kept");
console.log("✓ v2 latin tokenization: hyphen split / punctuation strip / stopword drop");

console.log("\ntest-agent-rag-encoder-single-source: PASS");
