"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");
const {
  DEFAULT_MIN_DISTANCE,
  resolveAdjacentWeek,
  resolveWeekSwipeDirection,
} = require("../miniprogram/utils/weekSwipe");

const ROOT = path.resolve(__dirname, "..");

function touch(clientX, clientY) {
  return { clientX, clientY };
}

function swipe(page, start, end) {
  page.onScheduleTouchStart({ touches: [start] });
  page.onScheduleTouchMove({ touches: [end] });
  page.onScheduleTouchEnd({ changedTouches: [end] });
}

function loadPage(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(filePath)];
  require(filePath);
  return mockEnv.createPageInstance();
}

function testSwipeClassifier() {
  assert.strictEqual(DEFAULT_MIN_DISTANCE, 60);
  assert.strictEqual(resolveWeekSwipeDirection(touch(260, 200), touch(170, 208)), "next");
  assert.strictEqual(resolveWeekSwipeDirection(touch(170, 200), touch(260, 192)), "prev");
  assert.strictEqual(
    resolveWeekSwipeDirection(touch(200, 120), touch(215, 220)),
    "",
    "vertical page scrolling must not switch weeks"
  );
  assert.strictEqual(
    resolveWeekSwipeDirection(touch(200, 120), touch(145, 124)),
    "",
    "small horizontal movement below the threshold must not switch weeks"
  );
  assert.strictEqual(
    resolveWeekSwipeDirection(touch(220, 120), touch(145, 190)),
    "",
    "diagonal movement without clear horizontal intent must not switch weeks"
  );
  assert.deepStrictEqual(resolveAdjacentWeek(1, 19, "prev"), { changed: false, week: 1 });
  assert.deepStrictEqual(resolveAdjacentWeek(19, 19, "next"), { changed: false, week: 19 });
}

function testHomeWeekSwipe() {
  mockEnv.clearStorage();
  const storage = require("../miniprogram/utils/storage");
  const page = loadPage("miniprogram/pages/index/index.js");
  page.setData({
    currentWeek: 2,
    totalWeeks: 19,
    showWeekend: true,
    weekendShowMode: "overview",
  });

  swipe(page, touch(280, 300), touch(180, 306));
  assert.strictEqual(page.data.currentWeek, 3, "left swipe should move from week 2 to week 3");
  assert.strictEqual(storage.getSettings().currentWeek, 3);
  assert.strictEqual(storage.getSettings().manualWeekOverride, true);

  swipe(page, touch(180, 300), touch(280, 294));
  assert.strictEqual(page.data.currentWeek, 2, "right swipe should move from week 3 to week 2");

  swipe(page, touch(280, 300), touch(180, 305));
  swipe(page, touch(280, 300), touch(180, 305));
  assert.strictEqual(page.data.currentWeek, 4, "separate quick swipes should each advance one week");

  swipe(page, touch(210, 180), touch(225, 300));
  assert.strictEqual(page.data.currentWeek, 4, "vertical scroll must leave the week unchanged");
  swipe(page, touch(210, 180), touch(160, 184));
  assert.strictEqual(page.data.currentWeek, 4, "sub-threshold horizontal movement must leave the week unchanged");

  page.setData({ currentWeek: 1 });
  swipe(page, touch(170, 260), touch(270, 260));
  assert.strictEqual(page.data.currentWeek, 1, "week 1 must not move to week 0");
  page.setData({ currentWeek: 19 });
  swipe(page, touch(270, 260), touch(170, 260));
  assert.strictEqual(page.data.currentWeek, 19, "the last week must not move past the term boundary");

  page.setData({ currentWeek: 6, weekendShowMode: "detail", showWeekend: true });
  swipe(page, touch(280, 260), touch(170, 260));
  assert.strictEqual(page.data.currentWeek, 6, "seven-day detail mode reserves horizontal gestures for its scroll view");

  page.setData({ weekendShowMode: "overview", detailVisible: true });
  swipe(page, touch(280, 260), touch(170, 260));
  assert.strictEqual(page.data.currentWeek, 6, "an open course detail must disable background week gestures");

  page.setData({ detailVisible: false, selectedCourse: null });
  page._suppressCourseTapUntil = 0;
  page.onScheduleTouchStart({ touches: [touch(200, 200)] });
  page.onScheduleTouchEnd({ changedTouches: [touch(205, 202)] });
  page.onCourseTap({ detail: { course: { id: "course-tap" } } });
  assert.strictEqual(page.data.detailVisible, true, "a normal course-card tap should still open details");

  page.setData({ detailVisible: false, selectedCourse: null, currentWeek: 6 });
  swipe(page, touch(280, 260), touch(170, 260));
  page.onCourseTap({ detail: { course: { id: "course-after-swipe" } } });
  assert.strictEqual(page.data.detailVisible, false, "a committed swipe must suppress the trailing course-card tap");
}

function testWeekSwitcherButtons() {
  let definition = null;
  const previousComponent = global.Component;
  global.Component = (value) => { definition = value; };
  const componentPath = path.join(ROOT, "miniprogram/components/week-switcher/index.js");
  delete require.cache[require.resolve(componentPath)];
  require(componentPath);
  global.Component = previousComponent;

  const events = [];
  const instance = {
    data: { currentWeek: 2, totalWeeks: 19 },
    triggerEvent(name, detail) {
      events.push({ name, detail });
    },
  };
  Object.keys(definition.methods).forEach((key) => {
    instance[key] = definition.methods[key];
  });

  instance.prevWeek();
  instance.nextWeek();
  instance.backToCurrent();
  assert.deepStrictEqual(events.map((item) => item.detail), [
    { type: "prev", week: 1 },
    { type: "next", week: 3 },
    { type: "current", week: 2 },
  ]);

  events.length = 0;
  instance.data.currentWeek = 1;
  instance.prevWeek();
  instance.data.currentWeek = 19;
  instance.nextWeek();
  assert.strictEqual(events.length, 0, "week-switcher boundary buttons must be inert");
}

function testScheduleViewPersistsWeekState() {
  mockEnv.clearStorage();
  const storage = require("../miniprogram/utils/storage");
  const page = loadPage("miniprogram/pages/schedule-view/schedule-view.js");
  page.activeTeachingCalendar = {
    weeks: [],
    termConfig: { totalWeeks: 19 },
  };
  page.setData({ currentWeek: 2, totalWeeks: 19, allCourses: [] });
  page.onWeekChange({ detail: { type: "next", week: 3 } });
  assert.strictEqual(page.data.currentWeek, 3);
  assert.strictEqual(storage.getSettings().currentWeek, 3);
  assert.strictEqual(storage.getSettings().manualWeekOverride, true);
  page.onWeekChange({ detail: { type: "current", week: 3 } });
  assert.strictEqual(storage.getSettings().manualWeekOverride, false, "back-to-current must restore calendar following");
}

function testRestoreDefaultsConfirmation() {
  mockEnv.clearStorage();
  const storage = require("../miniprogram/utils/storage");
  storage.saveSettings({
    hideInactiveCourses: false,
    showWeekend: false,
    weekendShowMode: "detail",
    currentWeek: 8,
    manualWeekOverride: true,
  });
  storage.setCurrentScheduleTarget({
    type: "class",
    id: "class-1",
    detailId: "class-1",
    name: "25动物医学6班",
    term: "2026-2027-1",
    courses: [],
  });
  const page = loadPage("miniprogram/pages/settings/settings.js");
  page.setData({ moreSettingsVisible: true });
  let modal = null;
  wx.onModal = (options) => { modal = options; };
  try {
    page.clearCache();
    assert(modal && modal.title === "恢复默认设置", "restore defaults must require a confirmation modal");
    assert.strictEqual(storage.getSettings().showWeekend, false, "settings must not change before confirmation");
    assert(storage.getCurrentScheduleTarget(), "the selected schedule must remain before confirmation");
    modal.success({ confirm: true });
    const restored = storage.getSettings();
    assert.strictEqual(restored.hideInactiveCourses, true);
    assert.strictEqual(restored.showWeekend, true);
    assert.strictEqual(restored.weekendShowMode, "overview");
    assert.strictEqual(restored.manualWeekOverride, false);
    assert.strictEqual(storage.getCurrentScheduleTarget(), null);
    assert.strictEqual(page.data.moreSettingsVisible, false);
  } finally {
    wx.onModal = null;
  }
}

function testHistoricalGradeRemovalAndSettingsHierarchy() {
  mockEnv.clearStorage();
  const storage = require("../miniprogram/utils/storage");
  wx.setStorageSync(storage.STORAGE_KEY, { showHistoricalGrades: true });
  const school = loadPage("miniprogram/pages/school/school.js");
  school.originalCatalogData = {
    semesters: [{ value: "2026-2027-1", label: "2026-2027-1" }],
    grades: ["2021", "2022", "2023", "2024", "2025", "2026"],
    colleges: [],
  };
  school.setData({
    activeSnapshot: { term: "2026-2027-1" },
    grades: [],
    colleges: [],
    teacherColleges: [{ code: "", name: "所有院系" }],
  });
  school.applyCatalogFilter();
  assert.deepStrictEqual(school.data.grades, ["2023", "2024", "2025", "2026"]);

  const businessFiles = [
    "miniprogram/pages/settings/settings.js",
    "miniprogram/pages/settings/settings.wxml",
    "miniprogram/pages/school/school.js",
  ];
  businessFiles.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert(!source.includes("showHistoricalGrades"), `${relativePath} must not retain the retired feature`);
  });

  const settingsWxml = fs.readFileSync(path.join(ROOT, "miniprogram/pages/settings/settings.wxml"), "utf8");
  const primarySettings = settingsWxml.split('<view wx:if="{{moreSettingsVisible}}"')[0];
  ["课表显示", "课程提醒", "常用工具", "帮助与关于"].forEach((heading) => {
    assert(primarySettings.includes(heading), `primary settings should include ${heading}`);
  });
  ["数据与公告", "当前数据版本", "手动刷新数据", "清除本地选择", "重置为新用户状态"].forEach((copy) => {
    assert(!primarySettings.includes(copy), `primary settings must hide maintenance copy: ${copy}`);
  });
  assert(settingsWxml.includes("恢复默认设置"), "restore defaults should remain in more settings");

  const indexWxml = fs.readFileSync(path.join(ROOT, "miniprogram/pages/index/index.wxml"), "utf8");
  const scheduleViewWxml = fs.readFileSync(path.join(ROOT, "miniprogram/pages/schedule-view/schedule-view.wxml"), "utf8");
  assert(indexWxml.includes('bindtouchend="onScheduleTouchEnd"'));
  assert(!indexWxml.includes("💡"), "home must not keep a permanent gesture tutorial");
  assert(!scheduleViewWxml.includes("💡"), "schedule view must not keep a permanent gesture tutorial");
}

testSwipeClassifier();
testHomeWeekSwipe();
testWeekSwitcherButtons();
testScheduleViewPersistsWeekState();
testRestoreDefaultsConfirmation();
testHistoricalGradeRemovalAndSettingsHierarchy();

console.log("test-miniprogram-clean-ui-week-swipe passed");
