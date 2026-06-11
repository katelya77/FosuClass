const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";
process.env.AI_PROVIDER = "mock";

const agentService = require("../server/src/services/ai/agentService");
const demoData = require("../miniprogram/pages/ai-assistant/demo-data");

async function testAgentEvidenceAndSteps() {
  const response = await agentService.chat({
    message: "帮我找这周适合连续自习两节的时间和教室",
    context: {
      term: "2025-2026-2",
      releaseVersion: "test-release",
      currentScheduleSummary: {
        enabled: true,
        targetType: "personal",
        term: "2025-2026-2",
        source: "local-xls",
        courses: [{
          courseName: "高等数学",
          teacherName: "测试老师",
          classroom: "C7-101",
          weekday: 1,
          startSection: 1,
          endSection: 2,
          weeks: [1, 2, 3, 4],
        }],
      },
    },
  });
  assert.strictEqual(response.success, true);
  assert(Array.isArray(response.taskSteps), "AI response should include task steps");
  assert(response.taskSteps.some((item) => item.key === "understand"), "AI response should mark requirement understanding");
  assert(response.taskSteps.some((item) => item.key === "complete"), "AI response should mark completion");
  assert(response.evidence && response.evidence.term === "2025-2026-2", "AI evidence should include term");
  assert.strictEqual(response.evidence.releaseVersion, "test-release");
  assert.strictEqual(response.evidence.toolCount, response.toolCalls.length);
  assert(!JSON.stringify(response).includes("[object Object]"), "AI response must not render object placeholders");
}

function testDemoDataProvenance() {
  const response = demoData.getDemoResponse("meeting");
  assert(response.safety.demoData === true, "demo response should be marked as demo data");
  assert(response.evidence && response.evidence.releaseVersion === "demo-data", "demo response should not look like production release");
  assert(Array.isArray(response.taskSteps) && response.taskSteps.length >= 2, "demo response should include task steps");
}

function testLocalPersonalizationControls() {
  const store = {};
  global.wx = {
    getStorageSync(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : "";
    },
    setStorageSync(key, value) {
      store[key] = value;
    },
    removeStorageSync(key) {
      delete store[key];
    },
  };
  const service = require("../miniprogram/services/aiAssistantService");
  service.setPersonalContextAllowed(true);
  service.rememberLatestScheduleImport({
    type: "personal-xls",
    term: "2025-2026-2",
    courses: [{ courseName: "测试课", weekday: 1, startSection: 1, endSection: 2 }],
  });
  const remembered = service.getRememberedPersonalization();
  assert.strictEqual(remembered.personalContextAllowed, true);
  assert(remembered.latestScheduleImport, "latest local import should be visible to the user");
  const paused = service.pausePersonalization();
  assert.strictEqual(paused.personalContextAllowed, false, "pause should disable personal context");
  const cleared = service.clearPersonalization();
  assert.strictEqual(cleared.personalContextAllowed, false);
  assert.strictEqual(cleared.latestScheduleImport, null);
}

async function run() {
  await testAgentEvidenceAndSteps();
  testDemoDataProvenance();
  testLocalPersonalizationControls();
  console.log("test-ai-agent-operations passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
