"use strict";

const assert = require("assert");
const { resolveTeachingEvent } = require("../shared/teachingEventResolver");
const calendar = require("../config/terms/2026-2027-1.json").teachingCalendar;
for (const date of ["2026-09-25", "2026-09-26", "2026-09-27", "2026-10-01", "2026-10-06", "2026-10-07"]) {
  const result = resolveTeachingEvent(date, calendar);
  assert.strictEqual(result.isTeachingDay, false, `${date} should not emit recurring courses`);
  assert.strictEqual(result.type, "holiday");
}
console.log("test-calendar-holiday passed");
