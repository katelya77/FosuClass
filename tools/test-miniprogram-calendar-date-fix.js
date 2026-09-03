const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const RealDate = Date;
const fixedNow = new RealDate(2026, 5, 11, 9, 39, 0);
const storage = {};
const pages = [];

function FixedDate(...args) {
  return args.length === 0 ? new RealDate(fixedNow.getTime()) : new RealDate(...args);
}

global.Date = FixedDate;
FixedDate.now = () => fixedNow.getTime();
FixedDate.parse = RealDate.parse;
FixedDate.UTC = RealDate.UTC;
FixedDate.prototype = RealDate.prototype;
global.wx = {
  getStorageSync(key) {
    return storage[key] === undefined ? "" : storage[key];
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
  removeStorageSync(key) {
    delete storage[key];
  },
  getStorageInfoSync() {
    return { keys: Object.keys(storage) };
  },
  request(options) {
    setTimeout(() => {
      if (options && typeof options.fail === "function") {
        options.fail({ errMsg: "request:fail timeout", code: "REQUEST_TIMEOUT" });
      }
    }, 0);
  },
  showLoading() {},
  hideLoading() {},
  showToast() {},
  showModal() {},
  showShareMenu() {},
};

const app = {
  globalData: {
    appConfig: null,
    activeRelease: null,
    bootstrapData: null,
    shownModalNoticeIds: {},
  },
  loadBootstrapData() {
    return Promise.resolve(null);
  },
  loadAppConfigData() {
    return Promise.resolve(null);
  },
};

global.getApp = () => app;
global.Page = (definition) => pages.push(definition);

function createPage(definition) {
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, cb) {
      Object.keys(patch || {}).forEach((key) => {
        if (key.includes(".")) {
          const parts = key.split(".");
          let target = this.data;
          while (parts.length > 1) {
            const part = parts.shift();
            target[part] = target[part] || {};
            target = target[part];
          }
          target[parts[0]] = patch[key];
        } else {
          this.data[key] = patch[key];
        }
      });
      if (typeof cb === "function") cb();
    },
  });
}

function assertNoBadDateText(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  ["NaN", "Invalid Date", "undefined月", "null月", "6月-"].forEach((bad) => {
    assert(!text.includes(bad), `${label} should not contain ${bad}`);
  });
}

const week = require("../miniprogram/utils/week");
const releasePackService = require("../miniprogram/services/releasePackService");
const teachingCalendarService = require("../miniprogram/services/teachingCalendarService");
const { getBuiltinTeachingCalendar } = require("../miniprogram/data/builtinTeachingCalendar");

const builtin = getBuiltinTeachingCalendar();
assert.strictEqual(builtin.termConfig.termStartDate, "2026-03-09");
assert.strictEqual(builtin.termConfig.weekStart, "monday");
assert.strictEqual(builtin.termConfig.totalWeeks, 19);
assert.strictEqual(builtin.weeks.length, 19);

const coldStart = teachingCalendarService.getImmediateActiveCalendar();
assert.strictEqual(coldStart.term, "", "unknown current term must not resurrect an archived built-in semester");
assert.strictEqual(coldStart.weeks.length, 0);

// The archived calendar remains available only when the caller explicitly
// requests that historical term.
const calendar = teachingCalendarService.getImmediateActiveCalendar({ term: "2025-2026-2" });
assert.strictEqual(calendar.term, "2025-2026-2");
assert.strictEqual(calendar.termConfig.termStartDate, "2026-03-09");
assert.strictEqual(calendar.termConfig.weekStart, "monday");
assert.strictEqual(calendar.termConfig.totalWeeks, 19);
assert.strictEqual(calendar.weeks.length, 19);

[
  ["2026-03-09", 1],
  ["2026-03-15", 1],
  ["2026-03-16", 2],
  ["2026-06-07", 13],
  ["2026-06-08", 14],
  ["2026-06-11", 14],
  ["2026-06-14", 14],
  ["2026-06-15", 15],
  ["2026-07-05", 17],
  ["2026-07-06", 18],
  ["2026-07-19", 19],
].forEach(([date, expected]) => {
  assert.strictEqual(
    week.getTodayTeachingInfo(date, calendar.weeks, calendar.termConfig).weekNo,
    expected,
    `${date} should be week ${expected}`
  );
});

const todayInfo = week.getTodayTeachingInfo(new Date(), calendar.weeks, calendar.termConfig);
assert.deepStrictEqual({
  weekNo: todayInfo.weekNo,
  weekday: todayInfo.weekday,
  weekdayLabel: todayInfo.weekdayLabel,
  startDate: todayInfo.startDate,
  endDate: todayInfo.endDate,
}, {
  weekNo: 14,
  weekday: 4,
  weekdayLabel: "周四",
  startDate: "2026-06-08",
  endDate: "2026-06-14",
});

const weekInfo = week.getWeekRangeByWeekNo(14, calendar.weeks, calendar.termConfig);
const weekRangeText = week.formatWeekRange(weekInfo.startDate, weekInfo.endDate);
const weekdayLabels = [0, 1, 2, 3, 4].map((offset) => week.formatDateLabel(week.addLocalDays(weekInfo.startDate, offset)));
assert.strictEqual(weekRangeText, "6月8日-6月14日");
assert.strictEqual(`${weekRangeText} · 第14周`, "6月8日-6月14日 · 第14周");
assert.strictEqual(`${todayInfo.dateLabel} ${todayInfo.weekdayLabel}`, "6月11日 周四");
assert.deepStrictEqual(weekdayLabels, ["6月8日", "6月9日", "6月10日", "6月11日", "6月12日"]);
assertNoBadDateText({ todayInfo, weekInfo, weekRangeText, weekdayLabels }, "date rendering");

[
  "miniprogram/pages/index/index.js",
  "miniprogram/pages/settings/settings.js",
  "miniprogram/pages/today/today.js",
  "miniprogram/pages/schedule-view/schedule-view.js",
  "miniprogram/pages/empty-room/empty-room.js",
  "miniprogram/utils/todayReminder.js",
  "miniprogram/services/aiAssistantService.js",
].forEach((relativePath) => {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  assert(!content.includes("../../data/mockCalendar"), `${relativePath} must not import mockCalendar`);
  assert(!content.includes("../data/mockCalendar"), `${relativePath} must not import mockCalendar`);
});

require("../miniprogram/pages/index/index.js");
require("../miniprogram/pages/settings/settings.js");
assert.strictEqual(pages.length, 2, "index and settings pages should register");

app.globalData.runtimePointer = {
  activeTerm: "2025-2026-2",
  term: "2025-2026-2",
  releaseVersion: "",
};
releasePackService.writeRuntimePointerCache({
  activeTerm: "2025-2026-2",
  term: "2025-2026-2",
  releaseVersion: "archived-test-release",
});

const indexPage = createPage(pages[0]);
indexPage.loadSchedule();
assert.strictEqual(indexPage.data.currentWeek, 14);
assert.strictEqual(indexPage.data.weekRangeText, "6月8日-6月14日");
assert.strictEqual(indexPage.data.weekSwitcherLabel, "6月8日-6月14日 · 第14周");
assert.strictEqual(indexPage.data.todayText, "6月11日 周四");
assert.deepStrictEqual(indexPage.data.weekdays.map((item) => `${item.label} ${item.dateLabel}`), [
  "周一 6月8日",
  "周二 6月9日",
  "周三 6月10日",
  "周四 6月11日",
  "周五 6月12日",
  "周六 6月13日",
  "周日 6月14日",
]);
assert.strictEqual(indexPage.data.weekdays[3].isToday, true);
assertNoBadDateText(indexPage.data, "index page data");

const settingsPage = createPage(pages[1]);
settingsPage.loadSettings();
assert.strictEqual(settingsPage.data.settings.currentWeek, 14);
assert.strictEqual(settingsPage.data.settings.semester, "2025-2026-2");
assert.strictEqual(settingsPage.data.settings.showWeekend, true);
assert.strictEqual(settingsPage.data.teachingInfo.dateLabel, "6月11日");
assert.strictEqual(settingsPage.data.teachingInfo.weekdayLabel, "周四");
assert.strictEqual(settingsPage.data.termStartDate, "2026年3月9日");
assert.strictEqual(settingsPage.data.termStartWeekdayText, "周一");
assert.strictEqual(settingsPage.data.totalTeachingWeeks, "19周");
assertNoBadDateText(settingsPage.data, "settings page data");

require("../miniprogram/utils/storage").saveSettings({ showWeekend: false });
indexPage.loadSchedule();
assert.deepStrictEqual(
  indexPage.data.weekdays.map((item) => item.label),
  ["周一", "周二", "周三", "周四", "周五"],
  "an explicit user choice to hide weekends should still be respected"
);

console.log("test-miniprogram-calendar-date-fix passed");
