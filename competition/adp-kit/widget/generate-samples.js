"use strict";

const fs = require("fs");
const path = require("path");
const { callTool } = require("../mcp/campus-tools-mcp/src/tools");

function card(cardType, envelope, extra = {}) {
  return Object.assign({ cardType }, envelope, extra);
}

function stableSample(envelope, queryId) {
  return Object.assign({}, envelope, {
    queryId,
    evidence: Object.assign({}, envelope.evidence, { computedAt: "2026-03-02T00:00:00.000Z" }),
  });
}

const schedule = stableSample(callTool("query_schedule", { entityType: "teacher", entityName: "教师001", week: 1, weekday: 3 }), "q-sample-schedule");
const classroom = stableSample(callTool("find_available_classrooms", { campus: "校区A", week: 1, weekday: 1, periodStart: 1, periodEnd: 2, capacity: 60 }), "q-sample-classroom");
const conflict = stableSample(callTool("compare_schedules", { firstType: "class", firstName: "2025级A班", secondType: "class", secondName: "2025级B班", week: 1, weekday: 5, periodStart: 5, periodEnd: 8 }), "q-sample-conflict");
const dayPlan = stableSample(callTool("generate_day_plan", { visitorId: "visitor-demo-001", date: "2026-03-06", preferredCampus: "校区A", preferredStudyDuration: 2 }), "q-sample-day-plan");

const samples = {
  schedule: card("schedule", schedule, { title: "教师001", timeText: "第1周 · 周三", sectionLabel: "课程安排" }),
  classroom: card("classroom", classroom, { title: "校区A · 空教室", timeText: "2026-03-02 · 第1-2节", sectionLabel: `找到 ${classroom.items.length} 间，展示前5间` }),
  conflict: card("conflict", conflict, { title: "A班 ↔ B班", timeText: "第1周 · 周五下午", sectionLabel: "重叠时段" }),
  day_plan: card("day_plan", dayPlan, { title: "演示用户001", timeText: "2026-03-06 · 周五", sectionLabel: "课程与空档" }),
  choice: {
    cardType: "choice", success: false, queryId: "q-choice-demo", dataVersion: "competition-demo-v1",
    title: "“A”存在多个候选", timeText: "请选择要继续查询的对象", evidence: { verified: false },
    items: [{ id: "cls-2025-a", type: "class", name: "2025级A班" }, { id: "campus-a", type: "campus", name: "校区A" }, { id: "college-a", type: "college", name: "学院A" }],
    actions: [{ type: "cancel_choice", label: "重新描述" }], error: { code: "AMBIGUOUS_ENTITY", message: "需要确认", details: null },
  },
  error: {
    cardType: "error", success: false, queryId: "q-error-demo", dataVersion: "competition-demo-v1",
    title: "CampusTools 暂时不可用", timeText: "本次动态事实尚未核验", evidence: { verified: false }, items: [],
    actions: [{ type: "retry", label: "重新查询" }, { type: "edit_query", label: "修改条件" }],
    error: { code: "TIMEOUT", message: "查询超时。小序没有使用模型生成内容代替工具结果。", details: null },
  },
};

for (const value of Object.values(samples)) {
  if (value.items && value.items.length > 8) value.items = value.items.slice(0, 8);
}

const output = path.join(__dirname, "sample-results.json");
fs.writeFileSync(output, `${JSON.stringify(samples, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(__dirname, "sample-results.js"), `window.CampusTaskSamples = ${JSON.stringify(samples, null, 2)};\n`, "utf8");
console.log(`[ok] 生成 ${output}`);
