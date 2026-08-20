"use strict";
// CSF P1 Widget Output Contract Stabilization 门禁（2026-08-19）
// W1 version 从 Agent-facing Envelope 移除必填（由确定性投影注入，模型不生成研发版本号）；
// W2 tieGroupCount 内部 Envelope 允许 0；公开 Widget 省略 0，出现时至少为 1；
// W3 week-board 空日单一 SSOT = 确定性投影过滤空日；
// W4 动作 sys.chat-only，payload 形状 { query }；
// W5 组合 Mission 最终 Widget = 最终完成能力的变体（课表→风险收口 risk）；
// W6-W8 WidgetPayloadValidator：同一 schema 校验所有 Agent final output，fail-closed 可读中文文本；
// W9 用户可见 Widget 名不含研发版本号；契约 SSOT 文档化空日策略。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const KIT = path.join(__dirname, "..", "..");
const ENVELOPE = require(path.join(KIT, "r50.2", "widget", "envelope.js"));
const VIEW_MODEL = require(path.join(KIT, "r50.2", "widget", "view-model.js"));
const WIDGET_DIR = path.join(KIT, "widget", "native", "campus-result-unified-v1");
const WIDGET_SCHEMA = JSON.parse(fs.readFileSync(path.join(WIDGET_DIR, "schema.json"), "utf8"));
const WIDGET_CONTRACT = JSON.parse(fs.readFileSync(path.join(WIDGET_DIR, "contract.json"), "utf8"));
const ENVELOPE_SCHEMA = JSON.parse(fs.readFileSync(path.join(KIT, "r50.2", "widget", "campus-result-envelope.schema.json"), "utf8"));
const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "widget-payload-regressions.json"), "utf8"));

test("W1. Envelope（Agent-facing）version 非必填；出现时仅接受 1.0；确定性子系统注入", () => {
  const base = {
    variant: "schedule", status: "success", title: "第1周课表", verified: true, summary: "共 4 门课程。",
  };
  assert.equal(ENVELOPE.validateEnvelope({ ...base }).ok, true, "无 version 必须通过（模型不生成研发版本号）");
  assert.equal(ENVELOPE.validateEnvelope({ ...base, version: "1.0" }).ok, true, "投影层注入 1.0 仍通过");
  assert.equal(ENVELOPE.validateEnvelope({ ...base, version: "1.2.3-dev" }).ok, false, "模型生成的研发版本号必须拒绝");
  assert.ok(!ENVELOPE.REQUIRED.includes("version"), "REQUIRED 常量不得包含 version");
  assert.ok(!ENVELOPE_SCHEMA.required.includes("version"), "envelope schema required 不得包含 version");
});

test("W2. tieGroupCount 内部 0 / 公开省略边界与真实导出一致", () => {
  assert.strictEqual(WIDGET_SCHEMA.properties.displayMeta.properties.tieGroupCount.minimum, 1, "公开 Widget schema 出现时 minimum 必须为 1");
  assert.strictEqual(ENVELOPE_SCHEMA.properties.displayMeta.properties.tieGroupCount.minimum, 0, "Envelope schema tieGroupCount minimum 必须为 0");
  const ranking = {
    variant: "ranking", status: "success", title: "教师负载 TopN", verified: true, summary: "负载最高的是教师001。",
    displayMeta: { tieGroupCount: 0 },
  };
  assert.equal(ENVELOPE.validateEnvelope(ranking).ok, true, "tieGroupCount=0 必须通过");
  assert.equal(ENVELOPE.validateEnvelope({ ...ranking, displayMeta: {} }).ok, true, "无 tieGroupCount 必须通过");
  const { validateWidgetPayload } = require(path.join(WIDGET_DIR, "payload-validator.js"));
  const payload = { ...JSON.parse(fs.readFileSync(path.join(WIDGET_DIR, "default.json"), "utf8")), displayMeta: { tieGroupCount: 0 } };
  assert.equal(validateWidgetPayload(payload).ok, false, "公开 Widget 不接受 0，应由投影层省略");
  delete payload.displayMeta.tieGroupCount;
  assert.equal(validateWidgetPayload(payload).ok, true, "无并列时缺省合法");
});

test("W3. week-board 空日单一 SSOT：确定性投影过滤空日，Widget 永不收到空日", () => {
  const lessons = [
    { courseName: "程序设计基础", weekdayName: "周一", weekday: 1, periodStart: 1, periodText: "第1-2节", startTime: "08:00", endTime: "09:40", campusName: "校区A", roomName: "A1-102", teachers: ["教师003"] },
    { courseName: "计算机组成原理", weekdayName: "周三", weekday: 3, periodStart: 7, periodText: "第7-8节", startTime: "14:00", endTime: "15:40", campusName: "校区B", roomName: "B2-201", teachers: ["教师003"] },
  ];
  const days = VIEW_MODEL.buildDays(lessons, {});
  assert.deepStrictEqual(days.map((d) => d.label), ["周一", "周三"], "空日必须被过滤，只保留有课的日期");
  assert.ok(days.every((d) => d.blocks.length > 0), "过滤后不允许空 blocks 日");
  assert.ok(WIDGET_SCHEMA.properties.days.items.properties.blocks, "真实导出 schema 必须保留 days/blocks 结构");
  const { validateWidgetPayload } = require(path.join(WIDGET_DIR, "payload-validator.js"));
  const malformed = { ...JSON.parse(fs.readFileSync(path.join(WIDGET_DIR, "default.json"), "utf8")), days: [{ label: "周二", blocks: [] }] };
  assert.equal(validateWidgetPayload(malformed).ok, false, "空日由 fail-closed validator 拒绝");
  assert.ok(WIDGET_CONTRACT.description.includes("空日"), "contract.json 必须文档化空日策略（SSOT）");
  assert.ok(WIDGET_CONTRACT.description.includes("过滤"), "contract.json 必须声明「过滤空日」为唯一策略");
});

test("W4. Mission Widget 动作 sys.chat-only，payload 形状 { query }", () => {
  const { nextActions } = require(path.join(KIT, "r51", "mission", "widget-actions.js"));
  const actions = nextActions({
    goal: { goalFamily: "teaching_assurance", completionCriteria: ["scheduleFacts", "riskFacts"] },
    completedCapabilities: ["SCHEDULE_DETAIL"],
    availableFacts: { scheduleFacts: { verified: true } },
    activeEntity: null,
  });
  assert.ok(actions.length > 0, "应生成下一步动作");
  for (const a of actions) {
    assert.strictEqual(a.type, "sys.chat", "仅允许 sys.chat");
    assert.ok(a.payload && typeof a.payload === "object" && !Array.isArray(a.payload), "payload 必须是对象");
    assert.deepStrictEqual(Object.keys(a.payload), ["query"], "payload 只允许 query 字段");
    assert.ok(typeof a.payload.query === "string" && a.payload.query.length > 0, "query 必须是自然语言文本");
  }
});

test("W5. 组合 Mission 最终 Widget = 最终完成能力的变体（课表→风险收口 risk）", () => {
  const mission = { completedCapabilities: ["SCHEDULE_DETAIL", "RISK_CHECK"] };
  const toolResults = {
    campus_schedule_query: { query: { entityType: "teacher", entityName: "教师003" }, window: { weekStart: 1, weekEnd: 1 }, items: [] },
    campus_risk_check: { query: { entityType: "teacher", entityName: "教师003" }, items: [{ risk: { conflictCount: 0, dashCount: 1 } }] },
  };
  const capabilityToolMap = { SCHEDULE_DETAIL: "campus_schedule_query", RISK_CHECK: "campus_risk_check" };
  const buildEnvelope = (raw, toolName) => ({
    ok: true,
    errors: [],
    envelope: {
      version: "1.0",
      variant: toolName === "campus_risk_check" ? "risk" : "schedule",
      status: "success",
      title: toolName === "campus_risk_check" ? "课程安排风险检查" : "第1周课表",
      verified: true,
      summary: toolName === "campus_risk_check" ? "冲突 0，赶场 1。" : "共 2 门课程。",
    },
  });
  const result = VIEW_MODEL.projectMissionFinalViewModel(mission, toolResults, capabilityToolMap, buildEnvelope);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.strictEqual(result.viewModel.variant, "risk", "最终 Widget 必须收口在最终能力（risk），而不是第一张课表卡");
  assert.strictEqual(result.viewModel.title, "课程安排风险检查");
  assert.strictEqual(result.viewModel.layoutMode, "result-card");
});

test("W6. WidgetPayloadValidator：合法 payload 通过；失败 payload fail-closed 输出可读中文文本", () => {
  const { validateWidgetPayload } = require(path.join(WIDGET_DIR, "payload-validator.js"));
  for (const fixture of FIXTURES.cases) {
    const result = validateWidgetPayload(fixture.payload);
    if (fixture.expect === "pass") {
      assert.equal(result.ok, true, `${fixture.id} 必须通过: ${JSON.stringify(result.errors)}`);
    } else {
      assert.equal(result.ok, false, `${fixture.id} 必须拒绝`);
      assert.ok(result.textFallback && typeof result.textFallback === "string" && result.textFallback.length > 0,
        `${fixture.id} 必须 fail-closed 输出可读文本 fallback`);
      assert.ok(!result.textFallback.includes("{") && !result.textFallback.includes("}"),
        `${fixture.id} fallback 不得输出原始 JSON`);
      assert.ok(!/queryId|dataHash|sourceTool|rankContext|token|authorization/i.test(result.textFallback),
        `${fixture.id} fallback 不得泄漏内部协议`);
      for (const must of fixture.mustMatch || []) {
        assert.ok((result.textFallback + " " + result.errors.join(" ")).includes(must),
          `${fixture.id} 应包含 ${must}（fallback 或诊断文本）`);
      }
    }
  }
  assert.strictEqual(FIXTURES.cases.length, 11, "回归集必须包含全部已证实失败模式");
});

test("W7. WidgetPayloadValidator：拒绝 open_widget / broaden_query 等非 sys.chat 动作", () => {
  const { validateWidgetPayload } = require(path.join(WIDGET_DIR, "payload-validator.js"));
  const base = {
    version: "1.0", variant: "space", status: "success", title: "空教室", subtitle: "校区A",
    verified: true, summary: "找到 8 间空教室。", context: "", sections: [], displayMeta: {},
    layoutMode: "result-card", weekBoardTitle: "", weekBoardSubtitle: "", days: [],
  };
  for (const type of ["open_widget", "broaden_query", "invoke_workflow"]) {
    const result = validateWidgetPayload({ ...base, actions: [{ id: "a1", type, label: "动作", payload: { query: "换个校区" } }] });
    assert.equal(result.ok, false, `${type} 必须拒绝`);
    assert.ok(result.errors.some((e) => e.includes("sys.chat")), `${type} 错误必须说明仅允许 sys.chat`);
    assert.ok(result.textFallback.length > 0, `${type} 必须 fail-closed 输出可读文本`);
    assert.ok(!result.textFallback.includes("{"), `${type} fallback 不得输出原始 JSON`);
  }
});

test("W8. WidgetPayloadValidator：week-board 结构损坏 / 空日 fail-closed 回退文案可读", () => {
  const { validateWidgetPayload } = require(path.join(WIDGET_DIR, "payload-validator.js"));
  const emptyDay = FIXTURES.cases.find((c) => c.id === "week-board-empty-day");
  const result = validateWidgetPayload(emptyDay.payload);
  assert.equal(result.ok, false);
  assert.ok(result.textFallback.includes("课表"), "fallback 保留业务标题");
  assert.ok(result.textFallback.includes("共 2 门课程。"), "fallback 保留工具事实摘要");
});

test("W9. 用户可见 Widget 名不含研发版本号；v7 契约绑定真实 Tencent Widget ID", () => {
  assert.ok(WIDGET_CONTRACT.name && typeof WIDGET_CONTRACT.name === "string", "contract.json 必须声明用户可见 name");
  assert.ok(!/R\d{2,}/.test(WIDGET_CONTRACT.name), `name 不得含研发版本号：${WIDGET_CONTRACT.name}`);
  assert.ok(!WIDGET_CONTRACT.name.includes("-R"), `name 不得含 -R 版本后缀：${WIDGET_CONTRACT.name}`);
  assert.strictEqual(WIDGET_CONTRACT.schema, "fosuclass-adp-widget-contract/v7");
  assert.match(WIDGET_CONTRACT.widgetId, /^[0-9a-f]{32}$/);
  assert.strictEqual(WIDGET_CONTRACT.status, "REAL_TENCENT_EXPORT_BOUND_FINAL_CANDIDATE");
});
