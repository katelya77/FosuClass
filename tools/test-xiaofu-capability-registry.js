/* 小佛助手能力注册表 / Action Bus 接线 / 设计令牌 一致性测试 */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// ── 1. 生成物 ↔ manifest 单一事实源一致 ────────────────────────────────
const manifest = require(path.join(ROOT, "server", "config", "agent-capability-manifest.json"));
const generated = require(path.join(ROOT, "miniprogram", "shared", "aiCapabilityRegistry.generated.js"));

assert.ok(manifest.miniprogram, "manifest.miniprogram 段必须存在");
assert.ok(Array.isArray(manifest.miniprogram.capabilities), "manifest.miniprogram.capabilities 必须是数组");
assert.ok(manifest.miniprogram.capabilities.length >= 30, "能力条目不应少于迁移前的 30 条");

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(generated.AI_CAPABILITY_REGISTRY)),
  JSON.parse(JSON.stringify(manifest.miniprogram.capabilities)),
  "生成物注册表必须与 manifest.miniprogram.capabilities 完全一致（禁止手工漂移）"
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(generated.CAPABILITY_KINDS)),
  JSON.parse(JSON.stringify(manifest.miniprogram.capabilityKinds)),
  "生成物 CAPABILITY_KINDS 必须与 manifest 一致"
);
assert.strictEqual(
  generated.QUICK_ACTIONS.length,
  manifest.miniprogram.quickActions.length,
  "QUICK_ACTIONS 数量必须与 manifest 一致"
);
for (const quick of generated.QUICK_ACTIONS) {
  assert.ok(quick.abilityId, "快捷动作必须带 abilityId");
  assert.ok(generated.AI_CAPABILITY_BY_ID[quick.abilityId], `快捷动作引用的能力 ${quick.abilityId} 必须存在`);
}
const ids = manifest.miniprogram.capabilities.map((c) => c.id);
assert.strictEqual(new Set(ids).size, ids.length, "能力 id 不允许重复");

// ── 2. 页面侧接线断言：注册表 require 生成物，禁止内联副本 ──────────────
const pageSrc = fs.readFileSync(
  path.join(ROOT, "miniprogram", "packageXiaofu", "pages", "ai-assistant", "ai-assistant.js"),
  "utf8"
);
assert.ok(
  pageSrc.includes('require("../../../shared/aiCapabilityRegistry.generated.js")'),
  "页面必须从生成物引入能力注册表"
);
assert.ok(
  !pageSrc.includes("const AI_CAPABILITY_REGISTRY = ["),
  "页面禁止保留内联的能力注册表副本"
);
assert.ok(
  !pageSrc.includes("const CAPABILITY_KINDS = {"),
  "页面禁止保留内联的 CAPABILITY_KINDS 副本"
);

// ── 3. Action Bus 接线断言 ─────────────────────────────────────────────
assert.ok(pageSrc.includes('require("../../services/xiaofuActionBus")'), "页面必须引入 Action Bus");
assert.ok(pageSrc.includes("getXiaofuActionBus"), "页面必须实现 getXiaofuActionBus");
assert.ok(pageSrc.includes("tryExecuteCardActionViaBus"), "页面必须实现 tryExecuteCardActionViaBus");
assert.ok(
  /performCardAction\(action, context\) \{[\s\S]{0,600}tryExecuteCardActionViaBus/.test(pageSrc),
  "performCardAction 必须先尝试 Action Bus 再回落既有逻辑"
);

// bus 行为级冒烟：映射 + 白名单校验
const { createActionBus } = require(path.join(ROOT, "miniprogram", "packageXiaofu", "services", "xiaofuActionBus.js"));
const opened = [];
const bus = createActionBus({
  context: {
    openSheet: (sheet) => opened.push(sheet),
    fillComposer: () => {},
    fillForm: () => {},
    confirmWrite: () => {},
    retry: () => {},
    resolveSubscribeTemplateIds: () => [],
  },
});
assert.strictEqual(bus.resolveCardAction("confirmReminder"), "confirmWrite", "confirmReminder 必须映射 confirmWrite");
assert.strictEqual(bus.resolveCardAction("ask"), null, "ask 不允许映射为可执行命令");
const sheetResult = bus.execute(
  { command: "openSheet", input: { sheet: "memory" } },
  { runtimeMode: "public" }
);
assert.ok(sheetResult && sheetResult.executed, "合法 openSheet 必须执行成功");
assert.deepStrictEqual(opened, ["memory"], "openSheet 必须调用页面 context");
const badNav = bus.execute(
  { command: "navigate", input: { url: "https://evil.example.com/phish" } },
  { runtimeMode: "public" }
);
assert.ok(!badNav.executed, "白名单外的跳转必须被拒绝");

// ── 4. 设计令牌断言 ────────────────────────────────────────────────────
const tokensPath = path.join(ROOT, "miniprogram", "packageXiaofu", "styles", "xiaofu-tokens.wxss");
assert.ok(fs.existsSync(tokensPath), "设计令牌文件必须存在");
const tokensSrc = fs.readFileSync(tokensPath, "utf8");
for (const token of [
  "--xf-surface:",
  "--xf-surface-soft:",
  "--xf-primary:",
  "--xf-text:",
  "--xf-text-secondary:",
  "--xf-primary-strong:",
  "--xf-success-strong:",
  "--xf-bg:",
]) {
  assert.ok(tokensSrc.includes(token), `设计令牌缺少 ${token}`);
}
const wxssSrc = fs.readFileSync(
  path.join(ROOT, "miniprogram", "packageXiaofu", "pages", "ai-assistant", "ai-assistant.wxss"),
  "utf8"
);
assert.ok(
  wxssSrc.includes('@import "../../styles/xiaofu-tokens.wxss";'),
  "页面样式必须引入设计令牌文件"
);
assert.ok(wxssSrc.includes("var(--xf-primary-strong)"), "页面样式必须使用设计令牌变量");
assert.ok(!wxssSrc.includes("--xf-color-"), "页面样式禁止残留已废弃的 --xf-color- 变量名");
assert.ok(!/#c62828(?![0-9a-fA-F])/i.test(wxssSrc), "页面样式禁止残留主色裸值 #c62828");
assert.ok(!/#f3f0eb(?![0-9a-fA-F])/i.test(wxssSrc), "页面样式禁止残留背景裸值 #f3f0eb");

console.log("test-xiaofu-capability-registry passed");
