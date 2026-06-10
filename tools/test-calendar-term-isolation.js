const assert = require("assert");

global.wx = {
  store: {},
  getStorageSync(key) { return this.store[key]; },
  setStorageSync(key, value) { this.store[key] = value; },
};

const service = require("../miniprogram/services/teachingCalendarService");
const a = service.normalizeCalendar({
  term: "2025-2026-2",
  releaseVersion: "a",
  weeks: [{ weekNo: 1, startDate: "2026-03-09", endDate: "2026-03-15", title: "开学教学周" }],
}, { term: "2025-2026-2", releaseVersion: "a", termConfig: { termStartDate: "2026-03-09", totalWeeks: 1 } });
const b = service.normalizeCalendar({
  term: "2026-2027-1",
  releaseVersion: "b",
  weeks: [],
}, { term: "2026-2027-1", releaseVersion: "b", termConfig: { totalWeeks: 1 }, planned: true });
assert.strictEqual(a.weeks[0].title, "开学教学周");
assert.strictEqual(b.weeks[0].title, "教学安排待维护");
assert.notStrictEqual(service.getCacheKey(a.term, a.releaseVersion), service.getCacheKey(b.term, b.releaseVersion));
console.log("test-calendar-term-isolation passed");
