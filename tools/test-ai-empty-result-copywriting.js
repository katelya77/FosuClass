const assert = require("assert");

const mockProvider = require("../server/src/services/ai/providers/mockProvider");

function textOf(payload) {
  return JSON.stringify(payload);
}

function generate(name, result) {
  return mockProvider.generate({
    intent: { name },
    toolResults: [{ name, status: "success", result }],
  });
}

function run() {
  assert(/老师姓名|哪位老师/.test(textOf(generate("clarify_missing_slot", {
    slot: { type: "teacher", missing: "teacherName" },
  }))), "teacher clarification should ask for teacher name");

  assert(/换短关键词|检查姓名|打开全校查询/.test(textOf(generate("search_school_index", {
    success: true,
    type: "teacher",
    q: "不存在老师",
    items: [],
    total: 0,
  }))), "teacher empty result should give practical suggestions");

  assert(/C7-203|C7|B8/.test(textOf(generate("search_school_index", {
    success: true,
    type: "classroom",
    q: "教室",
    items: [],
    total: 0,
  }))), "classroom empty result should suggest room formats");

  assert(/2-4 个关键字/.test(textOf(generate("search_school_index", {
    success: true,
    type: "course",
    q: "课程",
    items: [],
    total: 0,
  }))), "course empty result should suggest shorter course keywords");

  assert(/换楼栋|换节次|取消连续/.test(textOf(generate("search_empty_rooms", {
    success: true,
    rooms: [],
    total: 0,
    actionUrl: "/pages/empty-room/empty-room",
  }))), "empty room empty result should suggest changing filters");

  assert(/绑定班级课表|导入 XLS/.test(textOf(generate("get_today_courses", {
    success: true,
    needContext: true,
    courses: [],
    summary: "未收到当前课表摘要",
    actionUrl: "/pages/personal-sync/personal-sync?tab=xls",
  }))), "today no-context copy should guide schedule binding or XLS import");

  const diagnosis = generate("diagnose_data_status", {
    success: true,
    activeReleaseVersion: "demo",
    indexCounts: { class: 1, teacher: 2, classroom: 3, course: 4 },
    releasePackHealthy: true,
  });
  assert(/班级索引/.test(textOf(diagnosis)) && /教师索引/.test(textOf(diagnosis)) && /教室索引/.test(textOf(diagnosis)) && /课程索引/.test(textOf(diagnosis)),
    "diagnosis should translate index count names to Chinese");

  const labels = textOf(diagnosis) + textOf(generate("explain_personal_import", { success: true, steps: [], actionUrl: "/pages/personal-sync/personal-sync?tab=xls" }));
  assert(/打开全校查询/.test(labels), "actions should include natural school query label");
  assert(/去 XLS 导入/.test(labels), "actions should include natural XLS label");

  console.log("test-ai-empty-result-copywriting passed");
}

run();
