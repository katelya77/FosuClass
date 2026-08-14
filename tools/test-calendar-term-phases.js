const assert = require("assert");
const week = require("../miniprogram/utils/week");
const { resolveTeachingEvent } = require("../shared/teachingEventResolver");

const config = { term: "2025-2026-2", termStartDate: "2026-03-09", totalWeeks: 20, weekStart: "monday" };
assert.strictEqual(week.getTeachingWeekByDate(new Date("2026-03-01T00:00:00"), [], config).termPhase, "before-term");
assert.strictEqual(week.getTeachingWeekByDate(new Date("2026-03-10T00:00:00"), [], config).termPhase, "in-term");
assert.strictEqual(week.getTeachingWeekByDate(new Date("2026-08-01T00:00:00"), [], config).termPhase, "after-term");
assert.strictEqual(week.getTeachingWeekByDate(new Date("2026-03-10T00:00:00"), [], { term: "x", totalWeeks: 20 }).termPhase, "unknown");

const explicit = [{ weekNo: 1, startDate: "2026-03-09", endDate: "2026-03-15", title: "开学教学周" }];
assert.strictEqual(week.getTeachingWeekByDate(new Date("2026-03-10T00:00:00"), explicit, config).title, "开学教学周");

const beforeEvent = resolveTeachingEvent("2026-03-01", config);
assert.strictEqual(beforeEvent.termPhase, "before-term");
assert.strictEqual(beforeEvent.isTeachingDay, false, "regular weekdays before term must not emit courses");
const afterEvent = resolveTeachingEvent("2026-08-01", config);
assert.strictEqual(afterEvent.termPhase, "after-term");
assert.strictEqual(afterEvent.isTeachingDay, false, "regular weekdays after term must not emit courses");
assert.strictEqual(week.getTeachingPeriodText({ termPhase: "before-term", weekNo: 1 }), "尚未开学");
assert.strictEqual(week.getTeachingPeriodText({ termPhase: "after-term", weekNo: 20 }), "本学期已结束");
assert.strictEqual(week.getTeachingPeriodText({ termPhase: "in-term", weekNo: 3 }), "第3周");
console.log("test-calendar-term-phases passed");
