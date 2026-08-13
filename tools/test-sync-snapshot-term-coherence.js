"use strict";

const assert = require("assert");

const originalEnv = Object.assign({}, process.env);
const originalGlobals = {
  SYNC_PLAN: global.SYNC_PLAN,
  TERM_CONFIG: global.TERM_CONFIG,
  CLI_PARAMS: global.CLI_PARAMS,
};

function restore() {
  Object.keys(process.env).forEach((key) => {
    if (!(key in originalEnv)) delete process.env[key];
  });
  Object.assign(process.env, originalEnv);
  Object.keys(originalGlobals).forEach((key) => {
    if (originalGlobals[key] === undefined) delete global[key];
    else global[key] = originalGlobals[key];
  });
}

try {
  // Reproduce the operator failure: a stale local preference says 2025, while
  // the resolved one-click SyncPlan and term config both target 2026 Fall.
  process.env.PREFERRED_SEMESTER = "2025-2026-2";
  global.SYNC_PLAN = {
    term: "2026-2027-1",
    mergeOldData: false,
    runId: "snapshot-term-coherence",
    profile: "new-term",
  };
  global.TERM_CONFIG = {
    term: "2026-2027-1",
    semesterText: "2026-2027学年第一学期",
    termStartDate: "2026-09-07",
    totalWeeks: 20,
    weekStart: "monday",
    source: "test",
  };
  global.CLI_PARAMS = { includeScopes: ["classSchedules"] };

  const { buildSnapshot } = require("./fosu-sync-client/sync");
  const schedule = {
    classId: "class-2026-1",
    className: "25测试1班",
    semester: "2026-2027-1",
    grade: "2025",
    collegeCode: "01",
    collegeName: "测试学院",
    majorCode: "0101",
    majorName: "测试专业",
    displayType: "class-schedule",
    courses: [{
      courseName: "测试课程",
      weekday: 1,
      startSection: 1,
      endSection: 2,
      weeks: [1],
    }],
  };
  const snapshot = buildSnapshot({
    semesters: [{ value: "2026-2027-1", label: "2026-2027学年第一学期" }],
    colleges: [{ code: "01", name: "测试学院" }],
    grades: ["2025", "2026"],
    weeks: [],
    sections: [],
  }, [{
    collegeCode: "01",
    code: "0101",
    name: "测试专业",
    grade: "2025",
  }], [schedule], null, {
    resources: {},
  });

  assert.strictEqual(snapshot.term, "2026-2027-1", "snapshot term must come from the resolved SyncPlan");
  assert.strictEqual(snapshot.semester, "2026-2027-1");
  assert.strictEqual(snapshot.termConfig.term, "2026-2027-1");
  assert(snapshot.classSchedules.every((item) => item.semester === "2026-2027-1"));

  assert.throws(() => buildSnapshot({
    semesters: [], colleges: [], grades: [], weeks: [], sections: [],
  }, [], [Object.assign({}, schedule, { semester: "2025-2026-2" })], null, {
    resources: {},
  }), (error) => error && error.code === "SNAPSHOT_TERM_DATA_MISMATCH");
  console.log("test-sync-snapshot-term-coherence passed");
} finally {
  restore();
}
