const assert = require("assert");
const {
  buildSidecarMeta,
  calculateFingerprint,
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
  const second = calculateFingerprint(snapshot({
    releaseVersion: "fingerprint-b",
    version: "fingerprint-b",
    generatedAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    meta: { generatedCommand: "new command", includeScopes: ["classSchedules"], grades: "2025" },
  }));
  assert.strictEqual(first.canonicalHash, second.canonicalHash, "volatile metadata must not change canonical hash");

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
