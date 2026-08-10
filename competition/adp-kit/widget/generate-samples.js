"use strict";

const fs = require("fs");
const path = require("path");
const { callTool } = require("../mcp/campus-tools-mcp/src/tools");
const {
  adaptScheduleResult,
  adaptClassroomResult,
  adaptConflictResult,
  adaptDayPlanResult,
  adaptErrorResult,
  adaptChoiceResult,
} = require("./adapter");

function stableSample(envelope, queryId) {
  return Object.assign({}, envelope, {
    queryId,
    evidence: Object.assign({}, envelope.evidence, { computedAt: "2026-08-31T00:00:00.000Z" }),
  });
}

const scheduleEnvelope = stableSample(
  callTool("query_schedule", { entityType: "teacher", entityName: "教师001", week: 1, weekday: 3 }),
  "q-sample-schedule",
);
const classroomEnvelope = stableSample(
  callTool("find_available_classrooms", { campus: "校区A", week: 1, weekday: 1, periodStart: 1, periodEnd: 2, capacity: 60 }),
  "q-sample-classroom",
);
const conflictEnvelope = stableSample(
  callTool("compare_schedules", { firstType: "class", firstName: "2025级A班", secondType: "class", secondName: "2025级B班", week: 1, weekday: 5, periodStart: 5, periodEnd: 8 }),
  "q-sample-conflict",
);
const dayPlanEnvelope = stableSample(
  callTool("generate_day_plan", { visitorId: "visitor-demo-001", date: "2026-09-04", preferredCampus: "校区A", preferredStudyDuration: 2 }),
  "q-sample-day-plan",
);

const choiceEnvelope = {
  success: false,
  queryId: "q-choice-demo",
  dataVersion: "competition-demo-v1",
  evidence: { verified: false },
  items: [
    { id: "cls-2025-a", type: "class", name: "2025级A班" },
    { id: "campus-a", type: "campus", name: "校区A" },
    { id: "course-a", type: "course", name: "课程A" },
  ],
  error: { code: "AMBIGUOUS_ENTITY", message: "需要确认", details: null },
};

const errorEnvelope = {
  success: false,
  queryId: "q-error-demo",
  dataVersion: "competition-demo-v1",
  evidence: { verified: false },
  items: [],
  error: {
    code: "TIMEOUT",
    message: "查询超时。小序没有使用模型生成内容代替工具结果。",
    details: null,
  },
};

const samples = {
  schedule: adaptScheduleResult(scheduleEnvelope, {
    title: "教师001 · 课表",
    timeText: "第1周 · 周三",
  }),
  classroom: adaptClassroomResult(classroomEnvelope, {
    title: "校区A · 空教室",
    timeText: "2026-08-31 · 第1-2节",
    query: { capacity: 60 },
  }),
  conflict: adaptConflictResult(conflictEnvelope, {
    timeText: "第1周 · 周五下午",
  }),
  day_plan: adaptDayPlanResult(dayPlanEnvelope, {
    timeText: "2026-09-04 · 周五",
  }),
  choice: adaptChoiceResult(choiceEnvelope, {
    title: "找到多个匹配，请确认一个",
    originalTask: "刚才的课表查询",
  }),
  error: adaptErrorResult(errorEnvelope, {
    title: "这次没有查成功",
  }),
};

const output = path.join(__dirname, "sample-results.json");
fs.writeFileSync(output, `${JSON.stringify(samples, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(__dirname, "sample-results.js"), `window.CampusTaskSamples = ${JSON.stringify(samples, null, 2)};\n`, "utf8");
console.log(`[ok] 生成 ${output}`);
