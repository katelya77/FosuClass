"use strict";
// CSF P8 多模态预留 gate（2026-08-19）
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const model = require(path.join(__dirname, "..", "..", "r51", "mission", "model.js"));
const planner = require(path.join(__dirname, "..", "..", "r51", "mission", "planner.js"));

test("M1. MM-RESERVE.md 存在并声明视觉不得覆盖确定性事实", () => {
  const doc = fs.readFileSync(path.join(__dirname, "..", "..", "multimodal", "MM-RESERVE.md"), "utf8");
  assert.ok(doc.includes("visionAssets"), "预留文档必须定义 visionAssets");
  assert.ok(/不能覆盖|不能改写/.test(doc), "必须声明视觉不能覆盖课表事实");
  assert.ok(doc.includes("确定性工具"), "必须指向确定性工具为事实源");
});

test("M2. visionAssets 合法透传：校验通过并随 goal 保留快照", () => {
  const spec = {
    goalFamily: "schedule_inquiry",
    temporalScope: { kind: "explicit", weekStart: 2, weekEnd: 2, weekday: 3 },
    target: { entityRef: "t1" },
    visionAssets: ["asset-demo-01", { id: "asset-demo-02", type: "image", role: "reference" }],
  };
  const v = model.validateGoalSpec(spec);
  assert.strictEqual(v.ok, true);
  const plan = planner.planMission(spec);
  assert.deepStrictEqual(plan.goal.visionAssets, ["asset-demo-01", { id: "asset-demo-02", type: "image", role: "reference" }]);
  const st = model.newMissionState(spec);
  assert.deepStrictEqual(st.goal.visionAssets, ["asset-demo-01", { id: "asset-demo-02", type: "image", role: "reference" }]);
});

test("M3. visionAssets 绝不进入工具参数 / steps", () => {
  const spec = {
    goalFamily: "teaching_assurance",
    temporalScope: { kind: "explicit", weekStart: 2, weekEnd: 2 },
    constraints: { needSpace: true },
    visionAssets: ["asset-demo-01"],
  };
  const plan = planner.planMission(spec);
  const serialized = JSON.stringify(plan.steps);
  assert.ok(!serialized.includes("visionAssets"), "steps 不得携带 visionAssets");
  assert.ok(!serialized.includes("asset-demo-01"), "steps 不得携带资产引用");
});

test("M4. 非法 visionAssets fail closed", () => {
  const bad = { goalFamily: "schedule_inquiry", visionAssets: "not-an-array" };
  assert.strictEqual(model.validateGoalSpec(bad).ok, false);
  const badElem = { goalFamily: "schedule_inquiry", visionAssets: [42] };
  assert.strictEqual(model.validateGoalSpec(badElem).ok, false);
});