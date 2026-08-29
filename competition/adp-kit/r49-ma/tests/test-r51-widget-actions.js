"use strict";
// R51-J Mission-aware Widget Action 门禁（2026-08-19）
// P1 动作只走官方 sys.chat，payload 只允许自然语言 query；
// P2 禁止内部 Mission / entity id / JSON 塞进按钮；
// P3 根据已完成能力生成下一步动作（检查风险 / 看空档 / 找教室 / 看下一周 / 查看排位对象课表）；
// P4 确定性 + 有界（最多 3 个）。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const { nextActions, MAX_ACTIONS } = require(path.join(R51, "mission", "widget-actions.js"));

function state(overrides) {
  return {
    goal: { goalFamily: "teaching_assurance", completionCriteria: [] },
    completedCapabilities: [],
    availableFacts: {},
    activeEntity: null,
    rankingSelection: null,
    ...overrides,
  };
}

const INTERNAL_TOKENS = ["queryId", "dataHash", "sourceTool", "rankContext", "temporalContext", "slotSnapshot", "mission", "entityId", "transfer_to", "task_done", "{", "}"];

test("J1. 所有动作 type=sys.chat 且 payload 仅自然语言（teaching_assurance 课表完成 → 检查风险）", () => {
  const actions = nextActions(state({
    goal: { goalFamily: "teaching_assurance", completionCriteria: ["scheduleFacts", "riskFacts"] },
    completedCapabilities: ["SCHEDULE_DETAIL"],
    availableFacts: { scheduleFacts: { verified: true } },
  }));
  assert.ok(actions.some((a) => a.type === "sys.chat" && a.label === "检查风险"));
  for (const a of actions) {
    assert.strictEqual(a.type, "sys.chat");
    assert.ok(a.payload && typeof a.payload === "object", "payload 必须是对象");
    assert.deepStrictEqual(Object.keys(a.payload), ["query"], "payload 只允许 query 字段");
    for (const t of INTERNAL_TOKENS) {
      assert.ok(!a.payload.query.includes(t), `payload 不得包含内部协议 ${t}`);
      assert.ok(!a.label.includes(t), `label 不得包含内部协议 ${t}`);
    }
  }
});

test("J2. 排名完成 → 查看排位对象课表（payload 含业务实体名，不含内部 id）", () => {
  const actions = nextActions(state({
    goal: { goalFamily: "campus_operations_insight", completionCriteria: ["rankingFacts", "scheduleFacts"] },
    completedCapabilities: ["TEACHER_LOAD_RANKING"],
    availableFacts: { rankingFacts: { verified: true } },
    activeEntity: { type: "teacher", id: "t-001", name: "教师001" },
  }));
  const drill = actions.find((a) => a.label === "查看课表");
  assert.ok(drill, "应生成查看课表动作");
  assert.ok(drill.payload.query.includes("教师001"), "payload 使用业务实体名");
  assert.ok(!drill.payload.query.includes("t-001"), "payload 不得包含内部实体 id");
});

test("J3. 风险完成 + whatIf 目标 → 模拟调课动作", () => {
  const actions = nextActions(state({
    goal: { goalFamily: "teaching_assurance", completionCriteria: ["scheduleFacts", "riskFacts", "rescheduleSimFacts"] },
    completedCapabilities: ["SCHEDULE_DETAIL", "RISK_CHECK"],
    availableFacts: { scheduleFacts: { verified: true }, riskFacts: { verified: true } },
  }));
  assert.ok(actions.some((a) => a.label === "模拟调课"));
});

test("J4. 周范围课表完成 → 看下一周动作（payload 为语义 query）", () => {
  const actions = nextActions(state({
    goal: { goalFamily: "schedule_range_inquiry", completionCriteria: ["scheduleFacts"] },
    completedCapabilities: ["SCHEDULE_RANGE"],
    availableFacts: { scheduleFacts: { verified: true } },
  }));
  assert.ok(actions.some((a) => a.label === "看下一周"));
});

test("J5. collaboration 共同空闲完成 → 找教室动作", () => {
  const actions = nextActions(state({
    goal: { goalFamily: "collaboration_planning", completionCriteria: ["availabilityFacts", "spaceFacts"] },
    completedCapabilities: ["COMMON_AVAILABILITY"],
    availableFacts: { availabilityFacts: { verified: true } },
  }));
  assert.ok(actions.some((a) => a.label === "找教室"));
});

test("J6. 动作有界且确定性：max 3；同一状态两次生成字节一致", () => {
  const st = state({
    goal: { goalFamily: "teaching_assurance", completionCriteria: ["scheduleFacts", "riskFacts", "spaceFacts", "rescheduleSimFacts"] },
    completedCapabilities: ["SCHEDULE_DETAIL"],
    availableFacts: { scheduleFacts: { verified: true } },
    activeEntity: { type: "teacher", id: "t-003", name: "教师003" },
  });
  const a1 = nextActions(st);
  const a2 = nextActions(st);
  assert.ok(a1.length <= MAX_ACTIONS);
  assert.strictEqual(JSON.stringify(a1), JSON.stringify(a2));
});

test("J7. 无已完成能力 → 空动作（不伪造下一步）", () => {
  assert.deepStrictEqual(nextActions(state({ completedCapabilities: [] })), []);
});