"use strict";

const assert = require("assert");
const { callTool } = require("../mcp/campus-tools-mcp/src/tools");
const {
  adaptScheduleResult,
  adaptClassroomResult,
  adaptConflictResult,
  adaptDayPlanResult,
  adaptErrorResult,
  adaptChoiceResult,
} = require("./adapter");

function assertSafeActions(view) {
  assert(Array.isArray(view.actions), `${view.cardType}: actions 必须为数组`);
  assert(view.actions.length <= 3, `${view.cardType}: 主动作不得超过 3 个`);
  view.actions.forEach((action) => {
    assert(["sys.chat", "sys.go_to_url", "sys.download"].includes(action.type), `${view.cardType}: 非法 Action 类型 ${action.type}`);
    const serialized = JSON.stringify(action);
    assert(!/authorization|bearer\s|campus_api_token|nodeid|varbizid|system prompt|系统提示词/i.test(serialized), `${view.cardType}: Action 泄露内部字段`);
  });
}

function assertVerifiedDynamic(view, cardType) {
  assert.strictEqual(view.schemaVersion, "campus-widget/v2");
  assert.strictEqual(view.cardType, cardType);
  assert.strictEqual(view.success, true);
  assert.strictEqual(view.dataVersion, "competition-demo-v1");
  assert.strictEqual(view.evidence && view.evidence.verified, true);
  assertSafeActions(view);
}

const scheduleEnvelope = callTool("query_schedule", {
  entityType: "teacher",
  entityName: "教师001",
  week: 1,
  weekday: 3,
});
const schedule = adaptScheduleResult(scheduleEnvelope, {
  title: "教师001",
  timeText: "第1周 · 周三",
});
assertVerifiedDynamic(schedule, "schedule");
assert.strictEqual(schedule.items.length, 2);
assert(schedule.items.every((item) => item.courseName && item.periodText));
assert(schedule.actions.some((action) => action.label === "查看整周"));

const classroomEnvelope = callTool("find_available_classrooms", {
  campus: "校区A",
  week: 1,
  weekday: 1,
  periodStart: 1,
  periodEnd: 2,
  capacity: 60,
});
const classroom = adaptClassroomResult(classroomEnvelope, {
  title: "校区A · 空教室",
  query: { capacity: 60, building: "A1" },
});
assertVerifiedDynamic(classroom, "classroom");
assert(classroom.filters.some((item) => item.label === "校区A"));
assert(classroom.filters.some((item) => item.label === "容量≥60"));
assert(classroom.filters.some((item) => item.label === "A1"));
assert(classroom.items.length <= 5, "空教室首屏最多 5 条");

const selfCompareEnvelope = callTool("compare_schedules", {
  firstType: "teacher",
  firstName: "教师003",
  secondType: "teacher",
  secondName: "教师003",
  week: 1,
  weekday: 1,
});
const conflict = adaptConflictResult(selfCompareEnvelope, {});
assertVerifiedDynamic(conflict, "conflict");
assert.strictEqual(conflict.title, "教师003 · 课程安排风险检查");
assert.strictEqual(conflict.summary.conflictCount, 0);
assert.strictEqual(conflict.summary.rushWarningCount, 1);
assert.strictEqual(conflict.summary.selfCompare, true);
assert.strictEqual(conflict.rushWarnings.length, 1);

const dayPlanEnvelope = callTool("generate_day_plan", {
  visitorId: "visitor-demo-001",
  date: "2026-09-04",
  preferredCampus: "校区A",
  preferredStudyDuration: 2,
});
const dayPlan = adaptDayPlanResult(dayPlanEnvelope, {});
assertVerifiedDynamic(dayPlan, "day_plan");
assert.strictEqual(dayPlan.summary.lessonCount, 2);
assert(dayPlan.items.some((item) => item.type === "gap"));

const errorEnvelope = {
  success: false,
  queryId: "q-error-test",
  dataVersion: "competition-demo-v1",
  evidence: { verified: false },
  items: [],
  error: { code: "TIMEOUT", message: "测试超时", details: null },
};
const errorView = adaptErrorResult(errorEnvelope, {});
assert.strictEqual(errorView.schemaVersion, "campus-widget/v2");
assert.strictEqual(errorView.cardType, "error");
assert.strictEqual(errorView.success, false);
assert.strictEqual(errorView.evidence.verified, false);
assert(errorView.error && errorView.error.code === "TIMEOUT");
assertSafeActions(errorView);

const choiceEnvelope = {
  success: false,
  queryId: "q-choice-test",
  dataVersion: "competition-demo-v1",
  evidence: { verified: false },
  items: [
    { id: "internal-1", type: "teacher", name: "教师001" },
    { id: "internal-2", type: "teacher", name: "教师002" },
  ],
  error: { code: "AMBIGUOUS_ENTITY", message: "需要确认", details: null },
};
const choiceView = adaptChoiceResult(choiceEnvelope, {
  originalTask: "查询教师课表",
});
assert.strictEqual(choiceView.schemaVersion, "campus-widget/v2");
assert.strictEqual(choiceView.cardType, "choice");
assert.strictEqual(choiceView.success, false);
assert.strictEqual(choiceView.interaction.waitForUser, true);
assert(choiceView.items.length <= 5);
assert(choiceView.items.every((item) => item.action && item.action.type === "sys.chat"));
assert(choiceView.items.every((item) => !Object.prototype.hasOwnProperty.call(item.action, "internalId")));
assert(choiceView.items.every((item) => !JSON.stringify(item.action).includes("internal-")));

const unverified = JSON.parse(JSON.stringify(scheduleEnvelope));
unverified.evidence.verified = false;
assert.throws(() => adaptScheduleResult(unverified, {}), /unverified dynamic result/);

const wrongVersion = JSON.parse(JSON.stringify(scheduleEnvelope));
wrongVersion.dataVersion = "unexpected-version";
assert.throws(() => adaptScheduleResult(wrongVersion, {}), /unexpected dataVersion/);

console.log("Widget adapter contract tests passed: 6 card types + verified/action safety gates");
