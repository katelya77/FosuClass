#!/usr/bin/env node
// P4b：Tool 发布适配器专项（tasks.md P4b「Tool 域」验收）。
//   - 声明式校验：未知工具/模式加宽/非白名单字段/重复 id 一律拒绝；
//   - 发布前测试拒绝「全量禁用」（确定性路径必须有工具兜底）；
//   - overlay 只作用于五因子交集的 runtimeToolIds 因子，且只能收窄：
//     禁用即从可用集消失；模式收窄按 runtimeMode 过滤；manifest∩skill 因子
//     仍然生效（overlay 永远无法复活/新增工具）；
//   - 组合级闭环：发布 → 新快照绑定 → 在途旧快照不变 → rollback 恢复。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createToolPublicationAdapter } = require("../packages/tool-runtime");
const { createToolRuntime } = require("../packages/tool-runtime");
const { AgentKernel } = require("../server/src/services/ai/agentKernel");

const STATIC_TOOLS = [
  { id: "get_teaching_week", runtimeModes: [], safety: { operation: "read" } },
  { id: "search_campus_place", runtimeModes: ["public", "trial"], safety: { operation: "read" } },
  { id: "create_course_reminder", runtimeModes: ["trial", "dev"], safety: { operation: "write", requiresConfirmation: true } },
];

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tool-publication-${label}-`));
}

function createAdapter() {
  return createToolPublicationAdapter({
    staticTools: STATIC_TOOLS.map((tool) => ({ id: tool.id, runtimeModes: tool.runtimeModes })),
  });
}

function testValidation() {
  const adapter = createAdapter();
  assert.strictEqual(adapter.validate(adapter.seedPayload()).ok, true, "empty overlay (seed) validates");

  const cases = [
    ["unknown tool id", { tools: [{ id: "drop_tables" }] }],
    ["mode widening beyond static set", { tools: [{ id: "search_campus_place", runtimeModes: ["public", "dev"] }] }],
    ["unknown runtime mode", { tools: [{ id: "get_teaching_week", runtimeModes: ["prod"] }] }],
    ["non-boolean enabled", { tools: [{ id: "get_teaching_week", enabled: "yes" }] }],
    ["duplicate id", { tools: [{ id: "get_teaching_week" }, { id: "get_teaching_week", enabled: false }] }],
    ["non-declarative entry field", { tools: [{ id: "get_teaching_week", execute: "evil" }] }],
    ["safety tamper field", { tools: [{ id: "create_course_reminder", safety: { operation: "read" } }] }],
    ["non-declarative top field", { tools: [], backdoor: true }],
    ["invalid id shape", { tools: [{ id: "DROP TABLES;--" }] }],
    // P4b 审查 Important #1 回归：空数组在下游「!modes.length = 全模式」语义下
    // 会把静态受限工具加宽到全模式；空数组必须拒绝（省略 = 继承静态）。
    ["empty runtimeModes would widen static-restricted tool", { tools: [{ id: "search_campus_place", runtimeModes: [] }] }],
    ["empty runtimeModes on all-modes tool", { tools: [{ id: "get_teaching_week", runtimeModes: [] }] }],
  ];
  cases.forEach(([name, payload]) => {
    const report = adapter.validate(payload);
    assert.strictEqual(report.ok, false, `must reject: ${name}`);
    assert.ok(report.errors.length > 0, `must report errors: ${name}`);
  });

  // 静态空集（= 全模式）：允许三元组任意子集
  const narrowed = adapter.validate({ tools: [{ id: "get_teaching_week", runtimeModes: ["trial"] }] });
  assert.strictEqual(narrowed.ok, true, `narrowing within all-modes static set must pass: ${narrowed.errors}`);
  console.log("✓ declarative validation: unknown/widening/tampering all rejected");
}

function testPrePublishGuard() {
  const adapter = createAdapter();
  const disableAll = adapter.validate({
    tools: STATIC_TOOLS.map((tool) => ({ id: tool.id, enabled: false })),
  }).normalized;
  const report = adapter.test(disableAll);
  assert.strictEqual(report.ok, false, "pre-publish test must reject disabling every static tool");
  const disableSome = adapter.validate({ tools: [{ id: "search_campus_place", enabled: false }] }).normalized;
  assert.strictEqual(adapter.test(disableSome).ok, true, "partial disable is allowed");
  console.log("✓ pre-publish test rejects full disable, allows partial disable");
}

function buildKernel(overlay) {
  const toolRuntime = createToolRuntime({
    tools: STATIC_TOOLS.map((tool) => Object.assign({}, tool, {
      execute: async () => ({ ok: true }),
    })),
  });
  const capabilityManifestService = {
    getIntent: () => ({ allowedTools: STATIC_TOOLS.map((tool) => tool.id) }),
  };
  const kernel = new AgentKernel({
    skillRegistry: { getSkillForIntent: () => null },
    intentResolver: () => ({ name: "noop", slots: {} }),
    toolExecutor: async () => ({ ok: true }),
    toolRuntime,
    capabilityManifestService,
  });
  const skill = { id: "all_tools", allowedTools: STATIC_TOOLS.map((tool) => tool.id) };
  return { kernel, skill };
}

function testFiveFactorIntegration() {
  const adapter = createAdapter();

  // 无 overlay：runtimeMode 过滤按静态描述符（public 下 create_course_reminder 不可见）
  const baseline = buildKernel(null);
  const publicBaseline = baseline.kernel.resolveAllowedToolIds(
    { name: "noop" }, baseline.skill, "public", STATIC_TOOLS.map((tool) => tool.id), {}
  );
  assert.deepStrictEqual([...publicBaseline].sort(), ["get_teaching_week", "search_campus_place"], "static mode filter baseline");
  const trialBaseline = baseline.kernel.resolveAllowedToolIds(
    { name: "noop" }, baseline.skill, "trial", STATIC_TOOLS.map((tool) => tool.id), {}
  );
  assert.strictEqual(trialBaseline.length, 3, "trial sees all three tools statically");

  // overlay 禁用 search_campus_place + 收窄 get_teaching_week 到 trial
  const overlay = adapter.resolveRuntime({
    payload: {
      tools: [
        { id: "search_campus_place", enabled: false },
        { id: "get_teaching_week", runtimeModes: ["trial"] },
      ],
    },
  });
  const { kernel, skill } = buildKernel(overlay);
  const context = { toolOverlay: overlay };
  const publicWithOverlay = kernel.resolveAllowedToolIds(
    { name: "noop" }, skill, "public", STATIC_TOOLS.map((tool) => tool.id), context
  );
  assert.deepStrictEqual(publicWithOverlay, [], "disabled tool removed; mode-narrowed tool filtered for public");
  const trialWithOverlay = kernel.resolveAllowedToolIds(
    { name: "noop" }, skill, "trial", STATIC_TOOLS.map((tool) => tool.id), context
  );
  assert.deepStrictEqual([...trialWithOverlay].sort(), ["create_course_reminder", "get_teaching_week"],
    "trial keeps narrowed tool; disabled tool stays removed");

  // overlay 无法复活/新增：manifest/skill 因子之外的工具永远进不了交集
  const hostile = { disabled: [], modeOverrides: { drop_tables: ["public", "trial", "dev"] } };
  const withHostile = kernel.resolveAllowedToolIds(
    { name: "noop" }, skill, "trial", STATIC_TOOLS.map((tool) => tool.id), { toolOverlay: hostile }
  );
  assert.ok(!withHostile.includes("drop_tables"), "overlay can never introduce unknown tools");
  assert.strictEqual(withHostile.length, 3, "empty overlay keeps the static baseline");
  console.log("✓ five-factor intersection: overlay only narrows runtimeToolIds; manifest/skill factors still gate");
}

async function testCompositionRoundtrip() {
  const root = tmpRoot("compose");
  process.env.FOSU_AGENT_CONFIG_KERNEL_PATH = root;
  const composition = require("../server/src/services/ai/platformComposition");
  // P5a：require 期不再种子，先 await init（file 模式 = 幂等种子）。
  await composition.platformReady();
  const kernel = composition.getConfigKernel();

  const snapshotV1 = await kernel.getCurrentSnapshot("trial");
  const baselineOverlay = await composition.resolveToolOverlayForSnapshot(snapshotV1);
  assert.deepStrictEqual(baselineOverlay, { disabled: [], modeOverrides: {} }, "seed overlay = static defaults");

  // 挑一个真实插件工具验证组合级闭环（静态描述符集由 platformToolRuntime 注入）
  const realToolId = "get_teaching_week";
  const draftInput = {
    domain: "tool",
    artifactId: "fosu-campus",
    environment: "trial",
    payload: { tools: [{ id: realToolId, enabled: false }] },
    actor: "p4b-test",
  };
  await kernel.saveDraft(draftInput);
  const validation = await kernel.validateDraft(draftInput);
  assert.strictEqual(validation.ok, true, `real tool overlay validates: ${validation.errors}`);
  assert.strictEqual((await kernel.testDraft(draftInput)).ok, true);
  await kernel.publishDraft(draftInput);

  const snapshotV2 = await kernel.getCurrentSnapshot("trial");
  const bound = await composition.resolveToolOverlayForSnapshot(snapshotV2);
  assert.deepStrictEqual(bound.disabled, [realToolId], "new snapshot binds the published disable");

  const inFlight = await composition.resolveToolOverlayForSnapshot(snapshotV1);
  assert.deepStrictEqual(inFlight, { disabled: [], modeOverrides: {} }, "in-flight snapshot unaffected");

  await kernel.rollback({ domain: "tool", artifactId: "fosu-campus", environment: "trial", toVersion: 1, actor: "p4b-test" });
  const restored = await composition.resolveToolOverlayForSnapshot(await kernel.getCurrentSnapshot("trial"));
  assert.deepStrictEqual(restored, { disabled: [], modeOverrides: {} }, "rollback restores static defaults");
  console.log("✓ composition roundtrip: publish → snapshot binding → in-flight stability → rollback");
}

(async () => {
  testValidation();
  testPrePublishGuard();
  testFiveFactorIntegration();
  await testCompositionRoundtrip();
  console.log("\ntest-agent-tool-publication: PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
