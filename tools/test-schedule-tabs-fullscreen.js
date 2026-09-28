"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const mockEnv = require("./mock-env");
const storage = require("../miniprogram/utils/storage");

function page(name) {
  const file = path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.js`);
  delete require.cache[require.resolve(file)];
  require(file);
  return mockEnv.createPageInstance();
}

function testHomeTabs() {
  mockEnv.clearStorage();
  storage.addRecentSchedule({
    id: "class-2", type: "class", name: "25动物医学6班",
    title: "25动物医学6班", courses: [{ courseName: "动物组织学", weekday: 1, startSection: 1, endSection: 2 }],
  });
  storage.addRecentSchedule({
    id: "class-3", type: "class", name: "25动物医学6班",
    title: "25动物医学6班", courses: [{ courseName: "动物组织学", weekday: 1, startSection: 1, endSection: 2 }],
  });
  const home = page("index");
  home.refreshScheduleTabs({ id: "class-1", type: "class", name: "25动物医学1班" });
  assert.strictEqual(home.data.scheduleTabs.length, 2, "same class from multiple history records should open one tab");
  assert.strictEqual(home.data.scheduleTabs[0].current, true);
  home.loadSchedule = () => {};
  home.onScheduleTabTap({ currentTarget: { dataset: { key: home.data.scheduleTabs[1].key } } });
  assert.strictEqual(home.data.isPreviewSchedule, true);
  assert.strictEqual(storage.getSettings().className, "", "preview must not change the bound target");
  home.closeScheduleTab({ currentTarget: { dataset: { key: home.data.activeScheduleTab } } });
  assert.strictEqual(storage.getRecentSchedules().length, 0, "closing a tab should remove all matching history records");
  assert.strictEqual(home.data.activeScheduleTab, "current");
  storage.addRecentSchedule({
    id: "class-4", type: "class", name: "25动物医学1班",
    title: "25动物医学1班", courses: [{ courseName: "动物组织学", weekday: 1, startSection: 1, endSection: 2 }],
  });
  home.refreshScheduleTabs({ id: "class-1", type: "class", name: "25动物医学1班" });
  assert.strictEqual(home.data.scheduleTabs.length, 1, "current schedule must not repeat as a recent tab");
}

function testSchoolSearchMemory() {
  mockEnv.clearStorage();
  const school = page("school");
  school.setData({
    activeSnapshot: { term: "2026-2027-1" }, activeTab: "teacher", keyword: "陈芳",
    teacherColleges: [{ code: "", name: "所有院系" }, { code: "02", name: "学院" }],
    selectedTeacherCollegeIndex: 1, selectedTitleIndex: 2,
  });
  school.saveSearchPrefs();
  const reopened = page("school");
  reopened.setData({
    activeSnapshot: { term: "2026-2027-1" },
    teacherColleges: [{ code: "", name: "所有院系" }, { code: "02", name: "学院" }],
  });
  reopened.restoreSearchPrefs();
  assert.strictEqual(reopened.data.activeTab, "teacher");
  assert.strictEqual(reopened.data.keyword, "陈芳");
  assert.strictEqual(reopened.data.selectedTeacherCollegeIndex, 1);
  assert.strictEqual(reopened.data.selectedTitleIndex, 2);
  wx.setStorageSync(school.getStableFilterPrefsKey(), { collegeCode: "02", grade: "2025" });
  storage.clearAllSchoolCaches();
  assert.strictEqual(wx.getStorageSync(school.getStableFilterPrefsKey()).collegeCode, "02",
    "release cache refresh must preserve the user's filter choices");
  const navigateTo = wx.navigateTo;
  let openedUrl = "";
  wx.navigateTo = ({ url }) => { openedUrl = url; };
  try {
    school.goPersonalSync();
  } finally {
    wx.navigateTo = navigateTo;
  }
  assert.strictEqual(openedUrl, "/pages/personal-sync/personal-sync");
}

function testFullscreenWeekGestures() {
  const appConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../miniprogram/app.json"), "utf8"));
  assert(appConfig.pages.includes("pages/schedule-fullscreen/schedule-fullscreen"));
  const fullscreenConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    "../miniprogram/pages/schedule-fullscreen/schedule-fullscreen.json"), "utf8"));
  assert.strictEqual(fullscreenConfig.disableScroll, true, "fullscreen page must not expose vertical scrolling");
  const fullscreen = page("schedule-fullscreen");
  let receiver;
  const sent = [];
  fullscreen.getOpenerEventChannel = () => ({
    on: (_, fn) => { receiver = fn; },
    emit: (name, detail) => sent.push({ name, detail }),
  });
  const getSystemInfoSync = wx.getSystemInfoSync;
  const getMenuButtonBoundingClientRect = wx.getMenuButtonBoundingClientRect;
  wx.getSystemInfoSync = () => ({ statusBarHeight: 48 });
  wx.getMenuButtonBoundingClientRect = () => ({ top: 56, bottom: 88 });
  try {
    fullscreen.onLoad();
  } finally {
    wx.getSystemInfoSync = getSystemInfoSync;
    wx.getMenuButtonBoundingClientRect = getMenuButtonBoundingClientRect;
  }
  assert.strictEqual(fullscreen.data.headerTop, 48,
    "fullscreen toolbar should align with the capsule instead of leaving a second navigation-row gap");
  assert(fullscreen.data.sectionHeight < 90, "section rows should fit the visible fullscreen height");
  const contentHeight = fullscreen.data.headerTop + 24 +
    (314 + fullscreen.data.scheduleHeight) * 390 / 750;
  assert(contentHeight <= 844, "the timetable should fit without a short page scroll");
  receiver({ title: "课表预览", week: 2, target: { type: "class", name: "测试班级" }, courses: [] });
  assert.strictEqual(fullscreen.data.currentWeek, 2);
  fullscreen.onScheduleTouchStart({ touches: [{ clientX: 280, clientY: 200 }] });
  fullscreen.onScheduleTouchEnd({ changedTouches: [{ clientX: 180, clientY: 207 }] });
  assert.strictEqual(fullscreen.data.currentWeek, 3);
  assert.deepStrictEqual(sent.pop(), { name: "weekChange", detail: { week: 3 } });
  fullscreen.onScheduleTouchStart({ touches: [{ clientX: 200, clientY: 200 }] });
  fullscreen.onScheduleTouchEnd({ changedTouches: [{ clientX: 205, clientY: 320 }] });
  assert.strictEqual(fullscreen.data.currentWeek, 3, "vertical gestures must preserve the week");
  fullscreen.toggleZoom();
  assert.strictEqual(fullscreen.data.zoomed, true);
  assert.strictEqual(fullscreen.data.scrollX, true);
  assert.strictEqual(fullscreen.data.dayColumnWidth, 166, "zoom mode should widen day columns for reading");
}

testHomeTabs();
testSchoolSearchMemory();
testFullscreenWeekGestures();
console.log("test-schedule-tabs-fullscreen passed");
