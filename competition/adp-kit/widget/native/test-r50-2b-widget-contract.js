#!/usr/bin/env node
"use strict";
// R50.2B CampusResultUnified V1 Widget 契约门禁（2026-08-19）
// P1 契约/Schema/默认数据/样例四者字段集一致，且只含 Envelope 公开字段；
// P2 widgetId 不得伪造（null + FAIL_CLOSED_REAL_TENCENT_EXPORT_ONLY）；
// P3 模板必须渲染全部 sections/rows/actions，动作只走官方 sys.chat（payload 仅 query）；
// P4 模板/契约/样例零内部协议泄漏（queryId/dataHash/dataVersion/sourceTool/rankContext/
//    temporalContext/NodeID/VarBizID/token/内部 URL 等）；
// P5 移动端安全：不出现固定宽度/行数截断（无 width= 固定值、无 limit={2}）。
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

const fields = contract.fields.map((field) => field.name);

test("contract: widgetId 未注册不得伪造，策略必须 FAIL_CLOSED", () => {
  assert.strictEqual(contract.widgetId, null, "must not fabricate a WidgetID");
  assert.strictEqual(contract.widgetIdPolicy, "FAIL_CLOSED_REAL_TENCENT_EXPORT_ONLY");
  assert.strictEqual(contract.schema, "fosuclass-adp-widget-contract/v4");
  assert.strictEqual(contract.kind, "campus-result-unified");
  assert.strictEqual(contract.leakFree, true);
  assert.deepStrictEqual(contract.variants, [
    "schedule", "space", "collaboration", "risk", "reschedule",
    "ranking", "overview", "empty", "error", "message",
  ]);
});

test("contract: fields 与 schema.properties / default / 全部样例键集一致", () => {
  assert.deepStrictEqual(Object.keys(schema.properties), fields);
  assert.deepStrictEqual(Object.keys(defaults), fields);
  for (const sampleName of samples) {
    const sample = JSON.parse(fs.readFileSync(path.join(samplesDir, sampleName), "utf8"));
    assert.deepStrictEqual(Object.keys(sample), fields, `样例 ${sampleName} 键集必须等于 contract.fields`);
  }
  assert.strictEqual(samples.length, 10, "必须为全部 10 个 variant 提供样例");
});

test("contract: 样例 variant/status 组合合法且与文件名一致", () => {
  for (const sampleName of samples) {
    const sample = JSON.parse(fs.readFileSync(path.join(samplesDir, sampleName), "utf8"));
    assert.strictEqual(sample.variant, sampleName.replace(".json", ""), `样例 ${sampleName} 的 variant 必须与文件名一致`);
    assert(schema.properties.variant.enum.includes(sample.variant), `非法 variant ${sample.variant}`);
    assert(schema.properties.status.enum.includes(sample.status));
    assert.strictEqual(typeof sample.verified, "boolean");
    if (sample.variant === "empty") assert.strictEqual(sample.status, "empty");
    if (sample.variant === "error") assert.strictEqual(sample.status, "error");
    if (sample.status === "success") assert.strictEqual(sample.verified, true);
  }
});

test("contract: 模板渲染完整数组且不截断（全部 sections/rows/actions）", () => {
  assert(template.includes("sections.map"), "unified widget must render the complete sections array");
  assert(template.includes("section.rows.map"), "unified widget must render every row of every section");
  assert(template.includes("actions.map"), "unified widget must render every action");
  assert(!template.includes("limit={2}"), "unified widget must not preserve any two-row limit");
});

test("contract: 动作只走官方 sys.chat，payload 仅含用户语义 query", () => {
  assert(template.includes('type: "sys.chat"'), "actions must use official sys.chat");
  assert(template.includes("query: action.payload.query"), "payload must carry only the user-semantic query");
  assert(!template.includes("action.intent"), "must not leak intent to widget payload");
  assert(!template.includes("entityType"), "must not leak entity identifiers to widget payload");
  assert(!adapter.includes("queryId"), "adapter must not emit queryId");
  assert(!adapter.includes("intent"), "adapter must not emit intent");
  for (const sampleName of samples) {
    const sample = JSON.parse(fs.readFileSync(path.join(samplesDir, sampleName), "utf8"));
    for (const action of sample.actions) {
      assert.strictEqual(action.type, "sys.chat");
      assert.deepStrictEqual(Object.keys(action.payload), ["query"], `action payload 只允许 query: ${sampleName}`);
      assert(action.payload.query.length >= 4, `${sampleName}: query 为空`);
      assert(action.label.length >= 2, `${sampleName}: label 为空`);
    }
  }
});

test("contract: 模板/默认数据/样例零内部协议泄漏；adapter 不发射内部键", () => {
  // contract.json 的 forbiddenFields 与 adapter 的禁入表是「禁入字段」文档/门禁声明，
  // 本身允许出现字段名；真正承载 Widget 数据的 schema/default/samples/template 与
  // adapter 输出形状则必须零泄漏（adapter 运行时行为由本测试末尾的 python 冒烟验证）。
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
    // 密钥形令牌须至少含一个数字才能命中（避免 risk-resolve 等 id 误报）
    assert(!/sk-[a-z0-9._-]*\d[a-z0-9._-]*/i.test(text), `${label} 不得包含密钥形令牌`);
  }
  assert(!/https?:\/\/(localhost|127\.0\.0\.1|[\w-]+\.internal)/i.test(texts.template));
  assert(!/https?:\/\/[^\s"']*\/api\//i.test(JSON.stringify(texts)));
  // adapter 输出形状：绝不出现带引号的内部输出键（源码中的禁入表是小写运行时令牌；
  // "evidence" 等仅以运行时令牌形式存在，输出行为由 python 冒烟测试兜底验证）。
  for (const emittedKey of ['"queryId"', '"dataHash"', '"dataVersion"', '"computedAt"', '"intent"', '"entityType"', '"NodeID"']) {
    assert(!adapter.includes(emittedKey), `adapter 不得输出内部键 ${emittedKey}`);
  }
  assert(adapter.includes('"displayMeta"'), "adapter 输出必须包含 displayMeta 键");
});

test("contract: adapter 运行时行为（python 冒烟：合法输入→widget；泄漏输入→fallback）", () => {
  const { execFileSync } = require("child_process");
  const runAdapter = (envelope) => {
    const output = execFileSync("python", [path.join(root, "adapter.py")], {
      input: JSON.stringify({ envelope }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return JSON.parse(output);
  };
  const schedule = JSON.parse(fs.readFileSync(path.join(samplesDir, "schedule.json"), "utf8"));
  const result = runAdapter(schedule);
  assert.strictEqual(result.route, "widget", "合法 Envelope 必须 route=widget");
  assert.strictEqual(result.widgetId, null);
  assert.deepStrictEqual(Object.keys(result.data).sort(), [...fields].sort());
  const action = result.data.actions[0];
  assert.deepStrictEqual(Object.keys(action.payload), ["query"]);
  const leaked = JSON.parse(JSON.stringify(schedule));
  leaked.internalNote = "queryId=q-20260819-0001";
  const fallback = runAdapter(leaked);
  assert.strictEqual(fallback.route, "fallback", "含内部字段的输入必须 fail closed");
});

test("contract: 移动端安全 —— 无固定宽度、无固定高、尺寸由 size 控制", () => {
  assert(!/width=["']?\d/.test(template), "template must not use fixed pixel widths");
  assert(!/height=["']?\d/.test(template), "template must not use fixed pixel heights");
  assert(template.includes('size="md"'), "card size must be responsive (md)");
  assert(template.includes('size="sm"'), "child elements must use size props");
});

test("contract: verified empty / error / 模拟调课等语义样例齐备", () => {
  const empty = JSON.parse(fs.readFileSync(path.join(samplesDir, "empty.json"), "utf8"));
  assert.strictEqual(empty.status, "empty");
  assert.strictEqual(empty.sections.length, 0);
  assert.strictEqual(empty.actions.length, 1, "empty 变体必须提供「扩大范围」续接");
  const error = JSON.parse(fs.readFileSync(path.join(samplesDir, "error.json"), "utf8"));
  assert.strictEqual(error.displayMeta.recoverable, true);
  const reschedule = JSON.parse(fs.readFileSync(path.join(samplesDir, "reschedule.json"), "utf8"));
  assert.strictEqual(reschedule.displayMeta.simulated, true, "调课结果必须标记为模拟（未执行）");
  const collaboration = JSON.parse(fs.readFileSync(path.join(samplesDir, "collaboration.json"), "utf8"));
  assert.strictEqual(collaboration.displayMeta.weekendMarked, true, "协作候选必须区分工作日/周末");
  const ranking = JSON.parse(fs.readFileSync(path.join(samplesDir, "ranking.json"), "utf8"));
  assert.strictEqual(ranking.displayMeta.tieGroupCount, 1, "并列必须保留 tie 元数据");
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