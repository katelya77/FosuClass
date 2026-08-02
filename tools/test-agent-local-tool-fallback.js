#!/usr/bin/env node
const assert = require("assert");

const storage = {};
global.wx = {
  getStorageSync(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ""; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  getSystemInfoSync() { return { platform: "ios" }; },
  getAccountInfoSync() { return { miniProgram: { envVersion: "trial" } }; },
  showLoading() {},
  hideLoading() {},
  showToast() {},
};
global.getCurrentPages = () => [];
global.getApp = () => ({
  globalData: {
    activeRelease: {
      term: "2025-2026-2",
      releaseVersion: "local-test-release",
      manifest: { term: "2025-2026-2", releaseVersion: "local-test-release" },
    },
    appConfig: { currentSemester: "2025-2026-2", availableTerms: [] },
  },
});

const aiTransportRouter = require("../miniprogram/services/aiTransportRouter");
const aiAssistantService = require("../miniprogram/services/aiAssistantService");
const agentActivityState = require("../miniprogram/services/agentActivityState");

const originalTransportChat = aiTransportRouter.chat;

function transportFailure(code) {
  const error = new Error(code);
  error.code = code;
  aiTransportRouter.chat = async () => { throw error; };
}

async function run() {
  transportFailure("NETWORK_OFFLINE");
  const greeting = await aiAssistantService.chat("你好", {
    envVersion: "trial",
    releaseVersion: "local-test-release",
  });
  assert.strictEqual(greeting.success, true, "deterministic greeting remains available offline");
  assert.strictEqual(greeting.fallbackLayer, "client");
  assert.strictEqual(greeting.resultOrigin, "local_device", "offline result identifies its real origin");
  assert.strictEqual(greeting.resultLabel, "本机结果", "offline result has an explicit user-facing label");
  assert.strictEqual(greeting.runId, "", "client fallback must never fabricate a server runId");
  assert.strictEqual(greeting.externalProviderUsed, false);
  assert.ok(!Array.isArray(greeting.steps) || greeting.steps.length === 0, "client fallback must not fabricate Run steps");

  const greetingActivity = agentActivityState.activityPatchForResponse(greeting);
  assert.strictEqual(greetingActivity.agentActivityState, "degraded", "successful local result is not a failed terminal state");
  assert.match(greetingActivity.statusCapsuleText, /本机结果/);

  transportFailure("TLS_FAILED");
  const cachedSchedule = await aiAssistantService.chat("今天有什么课", {
    envVersion: "trial",
    term: "2025-2026-2",
    releaseVersion: "local-test-release",
    currentTeachingWeek: 1,
    todayWeekday: 1,
    currentScheduleSummary: {
      enabled: true,
      source: "local-personal-schedule-cache",
      courses: [{
        courseName: "动物生理学",
        teacherName: "陈老师",
        classroom: "C6-101",
        weekday: 1,
        startSection: 1,
        endSection: 2,
        startWeek: 1,
        endWeek: 18,
      }],
    },
  });
  assert.strictEqual(cachedSchedule.success, true);
  assert.strictEqual(cachedSchedule.resultOrigin, "local_device");
  assert.match(JSON.stringify(cachedSchedule.cards || []), /动物生理学/);
  assert.ok((cachedSchedule.cards || []).every((card) => (card.badges || []).includes("本机结果")), "every local fact card is visibly marked");

  transportFailure("WECHAT_NETWORK_REQUEST_FAILED");
  const ambiguousNetwork = await aiAssistantService.chat("你好", { envVersion: "trial" });
  assert.strictEqual(ambiguousNetwork.success, true, "ambiguous wx.request failures may use safe local tools");
  assert.strictEqual(ambiguousNetwork.fallbackReason, "WECHAT_NETWORK_REQUEST_FAILED");

  const unsupported = await aiAssistantService.buildClientFallbackForTest(
    "帮我总结这篇没有缓存的论文并发邮件",
    { envVersion: "trial", releaseVersion: "local-test-release" },
    "NETWORK_OFFLINE"
  );
  assert.strictEqual(unsupported.success, false, "unsupported offline work must not be presented as completed");
  assert.strictEqual(unsupported.status, "failed");
  assert.match(unsupported.answer, /需要联网/);
  assert.strictEqual(unsupported.resultOrigin, "local_device");

  const emptyLocal = aiAssistantService.getLocalCapabilityStatus({
    currentScheduleSummary: { enabled: false, courses: [] },
    releaseVersion: "",
  });
  assert.strictEqual(emptyLocal.canExecute, false);
  assert.strictEqual(emptyLocal.statusText, "离线 · 仅可查看已缓存页面");

  const releaseLocal = aiAssistantService.getLocalCapabilityStatus({
    releaseVersion: "local-test-release",
    currentTeachingWeek: 1,
    currentScheduleSummary: { enabled: false, courses: [] },
  });
  assert.strictEqual(releaseLocal.canExecute, true);
  assert.ok(releaseLocal.capabilities.includes("cached_release_pack"));

  const personalLocal = aiAssistantService.getLocalCapabilityStatus({
    currentScheduleSummary: { enabled: true, courses: [{ courseName: "动物生理学" }] },
  });
  assert.strictEqual(personalLocal.canExecute, true);
  assert.ok(personalLocal.capabilities.includes("personal_schedule"));

  console.log("test-agent-local-tool-fallback passed (27 checks)");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  aiTransportRouter.chat = originalTransportChat;
});
