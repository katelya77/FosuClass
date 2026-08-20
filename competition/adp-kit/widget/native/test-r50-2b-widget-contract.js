#!/usr/bin/env node
"use strict";
// Final CampusResultUnified V7 Widget 契约门禁（2026-08-20）
// P1 契约/Schema/默认数据/样例四者字段集一致（15 键：Envelope 公开字段 + 布局字段），
//    widgetId 必须来自用户提供的真实 Tencent 导出；
// P2 双布局：schedule 整周/周范围 → week-board（weekBoardTitle/weekBoardSubtitle/days）；
//    其余（单日明细/风险/空教室/态势/TopN/调课模拟/空结果/错误）→ result-card；
// P3 week-board 渲染结构：days[].label ∈ 周一..周日，blocks[].{time,title,location} 非空，
//    每日板块/周视图徽标/节次徽标，空天不输出板块；
// P4 动作只走官方 sys.chat（payload 仅 query），按钮为上下文感知的下一任务流；
// P5 模板/契约/样例零内部协议泄漏（queryId/dataHash/dataVersion/sourceTool/rankContext/
//    temporalContext/NodeID/VarBizID/token/内部 URL 等），adapter 输出形状零泄漏；
// P6 移动端安全：无固定宽度/行数截断；
// P7 adapter 运行时（python 冒烟）：整周样例 → week-board 透传；week-board 数据损坏 →
//    回退 result-card；内部字段泄漏输入 → fallback。
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "campus-result-unified-v1");
const contract = JSON.parse(fs.readFileSync(path.join(root, "contract.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, "schema.json"), "utf8"));
const defaults = JSON.parse(fs.readFileSync(path.join(root, "default.json"), "utf8"));
const template = fs.readFileSync(path.join(root, "template.txt"), "utf8");
const adapter = fs.readFileSync(path.join(root, "adapter.py"), "utf8");
const samplesDir = path.join(root, "samples");
const samples = fs.readdirSync(samplesDir).filter((file) => file.endsWith(".json")).sort();

const FORBIDDEN_PATTERNS = [
  "queryId", "queryid", "dataHash", "datahash", "dataVersion", "dataversion",
  "sourceTool", "sourcetool", "rankContext", "rankcontext", "temporalContext",
  "temporalcontext", "NodeID", "nodeid", "VarBizID", "varbizid",
  "Authorization", "authorization", "Bearer ", "evidence",
  "internalUrl", "internalurl", "computedAt",
];

const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const SAMPLE_VARIANT = {
  "collaboration.json": "collaboration",
  "empty.json": "empty",
  "error.json": "error",
  "message.json": "message",
  "overview.json": "overview",
  "ranking.json": "ranking",
  "reschedule.json": "reschedule",
  "risk.json": "risk",
  "schedule-day.json": "schedule",
  "schedule-range.json": "schedule",
  "schedule-week.json": "schedule",
  "space.json": "space",
};

function loadSample(name) {
  return JSON.parse(fs.readFileSync(path.join(samplesDir, name), "utf8"));
}

const fields = contract.fields.map((field) => field.name);

test("contract: widgetId 绑定最新真实 Tencent 导出，schema 升级 v8", () => {
  assert.strictEqual(contract.widgetId, "601418106a374b2eb7de54c65a3de7e0");
  assert.strictEqual(contract.widgetIdPolicy, "FAIL_CLOSED_REAL_TENCENT_EXPORT_ONLY");
  assert.strictEqual(contract.schema, "fosuclass-adp-widget-contract/v8");
  assert.strictEqual(contract.kind, "campus-result-unified");
  assert.strictEqual(contract.leakFree, true);
  assert.deepStrictEqual(contract.variants, [
    "schedule", "space", "collaboration", "risk", "reschedule",
    "ranking", "overview", "empty", "error", "message",
  ]);
  assert.deepStrictEqual(contract.layoutModes, ["result-card", "week-board"]);
});

test("contract: fields 与 schema.properties / default / 全部样例键集一致（15 键）", () => {
  assert.deepStrictEqual(Object.keys(schema.properties), fields);
  assert.deepStrictEqual(Object.keys(defaults), fields);
  for (const sampleName of samples) {
    const sample = loadSample(sampleName);
    assert.deepStrictEqual(Object.keys(sample), fields, `样例 ${sampleName} 键集必须等于 contract.fields`);
  }
  assert.strictEqual(samples.length, 12, "必须覆盖 schedule 双布局 + 其余变体共 12 个样例");
  assert(schema.properties.layoutMode.enum.includes("result-card"), "layoutMode 枚举必须含 result-card");
  assert(schema.properties.layoutMode.enum.includes("week-board"), "layoutMode 枚举必须含 week-board");
});

test("contract: 样例 variant/status 组合合法，10 个 variant 全覆盖", () => {
  const covered = new Set();
  for (const sampleName of samples) {
    const sample = loadSample(sampleName);
    const expectedVariant = SAMPLE_VARIANT[sampleName];
    assert(expectedVariant, `${sampleName} 缺少变体映射`);
    assert.strictEqual(sample.variant, expectedVariant, `样例 ${sampleName} 的 variant 必须为 ${expectedVariant}`);
    assert(schema.properties.variant.enum.includes(sample.variant), `非法 variant ${sample.variant}`);
    assert(schema.properties.status.enum.includes(sample.status));
    assert.strictEqual(typeof sample.verified, "boolean");
    if (sample.variant === "empty") assert.strictEqual(sample.status, "empty");
    if (sample.variant === "error") assert.strictEqual(sample.status, "error");
    if (sample.status === "success") assert.strictEqual(sample.verified, true);
    covered.add(sample.variant);
  }
  assert.strictEqual(covered.size, 10, "10 个 variant 必须全部有样例");
});

test("contract: layoutMode 规则 —— 整周/周范围课表 → week-board，其余 → result-card", () => {
  for (const sampleName of samples) {
    const sample = loadSample(sampleName);
    if (sample.variant === "schedule" && (sampleName === "schedule-week.json" || sampleName === "schedule-range.json")) {
      assert.strictEqual(sample.layoutMode, "week-board", `${sampleName} 应为 week-board`);
      assert(sample.weekBoardTitle, `${sampleName}: weekBoardTitle 不能为空`);
      assert(sample.weekBoardSubtitle, `${sampleName}: weekBoardSubtitle 不能为空`);
      assert.strictEqual(sample.days.length > 0, true, `${sampleName}: days 必须含至少一个有效日板块`);
      assert.strictEqual(sample.sections.length, 0, `${sampleName}: week-board 不应携带 result-card sections`);
    } else {
      assert.strictEqual(sample.layoutMode, "result-card", `${sampleName} 应为 result-card`);
      assert.strictEqual(sample.weekBoardTitle, "", `${sampleName}: result-card 不应有 weekBoardTitle`);
      assert.strictEqual(sample.weekBoardSubtitle, "", `${sampleName}: result-card 不应有 weekBoardSubtitle`);
      assert.strictEqual(sample.days.length, 0, `${sampleName}: result-card 不应有 days`);
    }
  }
  assert.strictEqual(defaults.layoutMode, "week-board", "default.json 必须以整周课表作为旗舰预览");
});

test("contract: week-board 渲染结构 —— 日板块/课程块/空天折叠/确定性字段", () => {
  for (const name of ["schedule-week.json", "schedule-range.json"]) {
    const sample = loadSample(name);
    const seen = new Set();
    for (const day of sample.days) {
      assert(DAY_LABELS.includes(day.label), `${name}: 非法日标签 ${day.label}`);
      assert(!seen.has(day.label), `${name}: 日标签重复 ${day.label}`);
      seen.add(day.label);
      assert.strictEqual(day.blocks.length >= 1, true, `${name}: ${day.label} 板块必须非空`);
      for (const block of day.blocks) {
        assert.strictEqual(typeof block.time, "string");
        assert(block.time.length >= 1, `${name}: block.time 不能为空`);
        assert(block.title.length >= 1, `${name}: block.title 不能为空`);
        assert(block.location.length >= 1, `${name}: block.location 不能为空`);
      }
    }
    assert.strictEqual(seen.has("周一"), true, `${name}: 必须有周一板块`);
  }
  assert(template.includes("days.map"), "week-board 模板必须渲染 days 数组");
  assert(template.includes("day.blocks.map"), "week-board 模板必须渲染每日 blocks 数组");
  assert(/layoutMode === ['"]week-board['"]/.test(template), "模板必须按 layoutMode 双分支渲染");
  assert(template.includes("课程时间板"), "week-board 必须展示时间板标识");
  assert(template.includes("day.blocks.length"), "每日板块必须展示节次徽标");
  const monday = loadSample("schedule-week.json").days.find((day) => day.label === "周一");
  assert.strictEqual(monday.blocks.length, 2, "周一必须有 2 个课程块（与第1周课表事实一致）");
});

test("contract: 模板渲染完整数组且不截断（全部 sections/rows/actions）", () => {
  assert(template.includes("sections.map"), "unified widget must render the complete sections array");
  assert(template.includes("section.rows.map"), "unified widget must render every row of every section");
  assert(template.includes("actions.map"), "unified widget must render every action");
  assert(!template.includes("limit={2}"), "unified widget must not preserve any two-row limit");
});

test("contract: 动作只走官方 sys.chat，payload 仅含用户语义 query，上下文感知", () => {
  assert(/type:\s*['"]sys\.chat['"]/.test(template), "actions must use official sys.chat");
  assert(template.includes("query: action.payload.query"), "payload must carry only the user-semantic query");
  assert(!template.includes("action.intent"), "must not leak intent to widget payload");
  assert(!template.includes("entityType"), "must not leak entity identifiers to widget payload");
  assert(!adapter.includes("queryId"), "adapter must not emit queryId");
  assert(!adapter.includes("intent"), "adapter must not emit intent");
  for (const sampleName of samples) {
    const sample = loadSample(sampleName);
    assert(sample.actions.length >= 1, `${sampleName}: 必须提供下一步任务流按钮`);
    for (const action of sample.actions) {
      assert.strictEqual(action.type, "sys.chat");
      assert.deepStrictEqual(Object.keys(action.payload), ["query"], `action payload 只允许 query: ${sampleName}`);
      assert(action.payload.query.length >= 4, `${sampleName}: query 为空`);
      assert(action.label.length >= 2, `${sampleName}: label 为空`);
      assert(action.payload.query !== sample.title, `${sampleName}: 按钮 query 不得是复述标题的无效追问`);
    }
  }
  const weekSample = loadSample("schedule-week.json");
  const dayAction = weekSample.actions.find((action) => action.id === "weekboard-day-detail");
  assert(dayAction, "week-board 必须提供「看某日明细」的上下文感知续接动作");
  assert(dayAction.label.startsWith("看"), `日明细按钮应语义化（实际 ${dayAction.label}）`);
  assert(dayAction.payload.query.includes("周一"), "日明细 query 必须携带确定的日语义");
  assert(weekSample.actions.some((action) => action.label.includes("风险")), "整周课表必须提供「检查风险」续接");
  assert(weekSample.actions.some((action) => action.label.includes("下一个")), "整周课表必须提供「看下一个教学周」续接");
});

test("contract: 模板/默认数据/样例零内部协议泄漏；adapter 不发射内部键", () => {
  assert.deepStrictEqual(contract.forbiddenFields, [
    "queryId", "dataHash", "dataVersion", "sourceTool", "rankContext",
    "temporalContext", "NodeID", "VarBizID", "Authorization", "Token",
    "evidence", "computedAt", "internalUrl",
  ], "contract 必须声明完整禁入字段清单");
  const texts = {
    schema: JSON.stringify(schema),
    defaults: JSON.stringify(defaults),
    template,
    samples: samples
      .map((name) => fs.readFileSync(path.join(samplesDir, name), "utf8"))
      .join("\n"),
  };
  for (const [label, text] of Object.entries(texts)) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert(!text.includes(pattern), `${label} 不得包含 ${pattern}`);
    }
    assert(!/sk-[a-z0-9._-]*\d[a-z0-9._-]*/i.test(text), `${label} 不得包含密钥形令牌`);
  }
  assert(!/https?:\/\/(localhost|127\.0\.0\.1|[\w-]+\.internal)/i.test(texts.template));
  assert(!/https?:\/\/[^\s"']*\/api\//i.test(JSON.stringify(texts)));
  for (const emittedKey of ['"queryId"', '"dataHash"', '"dataVersion"', '"computedAt"', '"intent"', '"entityType"', '"NodeID"']) {
    assert(!adapter.includes(emittedKey), `adapter 不得输出内部键 ${emittedKey}`);
  }
  assert(adapter.includes('"displayMeta"'), "adapter 输出必须包含 displayMeta 键");
  assert(adapter.includes('"layoutMode"'), "adapter 输出必须包含 layoutMode 键");
  assert(adapter.includes('"days"'), "adapter 输出必须包含 days 键");
  assert(adapter.includes("week-board"), "adapter 必须实现 week-board 布局分支");
  assert(adapter.includes("result-card"), "adapter 必须实现 result-card 兜底");
});

test("contract: adapter 运行时行为（python 冒烟：整周→week-board；损坏→回退；泄漏→fallback）", () => {
  const { execFileSync } = require("child_process");
  const runAdapter = (envelope) => {
    const output = execFileSync("python", [path.join(root, "adapter.py")], {
      input: JSON.stringify({ envelope }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return JSON.parse(output);
  };
  const week = loadSample("schedule-week.json");
  const result = runAdapter(week);
  assert.strictEqual(result.route, "widget", "合法 Envelope 必须 route=widget");
  assert.strictEqual(result.widgetId, contract.widgetId);
  assert.deepStrictEqual(Object.keys(result.data).sort(), [...fields].sort());
  assert.strictEqual(result.data.layoutMode, "week-board", "整周课表必须透传 week-board");
  assert.strictEqual(result.data.weekBoardTitle, week.weekBoardTitle);
  assert.strictEqual(result.data.days.length, week.days.length, "days 板块必须透传");
  assert.strictEqual(result.data.days[0].blocks.length, 2, "周一 2 个课程块必须保留");
  const action = result.data.actions[0];
  assert.deepStrictEqual(Object.keys(action.payload), ["query"]);
  assert(result.data.days.every((day) => day.blocks.every((block) => Object.keys(block).every((key) => ["time", "title", "location", "meta"].includes(key)))),
    "block 仅允许 time/title/location/meta");

  const damaged = JSON.parse(JSON.stringify(week));
  damaged.layoutMode = "week-board";
  damaged.weekBoardTitle = "教师003 · 第1周课表";
  damaged.days = [{ label: "周一", blocks: [] }, { label: "周二", blocks: [] }];
  const fallbackLayout = runAdapter(damaged);
  assert.strictEqual(fallbackLayout.route, "widget", "week-board 损坏只回退布局，不整体 fallback");
  assert.strictEqual(fallbackLayout.data.layoutMode, "result-card", "week-board 数据损坏必须回退 result-card");
  assert.deepStrictEqual(fallbackLayout.data.days, []);

  const leaked = JSON.parse(JSON.stringify(week));
  leaked.internalNote = "queryId=q-20260819-0001";
  const fallback = runAdapter(leaked);
  assert.strictEqual(fallback.route, "fallback", "含内部字段的输入必须 fail closed");
});

test("contract: 移动端安全 —— 仅允许百分比宽度、无固定高、尺寸由 size 控制", () => {
  assert(!/width=["']\d+px["']/.test(template), "template must not use fixed pixel widths");
  assert(!/height=["']?\d/.test(template), "template must not use fixed pixel heights");
  assert(template.includes('size="md"'), "card size must be responsive (md)");
  assert(template.includes('size="sm"'), "child elements must use size props");
});

test("contract: verified empty / error / 模拟调课等语义样例齐备", () => {
  const empty = loadSample("empty.json");
  assert.strictEqual(empty.status, "empty");
  assert.strictEqual(empty.sections.length, 0);
  assert.strictEqual(empty.actions.length, 1, "empty 变体必须提供「扩大范围」续接");
  const error = loadSample("error.json");
  assert.strictEqual(error.displayMeta.recoverable, true);
  const reschedule = loadSample("reschedule.json");
  assert.strictEqual(reschedule.displayMeta.simulated, true, "调课结果必须标记为模拟（未执行）");
  const collaboration = loadSample("collaboration.json");
  assert.strictEqual(collaboration.displayMeta.weekendMarked, true, "协作候选必须区分工作日/周末");
  const ranking = loadSample("ranking.json");
  assert.strictEqual(ranking.displayMeta.tieGroupCount, 1, "并列必须保留 tie 元数据");
  const day = loadSample("schedule-day.json");
  assert.strictEqual(day.layoutMode, "result-card", "单日明细必须走 result-card");
  assert.strictEqual(day.sections.length >= 1, true, "单日明细必须保留 sections 结果卡内容");
});

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test("contract: 全部断言执行完成", () => {});
