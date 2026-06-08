const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";

const agentService = require("../server/src/services/ai/agentService");

const context = {
  term: "2025-2026-2",
  releaseVersion: "",
  timezone: "Asia/Shanghai",
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
  const response = await agentService.chat({ message, context });
  assert.strictEqual(response.success, true, `${message} should return success`);
  const names = response.toolCalls.map((item) => item.name);
  assert(names.includes(expectedTool), `${message} should route to ${expectedTool}, got ${names.join(",")}`);
}

async function run() {
  await assertRoutes("现在空教室", "search_empty_rooms");
  await assertRoutes("查老师课表", "search_school_index");
  await assertRoutes("今天有课吗", "get_today_courses");
  await assertRoutes("怎么导入 XLS", "explain_personal_import");
  await assertRoutes("为什么数据加载失败", "diagnose_data_status");
  console.log("test-ai-agent-tool-routing passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
