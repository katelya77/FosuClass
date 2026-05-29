const assert = require("assert");
const {
  isPhysicalEducationLike,
  isVenueLike,
  mergeCanonicalCoursesForDisplay,
  normalizeCourseIdentity,
} = require("../miniprogram/utils/courseNormalizer");

function testNormalCourse() {
  const course = normalizeCourseIdentity({
    courseName: "有机化学",
    teacherName: "袁文兵",
    classroom: "C7-503",
  });
  assert.strictEqual(course.displayCourseName, "有机化学");
  assert.strictEqual(course.displayTeacherName, "袁文兵");
  assert.strictEqual(course.displayClassroom, "C7-503");
  assert.strictEqual(course.normalizationReason, "normal");
}

function testPeVenueCourseName() {
  const course = normalizeCourseIdentity({
    courseName: "仙溪游泳池",
    teacherName: "大学体育2",
    classroom: "",
  });
  assert.strictEqual(course.displayCourseName, "大学体育2");
  assert.strictEqual(course.displayClassroom, "仙溪游泳池");
  assert.strictEqual(course.isPhysicalEducationLike, true);
  assert.strictEqual(course.isVenueCandidate, true);
  assert.strictEqual(course.isTeacherFieldActuallyCourseName, true);
  assert.strictEqual(course.normalizationReason, "courseName_is_venue_teacherName_is_course");
}

function testPeSportsFieldCourseName() {
  const course = normalizeCourseIdentity({
    courseName: "仙溪运动场1",
    teacherName: "大学体育2",
  });
  assert.strictEqual(course.displayCourseName, "大学体育2");
  assert.strictEqual(course.displayClassroom, "仙溪运动场1");
}

function testTodayMerge() {
  const base = {
    semester: "2025-2026-2",
    className: "25动物科学3班",
    weekday: 5,
    startSection: 9,
    endSection: 10,
    startWeek: 1,
    endWeek: 16,
    weeks: [12],
  };
  const courses = [
    Object.assign({}, base, { courseName: "大学体育2", teacherName: "", classroom: "" }),
    Object.assign({}, base, { courseName: "仙溪湖龙舟码头", teacherName: "大学体育2", classroom: "" }),
    Object.assign({}, base, { courseName: "仙溪游泳池", teacherName: "大学体育2", classroom: "" }),
    Object.assign({}, base, { courseName: "仙溪运动场1", teacherName: "大学体育2", classroom: "" }),
    Object.assign({}, base, { courseName: "仙溪运动场2", teacherName: "大学体育2", classroom: "" }),
  ];
  const result = mergeCanonicalCoursesForDisplay(courses, {
    semester: "2025-2026-2",
    className: "25动物科学3班",
    currentWeek: 12,
    weekday: 5,
  });

  assert.strictEqual(result.courses.length, 1);
  assert.strictEqual(result.courses[0].displayCourseName, "大学体育2");
  assert.strictEqual(result.courses[0].displayClassroom, "多个地点");
  assert.strictEqual(result.courses[0].tag, "多地点");
  assert.strictEqual(result.courses[0].isMerged, true);
  assert.strictEqual(result.courses[0].mergedCount, 5);
}

function testBiochemistryNotVenueOrPe() {
  const course = normalizeCourseIdentity({
    courseName: "动物生物化学",
    teacherName: "祁思区陈庆",
    classroom: "C5-111",
  });
  assert.strictEqual(course.displayCourseName, "动物生物化学");
  assert.strictEqual(course.displayTeacherName, "祁思区陈庆");
  assert.strictEqual(course.displayClassroom, "C5-111");
  assert.strictEqual(course.isVenueCandidate, false);
  assert.strictEqual(course.isPhysicalEducationLike, false);
  assert.strictEqual(isVenueLike(course.courseName), false);
  assert.strictEqual(isPhysicalEducationLike(course), false);
}

function testSafetyEducationNotVenue() {
  const course = normalizeCourseIdentity({
    courseName: "实验室安全教育",
    teacherName: "赵孟孟",
    classroom: "",
  });
  assert.strictEqual(course.displayCourseName, "实验室安全教育");
  assert.strictEqual(course.isVenueCandidate, false);
  assert.strictEqual(isVenueLike(course.courseName), false);
}

testNormalCourse();
testPeVenueCourseName();
testPeSportsFieldCourseName();
testTodayMerge();
testBiochemistryNotVenueOrPe();
testSafetyEducationNotVenue();

console.log("course normalizer tests passed");
