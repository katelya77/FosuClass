const assert = require("node:assert/strict");
const { test } = require("node:test");
const mockEnv = require("./mock-env");
const storage = require("../miniprogram/utils/storage");
require("../miniprogram/pages/school/school.js");
const schoolPage = mockEnv.createPageInstance();
require("../miniprogram/pages/schedule-view/schedule-view.js");
const detailPage = mockEnv.createPageInstance();

function selectMajor(page) {
  page.setData({ semesters: [{ value: "2026-2027-1" }], selectedSemesterIndex: 0,
    colleges: [{ code: "23", name: "测试学院" }], selectedCollegeIndex: 0,
    grades: ["2026"], selectedGradeIndex: 0,
    majors: [{ code: "eng", name: "英语" }], selectedMajorIndex: 0,
    selectedClassIndex: -1, classesOptions: [] });
}
const admin = { className: "26英语1班", displayType: "class-schedule", majorCode: "eng", grade: "2026" };
const unknown = { className: "2026级英语专业共享课程", displayType: "major-shared-schedule", isAggregated: true, majorCode: "eng", grade: "2026" };

test("全校课表不能因班名含英语而隐藏行政班，也不能隐藏待核实课程", () => {
  selectMajor(schoolPage);
  schoolPage.executeSearch = (_type, _params, render) => render({ items: [admin, unknown] });
  schoolPage.searchClassSchedule();
  assert.deepEqual(schoolPage.data.classAdminResults.map(s => s.className), ["26英语1班"]);
  assert.equal(schoolPage.data.classAggregateResults.length, 1);
  assert.match(schoolPage.data.classNoticeText, /不能|不可/);
});

test("班级选择器只提供行政班，不把专业聚合作为共享班级", async () => {
  selectMajor(schoolPage);
  schoolPage.fetchSearchIndex = async () => ({ success: true, items: [admin, unknown] });
  const options = await schoolPage.fetchClasses();
  assert.deepEqual(options.map(s => s.className), ["26英语1班"]);
});

test("旧聚合课表不能覆盖当前首页课表", () => {
  mockEnv.clearStorage();
  detailPage.setData({ type: "class", name: unknown.className, isAggregated: true,
    isCurrentTarget: false, scheduleMeta: unknown, allCourses: [] });
  let modal;
  wx.onModal = data => { modal = data; };
  detailPage.toggleBindTarget();
  assert.equal(storage.getCurrentScheduleTarget(), null);
  assert.equal(detailPage.data.isCurrentTarget, false);
  assert.match(modal && modal.content || "", /班级/);
  wx.onModal = null;
});

test("课程详情上课班级只列原始班级，不混入专业聚合标题", () => {
  const { resolveTeachingEvents } = require("../miniprogram/utils/teachingEventResolver");
  const resolved = resolveTeachingEvents({
    targetType: "class", targetName: "2026级生物工程专业课表", selectedWeek: 6,
    courses: [{ courseName: "普通化学A", classNames: ["26生物工程1"], className: "2026级生物工程专业课表",
      majorName: "生物工程", weekday: 1, startSection: 3, endSection: 4, weeks: [6] }],
  });
  assert.deepEqual(resolved.events[0].audienceClasses, ["26生物工程1"]);
});

test("已经绑定的旧聚合表保留数据，同时提示重新选择具体行政班", () => {
  require("../miniprogram/pages/index/index.js");
  const home = mockEnv.createPageInstance();
  storage.clearCurrentScheduleTarget();
  storage.setCurrentScheduleTarget({ ...unknown, type: "class", name: unknown.className,
    semester: "2026-2027-1", term: "2026-2027-1", courses: [] });
  home.renderScheduleWithCalendar({ term: "2026-2027-1", termConfig: {
    term: "2026-2027-1", termStartDate: "2026-09-07", totalWeeks: 20, weekStart: "monday",
  }, weeks: [] });
  assert.match(home.data.classAssignmentWarning, /重新选择具体班级/);
  assert.equal(storage.getCurrentScheduleTarget().name, unknown.className);
  storage.clearCurrentScheduleTarget();
});
