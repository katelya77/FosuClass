"use strict";
// R50.2B Widget Action 门禁（2026-08-19）
// P1 只产出官方 sys.chat 协议动作，payload 为用户语义自然语言；
// P2 query 禁止携带实体 ID / lessonId / NodeID / VarBizID / 内部标识；
// P3 场景续接动作确定性、可解析为合法 User Turn 续接。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const KIT = path.join(__dirname, "..", "..");
const WIDGET_DIR = path.join(KIT, "r50.2", "widget");

const {
  buildSysChatAction,
  buildFollowUpActions,
} = require(path.join(WIDGET_DIR, "action-builder.js"));
const { isClean } = require(path.join(WIDGET_DIR, "envelope.js"));

test("actions: 合法动作形状为官方 sys.chat 协议", () => {
  const built = buildSysChatAction({ id: "a1", label: "只看周三", query: "查看教师003第1周周三的课" });
  assert.equal(built.ok, true);
  assert.deepStrictEqual(built.action, {
    id: "a1",
    type: "sys.chat",
    label: "只看周三",
    payload: { query: "查看教师003第1周周三的课" },
  });
  assert.equal(isClean(built.action).ok, true);
});

test("actions: 拒绝含内部标识的 query（fail closed）", () => {
  const injections = [
    "查看课程 les-101 的课",
    "查看 lessonId=les-101",
    "查询 NodeID node-01",
    "VarBizID vbz-1",
    "queryId q-20260819-0001",
    "courseId c-011",
  ];
  for (const query of injections) {
    const built = buildSysChatAction({ id: "a1", label: "x", query });
    assert.equal(built.ok, false, `query「${query}」必须被拒绝`);
    assert.equal(built.action, null);
  }
});

test("actions: 拒绝空 id/label/query", () => {
  assert.equal(buildSysChatAction({ id: "", label: "x", query: "q" }).ok, false);
  assert.equal(buildSysChatAction({ id: "a", label: "", query: "q" }).ok, false);
  assert.equal(buildSysChatAction({ id: "a", label: "x", query: "  " }).ok, false);
});

test("actions: 每类 variant 生成确定性用户语义续接", () => {
  const entity = { name: "教师003" };
  const cases = [
    ["schedule", { resolvedEntity: entity, window: { weekStart: 1, weekEnd: 1 } }],
    ["space", {}],
    ["collaboration", { resolvedEntity: { name: "教师001、教师002" } }],
    ["risk", {}],
    ["reschedule", {}],
    ["ranking", { summary: { metric: "loadCount" } }],
    ["overview", {}],
    ["empty", {}],
    ["error", {}],
    ["message", { resolvedEntity: entity }],
  ];
  for (const [variant, raw] of cases) {
    const actions = buildFollowUpActions(variant, { raw });
    assert.ok(actions.length >= 1, `${variant} 必须至少一个续接动作`);
    for (const action of actions) {
      assert.equal(action.type, "sys.chat", `${variant}: 类型必须是 sys.chat`);
      assert.ok(action.label.length >= 2, `${variant}: label 为空`);
      assert.ok(action.payload.query.length >= 4, `${variant}: query 为空`);
      assert.equal(isClean(action).ok, true, `${variant}: 泄漏内部字段`);
    }
  }
});

test("actions: 相同输入两次生成字节一致（确定性）", () => {
  const raw = { resolvedEntity: { name: "教师003" }, window: { weekStart: 1, weekEnd: 1 } };
  const first = JSON.stringify(buildFollowUpActions("schedule", { raw }));
  const second = JSON.stringify(buildFollowUpActions("schedule", { raw }));
  assert.equal(first, second);
});

test("actions: 排名续接引用稳定位次而非实体 ID", () => {
  const raw = { summary: { metric: "loadCount" } };
  const actions = buildFollowUpActions("ranking", { raw });
  const top1 = actions.find((a) => a.id === "ranking-top1");
  assert.ok(top1, "必须存在查看第1名动作");
  assert.equal(top1.label, "查看第1名的课表");
  assert.ok(top1.payload.query.includes("排名第1的"));
  assert.ok(!top1.payload.query.includes("t-001"));
});