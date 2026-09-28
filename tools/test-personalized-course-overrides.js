const assert = require("node:assert/strict");
const service = require("../miniprogram/services/courseOverrideService");
const { getCourseWeekStatus } = require("../miniprogram/utils/courseWeekRules");
const { getCoursesByClass, normalizeCourse } = require("../miniprogram/utils/course");
const { setCurrentScheduleTarget } = require("../miniprogram/utils/storage");
const teachingCalendarService = require("../miniprogram/services/teachingCalendarService");
const { getTodayCoursesData } = require("../miniprogram/utils/todayReminder");
const customCourseService = require("../miniprogram/services/customCourseService");

const storage = new Map();
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
};

const target = { type: "class", term: "2026-2027-1", classId: "25-vet-6", name: "25动物医学6班" };
const otherTarget = { type: "class", term: "2026-2027-1", classId: "25-vet-7", name: "25动物医学7班" };
const base = [
  { id: "lesson-a", courseName: "动物解剖学", teacherName: "原教师", classroom: "C7-214", weekday: 2, startSection: 1, endSection: 2, weekText: "1-16周", weeks: Array.from({ length: 16 }, (_, index) => index + 1), remark: "原备注" },
  { id: "lesson-b", courseName: "动物解剖学", teacherName: "另一教师", classroom: "C7-302", weekday: 4, startSection: 3, endSection: 4, weekText: "1-16周", weeks: Array.from({ length: 16 }, (_, index) => index + 1) },
];

const adjusted = {
  courseName: "动物解剖学实验",
  teacherName: "新教师",
  classroom: "C7-318",
  weekday: 5,
  startSection: 5,
  endSection: 6,
  weekText: "2,4,6周",
  note: "个人调课",
};

assert.equal(service.saveCourseOverride(base[0], adjusted, base, target), true);
const merged = service.applyCourseOverrides(base, target);
assert.equal(merged[0].courseName, adjusted.courseName);
assert.equal(merged[0].displayCourseName, adjusted.courseName);
assert.equal(merged[0].classroom, adjusted.classroom);
assert.equal(merged[0].remark, adjusted.note);
assert.deepEqual(merged[0].sections, [5, 6]);
assert.equal(getCourseWeekStatus(merged[0], 4).active, true);
assert.equal(getCourseWeekStatus(merged[0], 3).active, false);
assert.equal(normalizeCourse(merged[0]).courseName, adjusted.courseName);
assert.equal(setCurrentScheduleTarget(Object.assign({}, target, { courses: base })), true);
assert.equal(getCoursesByClass(target.name)[0].courseName, adjusted.courseName);
const originalCalendar = teachingCalendarService.getImmediateActiveCalendar;
teachingCalendarService.getImmediateActiveCalendar = () => ({
  term: target.term,
  weeks: [],
  termConfig: { term: target.term, termStartDate: "2026-09-07", totalWeeks: 20, weekStart: "monday" },
});
try {
  const friday = getTodayCoursesData({ now: "2026-09-18T12:00:00+08:00" });
  assert.equal(friday.courses.length, 1);
  assert.equal(friday.courses[0].courseName, adjusted.courseName);
  assert.equal(friday.courses[0].classroom, adjusted.classroom);
  assert.equal(friday.courses[0].personalized, true);
} finally {
  teachingCalendarService.getImmediateActiveCalendar = originalCalendar;
}
assert.equal(base[0].courseName, "动物解剖学");
assert.equal(merged[1], base[1]);
assert.equal(service.applyCourseOverrides(base, otherTarget)[0], base[0]);

const refreshed = base.map((item) => Object.assign({}, item));
refreshed[0].classroom = "学校更新教室";
refreshed[0].releaseVersion = "v2";
assert.equal(service.applyCourseOverrides(refreshed, target)[0].classroom, adjusted.classroom);
assert.equal(service.applyCourseOverrides(refreshed, target)[0].releaseVersion, "v2");
refreshed[0].teacherName = "学校新教师";
assert.equal(service.applyCourseOverrides(refreshed, target)[0].teacherName, adjusted.teacherName);
const reidentified = refreshed.map((item) => Object.assign({}, item));
reidentified[0].id = "lesson-a-release-2";
assert.equal(service.applyCourseOverrides(reidentified, target)[0].classroom, adjusted.classroom);
assert.equal(service.restoreCourseOverride(base[0], base, target), true);
assert.equal(service.applyCourseOverrides(refreshed, target)[0].classroom, "学校更新教室");
assert.equal(service.getOverrides(target).length, 0);

const unusual = [{ id: "venue-as-title", courseName: "C7-214", teacherName: "大学体育1", weekday: 2, startSection: 1, endSection: 2, weekText: "1-16周" }];
const unusualForm = service.getSourceEditableValues(unusual[0]);
assert.equal(unusualForm.courseName, "大学体育1");
assert.equal(unusualForm.classroom, "C7-214");
service.saveCourseOverride(unusual[0], Object.assign({}, unusualForm, { classroom: "体育馆" }), unusual, otherTarget);
const unusualAdjusted = service.applyCourseOverrides(unusual.map(normalizeCourse), otherTarget)[0];
assert.equal(normalizeCourse(unusualAdjusted).courseName, "大学体育1");
assert.equal(normalizeCourse(unusualAdjusted).classroom, "体育馆");

assert.equal(setCurrentScheduleTarget(Object.assign({}, target, { courses: [] })), true);
customCourseService.upsertCustomCourse({
  courseName: "自选实验课",
  weekday: 5,
  startSection: 3,
  endSection: 4,
  weekText: "2周",
}, target);
teachingCalendarService.getImmediateActiveCalendar = () => ({
  term: target.term,
  weeks: [],
  termConfig: { term: target.term, termStartDate: "2026-09-07", totalWeeks: 20, weekStart: "monday" },
});
try {
  assert.equal(getTodayCoursesData({ now: "2026-09-18T12:00:00+08:00" }).courses[0].courseName, "自选实验课");
} finally {
  teachingCalendarService.getImmediateActiveCalendar = originalCalendar;
}

assert.throws(() => service.saveCourseOverride(base[0], Object.assign({}, adjusted, { weekText: "无效周次" }), base, target), /有效周次/);
assert.equal(service.getOverrides(target).length, 0);

console.log("personalized course overrides: passed");
