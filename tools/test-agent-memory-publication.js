#!/usr/bin/env node
// P4b：Memory 策略发布适配器专项（tasks.md P4b「Memory 域」验收）。
//   - 声明式校验：非白名单字段/未知 TTL 键/越界数值/内容载体一律拒绝；
//   - 发布前测试：termScopeTtlMs 不得短于 pendingTtlMs；
//   - 策略真实生效：minConfidence 改变自动持久化门槛、ttlOverridesMs 改变
//     过期时间、maxRetrieve 改变检索上限（server 侧 memory 模块真实消费）；
//   - 快照绑定隔离：发布只影响新快照；在途 Run 持有的旧快照策略不变；
//   - 策略接口不携带用户记忆内容（描述符只含有界数值）。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createMemoryPolicyPublicationAdapter } = require("../packages/agent-runtime");
const memoryPolicy = require("../server/src/services/ai/memory/memoryPolicy");
const { retrieveUserMemories } = require("../server/src/services/ai/memory/memoryRetriever");

const KNOWN_KEYS = Object.keys(memoryPolicy.DEFAULT_TTL_MS);

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `memory-publication-${label}-`));
}

function createAdapter() {
  return createMemoryPolicyPublicationAdapter({ knownTtlKeys: KNOWN_KEYS });
}

function testValidation() {
  const adapter = createAdapter();
  assert.strictEqual(adapter.validate(adapter.seedPayload()).ok, true, "empty policy (seed) validates");

  const cases = [
    ["unknown ttl key", { ttlOverridesMs: { not_a_memory_key: 7200000 } }],
    ["ttl below floor", { ttlOverridesMs: { campus: 1000 } }],
    ["ttl above ceiling", { ttlOverridesMs: { campus: 99999999999999 } }],
    ["minConfidence out of range", { minConfidence: 1.5 }],
    ["pendingTtlMs below floor", { pendingTtlMs: 1000 }],
    ["termScopeTtlMs above ceiling", { termScopeTtlMs: 99999999999999 }],
    ["maxRetrieve out of range", { maxRetrieve: 100 }],
    ["maxRetrieve non-integer", { maxRetrieve: 2.5 }],
    ["content carrier field", { memoryContent: "用户记忆原文" }],
    ["memories array carrier", { memories: [{ text: "x" }] }],
    ["bad key shape", { ttlOverridesMs: { "DROP;--": 7200000 } }],
  ];
  cases.forEach(([name, payload]) => {
    const report = adapter.validate(payload);
    assert.strictEqual(report.ok, false, `must reject: ${name}`);
    assert.ok(report.errors.length > 0, `must report errors: ${name}`);
  });

  const ok = adapter.validate({
    ttlOverridesMs: { campus: 7200000, working_entity: 3600000 },
    minConfidence: 0.9,
    pendingTtlMs: 3600000,
    termScopeTtlMs: 86400000,
    maxRetrieve: 3,
  });
  assert.strictEqual(ok.ok, true, `valid policy must pass: ${ok.errors}`);
  console.log("✓ declarative validation: unknown/unbounded/content-carrier all rejected");
}

function testPrePublishGuard() {
  const adapter = createAdapter();
  const inverted = adapter.validate({ pendingTtlMs: 604800000, termScopeTtlMs: 86400000 }).normalized;
  const report = adapter.test(inverted);
  assert.strictEqual(report.ok, false, "term-scope TTL shorter than pending TTL must fail pre-publish test");
  const sane = adapter.validate({ pendingTtlMs: 3600000, termScopeTtlMs: 86400000 }).normalized;
  assert.strictEqual(adapter.test(sane).ok, true, "sane ordering passes");
  console.log("✓ pre-publish test enforces termScope >= pending TTL ordering");
}

function testPolicyActuallyApplies() {
  const policy = {
    minConfidence: 0.95,
    ttlOverridesMs: { campus: 3600000 },
    maxRetrieve: 1,
  };

  // minConfidence：0.9 置信候选在默认门槛可通过，在发布策略下被拒绝
  const candidate = { key: "campus", confidence: 0.9, scope: "user" };
  assert.strictEqual(memoryPolicy.mayAutoPersistUserMemory("cloud_sync", candidate, null), true,
    "default threshold admits the candidate");
  assert.strictEqual(memoryPolicy.mayAutoPersistUserMemory("cloud_sync", candidate, policy), false,
    "published minConfidence rejects the same candidate");

  // ttlOverridesMs：campus 默认 90 天，发布策略压到 1 小时
  const defaultTtl = memoryPolicy.resolveTtlMs({ key: "campus" }, null);
  const overrideTtl = memoryPolicy.resolveTtlMs({ key: "campus" }, policy);
  assert.strictEqual(overrideTtl, 3600000, "ttl override applies");
  assert.ok(defaultTtl > overrideTtl, "default TTL is longer than the override");
  // 未覆盖的键不受策略影响
  assert.strictEqual(
    memoryPolicy.resolveTtlMs({ key: "college" }, policy),
    memoryPolicy.resolveTtlMs({ key: "college" }, null),
    "non-overridden keys keep static defaults"
  );

  // maxRetrieve：检索上限被策略收窄（limit 参数显式缺省 → 策略接管）
  const items = [
    { key: "campus", value: "江湾", confidence: 0.99, updatedAt: new Date().toISOString() },
    { key: "college", value: "计算机学院", confidence: 0.98, updatedAt: new Date().toISOString() },
  ];
  const baseline = retrieveUserMemories(items, { message: "校区" }, 5, null);
  const narrowed = retrieveUserMemories(items, { message: "校区" }, 5, policy);
  assert.ok(narrowed.length <= 1, `maxRetrieve=1 caps retrieval (got ${narrowed.length})`);
  assert.ok(baseline.length >= narrowed.length, "baseline retrieves at least as many");
  console.log("✓ published policy actually changes persistence threshold / TTL / retrieval cap");
}

function testSnapshotBindingIsolation() {
  const root = tmpRoot("compose");
  process.env.FOSU_AGENT_CONFIG_KERNEL_PATH = root;
  const composition = require("../server/src/services/ai/platformComposition");
  const kernel = composition.getConfigKernel();

  // 种子：空策略（≡ P4b 前行为）
  const snapshotV1 = kernel.getCurrentSnapshot("trial");
  assert.deepStrictEqual(composition.resolveMemoryPolicyForSnapshot(snapshotV1), {},
    "seed snapshot resolves to empty policy (static defaults)");

  // 发布 v2：minConfidence 0.95 + campus TTL 1 小时
  const draftInput = {
    domain: "memory",
    artifactId: "fosu-campus",
    environment: "trial",
    payload: { minConfidence: 0.95, ttlOverridesMs: { campus: 3600000 } },
    actor: "p4b-test",
  };
  kernel.saveDraft(draftInput);
  const validation = kernel.validateDraft(draftInput);
  assert.strictEqual(validation.ok, true, `policy draft validates: ${validation.errors}`);
  assert.strictEqual(kernel.testDraft(draftInput).ok, true);
  kernel.publishDraft(draftInput);

  const snapshotV2 = kernel.getCurrentSnapshot("trial");
  const boundPolicy = composition.resolveMemoryPolicyForSnapshot(snapshotV2);
  assert.strictEqual(boundPolicy.minConfidence, 0.95, "new snapshot binds the published policy");
  assert.deepStrictEqual(boundPolicy.ttlOverridesMs, { campus: 3600000 });

  // 在途 Run：v1 快照仍解析空策略（发布不影响在途）——同一进程两次解析互不影响
  const inFlightPolicy = composition.resolveMemoryPolicyForSnapshot(snapshotV1);
  assert.deepStrictEqual(inFlightPolicy, {}, "in-flight snapshot keeps static defaults");
  const candidate = { key: "campus", confidence: 0.9, scope: "user" };
  assert.strictEqual(memoryPolicy.mayAutoPersistUserMemory("cloud_sync", candidate, inFlightPolicy), true,
    "in-flight run behavior unchanged");
  assert.strictEqual(memoryPolicy.mayAutoPersistUserMemory("cloud_sync", candidate, boundPolicy), false,
    "new run behavior follows the published policy");

  // rollback：新快照回到空策略
  kernel.rollback({ domain: "memory", artifactId: "fosu-campus", environment: "trial", toVersion: 1, actor: "p4b-test" });
  assert.deepStrictEqual(
    composition.resolveMemoryPolicyForSnapshot(kernel.getCurrentSnapshot("trial")),
    {},
    "rollback restores static defaults"
  );
  console.log("✓ snapshot binding isolation: publish → new-run policy → in-flight stability → rollback");
}

testValidation();
testPrePublishGuard();
testPolicyActuallyApplies();
testSnapshotBindingIsolation();
console.log("\ntest-agent-memory-publication: PASS");
