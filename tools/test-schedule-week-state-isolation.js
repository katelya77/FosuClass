"use strict";

const assert = require("assert");
const path = require("path");
const mockEnv = require("./mock-env");
const storage = require("../miniprogram/utils/storage");
const calendarService = require("../miniprogram/services/teachingCalendarService");
const week = require("../miniprogram/utils/week");
const navigation = require("../miniprogram/services/scheduleNavigationService");

const RealDate = Date;
let now = new RealDate(2026, 9, 7, 12).getTime();
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};

function calendar(start = "2026-08-31", version = "immediate") {
  return {
    term: "2026-2027-1", releaseVersion: version,
    termConfig: { term: "2026-2027-1", termStartDate: start, weekStart: start, totalWeeks: 19 },
    weeks: Array.from({ length: 19 }, (_, index) => ({
      weekNo: index + 1, type: "teaching",
      startDate: week.formatDate(week.addLocalDays(start, index * 7)),
      endDate: week.formatDate(week.addLocalDays(start, index * 7 + 6)),
    })),
  };
}

let immediate = calendar();
const originalImmediate = calendarService.getImmediateActiveCalendar;
const originalLoad = calendarService.loadActiveTeachingCalendar;
calendarService.getImmediateActiveCalendar = () => immediate;
calendarService.loadActiveTeachingCalendar = () => Promise.resolve(immediate);
wx.setNavigationBarTitle = () => {};

function page(name) {
  const file = path.resolve(__dirname, `../miniprogram/pages/${name}/${name}.js`);
  delete require.cache[require.resolve(file)];
  require(file);
  const instance = mockEnv.createPageInstance();
  // The shared mock helper assigns the definition's data object last.
  // Clone here so each tested instance has WeChat's independent page data.
  instance.data = JSON.parse(JSON.stringify(instance.data));
  return instance;
}

function home() {
  const instance = page("index");
  instance.loadPageConfig = () => {};
  instance.checkTodayReminder = () => {};
  instance.refreshCurrentTargetSilently = () => {};
  instance.onLoad({});
  instance.onShow();
  return instance;
}

function view(options = {}) {
  const instance = page("schedule-view");
  instance.getOpenerEventChannel = () => ({ on() {} });
  instance.onLoad(options);
  instance.initScheduleLayout();
  return instance;
}

function swipe(instance) {
  instance.onScheduleTouchStart({ touches: [{ clientX: 280, clientY: 200 }] });
  instance.onScheduleTouchEnd({ changedTouches: [{ clientX: 180, clientY: 206 }] });
}

function reenter(instance) {
  if (instance.onHide) instance.onHide();
  instance.onShow();
}

function snapshotSettings() {
  return JSON.stringify(wx.getStorageSync(storage.STORAGE_KEY));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() { await Promise.resolve(); await Promise.resolve(); }

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test("legacy settings cannot choose the home week; migration preserves other preferences", () => {
  mockEnv.clearStorage();
  const legacy = { currentWeek: 15, manualWeekOverride: true, className: "fixture", semester: "2026-2027-1",
    showWeekend: false, weekendShowMode: "detail", hideInactiveCourses: false, enableTodayStartupReminder: false };
  // Direct raw storage also covers users upgrading from the old implementation.
  wx.setStorageSync(storage.STORAGE_KEY, legacy);
  assert.strictEqual(home().data.currentWeek, 6);
  const migrated = storage.getSettings();
  assert(!Object.hasOwn(migrated, "currentWeek"));
  assert(!Object.hasOwn(migrated, "manualWeekOverride"));
  Object.keys(legacy).filter((key) => !["currentWeek", "manualWeekOverride"].includes(key))
    .forEach((key) => assert.deepStrictEqual(migrated[key], legacy[key], key));
  assert(!Object.hasOwn(wx.getStorageSync(storage.STORAGE_KEY), "currentWeek"));
  storage.saveSettings({ currentWeek: 15, manualWeekOverride: true });
  assert(!Object.hasOwn(storage.getSettings(), "currentWeek"), "legacy writes must not revive the preference");
});

test("home swipes and internal renders stay local; tab reentry and cold start return to today", () => {
  mockEnv.clearStorage();
  storage.saveSettings({ showWeekend: true });
  const before = snapshotSettings();
  const instance = home();
  swipe(instance); swipe(instance);
  assert.strictEqual(instance.data.currentWeek, 8);
  instance.loadSchedule();
  assert.strictEqual(instance.data.currentWeek, 8, "internal refresh must preserve browsing");
  assert.strictEqual(snapshotSettings(), before);
  reenter(instance);
  assert.strictEqual(instance.data.currentWeek, 6);
  assert.strictEqual(home().data.currentWeek, 6);
});

test("home to school, school to home, and A to B are independent for all schedule types", () => {
  mockEnv.clearStorage();
  storage.saveSettings({ showWeekend: true });
  const before = snapshotSettings();
  const instance = home();
  swipe(instance); swipe(instance);
  for (const type of ["class", "teacher", "classroom", "course"]) {
    const a = view({ type });
    assert.strictEqual(a.data.currentWeek, 6, type);
    swipe(a); swipe(a); swipe(a);
    assert.strictEqual(a.data.currentWeek, 9, type);
    a.initScheduleLayout();
    assert.strictEqual(a.data.currentWeek, 9, "late course delivery must preserve the selected week");
    assert.strictEqual(view({ type }).data.currentWeek, 6, "new instance starts at today");
  }
  assert.strictEqual(instance.data.currentWeek, 8, "other views must not alter the open home");
  reenter(instance);
  assert.strictEqual(instance.data.currentWeek, 6);
  assert.strictEqual(snapshotSettings(), before);
});

test("explicit week and weekday survive navigation and belong only to this detail instance", () => {
  mockEnv.clearStorage();
  const url = navigation.buildScheduleViewUrl({ type: "class", id: "fixture", week: 9, weekday: 7 });
  assert(url.includes("week=9") && url.includes("weekday=7"));
  storage.saveSettings({ showWeekend: false });
  const before = snapshotSettings();
  const explicit = view({ week: "9", weekday: "7" });
  assert.strictEqual(explicit.data.currentWeek, 9);
  assert.strictEqual(explicit.data.showWeekend, true);
  swipe(explicit);
  assert.strictEqual(view().data.currentWeek, 6);
  assert.strictEqual(home().data.currentWeek, 6);
  assert.strictEqual(snapshotSettings(), before);
});

test("fullscreen preserves its opener context including home onShow, without changing other views", () => {
  mockEnv.clearStorage();
  storage.setCurrentScheduleTarget({ type: "class", id: "fixture", name: "fixture", term: "2026-2027-1", courses: [] });
  const before = snapshotSettings();
  const other = view();
  for (const opener of [home(), view()]) {
    opener.onWeekChange({ detail: { type: "select", week: 8 } });
    let receiver;
    const fullscreen = page("schedule-fullscreen");
    fullscreen.getOpenerEventChannel = () => ({
      on(name, fn) { receiver = fn; },
      emit(name, detail) { assert.strictEqual(name, "weekChange"); openerEvents.weekChange(detail); },
    });
    fullscreen.onLoad();
    let openerEvents;
    wx.navigateTo = ({ url, events, success }) => {
      assert.strictEqual(url, "/pages/schedule-fullscreen/schedule-fullscreen");
      openerEvents = events;
      success({ eventChannel: { emit(name, payload) { assert.strictEqual(name, "schedule"); receiver(payload); } } });
      if (opener.onHide) opener.onHide();
    };
    opener.openScheduleFullscreen();
    assert.strictEqual(fullscreen.data.currentWeek, 8);
    swipe(fullscreen);
    assert.strictEqual(fullscreen.data.currentWeek, 9);
    assert.strictEqual(opener.data.currentWeek, 9);
    if (opener.onShow) opener.onShow();
    assert.strictEqual(opener.data.currentWeek, 9, "return from fullscreen is the same schedule context");
    if (opener.onShow) { reenter(opener); assert.strictEqual(opener.data.currentWeek, 6); }
  }
  assert.strictEqual(other.data.currentWeek, 6);
  assert.strictEqual(home().data.currentWeek, 6);
  assert.strictEqual(snapshotSettings(), before);
});

test("calendar week rollover is recalculated on home reentry", () => {
  mockEnv.clearStorage();
  const instance = home();
  assert.strictEqual(instance.data.currentWeek, 6);
  now = new RealDate(2026, 9, 12, 12).getTime();
  reenter(instance);
  assert.strictEqual(instance.data.currentWeek, 7);
  assert.strictEqual(view().data.currentWeek, 7);
  now = new RealDate(2026, 9, 7, 12).getTime();
});

test("personal import preview and today's reminder also ignore legacy week preferences", () => {
  mockEnv.clearStorage();
  wx.setStorageSync(storage.STORAGE_KEY, { currentWeek: 15, manualWeekOverride: true });
  const personal = page("personal-sync");
  personal.prepareStudentPreview({ summary: { currentPreviewWeek: 15 }, previewGrid: { week: 15 }, allArrangements: [] });
  assert.strictEqual(personal.data.studentPreviewWeek, 6);
  assert.strictEqual(require("../miniprogram/utils/todayReminder").getTodayCoursesData().currentWeek, 6);
});

test("latest calendar updates untouched pages but preserves home/detail browsing and explicit week", async () => {
  mockEnv.clearStorage();
  const pending = [];
  calendarService.loadActiveTeachingCalendar = () => { const item = deferred(); pending.push(item); return item.promise; };
  const untouchedHome = home();
  const browsingHome = home();
  const untouchedView = view();
  const browsingView = view();
  const explicitView = view({ week: "9" });
  browsingHome.onWeekChange({ detail: { type: "select", week: 8 } });
  browsingView.onWeekChange({ detail: { type: "select", week: 8 } });
  pending.forEach((item) => item.resolve(calendar("2026-08-24", "latest")));
  await flush();
  assert.strictEqual(untouchedHome.data.currentWeek, 7);
  assert.strictEqual(untouchedView.data.currentWeek, 7);
  assert.strictEqual(browsingHome.data.currentWeek, 8);
  assert.strictEqual(browsingView.data.currentWeek, 8);
  assert.strictEqual(explicitView.data.currentWeek, 9);
  calendarService.loadActiveTeachingCalendar = () => Promise.resolve(immediate);
});

test("out-of-order calendar refreshes cannot overwrite a newer page initialization", async () => {
  mockEnv.clearStorage();
  const pending = [];
  calendarService.loadActiveTeachingCalendar = () => { const item = deferred(); pending.push(item); return item.promise; };
  const instance = home();
  const detail = view();
  reenter(instance);
  detail.initScheduleLayout();
  pending[2].resolve(calendar("2026-08-24", "newer"));
  pending[3].resolve(calendar("2026-08-24", "newer"));
  await flush();
  pending[0].resolve(calendar("2026-08-31", "older"));
  pending[1].resolve(calendar("2026-08-31", "older"));
  await flush();
  assert.strictEqual(instance.data.currentWeek, 7);
  assert.strictEqual(detail.data.currentWeek, 7);
  calendarService.loadActiveTeachingCalendar = () => Promise.resolve(immediate);
});

test("back-to-current clears browsing intent so latest calendar can follow today again", async () => {
  mockEnv.clearStorage();
  const instance = home();
  const detail = view({ week: "9" });
  instance.onWeekChange({ detail: { type: "select", week: 8 } });
  await flush();
  const pending = [];
  calendarService.loadActiveTeachingCalendar = () => { const item = deferred(); pending.push(item); return item.promise; };
  instance.backToCurrentWeek();
  detail.backToCurrentWeek();
  detail.initScheduleLayout();
  assert.strictEqual(instance.data.currentWeek, 6);
  assert.strictEqual(detail.data.currentWeek, 6);
  pending.forEach((item) => item.resolve(calendar("2026-08-24", "latest")));
  await flush();
  assert.strictEqual(instance.data.currentWeek, 7);
  assert.strictEqual(detail.data.currentWeek, 7);
});

async function main() {
  let passed = 0;
  for (const item of cases) {
    try { await item.fn(); passed += 1; console.log(`PASS ${item.name}`); }
    catch (error) { console.error(`FAIL ${item.name}: ${error.message}`); process.exitCode = 1; }
    await flush();
    now = new RealDate(2026, 9, 7, 12).getTime();
    calendarService.loadActiveTeachingCalendar = () => Promise.resolve(immediate);
  }
  console.log(`${passed}/${cases.length} schedule week state isolation cases passed`);
}

main().finally(() => {
  global.Date = RealDate;
  calendarService.getImmediateActiveCalendar = originalImmediate;
  calendarService.loadActiveTeachingCalendar = originalLoad;
});
