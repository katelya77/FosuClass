const assert = require("assert");
const week = require("../miniprogram/utils/week");

const config = { term: "2025-2026-2", termStartDate: "2026-03-09", totalWeeks: 20, weekStart: "monday" };
assert.strictEqual(week.getTeachingWeekByDate(new Date("2026-03-01T00:00:00"), [], config).termPhase, "before-term");
assert.strictEqual(week.getTeachingWeekByDate(new Date("2026-03-10T00:00:00"), [], config).termPhase, "in-term");
assert.strictEqual(week.getTeachingWeekByDate(new Date("2026-08-01T00:00:00"), [], config).termPhase, "after-term");
assert.strictEqual(week.getTeachingWeekByDate(new Date("2026-03-10T00:00:00"), [], { term: "x", totalWeeks: 20 }).termPhase, "unknown");

const explicit = [{ weekNo: 1, startDate: "2026-03-09", endDate: "2026-03-15", title: "开学教学周" }];
assert.strictEqual(week.getTeachingWeekByDate(new Date("2026-03-10T00:00:00"), explicit, config).title, "开学教学周");
console.log("test-calendar-term-phases passed");
