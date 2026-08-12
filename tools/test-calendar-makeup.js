"use strict";

const assert = require("assert");
const { resolveTeachingEvent } = require("../shared/teachingEventResolver");
const calendar = require("../config/terms/2026-2027-1.json").teachingCalendar;
const sunday = resolveTeachingEvent("2026-09-20", calendar);
assert.strictEqual(sunday.type, "makeup");
assert.strictEqual(sunday.isTeachingDay, true);
assert.strictEqual(sunday.scheduleSourceDate, "2026-10-06");
assert.strictEqual(sunday.scheduleWeekday, 2);
assert.strictEqual(sunday.scheduleWeek, 5);
const saturday = resolveTeachingEvent("2026-10-10", calendar);
assert.strictEqual(saturday.type, "makeup");
assert.strictEqual(saturday.scheduleSourceDate, "2026-10-07");
assert.strictEqual(saturday.scheduleWeekday, 3);
assert.strictEqual(saturday.scheduleWeek, 5);
console.log("test-calendar-makeup passed");
