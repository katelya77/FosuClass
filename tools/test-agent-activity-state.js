#!/usr/bin/env node
const assert = require("assert");

const {
  activityPatchForRunEvent,
  createSubmittingActivityPatch,
} = require("../miniprogram/services/agentActivityState");

function run() {
  const submitting = createSubmittingActivityPatch();
  assert.strictEqual(submitting.agentActivityState, "submitting");
  assert.ok(!/理解|Thinking/.test(submitting.statusCapsuleText));

  assert.strictEqual(
    activityPatchForRunEvent({ type: "understanding.started", text: "正在理解你的目标" }).agentActivityState,
    "understanding"
  );
  assert.notStrictEqual(
    activityPatchForRunEvent({ type: "provider.selected", text: "已选择推理层" }).agentActivityState,
    "thinking",
    "provider selection is not a real model call"
  );
  assert.strictEqual(
    activityPatchForRunEvent({ type: "provider.started", text: "正在增强理解" }).agentActivityState,
    "thinking"
  );
  assert.strictEqual(
    activityPatchForRunEvent({ type: "tool.started", text: "正在读取权威数据" }).agentActivityState,
    "querying"
  );
  assert.strictEqual(
    activityPatchForRunEvent({ type: "result.verifying", text: "正在核验" }).agentActivityState,
    "composing"
  );
  assert.strictEqual(
    activityPatchForRunEvent({ type: "understanding.fallback", text: "已切换确定性理解" }).agentActivityState,
    "degraded"
  );
  assert.strictEqual(
    activityPatchForRunEvent({ type: "provider.failed", text: "推理层暂不可用" }).agentActivityState,
    "degraded"
  );
  assert.strictEqual(
    activityPatchForRunEvent({ type: "run.completed", text: "已完成" }).agentActivityState,
    "complete"
  );

  console.log("test-agent-activity-state: PASS");
}

run();
