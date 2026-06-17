const assert = require("assert");
const { getBuiltinTeachingCalendar } = require("../miniprogram/data/builtinTeachingCalendar");

const pages = [];
const storage = {};
let requestedSelectors = [];

global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  getStorageInfoSync() { return { keys: Object.keys(storage) }; },
  request(options) {
    setTimeout(() => options.fail && options.fail({ errMsg: "request:fail timeout" }), 0);
  },
  nextTick(callback) { callback(); },
  createSelectorQuery() {
    requestedSelectors = [];
    return {
      in() { return this; },
      select(selector) {
        requestedSelectors.push(selector);
        return this;
      },
      boundingClientRect() { return this; },
      exec(callback) {
        callback([
          { top: 100, height: 600 },
          { top: 900, height: 120 },
        ]);
      },
    };
  },
};
global.getApp = () => ({ globalData: {} });
global.Page = (definition) => pages.push(definition);

require("../miniprogram/pages/calendar/calendar.js");
const page = Object.assign({
  data: JSON.parse(JSON.stringify(pages[0].data || {})),
  setData(patch) {
    this.data = Object.assign({}, this.data, patch);
  },
}, pages[0]);

function makeWeeks(count) {
  return Array.from({ length: count }, (_, index) => ({
    weekNo: index + 1,
    title: `第${index + 1}周`,
    type: "teaching",
  }));
}

page.onShow();
assert(page.data.targetWeekNo > 0, "in-term page should choose a target week");
assert(requestedSelectors.includes(`#week-${page.data.targetWeekNo}`), "selector should target current week card");
assert(page.data.scrollTop > 0, "current week should be centered with scrollTop");
assert(page.data.weeks.some((week) => week.active), "active week style flag should remain");
const firstScrollTop = page.data.scrollTop;

page.renderCalendar(getBuiltinTeachingCalendar(), getBuiltinTeachingCalendar().termConfig || {}, {
  forceCenter: false,
  allowChangedWeekCenter: true,
});
assert.strictEqual(page.data.scrollTop, firstScrollTop, "same remote current week should not jump twice");

page._autoCentering = false;
page.onCalendarScroll({ detail: { scrollTop: firstScrollTop + 600 } });
assert.strictEqual(page.data.showBackToCurrentWeek, true, "manual scroll away should show back button");
const userScrollTop = page.data.scrollTop;
page.renderCalendar(getBuiltinTeachingCalendar(), getBuiltinTeachingCalendar().termConfig || {}, {
  forceCenter: false,
  allowChangedWeekCenter: true,
});
assert.strictEqual(page.data.scrollTop, userScrollTop, "remote refresh should not pull back after manual scroll");
page.backToCurrentWeek();
assert.strictEqual(page.data.showBackToCurrentWeek, false, "back button should re-center and hide itself");

page.renderCalendar({
  term: "future",
  semesterText: "未来学期",
  termConfig: { term: "future", termStartDate: "2099-09-01", weekStart: "monday", totalWeeks: 3 },
  weeks: makeWeeks(3),
}, { termStartDate: "2099-09-01", weekStart: "monday", totalWeeks: 3 }, { forceCenter: true });
assert.strictEqual(page.data.targetWeekNo, 1, "before-term should target week 1");

page.renderCalendar({
  term: "past",
  semesterText: "过去学期",
  termConfig: { term: "past", termStartDate: "2020-01-01", weekStart: "monday", totalWeeks: 4 },
  weeks: makeWeeks(4),
}, { termStartDate: "2020-01-01", weekStart: "monday", totalWeeks: 4 }, { forceCenter: true });
assert.strictEqual(page.data.targetWeekNo, 4, "after-term should target the last valid week");

page.renderCalendar({
  term: "unknown",
  semesterText: "未知学期",
  termConfig: { term: "unknown" },
  weeks: makeWeeks(2),
}, {}, { forceCenter: true });
assert.strictEqual(page.data.targetWeekNo, 0, "unknown phase should not auto-scroll");

console.log("test-calendar-auto-center passed");
