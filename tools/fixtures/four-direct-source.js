"use strict";
module.exports = function snapshot() {
  const term = "2026-2027-1";
  const event = { courseName: "测试课程", teacherName: "测试教师", classroom: "测试教室", weekday: 1, startSection: 1, endSection: 2, weeks: [1, 2], startWeek: 1, endWeek: 2, semester: term };
  const data = { schemaVersion: 1, term, semester: term, termStartDate: "2026-09-07", termConfig: { term, termStartDate: "2026-09-07", totalWeeks: 20, weekStart: "monday" }, catalog: { colleges: [{ code: "fixture", name: "测试学院" }], grades: ["2026"], semesters: [{ value: term, label: term }], majors: [{ code: "fixture", name: "测试专业", collegeCode: "fixture", grade: "2026" }] }, majors: [{ code: "fixture", name: "测试专业", collegeCode: "fixture", grade: "2026" }], classSchedules: [{ classId: "fixture-class", className: "26测试1班", collegeCode: "fixture", grade: "2026", majorCode: "fixture", semester: term, displayType: "class-schedule", courses: [event] }], resources: {}, scopeSources: {}, directSourceSummary: {}, meta: { allowDerived: false, requireFourDirectSources: true, includeScopes: ["classSchedules", "teacherSchedules", "classroomSchedules", "courseSchedules", "teachers", "classrooms", "courses"] } };
  Object.assign(data, { releaseVersion: "2026-10-08T00-00-00", version: "2026-10-08T00-00-00", generatedAt: "2026-10-08T00:00:00.000Z" });
  data.termConfig.releaseVersion = data.releaseVersion;
  for (const kind of ["class", "teacher", "classroom", "course"]) {
    if (kind !== "class") {
      const key = { teacher: "teacherName", classroom: "roomName", course: "courseName" }[kind];
      const name = { teacher: "测试教师", classroom: "测试教室", course: "测试课程" }[kind];
      data.resources[kind + "Schedules"] = [{ [key]: name, id: "fixture-" + kind, semester: term, courses: [event] }];
      data.resources[{ teacher: "teachers", classroom: "classrooms", course: "courses" }[kind]] = [{ [key]: name, id: "fixture-" + kind }];
    }
    data.scopeSources[kind + "Schedules"] = { sourceMode: "network-direct", requested: 1, succeeded: 1, failed: 0, cacheHits: 0 };
    data.directSourceSummary[kind] = { sourceMode: "network-direct", discoveredEntities: 1, requestedEntities: 1, success: 1, empty: 0, failed: 0, scheduleDocuments: 1, courseEvents: 1, parserErrors: 0, coverageValid: true };
  }
  return data;
};
