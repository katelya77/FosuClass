"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), "utf8"));

const dataset = readJson("data", "competition-demo-v3.json");
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

const bindings = readJson("bindings", "agent-tool-bindings.json");
assert.equal(Object.keys(bindings.agents).length, 4);
assert.equal(bindings.uniqueOperationCount, 13);
assert.equal(bindings.bindingCount, 14);
assert.deepEqual(bindings.agents.main, []);
assert.deepEqual(bindings.sharedTools.campus_academic_context, ["schedule", "risk"]);

const { TOOL_DEFS, callTool } = require(path.join(ROOT, "campus-tools", "src", "tools.js"));
const { AGENT_TOOL_MAP } = require(path.join(ROOT, "campus-tools", "src", "agent-tools.js"));
assert.equal(Object.keys(AGENT_TOOL_MAP).length, 13);
assert.ok(Object.values(AGENT_TOOL_MAP).every((name) => TOOL_DEFS.some((tool) => tool.name === name)));
assert.deepEqual(TOOL_DEFS.map((tool) => tool.name).filter((name) => !Object.values(AGENT_TOOL_MAP).includes(name)), ["resolve_entity"]);

for (const week of [1, 2, 3, 4]) {
  const risk = callTool("compare_schedules", {
    firstType: "teacher",
    firstName: "教师025",
    secondType: "teacher",
    secondName: "教师025",
    week,
  });
  assert.equal(risk.success, true);
  assert.equal(risk.summary.conflictCount, 0);
  assert.equal(risk.summary.rushWarningCount, 4);
  assert.ok(risk.rushWarnings.every((item) => item.gapMinutes === 20));
}

const allRooms = callTool("find_available_classrooms", {
  week: 1,
  weekday: 4,
  periodStart: 1,
  periodEnd: 4,
});
assert.equal(allRooms.success, true);
assert.equal(allRooms.items.length, 63);

const group = callTool("plan_group", {
  entities: [
    { type: "teacher", name: "教师005" },
    { type: "teacher", name: "教师006" },
    { type: "teacher", name: "教师014" },
  ],
  week: 1,
  weekday: 4,
  periodStart: 1,
  periodEnd: 4,
  minConsecutivePeriods: 4,
  minCapacity: 120,
});
assert.equal(group.success, true);
assert.equal(group.items[0].roomCount, 7);
assert.equal(group.items[0].rooms[0].roomName, "A1-201");
assert.equal(group.items[0].rooms[0].capacity, 120);

const reschedule = callTool("check_reschedule_feasibility", {
  sourceLessonId: "lesson-001",
  target: { week: 1, weekday: 4, periodStart: 7, periodEnd: 8 },
});
assert.equal(reschedule.success, true);
assert.equal(reschedule.summary.feasible, true);
assert.equal(reschedule.summary.warningCount, 1);
assert.equal(reschedule.simulation.mutatedData, false);
assert.equal(reschedule.items[0].checks.spaceAvailability.roomCount, 8);
assert.equal(reschedule.items[0].checks.spaceAvailability.suggestedRoom.name, "A1-201");
assert.equal(reschedule.items[0].warnings[0].type, "continuous_load");

const insight = callTool("query_teacher_load", { weekStart: 1, weekEnd: 4, topN: 1 });
assert.equal(insight.success, true);
assert.equal(insight.items[0].rank, 1);
assert.equal(insight.items[0].teacher.name, "教师025");
assert.equal(insight.items[0].lessonOccurrences, 56);
assert.equal(insight.items[0].periodUnits, 112);

for (const name of ["risk", "collaboration", "reschedule", "insight"]) {
  const golden = readJson("golden", `${name}.json`);
  assert.equal(golden.dataVersion, "competition-demo-v3");
  assert.equal(golden.verified, true);
}

const openapi = readJson("openapi", "campus-tools.openapi.json");
assert.equal(openapi.info.version, "1.3.0");
assert.ok(JSON.stringify(openapi).includes("competition-demo-v3"));

const widgetText = fs.readFileSync(path.join(ROOT, "widget", "小序-校园智序结果卡.widget"), "utf8");
assert.doesNotThrow(() => JSON.parse(widgetText));
assert.ok(widgetText.includes('"verified"'));
assert.ok(widgetText.includes("已核验"));

console.log("PASS final-delivery verification: 4 agents / 13 tools / 14 bindings / 4 verified heroes");
