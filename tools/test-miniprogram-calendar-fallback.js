const assert = require("assert");

const storage = {};
const pages = [];

global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  getStorageInfoSync() { return { keys: Object.keys(storage) }; },
  request(options) {
    setTimeout(() => options.fail && options.fail({ errMsg: "request:fail timeout" }), 0);
  },
  showLoading() {},
  hideLoading() {},
  showModal() {},
};
global.getApp = () => ({ globalData: {} });
global.Page = (definition) => pages.push(definition);

const teachingCalendarService = require("../miniprogram/services/teachingCalendarService");
const { getBuiltinTeachingCalendar } = require("../miniprogram/data/builtinTeachingCalendar");

async function run() {
  const builtin = getBuiltinTeachingCalendar();
  const lastGood = Object.assign({}, builtin, {
    releaseVersion: "last-good-v1",
    source: "unit-test-last-good",
    weeks: builtin.weeks.slice(0, 20).map((week) => Object.assign({}, week, {
      title: week.weekNo === 1 ? "缓存开学教学周" : week.title,
    })),
  });
  wx.setStorageSync(`fosu:v6:teaching-calendar:last-good:${encodeURIComponent(lastGood.term)}`, {
    savedAt: Date.now(),
    calendar: lastGood,
  });

  const withLastGood = await teachingCalendarService.loadActiveTeachingCalendar({
    term: "2025-2026-2",
    pointerTimeout: 1,
    calendarTimeout: 1,
  });
  assert.strictEqual(withLastGood.term, "2025-2026-2");
  assert(withLastGood.weeks.length >= 20, "last-good fallback should keep weeks");
  assert(withLastGood.fromStorage || withLastGood.fallback, "last-good fallback should mark degraded result");

  Object.keys(storage).forEach((key) => delete storage[key]);
  const builtinFallback = await teachingCalendarService.loadActiveTeachingCalendar({
    term: "2025-2026-2",
    pointerTimeout: 1,
    calendarTimeout: 1,
  });
  assert.strictEqual(builtinFallback.term, "2025-2026-2");
  assert.strictEqual(builtinFallback.weeks.length, 20);
  assert.strictEqual(builtinFallback.builtin, true);
  assert(builtinFallback.weeks.every((week) => week.startDate && week.endDate && week.title && week.typeText));

  require("../miniprogram/pages/calendar/calendar.js");
  assert.strictEqual(pages.length, 1, "calendar page should register once");
  const page = Object.assign({
    data: {},
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    },
  }, pages[0]);
  page.onShow();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert(Array.isArray(page.data.weeks), "page should set weeks");
  assert(page.data.weeks.length >= 20, "calendar page should never leave weeks empty after network failure");
  assert(page.data.title.includes("2025-2026学年第二学期"), "page should show current semester title");
  console.log("test-miniprogram-calendar-fallback passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
