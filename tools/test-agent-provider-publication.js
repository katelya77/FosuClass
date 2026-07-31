#!/usr/bin/env node
// P4b：Provider 发布适配器专项（tasks.md P4b「Provider 域」验收）。
//   - 声明式校验：未知 Provider/越界预算/非法 URL/非白名单字段一律拒绝；
//   - 密钥永远不进 Artifact：任意深度的 key/token/secret 字段拒绝；
//   - deterministic 策略不可发布（保留给 public 硬护栏）；
//   - overlayToRuntimeConfig 只映射白名单 AI_* 键，永不产生密钥键；
//   - public 硬护栏最后应用：任何 overlay 合并结果在 public 环境仍 mock/tool-only；
//   - 组合级闭环：发布 → 新快照绑定 → 在途旧快照不变 → rollback 恢复。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createProviderPublicationAdapter, overlayToRuntimeConfig } = require("../packages/provider-runtime");
const { applyProviderHardGuards } = require("../server/src/services/ai/runtime/fosuTurnPorts");

const KNOWN = ["deepseek", "coze", "cloudbase-openai", "mock"];

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `provider-publication-${label}-`));
}

function testValidation() {
  const adapter = createProviderPublicationAdapter({ knownProviderIds: KNOWN });
  assert.strictEqual(adapter.validate(adapter.seedPayload()).ok, true, "empty overlay (seed) validates");

  const cases = [
    ["unknown provider in chain", { providerChain: ["not_a_provider"] }],
    ["chain too long", { providerChain: ["deepseek", "coze", "cloudbase-openai", "mock", "deepseek"] }],
    ["empty chain", { providerChain: [] }],
    ["unknown stage", { stageProviders: { understanding: "deepseek" } }],
    ["unknown stage provider", { stageProviders: { decision: "made_up" } }],
    ["timeout below floor", { timeoutMs: 500 }],
    ["timeout above ceiling", { timeoutMs: 60000 }],
    ["maxTokens out of range", { maxTokens: 16384 }],
    ["temperature out of range", { temperature: 5 }],
    ["http baseUrl", { baseUrlOverrides: { deepseek: "http://api.example.com" } }],
    ["ip literal baseUrl", { baseUrlOverrides: { deepseek: "https://127.0.0.1:8443/v1" } }],
    ["localhost baseUrl", { baseUrlOverrides: { deepseek: "https://localhost/v1" } }],
    ["non-overridable provider baseUrl", { baseUrlOverrides: { coze: "https://api.example.com" } }],
    ["deterministic policy not publishable", { executionPolicy: "deterministic" }],
    ["unknown policy", { executionPolicy: "yolo" }],
    ["non-declarative field", { adminBackdoor: true }],
    ["secret at top level", { apiKey: "sk-test" }],
    ["secret nested in stageProviders", { stageProviders: { decision: "deepseek", token: "x" } }],
    ["secret nested in baseUrlOverrides", { baseUrlOverrides: { deepseek: "https://api.example.com", password: "x" } }],
    ["model with whitespace", { model: "gpt 4o" }],
  ];
  cases.forEach(([name, payload]) => {
    const report = adapter.validate(payload);
    assert.strictEqual(report.ok, false, `must reject: ${name}`);
    assert.ok(report.errors.length > 0, `must report errors: ${name}`);
  });

  const ok = adapter.validate({
    providerChain: ["deepseek", "mock"],
    stageProviders: { decision: "deepseek", response: "coze" },
    model: "deepseek-chat",
    timeoutMs: 8000,
    maxTokens: 2048,
    temperature: 0.3,
    executionPolicy: "strict_model_first",
    baseUrlOverrides: { deepseek: "https://api.deepseek.com" },
  });
  assert.strictEqual(ok.ok, true, `valid overlay must pass: ${ok.errors}`);
  console.log("✓ declarative validation: unknown/out-of-range/secret/deterministic all rejected");
}

function testOverlayMapping() {
  const updates = overlayToRuntimeConfig({
    providerChain: ["deepseek", "mock"],
    stageProviders: { decision: "deepseek", planner: "coze", response: "cloudbase-openai" },
    model: "deepseek-chat",
    reasoningModel: "deepseek-reasoner",
    timeoutMs: 8000,
    maxTokens: 2048,
    temperature: 0.3,
    executionPolicy: "adaptive",
    baseUrlOverrides: { deepseek: "https://api.deepseek.com", "cloudbase-openai": "https://openapi.example.com" },
  });
  assert.strictEqual(updates.AI_PROVIDER_CHAIN, "deepseek,mock");
  assert.strictEqual(updates.AI_DECISION_PROVIDER, "deepseek");
  assert.strictEqual(updates.AI_UNDERSTANDING_PROVIDER, "deepseek", "decision stage also maps understanding alias");
  assert.strictEqual(updates.AI_PLANNER_PROVIDER, "coze");
  assert.strictEqual(updates.AI_RESPONSE_PROVIDER, "cloudbase-openai");
  assert.strictEqual(updates.AI_MODEL, "deepseek-chat");
  assert.strictEqual(updates.AI_REASONING_MODEL, "deepseek-reasoner");
  assert.strictEqual(updates.AI_TIMEOUT_MS, "8000");
  assert.strictEqual(updates.AI_MAX_TOKENS, "2048");
  assert.strictEqual(updates.AI_TEMPERATURE, "0.3");
  assert.strictEqual(updates.AI_EXECUTION_POLICY, "adaptive");
  assert.strictEqual(updates.AI_BASE_URL, "https://api.deepseek.com");
  assert.strictEqual(updates.CLOUDBASE_OPENAI_BASE_URL, "https://openapi.example.com");
  // 密钥键永不出现：映射输出键集合必须是固定白名单（白名单由人工审定，
  // 不含任何密钥载体；AI_MAX_TOKENS 等合法字段不算密钥）。
  const ALLOWED_KEYS = new Set([
    "AI_PROVIDER_CHAIN", "AI_DECISION_PROVIDER", "AI_UNDERSTANDING_PROVIDER",
    "AI_PLANNER_PROVIDER", "AI_RESPONSE_PROVIDER", "AI_MODEL", "AI_REASONING_MODEL",
    "AI_TIMEOUT_MS", "AI_MAX_TOKENS", "AI_TEMPERATURE", "AI_EXECUTION_POLICY",
    "AI_BASE_URL", "CLOUDBASE_OPENAI_BASE_URL",
  ]);
  Object.keys(updates).forEach((key) => {
    assert.ok(ALLOWED_KEYS.has(key), `overlay mapping must never emit non-whitelisted key: ${key}`);
  });
  assert.deepStrictEqual(overlayToRuntimeConfig({}), {}, "empty overlay maps to no updates");
  assert.deepStrictEqual(overlayToRuntimeConfig(null), {}, "null overlay maps to no updates");
  console.log("✓ overlayToRuntimeConfig maps only whitelisted AI_* keys (never secrets)");
}

function testPublicHardGuard() {
  // 即使 overlay 合并出敌意配置（模拟发布物+基础配置合并的最坏结果），
  // public 环境最后应用的硬护栏仍强制 mock/tool-only（外部调用恒 0 的运行时保证）。
  const hostile = {
    AI_AGENT_ENABLED: "true",
    AI_PROVIDER: "deepseek",
    AI_PROVIDER_POLICY: "always",
    AI_PROVIDER_CHAIN: "deepseek,mock",
    AI_RUNTIME_MODE: "trial",
    AI_EXECUTION_POLICY: "strict_model_first",
  };
  const guarded = applyProviderHardGuards(hostile, "public");
  assert.strictEqual(guarded.AI_AGENT_ENABLED, "false");
  assert.strictEqual(guarded.AI_PROVIDER, "mock");
  assert.strictEqual(guarded.AI_PROVIDER_POLICY, "tool-only");
  assert.strictEqual(guarded.AI_RUNTIME_MODE, "public");

  const trialConfig = applyProviderHardGuards(hostile, "trial");
  assert.strictEqual(trialConfig, hostile, "non-public environments are untouched by the guard");
  console.log("✓ public hard guard re-applied after overlay merge; non-public untouched");
}

function testCompositionRoundtrip() {
  const root = tmpRoot("compose");
  process.env.FOSU_AGENT_CONFIG_KERNEL_PATH = root;
  const composition = require("../server/src/services/ai/platformComposition");
  const kernel = composition.getConfigKernel();

  // 种子：空 overlay（≡ P4b 前行为）
  const snapshotV1 = kernel.getCurrentSnapshot("trial");
  const overlayV1 = composition.resolveProviderOverlayForSnapshot(snapshotV1);
  assert.deepStrictEqual(overlayV1, {}, "seed snapshot resolves to empty overlay");

  // 发布 v2：trial 环境换链
  const draftInput = {
    domain: "provider",
    artifactId: "fosu-campus",
    environment: "trial",
    payload: { providerChain: ["deepseek", "mock"], timeoutMs: 9000 },
    actor: "p4b-test",
  };
  kernel.saveDraft(draftInput);
  assert.strictEqual(kernel.validateDraft(draftInput).ok, true);
  assert.strictEqual(kernel.testDraft(draftInput).ok, true);
  kernel.publishDraft(draftInput);
  const snapshotV2 = kernel.getCurrentSnapshot("trial");
  const overlayV2 = composition.resolveProviderOverlayForSnapshot(snapshotV2);
  assert.deepStrictEqual(overlayV2.providerChain, ["deepseek", "mock"], "new snapshot binds the published overlay");
  assert.strictEqual(overlayV2.timeoutMs, 9000);

  // 在途 Run 持有的 v1 快照仍解析空 overlay（发布不影响在途）
  const inFlight = composition.resolveProviderOverlayForSnapshot(snapshotV1);
  assert.deepStrictEqual(inFlight, {}, "in-flight snapshot keeps the pre-publish overlay");

  // rollback：新快照回到空 overlay
  kernel.rollback({ domain: "provider", artifactId: "fosu-campus", environment: "trial", toVersion: 1, actor: "p4b-test" });
  const snapshotV3 = kernel.getCurrentSnapshot("trial");
  assert.deepStrictEqual(composition.resolveProviderOverlayForSnapshot(snapshotV3), {}, "rollback restores the seed overlay");

  // public 环境种子解析同样为空 overlay（public 保护由运行时硬护栏兜底）
  assert.deepStrictEqual(
    composition.resolveProviderOverlayForSnapshot(kernel.getCurrentSnapshot("public")),
    {},
    "public seed overlay is empty"
  );
  console.log("✓ composition roundtrip: publish → snapshot binding → in-flight stability → rollback");
}

testValidation();
testOverlayMapping();
testPublicHardGuard();
testCompositionRoundtrip();
console.log("\ntest-agent-provider-publication: PASS");
