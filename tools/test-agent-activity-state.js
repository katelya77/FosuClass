#!/usr/bin/env node
const assert = require("assert");

const {
  activityPatchForRunEvent,
  activityPatchForResponse,
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
  assert.strictEqual(
    activityPatchForRunEvent({ type: "run.completed", status: "partial", partialCompletion: true }).agentActivityState,
    "degraded",
    "partial terminal events must never become complete"
  );
  assert.strictEqual(
    activityPatchForRunEvent({ type: "run.completed", status: "failed", success: false, errorCount: 1 }).agentActivityState,
    "network_error",
    "failed terminal events must never become complete"
  );

  assert.strictEqual(activityPatchForResponse({ status: "partial", success: false, partialCompletion: true }).agentActivityState, "degraded");
  assert.strictEqual(activityPatchForResponse({ status: "failed", success: false, errors: [{ code: "VERIFY_FAILED" }] }).agentActivityState, "network_error");
  assert.strictEqual(activityPatchForResponse({ status: "degraded", success: true, fallback: true }).agentActivityState, "degraded");
  const unverifiedSuccess = activityPatchForResponse({ status: "completed", success: true });
  assert.strictEqual(unverifiedSuccess.agentActivityState, "complete");
  assert.ok(!/核验/.test(unverifiedSuccess.statusCapsuleText), "an unverified response must not claim verification");

  // M2-T2: verification.* run events map to the verifying activity state.
  assert.strictEqual(
    activityPatchForRunEvent({ type: "verification.started", text: "正在核验结果" }).agentActivityState,
    "verifying",
    "verification.started must map to verifying"
  );
  const verificationDone = activityPatchForRunEvent({ type: "verification.completed", text: "结果已核验" });
  assert.strictEqual(
    verificationDone.agentActivityState,
    "verifying",
    "verification.completed must map to verifying"
  );
  assert.ok(
    !/Thinking/.test(verificationDone.statusCapsuleText),
    "verification events must never masquerade as Thinking"
  );

  console.log("test-agent-activity-state: PASS");
}

run();
