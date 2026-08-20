"use strict";
// Campus Decision Intelligence 动作门禁：动作只由 Mission 完成度与权限等级导出。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { nextBestAction, nextCapabilityFor } = require(path.join(__dirname, "..", "..", "r51", "decision", "next-best-action.js"));
const { authorityAwareAction } = require(path.join(__dirname, "..", "..", "r51", "decision", "authority-action.js"));

function state(overrides = {}) {
  return {
    goal: { completionCriteria: ["availabilityFacts", "spaceFacts"] },
    availableFacts: { availabilityFacts: { verified: true } },
    steps: [{ capability: "SPACE_DISCOVERY", status: "pending" }],
    authorityLevel: "L2",
    ...overrides,
  };
}

function assertPublicChatAction(action) {
  assert.deepStrictEqual(Object.keys(action.payload), ["query"]);
  assert.strictEqual(action.type, "sys.chat");
  assert.ok(typeof action.label === "string" && action.label.length > 0);
  assert.ok(typeof action.payload.query === "string" && action.payload.query.length > 0);
  assert.ok(!JSON.stringify(action).includes("SPACE_DISCOVERY"));
  assert.ok(!JSON.stringify(action).includes("campus_classroom_search"));
}

test("D7. Mission 缺 criteria 时从 nextCapabilityId 生成下一能力动作，而非 query 关键词路由", () => {
  const action = nextBestAction({ missionState: state(), decision: { decision: "recommend" } });
  assert.deepStrictEqual(action, {
    type: "sys.chat",
    label: "查找可用教室",
    payload: { query: "查找符合当前安排的可用教室" },
  });
  assertPublicChatAction(action);
});

test("D8. 决策已收口时给出确认或精细化偏好动作", () => {
  const complete = state({
    availableFacts: { availabilityFacts: { verified: true }, spaceFacts: { verified: true } },
    steps: [{ capability: "SPACE_DISCOVERY", status: "done" }],
  });
  const confirm = nextBestAction({ missionState: complete, decision: { decision: "recommend", tieGroupCount: 0 } });
  const refine = nextBestAction({ missionState: complete, decision: { decision: "recommend", tieGroupCount: 1 } });

  assert.deepStrictEqual(confirm, {
    type: "sys.chat",
    label: "确认推荐方案",
    payload: { query: "确认采用当前推荐方案" },
  });
  assert.deepStrictEqual(refine, {
    type: "sys.chat",
    label: "细化偏好",
    payload: { query: "补充偏好后重新比较当前候选" },
  });
});

test("D8a. 已完成但缺失或未知 decision 状态时不得默认确认推荐", () => {
  const complete = state({
    availableFacts: { availabilityFacts: { verified: true }, spaceFacts: { verified: true } },
    steps: [{ capability: "SPACE_DISCOVERY", status: "done" }],
  });
  assert.strictEqual(nextBestAction({ missionState: complete }), null);
  assert.strictEqual(nextBestAction({ missionState: complete, decision: { decision: "unknown" } }), null);
});

test("D8b. scheduleFacts 没有 nextCapabilityId 时不得在 detail/range 间猜测", () => {
  assert.strictEqual(nextCapabilityFor({ missing: ["scheduleFacts"], nextCapabilityId: null }), null);
  const rangeMissionWithoutIdentity = state({
    goal: { completionCriteria: ["scheduleFacts"] },
    availableFacts: {},
    steps: [],
  });
  assert.strictEqual(nextBestAction({ missionState: rangeMissionWithoutIdentity, decision: { decision: "recommend" } }), null);
});

test("D9. L0/L1/L2 保持普通 sys.chat 动作", () => {
  const action = { type: "sys.chat", label: "确认推荐方案", payload: { query: "确认采用当前推荐方案" } };
  for (const level of ["L0", "L1", "L2"]) {
    const result = authorityAwareAction(action, { missionState: state({ authorityLevel: level }) });
    assert.deepStrictEqual(result, action, level);
    assert.strictEqual(Object.hasOwn(result, "requiresConfirm"), false, level);
  }
});

test("D10. L3 只能输出 confirmation-only 动作，且不得自动执行或暴露内部动作", () => {
  const result = authorityAwareAction(
    { type: "sys.chat", label: "执行预约", payload: { query: "执行预约 room-internal-17" } },
    { missionState: state({ authorityLevel: "L3" }) }
  );
  assert.deepStrictEqual(result, {
    type: "sys.chat",
    label: "确认后继续",
    payload: { query: "请先确认是否继续此项操作" },
    requiresConfirm: true,
  });
  assert.ok(!JSON.stringify(result).includes("room-internal-17"));
  assert.ok(!JSON.stringify(result).includes("执行预约"));
});

test("D10a. MissionState 与 L3 写入策略冲突时必须 fail-closed 为确认动作", () => {
  const result = authorityAwareAction(
    { type: "sys.chat", label: "继续", payload: { query: "继续当前安排" } },
    { missionState: state({ authorityLevel: "L2" }), goalSpec: { goalFamily: "space_inquiry", intent: "reserve" } }
  );
  assert.strictEqual(result.requiresConfirm, true);
  assert.strictEqual(result.label, "确认后继续");
});
