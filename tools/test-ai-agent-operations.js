const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";
process.env.AI_PROVIDER = "mock";
// 连续自习推荐依赖脱敏个人课表摘要；与线上 AI_ALLOW_PERSONAL_CONTEXT 闸门一致
process.env.AI_ALLOW_PERSONAL_CONTEXT = "true";

const agentService = require("../server/src/services/ai/agentService");
const toolRegistry = require("../server/src/services/ai/toolRegistry");
const demoData = require("../miniprogram/packageXiaofu/pages/ai-assistant/demo-data");

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
  assert.strictEqual(String(response.intent && response.intent.name || ""), "recommend_meeting_time");
  assert(Array.isArray(response.taskSteps), "AI response should include task steps");
  assert(response.taskSteps.some((item) => item.key === "understand"), "AI response should mark requirement understanding");
  assert(response.taskSteps.some((item) => item.key === "complete"), "AI response should mark completion");
  assert(response.evidence && response.evidence.term === "2025-2026-2", "AI evidence should include term");
  assert.strictEqual(response.evidence.releaseVersion, "test-release");
  // V2 Evidence.toolCount 只统计成功的事实工具，不等于公开展示的全部 toolCalls 条数
  assert(response.evidence.toolCount >= 1, "AI evidence should count at least one successful fact tool");
  assert(Array.isArray(response.toolCalls) && response.toolCalls.length >= response.evidence.toolCount);
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

function testImportedPersonalScheduleTools() {
  const context = {
    term: "2026-2027-1",
    clientLocalTime: "2026-09-07T08:00:00+08:00",
    currentTeachingWeek: 1,
    currentScheduleSummary: {
      enabled: true,
      targetType: "personal-xls",
      term: "2026-2027-1",
      source: "xls-import",
      courses: [
        {
          courseName: "机器学习导论",
          teacherName: "李明",
          classroom: "仙溪C7-101",
          weekday: 1,
          startSection: 3,
          endSection: 4,
          weeks: [1, 3, 5, 7, 9, 11, 13, 15],
          weekText: "1-16周(单)",
        },
        {
          courseName: "数据科学基础",
          teacherName: "王芳",
          classroom: "C1-202",
          weekday: 2,
          startSection: 5,
          endSection: 6,
          weeks: [1, 2, 3, 4],
          weekText: "1-4周",
        },
      ],
    },
  };

  const today = toolRegistry.executeTool("get_today_courses", { message: "今天有什么课" }, context);
  assert.strictEqual(today.needContext, false);
  assert.strictEqual(today.courseCount, 1);
  assert.strictEqual(today.courses[0].courseName, "机器学习导论");

  const tomorrow = toolRegistry.executeTool("get_tomorrow_courses", { message: "明天有什么课" }, context);
  assert.strictEqual(tomorrow.needContext, false);
  assert.strictEqual(tomorrow.courseCount, 1);
  assert.strictEqual(tomorrow.courses[0].courseName, "数据科学基础");

  const next = toolRegistry.executeTool("get_next_course", { message: "下一节课" }, context);
  assert.strictEqual(next.courseCount, 1);
  assert.strictEqual(next.nextCourse.courseName, "机器学习导论");

  const week = toolRegistry.executeTool("get_week_schedule", { message: "本周课表" }, context);
  assert.strictEqual(week.needContext, false);
  assert.strictEqual(week.courseCount, 2);
  assert.strictEqual(week.days.length, 2);
}

async function run() {
  await testAgentEvidenceAndSteps();
  testDemoDataProvenance();
  testLocalPersonalizationControls();
  testImportedPersonalScheduleTools();
  console.log("test-ai-agent-operations passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
