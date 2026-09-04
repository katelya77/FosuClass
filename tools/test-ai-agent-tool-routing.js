const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";
process.env.AI_RUNTIME_MODE = "competition";
process.env.AI_PROVIDER_ACTIVE_ENV = process.env.AI_PROVIDER_ACTIVE_ENV || "trial";
process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
process.env.NODE_ENV = "development";

const agentService = require("../server/src/services/ai/agentService");
const toolRegistry = require("../server/src/services/ai/toolRegistry");

const context = {
  term: "2025-2026-2",
  releaseVersion: "",
  timezone: "Asia/Shanghai",
  envVersion: "develop",
  currentScheduleSummary: {
    enabled: true,
    targetType: "class",
    targetName: "测试班",
    courses: [{
      courseName: "高等数学",
      teacherName: "测试老师",
      classroom: "C7-101",
      weekday: new Date().getDay() || 7,
      startSection: 3,
      endSection: 4,
      weeks: [1, 2, 3],
    }],
  },
};

async function assertRoutes(message, expectedTool) {
  const response = await agentService.chat({
    message,
    context,
    runtimeMode: "competition",
    serverSession: { openidHash: "unit-test-openid" },
  });
  assert(response && Array.isArray(response.toolCalls), `${message} should return a tool trace`);
  const names = response.toolCalls.map((item) => item.name);
  assert(names.includes(expectedTool), `${message} should route to ${expectedTool}, got ${names.join(",")}`);
}

async function run() {
  await assertRoutes("现在空教室", "search_empty_rooms");
  await assertRoutes("查张三老师课表", "search_school_index");
  await assertRoutes("今天有课吗", "get_today_courses");
  await assertRoutes("怎么导入 XLS", "explain_personal_import");
  await assertRoutes("为什么数据加载失败", "diagnose_data_status");

  const fixedContext = Object.assign({}, context, {
    clientLocalTime: "2026-09-04T10:00:00+08:00",
    currentWeek: 2,
  });
  const emptyRoom = toolRegistry.resolveIntent("后天下午在江湾校区 C7 找连续3节空教室", fixedContext);
  assert.strictEqual(emptyRoom.name, "search_continuous_empty_rooms");
  assert.deepStrictEqual({
    date: emptyRoom.slots.date,
    dateOffset: emptyRoom.slots.dateOffset,
    campus: emptyRoom.slots.campus,
    building: emptyRoom.slots.building,
    sections: emptyRoom.slots.sections,
    minFreeSections: emptyRoom.slots.minFreeSections,
  }, {
    date: "2026-09-06",
    dateOffset: 2,
    campus: "江湾校区",
    building: "C7",
    sections: "5-8",
    minFreeSections: 3,
  });

  const scheduleSearch = toolRegistry.resolveIntent("查第8周周三下午江湾校区陈芳老师课表", fixedContext);
  assert.strictEqual(scheduleSearch.name, "search_school_index");
  assert.deepStrictEqual({
    type: scheduleSearch.slots.type,
    q: scheduleSearch.slots.q,
    week: scheduleSearch.slots.week,
    weekday: scheduleSearch.slots.weekday,
    periodHint: scheduleSearch.slots.periodHint,
    sections: scheduleSearch.slots.sections,
    campus: scheduleSearch.slots.campus,
  }, {
    type: "teacher",
    q: "陈芳",
    week: 8,
    weekday: 3,
    periodHint: "afternoon",
    sections: "5-8",
    campus: "江湾校区",
  });

  const tomorrow = toolRegistry.resolveIntent("明天有什么课", fixedContext);
  assert.strictEqual(tomorrow.name, "get_tomorrow_courses");
  assert.strictEqual(tomorrow.slots.date, "2026-09-05");
  assert.strictEqual(tomorrow.slots.dateOffset, 1);

  const inThreeDays = toolRegistry.resolveIntent("大后天上午仙溪有哪些空教室", fixedContext);
  assert.strictEqual(inThreeDays.name, "search_empty_rooms");
  assert.strictEqual(inThreeDays.slots.dateOffset, 3);
  assert.strictEqual(inThreeDays.slots.date, "2026-09-07");
  assert.strictEqual(inThreeDays.slots.sections, "1-4");
  assert.strictEqual(inThreeDays.slots.campus, "仙溪校区");
  console.log("test-ai-agent-tool-routing passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
