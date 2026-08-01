#!/usr/bin/env node
// W5：通用 UI Block → 展示模型适配器测试。
// 覆盖：12 种通用 Block 的展示投影、未知类型安全降级、deriveBlocks 优先级、
// 声明式 Skill 零页面改动可渲染、通用层纯度（无业务硬编码）、零编造字段。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const adapter = require("../miniprogram/packageXiaofu/services/uiBlockAdapter");
const AGENT_SDK = require("../miniprogram/shared/agentSdk.generated.js");

let checks = 0;
function ok(cond, msg) { checks += 1; assert(cond, msg); }
function eq(actual, expected, msg) { checks += 1; assert.strictEqual(actual, expected, msg); }
function deepEq(actual, expected, msg) { checks += 1; assert.deepStrictEqual(actual, expected, msg); }

// 1. 全部 12 种 Block 类型映射到预期展示投影
function testAllBlockTypes() {
  const display = adapter.mapBlocksToDisplay([
    { type: "text", text: "第一段回答" },
    { type: "markdown", markdown: "# 标题\n\n- 要点" },
    { type: "plan", title: "执行计划", steps: [{ label: "查询数据", status: "done" }, { label: "汇总结果", status: "running" }] },
    { type: "tool_progress", toolId: "search_tool", status: "running", label: "正在检索" },
    { type: "list", title: "通用列表", items: [
      { title: "条目一", subtitle: "副标题一", value: "详情一", url: "/pages/index/index" },
      { title: "条目二" },
    ] },
    { type: "detail", title: "详情卡", fields: [{ label: "名称", value: "示例值" }] },
    { type: "schedule", title: "通用日程", entries: [
      { title: "晨会", subtitle: "全员参加", start: "09:00", end: "09:30", location: "会议室" },
    ] },
    { type: "clarification", prompt: "要查询哪一天？", options: [{ label: "今天", value: "today" }, { label: "明天", value: "tomorrow" }] },
    { type: "confirmation", title: "确认操作", prompt: "确认提交该操作？", confirmLabel: "确认提交" },
    { type: "action_receipt", command: "reminder.create", status: "done", title: "提醒已创建" },
    { type: "warning", message: "数据可能不是最新", code: "STALE" },
    { type: "error", message: "服务调用失败", code: "UPSTREAM", retryable: true },
  ]);

  // text / markdown → 拼接进 text，markdown 内部结构原样保留
  ok(display.text.indexOf("第一段回答") >= 0, "text block 应进入 text");
  ok(display.text.indexOf("# 标题\n\n- 要点") >= 0, "markdown 应原样保留换行结构");

  // plan → {steps, summary}
  ok(display.plan, "plan block 应产出 plan");
  eq(display.plan.steps.length, 2, "plan 应映射两个步骤");
  eq(display.plan.steps[0].label, "查询数据", "plan 步骤 label 保留");
  eq(display.plan.steps[0].status, "done", "plan 步骤 status 保留");
  eq(display.plan.summary, "执行计划", "plan summary 来自 title");

  // tool_progress → displaySteps 形状 {label, status, tool, durationMs}
  deepEq(display.steps[0], { label: "正在检索", status: "running", tool: "search_tool", durationMs: 0 },
    "tool_progress 应映射 displaySteps 形状");

  // list → 卡片，条目 {title, subtitle, description, url?}
  const listCard = display.cards.find((card) => card.type === "list");
  ok(listCard, "list block 应产出卡片");
  eq(listCard.typeClass, "generic", "卡片 typeClass 应为 generic");
  eq(listCard.title, "通用列表", "卡片 title 保留");
  deepEq(listCard.items[0], { title: "条目一", subtitle: "副标题一", description: "详情一", url: "/pages/index/index" },
    "list 条目应映射 title/subtitle/description/url");
  eq(listCard.items.length, 2, "list 两个条目都应保留");

  // detail → 卡片，fields → 条目 {title: label, description: value}
  const detailCard = display.cards.find((card) => card.type === "detail");
  ok(detailCard, "detail block 应产出卡片");
  deepEq(detailCard.items[0], { title: "名称", subtitle: "", description: "示例值" },
    "detail fields 应映射为通用条目");

  // schedule → 卡片，时间/地点通用映射进 description
  const scheduleCard = display.cards.find((card) => card.type === "schedule");
  ok(scheduleCard, "schedule block 应产出卡片");
  eq(scheduleCard.items[0].title, "晨会", "schedule 条目 title 保留");
  eq(scheduleCard.items[0].subtitle, "全员参加", "schedule 条目 subtitle 保留");
  ok(scheduleCard.items[0].description.indexOf("09:00-09:30") >= 0, "description 应含时间段");
  ok(scheduleCard.items[0].description.indexOf("会议室") >= 0, "description 应含地点");

  // clarification → clarification 对象 + clarification 卡片
  deepEq(display.clarification, {
    question: "要查询哪一天？",
    options: [{ label: "今天", value: "today" }, { label: "明天", value: "tomorrow" }],
  }, "clarification 应映射 question/options");
  const clarCard = display.cards.find((card) => card.type === "clarification");
  ok(clarCard, "clarification 应同时产出卡片");
  eq(clarCard.items.length, 2, "clarification 卡片应列出选项");

  // confirmation → confirmation 对象 + 带 confirm 动作的卡片
  eq(display.confirmation.title, "确认操作", "confirmation title 保留");
  eq(display.confirmation.description, "确认提交该操作？", "confirmation description 来自 prompt");
  deepEq(display.confirmation.confirmAction, { label: "确认提交", type: "confirm" },
    "confirmation 应带 confirm 动作");
  const confCard = display.cards.find((card) => card.type === "confirmation");
  ok(confCard && confCard.actions && confCard.actions[0].type === "confirm", "confirmation 卡片应含 confirm 动作");

  // action_receipt → receipts
  deepEq(display.receipts, [{ command: "reminder.create", status: "done", label: "提醒已创建" }],
    "action_receipt 应映射 receipts");

  // warning / error → variant 卡片 + 消息数组
  const warnCard = display.cards.find((card) => card.type === "warning");
  ok(warnCard && warnCard.variant === "warning", "warning 卡片应带 warning variant");
  deepEq(display.warnings, [{ message: "数据可能不是最新", code: "STALE" }], "warning 消息应入 warnings");
  const errCard = display.cards.find((card) => card.type === "error");
  ok(errCard && errCard.variant === "error", "error 卡片应带 error variant");
  deepEq(display.errors, [{ message: "服务调用失败", code: "UPSTREAM", retryable: true }], "error 消息应入 errors");

  eq(display.unknownCount, 0, "全部已知类型不应产生 unknownCount");
}

// 2. 未知类型 / 垃圾输入：安全降级 + 计数 + 不抛异常
function testUnknownAndGarbage() {
  const display = adapter.mapBlocksToDisplay([
    { type: "hologram", text: "全息投影内容" },
    null,
    "garbage string",
    { type: 123 },
  ]);
  eq(display.unknownCount, 4, "未知/非法 block 应全部计数");
  const fallback = display.cards.find((card) => card.items[0] && card.items[0].title === "全息投影内容");
  ok(fallback, "未知类型应降级为安全文本卡");
  eq(fallback.type, "text", "降级卡类型应为 text");
  eq(fallback.title, "结果", "降级卡 title 应为固定安全文案");
  display.cards.forEach((card) => {
    eq(typeof card.title, "string", "降级卡 title 必须是字符串");
    card.items.forEach((item) => eq(typeof item.title, "string", "降级条目 title 必须是字符串"));
  });

  // 原始对象不得泄露进 title（[object Object] 拦截）
  const leak = adapter.mapBlocksToDisplay([{ type: "hologram", text: { nested: 1 } }]);
  eq(leak.unknownCount, 1, "对象内容仍为未知类型计数");
  ok(leak.cards[0].items[0].title.indexOf("[object") < 0, "title 不得泄露 [object Object]");

  // 完全不合法输入不抛异常
  const empty = adapter.mapBlocksToDisplay(null);
  eq(empty.unknownCount, 0, "null 输入不应计数");
  eq(empty.cards.length, 0, "null 输入不应产出卡片");
  eq(empty.text, "", "null 输入 text 为空");
  ok(!empty.plan && !empty.clarification && !empty.confirmation, "null 输入无 plan/clarification/confirmation");
  deepEq(adapter.mapBlocksToDisplay("not-an-array").cards.length, 0, "非数组输入安全返回");
  deepEq(adapter.deriveBlocks(null), [], "deriveBlocks(null) 返回空数组");
  deepEq(adapter.deriveBlocks(undefined), [], "deriveBlocks(undefined) 返回空数组");
}

// 3. deriveBlocks 优先级：显式 uiBlocks > ui.blocks > 信封推导
function testDeriveBlocksPrecedence() {
  const explicit = adapter.deriveBlocks({ uiBlocks: [{ type: "text", text: "显式块" }], answer: "不应出现" });
  eq(explicit.length, 1, "显式 uiBlocks 优先时只取显式块");
  eq(explicit[0].text, "显式块", "显式 uiBlocks 内容生效");

  const viaUi = adapter.deriveBlocks({ ui: { blocks: [{ type: "markdown", markdown: "**粗体**" }] }, answer: "不应出现" });
  eq(viaUi.length, 1, "ui.blocks 优先于信封推导");
  eq(viaUi[0].markdown, "**粗体**", "ui.blocks 内容生效");

  // 无显式块时从信封推导（与服务端 blocksFromAgentResult 同一事实源）
  const envelope = {
    answer: "这是回答",
    cards: [{ type: "list", title: "通用结果", items: [{ title: "甲" }, { title: "乙" }] }],
  };
  const derived = adapter.deriveBlocks(envelope);
  deepEq(derived, AGENT_SDK.blocksFromAgentResult(envelope), "信封推导应与权威包结果一致");
  eq(derived[0].type, "text", "answer 应推导为 text block");
  eq(derived[1].type, "list", "多条目 card 应推导为 list block");

  // 显式块含非法类型时不抛异常，降级回信封推导
  const salvage = adapter.deriveBlocks({ uiBlocks: [{ type: "hologram" }], answer: "回退回答" });
  eq(salvage.length, 1, "非法显式块应降级推导");
  eq(salvage[0].type, "text", "降级后由 answer 推导出 text block");
}

// 4. 声明式 Skill 模拟：只含通用字段的信封 → 页面可渲染卡片（形状子集校验）
function testDeclarativeSkillEnvelope() {
  const envelope = {
    answer: "已为你整理好通用清单。",
    cards: [{ title: "通用清单", items: [
      { title: "条目一", subtitle: "说明一", value: "值一" },
      { title: "条目二" },
    ] }],
  };
  const result = adapter.responseToDisplayAugment(envelope);
  ok(Array.isArray(result.blocks) && result.blocks.length === 2, "augment 应返回推导出的 blocks");
  ok(result.display && typeof result.display === "object", "augment 应返回 display");
  eq(result.display.text, "已为你整理好通用清单。", "answer 应进入 display.text");
  eq(result.display.cards.length, 1, "通用 card 应产出一张卡片");

  const card = result.display.cards[0];
  eq(card.type, "list", "多条目通用 card 应推导为 list 卡片");
  // 卡片字段必须是页面 normalizeCard 消费形状的子集（多余字段一律不允许）
  const consumedCardKeys = new Set(["type", "typeClass", "title", "subtitle", "badges", "items", "actions", "variant"]);
  Object.keys(card).forEach((key) => ok(consumedCardKeys.has(key), `卡片字段 ${key} 应在页面消费形状内`));
  // 条目字段同样是页面 normalizeCardItem 可消费的通用形状
  const consumedItemKeys = new Set(["title", "subtitle", "description", "url"]);
  card.items.forEach((item) => {
    Object.keys(item).forEach((key) => ok(consumedItemKeys.has(key), `条目字段 ${key} 应在页面消费形状内`));
  });
  // 页面渲染所需的最小字段齐全
  eq(typeof card.title, "string", "卡片 title 为字符串");
  ok(Array.isArray(card.badges) && Array.isArray(card.items), "badges/items 为数组");
}

// 5. 通用层纯度：适配器源码不得包含任何业务硬编码
function testGenericLayerPurity() {
  const source = fs.readFileSync(
    path.join(__dirname, "../miniprogram/packageXiaofu/services/uiBlockAdapter.js"),
    "utf8"
  );
  ok(!/佛大|佛山|fosu|release-pack|课表|教室|教师/i.test(source),
    "适配器不得包含业务/校园硬编码（业务映射属于页面层）");
}

// 6. 零编造字段：输入缺失的字段不得补文案
function testNoFabricatedFields() {
  const display = adapter.mapBlocksToDisplay([
    { type: "list", title: "清单", items: [{ title: "只有标题" }] },
  ]);
  const item = display.cards[0].items[0];
  eq(item.subtitle, "", "缺失 subtitle 不得编造");
  eq(item.description, "", "缺失 value 不得编造描述");
  ok(!("url" in item), "无 url 不得补 url 字段");

  // 完全无内容的条目应被丢弃，而不是产出空壳
  const emptyItems = adapter.mapBlocksToDisplay([{ type: "list", title: "清单", items: [{}] }]);
  eq(emptyItems.cards[0].items.length, 0, "空条目应被过滤");
}

function run() {
  testAllBlockTypes();
  testUnknownAndGarbage();
  testDeriveBlocksPrecedence();
  testDeclarativeSkillEnvelope();
  testGenericLayerPurity();
  testNoFabricatedFields();
  console.log(`test-xiaofu-ui-block-adapter: PASS (${checks} checks)`);
}

run();
