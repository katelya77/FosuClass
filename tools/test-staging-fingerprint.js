const assert = require("assert");
const crypto = require("crypto");
const {
  buildSidecarMeta,
  calculateFingerprint,
  canonicalPayload,
} = require("../server/src/utils/stagingFingerprint");

function snapshot(patch = {}) {
  const course = {
    courseName: "指纹课程",
    teacherName: "张老师",
    classroom: "C7-119",
    weekday: 1,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    weeks: [1, 2],
  };
  return Object.assign({
    schemaVersion: "1.0",
    releaseVersion: "fingerprint-a",
    version: "fingerprint-a",
    term: "2025-2026-2",
    semester: "2025-2026-2",
    termStartDate: "2026-03-09",
    termConfig: { term: "2025-2026-2", semesterText: "2025-2026学年第二学期", termStartDate: "2026-03-09", totalWeeks: 19, weekStart: "monday" },
    teachingCalendar: {
      schemaVersion: 2,
      term: "2025-2026-2",
      termStartDate: "2026-03-09",
      totalWeeks: 19,
      weekStart: "monday",
      source: "official-test",
      sourceStatus: "CALENDAR_SOURCE_COMPLETE",
      sourceHash: "calendar-a",
      weeks: [{ weekNo: 1, startDate: "2026-03-09", endDate: "2026-03-15", type: "teaching" }],
      specialDates: [],
      cohortMilestones: [],
    },
    generatedAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    catalog: { colleges: [{ code: "04", name: "测试学院" }], grades: ["2025"] },
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classSchedules: [{ className: "25指纹1班", courses: [course] }],
    resources: {
      teachers: [{ teacherName: "张老师" }],
      classrooms: [{ roomName: "C7-119" }],
      courses: [{ courseName: "指纹课程" }],
      teacherSchedules: [{ teacherName: "张老师", courses: [course] }],
      classroomSchedules: [{ roomName: "C7-119", courses: [course] }],
      courseSchedules: [{ courseName: "指纹课程", courses: [course] }],
    },
    meta: { generatedCommand: "old command", includeScopes: ["classSchedules"], grades: "2025" },
  }, patch);
}

function run() {
  const first = calculateFingerprint(snapshot());
  const legacyHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalPayload(snapshot())), "utf8")
    .digest("hex");
  assert.strictEqual(first.canonicalHash, legacyHash, "streaming canonical hash must match legacy canonical JSON hash");
  const second = calculateFingerprint(snapshot({
    releaseVersion: "fingerprint-b",
    version: "fingerprint-b",
    generatedAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    meta: { generatedCommand: "new command", includeScopes: ["classSchedules"], grades: "2025" },
  }));
  assert.strictEqual(first.canonicalHash, second.canonicalHash, "volatile metadata must not change canonical hash");

  const changedTermConfig = snapshot({
    termConfig: Object.assign({}, snapshot().termConfig, { totalWeeks: 20 }),
  });
  assert.notStrictEqual(first.canonicalHash, calculateFingerprint(changedTermConfig).canonicalHash, "term config changes must rebuild the release");
  const changedCalendar = snapshot({
    teachingCalendar: Object.assign({}, snapshot().teachingCalendar, {
      specialDates: [{ date: "2026-04-05", type: "holiday", note: "test holiday" }],
    }),
  });
  assert.notStrictEqual(first.canonicalHash, calculateFingerprint(changedCalendar).canonicalHash, "teaching calendar changes must rebuild the release");

  const reordered = snapshot({
    catalog: { colleges: [{ code: "05", name: "B" }, { code: "04", name: "A" }], grades: ["2025"] },
    majors: [
      { collegeCode: "04", code: "0402", name: "B", grade: "2025" },
      { collegeCode: "04", code: "0401", name: "A", grade: "2025" },
    ],
    classSchedules: [
      { classId: "class-b", className: "B", courses: [Object.assign({}, snapshot().classSchedules[0].courses[0], { weekday: 2 })] },
      { classId: "class-a", className: "A", courses: [snapshot().classSchedules[0].courses[0]] },
    ],
    resources: {
      teachers: [{ teacherId: "t2", teacherName: "B" }, { teacherId: "t1", teacherName: "A" }],
      classrooms: [{ roomId: "r2", roomName: "B" }, { roomId: "r1", roomName: "A" }],
      courses: [{ courseId: "c2", courseName: "B" }, { courseId: "c1", courseName: "A" }],
      teacherSchedules: [
        { teacherId: "t2", teacherName: "B", courses: [Object.assign({}, snapshot().resources.teacherSchedules[0].courses[0], { weekday: 2 })] },
        { teacherId: "t1", teacherName: "A", courses: [snapshot().resources.teacherSchedules[0].courses[0]] },
      ],
      classroomSchedules: [
        { roomId: "r2", roomName: "B", courses: [Object.assign({}, snapshot().resources.classroomSchedules[0].courses[0], { weekday: 2 })] },
        { roomId: "r1", roomName: "A", courses: [snapshot().resources.classroomSchedules[0].courses[0]] },
      ],
      courseSchedules: [
        { courseId: "c2", courseName: "B", courses: [Object.assign({}, snapshot().resources.courseSchedules[0].courses[0], { weekday: 2 })] },
        { courseId: "c1", courseName: "A", courses: [snapshot().resources.courseSchedules[0].courses[0]] },
      ],
    },
  });
  const reorderedAgain = snapshot({
    catalog: { colleges: [{ code: "04", name: "A" }, { code: "05", name: "B" }], grades: ["2025"] },
    majors: reordered.majors.slice().reverse(),
    classSchedules: reordered.classSchedules.slice().reverse().map((item) => Object.assign({}, item, { courses: item.courses.slice().reverse() })),
    resources: {
      teachers: reordered.resources.teachers.slice().reverse(),
      classrooms: reordered.resources.classrooms.slice().reverse(),
      courses: reordered.resources.courses.slice().reverse(),
      teacherSchedules: reordered.resources.teacherSchedules.slice().reverse(),
      classroomSchedules: reordered.resources.classroomSchedules.slice().reverse(),
      courseSchedules: reordered.resources.courseSchedules.slice().reverse(),
    },
  });
  assert.strictEqual(
    calculateFingerprint(reordered).canonicalHash,
    calculateFingerprint(reorderedAgain).canonicalHash,
    "entity and event order must not change canonical hash"
  );

  const sidecar = buildSidecarMeta(snapshot(), {
    fingerprint: first,
    previousHash: first.canonicalHash,
    rawSizeBytes: 1234,
  });
  assert.strictEqual(sidecar.changed, false);
  assert.strictEqual(sidecar.counts.classSchedules, 1);
  assert.strictEqual(sidecar.counts.teacherSchedules, 1);
  console.log("test-staging-fingerprint passed");
}

run();
