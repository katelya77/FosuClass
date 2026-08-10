"use strict";

const assert = require("assert");
const samples = require("./sample-results.json");
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

const schedule = adaptScheduleResult(samples.schedule, {
  title: "教师001",
  timeText: "第1周 · 周三",
});
assertVerifiedDynamic(schedule, "schedule");
assert.strictEqual(schedule.items.length, 2);
assert(schedule.items.every((item) => item.courseName && item.periodText));
assert(schedule.actions.some((action) => action.label === "查看整周"));

const classroomEnvelope = JSON.parse(JSON.stringify(samples.classroom));
classroomEnvelope.query.capacity = 60;
classroomEnvelope.query.building = "A1";
const classroom = adaptClassroomResult(classroomEnvelope, {
  title: "校区A · 空教室",
});
assertVerifiedDynamic(classroom, "classroom");
assert(classroom.filters.some((item) => item.label === "校区A"));
assert(classroom.filters.some((item) => item.label === "容量≥60"));
assert(classroom.filters.some((item) => item.label === "A1"));
assert(classroom.items.length <= 5, "空教室首屏最多 5 条");

const selfCompareEnvelope = JSON.parse(JSON.stringify(samples.conflict));
selfCompareEnvelope.compared = [
  { type: "teacher", id: "t-003", name: "教师003" },
  { type: "teacher", id: "t-003", name: "教师003" },
];
selfCompareEnvelope.items = [];
selfCompareEnvelope.summary = {
  conflictCount: 0,
  firstBusySlots: 2,
  secondBusySlots: 2,
  hasConflict: false,
  selfCompare: true,
  rushWarningCount: 1,
};
selfCompareEnvelope.rushWarnings = [{
  entity: "教师003",
  weekday: 1,
  weekdayName: "周一",
  from: {
    lessonId: "les-201",
    courseName: "程序设计基础",
    periodText: "第5-6节",
    campusName: "校区A",
    roomName: "A2-301",
  },
  to: {
    lessonId: "les-202",
    courseName: "计算机组成原理",
    periodText: "第7-8节",
    campusName: "校区B",
    roomName: "B1-201",
  },
  gapMinutes: 20,
}];
const conflict = adaptConflictResult(selfCompareEnvelope, {});
assertVerifiedDynamic(conflict, "conflict");
assert.strictEqual(conflict.title, "教师003 · 课程安排风险检查");
assert.strictEqual(conflict.summary.rushWarningCount, 1);
assert.strictEqual(conflict.summary.selfCompare, true);
assert.strictEqual(conflict.rushWarnings.length, 1);

const dayPlan = adaptDayPlanResult(samples.day_plan, {});
assertVerifiedDynamic(dayPlan, "day_plan");
assert.strictEqual(dayPlan.summary.lessonCount, 2);
assert(dayPlan.items.some((item) => item.type === "gap"));

const errorView = adaptErrorResult(samples.error, {});
assert.strictEqual(errorView.schemaVersion, "campus-widget/v2");
assert.strictEqual(errorView.cardType, "error");
assert.strictEqual(errorView.success, false);
assert.strictEqual(errorView.evidence.verified, false);
assert(errorView.error && errorView.error.code === "TIMEOUT");
assertSafeActions(errorView);

const choiceView = adaptChoiceResult(samples.choice, {
  originalTask: "查询A的课表",
});
assert.strictEqual(choiceView.schemaVersion, "campus-widget/v2");
assert.strictEqual(choiceView.cardType, "choice");
assert.strictEqual(choiceView.success, false);
assert.strictEqual(choiceView.interaction.waitForUser, true);
assert(choiceView.items.length <= 5);
assert(choiceView.items.every((item) => item.action && item.action.type === "sys.chat"));
assert(choiceView.items.every((item) => !Object.prototype.hasOwnProperty.call(item.action, "internalId")));

const unverified = JSON.parse(JSON.stringify(samples.schedule));
unverified.evidence.verified = false;
assert.throws(() => adaptScheduleResult(unverified, {}), /unverified dynamic result/);

const wrongVersion = JSON.parse(JSON.stringify(samples.schedule));
wrongVersion.dataVersion = "unexpected-version";
assert.throws(() => adaptScheduleResult(wrongVersion, {}), /unexpected dataVersion/);

console.log("Widget adapter contract tests passed: 6 card types + verified/action safety gates");
