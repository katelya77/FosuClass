"use strict";
// R50.2A 可选结构化参数归一化测试（2026-08-19）
// 复现 ADP 全局调试失败：target.room 以 null / "" / "   " / [] / {} 到达确定性边界时
// 必须按 schema 可选性归一化为「缺失」，不得触发假教室实体查找。
// 同时验证：必填值、合法数值（尤其 0 作为 legacy 可选数值字段的「未指定」语义）
// 绝不被通用归一化器误删。
const test = require("node:test");
const assert = require("node:assert");
const {
  resolveAgentToolParams,
  buildRestRequest,
  normalizeAgentToolInput,
  CONTRACT,
} = require("../tools/adapter/adapter");

const base = {
  sourceLessonId: "lesson-protocol-fixture",
  target: { week: 2, weekday: 5, periodStart: 7, periodEnd: 8 },
};

for (const emptyRoom of [null, "", "   ", [], {}]) {
  test(`optional target.room ${JSON.stringify(emptyRoom)} is treated as absent`, () => {
    const raw = { ...base, target: { ...base.target, room: emptyRoom } };
    const resolved = resolveAgentToolParams("campus_reschedule_feasibility", raw);
    assert.equal(resolved.ok, true, `room=${JSON.stringify(emptyRoom)} 必须通过校验`);
    assert.equal(Object.hasOwn(resolved.params.target, "room"), false);
    assert.deepStrictEqual(resolved.params.target, base.target, "target 其余必填槽位保持原值");
    const request = buildRestRequest("campus_reschedule_feasibility", resolved.params, {
      baseUrl: "https://example.invalid",
    });
    const body = JSON.parse(request.body);
    assert.equal(Object.hasOwn(body.target, "room"), false);
  });
}

test("required numeric values survive normalization untouched", () => {
  const resolved = resolveAgentToolParams("campus_reschedule_feasibility", base);
  assert.equal(resolved.ok, true);
  assert.deepStrictEqual(resolved.params.target, {
    week: 2, weekday: 5, periodStart: 7, periodEnd: 8,
  });
});

test("valid falsey values (numeric 0) are never erased by the generic normalizer", () => {
  const schema = {
    type: "object",
    properties: {
      weekday: { type: "integer", minimum: 0, description: "0 视为未指定（legacy 可选数值字段）" },
      label: { type: "string" },
    },
    required: [],
  };
  const normalized = normalizeAgentToolInput(schema, { weekday: 0, label: "   " });
  assert.strictEqual(Object.hasOwn(normalized, "weekday"), true, "数值 0 不得与空容器/空串混淆");
  assert.strictEqual(normalized.weekday, 0);
  assert.strictEqual(Object.hasOwn(normalized, "label"), false, "空白字符串按语义空删除");
});

test("nested object optional normalization is schema-aware (required children preserved)", () => {
  const tool = CONTRACT.tools.find((t) => t.name === "campus_reschedule_feasibility");
  const schema = tool.inputSchema;
  const raw = {
    sourceLessonId: "lesson-protocol-fixture",
    target: { week: 0, weekday: 5, periodStart: 7, periodEnd: 8, room: null },
  };
  const normalized = normalizeAgentToolInput(schema, raw);
  assert.strictEqual(Object.hasOwn(normalized.target, "room"), false);
  assert.strictEqual(normalized.target.week, 0, "数值 0 保留（后续由契约 minimum 校验决定取舍，不由归一化器删除）");
});

test("omitted optional fields stay omitted; required top-level fields untouched", () => {
  const resolved = resolveAgentToolParams("campus_reschedule_feasibility", {
    sourceLessonId: "lesson-protocol-fixture",
    target: { week: 3, weekday: 2, periodStart: 1, periodEnd: 2 },
  });
  assert.equal(resolved.ok, true);
  assert.deepStrictEqual(resolved.params.target, { week: 3, weekday: 2, periodStart: 1, periodEnd: 2 });
});