"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), "utf8"));

const dataset = readJson("E_Data", "competition-demo-v3.json");
assert.equal(dataset.meta.dataVersion, "competition-demo-v3");
assert.equal(dataset.meta.dataHash, "sha1:842b7959e808");
assert.deepEqual(
  {
    campuses: dataset.campuses.length,
    colleges: dataset.colleges.length,
    classes: dataset.classes.length,
    teachers: dataset.teachers.length,
    courses: dataset.courses.length,
    rooms: dataset.rooms.length,
    lessons: dataset.lessons.length,
  },
  { campuses: 4, colleges: 6, classes: 24, teachers: 40, courses: 73, rooms: 85, lessons: 175 },
);

const bindings = readJson("D_Agent配置", "agent-tool-bindings.json");
assert.equal(Object.keys(bindings.agents).length, 4);
assert.equal(bindings.uniqueOperationCount, 13);
assert.equal(bindings.bindingCount, 14);
assert.deepEqual(bindings.agents.main, []);
assert.deepEqual(bindings.sharedTools.campus_academic_context, ["schedule", "risk"]);

process.env.CAMPUS_DATA_PATH = path.join(ROOT, "E_Data", "competition-demo-v3.json");
const { TOOL_DEFS, callTool } = require(path.join(ROOT, "B_CampusTools", "core-src", "tools.js"));
const { AGENT_TOOL_MAP } = require(path.join(ROOT, "B_CampusTools", "core-src", "agent-tools.js"));
assert.equal(Object.keys(AGENT_TOOL_MAP).length, 13);
assert.ok(Object.values(AGENT_TOOL_MAP).every((name) => TOOL_DEFS.some((tool) => tool.name === name)));

for (const week of [1, 2, 3, 4]) {
  const risk = callTool("compare_schedules", {
    firstType: "teacher", firstName: "教师025",
    secondType: "teacher", secondName: "教师025", week,
  });
  assert.equal(risk.summary.conflictCount, 0);
  assert.equal(risk.summary.rushWarningCount, 4);
  assert.ok(risk.rushWarnings.every((item) => item.gapMinutes === 20));
}

const rooms = callTool("find_available_classrooms", { week: 1, weekday: 4, periodStart: 1, periodEnd: 4 });
assert.equal(rooms.items.length, 63);

const group = callTool("plan_group", {
  entities: [
    { type: "teacher", name: "教师005" },
    { type: "teacher", name: "教师006" },
    { type: "teacher", name: "教师014" },
  ],
  week: 1, weekday: 4, periodStart: 1, periodEnd: 4,
  minConsecutivePeriods: 4, minCapacity: 120,
});
assert.equal(group.items[0].roomCount, 7);
assert.equal(group.items[0].rooms[0].roomName, "A1-201");
assert.equal(group.items[0].rooms[0].capacity, 120);

const reschedule = callTool("check_reschedule_feasibility", {
  sourceLessonId: "lesson-001",
  target: { week: 1, weekday: 4, periodStart: 7, periodEnd: 8 },
});
assert.equal(reschedule.summary.feasible, true);
assert.equal(reschedule.summary.warningCount, 1);
assert.equal(reschedule.simulation.mutatedData, false);
assert.equal(reschedule.items[0].checks.spaceAvailability.roomCount, 8);
assert.equal(reschedule.items[0].checks.spaceAvailability.suggestedRoom.name, "A1-201");

const insight = callTool("query_teacher_load", { weekStart: 1, weekEnd: 4, topN: 1 });
assert.equal(insight.items[0].teacher.name, "教师025");
assert.equal(insight.items[0].lessonOccurrences, 56);
assert.equal(insight.items[0].periodUnits, 112);

for (const name of ["risk", "collaboration", "reschedule", "insight"]) {
  const golden = readJson("F_Verification", "Golden-Result", `${name}.json`);
  assert.equal(golden.dataVersion, "competition-demo-v3");
  assert.equal(golden.verified, true);
}

const widget = fs.readFileSync(path.join(ROOT, "C_Widget", "小序-校园智序结果卡.widget"), "utf8");
assert.doesNotThrow(() => JSON.parse(widget));
assert.ok(widget.includes('"verified"'));

console.log("PASS: 4 Agent / 13 CampusTools / 14 bindings / 4 Golden Result");
