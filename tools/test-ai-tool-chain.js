const assert = require("assert");

process.env.AI_AGENT_ENABLED = "false";

const releaseService = require("../server/src/services/releaseService");
const toolRegistry = require("../server/src/services/ai/toolRegistry");
const agentService = require("../server/src/services/ai/agentService");

function findUniqueTeacherQuery() {
  const index = releaseService.readActiveIndex("teacher");
  const items = Array.isArray(index.items) ? index.items : [];
  for (const item of items.slice(0, 100)) {
    const name = item.teacherName || item.name;
    if (!name || String(name).length < 2) continue;
    const result = releaseService.searchActiveIndex("teacher", name, { limit: 8 });
    if (result.success && Array.isArray(result.items) && result.items.length === 1) {
      return name;
    }
  }
  return "";
}

async function run() {
  const teacherName = findUniqueTeacherQuery();
  if (teacherName) {
    const intent = toolRegistry.resolveIntent(`查${teacherName}老师课表`, {});
    const calls = toolRegistry.runToolChainForIntent(intent, `查${teacherName}老师课表`, {});
    const names = calls.map((item) => item.name);
    assert(names.includes("search_school_index"), "teacher query should search school index");
    assert(names.includes("get_schedule_detail"), "single high-confidence teacher hit should read schedule detail");
  } else {
    const response = await agentService.chat({ message: "查张三老师课表", context: {} });
    const toolNames = (response.toolCalls || []).map((item) => String(item.name || ""));
    const hasSchoolIndex = toolNames.some((name) => (
      name === "search_school_index"
      || name.indexOf("search_school_index") >= 0
      || name.indexOf("全校") >= 0
      || name.indexOf("查询") >= 0
    ));
    const intentName = response.intent && response.intent.name || response.metrics && response.metrics.intentName || "";
    assert(
      hasSchoolIndex || intentName === "search_school_index",
      "teacher query should keep search_school_index compatible"
    );
  }

  const emptyIntent = { name: "search_empty_rooms", slots: { releaseVersion: "missing-release-for-ai-test", sections: "1-2" } };
  const emptyCalls = toolRegistry.runToolChainForIntent(emptyIntent, "现在有空教室吗", { releaseVersion: "missing-release-for-ai-test" });
  const emptyNames = emptyCalls.map((item) => item.name);
  assert(emptyNames.includes("search_empty_rooms"), "empty room chain should run search_empty_rooms");
  assert(emptyNames.includes("diagnose_data_status"), "empty room failure or empty result should append diagnose_data_status");

  const context = {
    currentScheduleSummary: {
      enabled: true,
      targetType: "class",
      targetName: "测试班",
      courses: [{ weekday: 1, startSection: 1, endSection: 2, courseName: "测试课" }],
    },
  };
  const meetingIntent = toolRegistry.resolveIntent("帮我推荐连续 2 节自习时间", context);
  assert(!meetingIntent.slots.date, "undated recommendation must search the remaining week instead of pinning today");
  const meetingCalls = toolRegistry.runToolChainForIntent(meetingIntent, "帮我推荐连续 2 节自习时间", context);
  const meetingNames = meetingCalls.map((item) => item.name);
  assert(meetingNames.includes("recommend_meeting_time"), "meeting chain should calculate candidates");
  assert(meetingNames.includes("search_empty_rooms"), "meeting chain should append empty room lookup");
  const meetingResult = meetingCalls[0].result || {};
  assert(Array.isArray(meetingResult.candidates), "meeting result should include candidates");
  assert(meetingResult.emptyRoomActionUrl, "meeting result should include empty room action");

  console.log("test-ai-tool-chain passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
