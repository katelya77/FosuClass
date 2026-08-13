const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

global.getApp = () => ({
  globalData: {
    activeRelease: {
      term: "2025-2026-2",
      releaseVersion: "release-b",
    },
  },
});

const storage = require("../miniprogram/utils/storage");
const releasePackService = require("../miniprogram/services/releasePackService");
const currentScheduleService = require("../miniprogram/services/currentScheduleService");

const originalLoadDetail = releasePackService.loadDetail;
const originalLoadIndex = releasePackService.loadIndex;
const ACTIVE_B = { term: "2025-2026-2", releaseVersion: "release-b", updatedAt: "2026-06-17T00:00:00Z" };

function reset() {
  mockEnv.clearStorage();
  storage.clearCurrentScheduleTarget();
  currentScheduleService.__resetForTest();
  releasePackService.loadDetail = originalLoadDetail;
  releasePackService.loadIndex = originalLoadIndex;
}

function makeTarget(patch = {}) {
  return Object.assign({
    type: "class",
    id: "class-1",
    detailId: "class-1",
    classId: "class-1",
    name: "25动物医学6班",
    term: "2025-2026-2",
    semester: "2025-2026-2",
    releaseVersion: "release-a",
    courses: [{ courseName: "旧课", weekday: 1, startSection: 1, endSection: 2 }],
    source: "release-pack",
  }, patch);
}

function makeDetail(id = "class-1", patch = {}) {
  return Object.assign({
    term: "2025-2026-2",
    releaseVersion: "release-b",
    schedule: {
      type: "class",
      id,
      detailId: id,
      classId: id,
      name: "25动物医学6班",
      className: "25动物医学6班",
      courses: [{ courseName: "新课", weekday: 1, startSection: 3, endSection: 4 }],
    },
  }, patch);
}

async function testUpdatesOldReleaseToActiveRelease() {
  reset();
  storage.setCurrentScheduleTarget(makeTarget());
  let calls = 0;
  releasePackService.loadDetail = async (type, id) => {
    calls += 1;
    assert.strictEqual(type, "class");
    assert.strictEqual(id, "class-1");
    return makeDetail(id);
  };
  const result = await currentScheduleService.ensureCurrentScheduleFresh({
    activeSnapshot: ACTIVE_B,
    force: true,
    notify: true,
  });
  const saved = storage.getCurrentScheduleTarget();
  assert.strictEqual(result.status, "UPDATED");
  assert.strictEqual(calls, 1);
  assert.strictEqual(saved.releaseVersion, "release-b");
  assert.strictEqual(saved.courses[0].courseName, "新课");
  assert.strictEqual(saved.schemaVersion, storage.CURRENT_SCHEDULE_TARGET_SCHEMA_VERSION);
  assert.strictEqual((storage.getRecentSchedules()[0] || {}).releaseVersion, "release-b");
}

async function testSameReleaseDoesNotFetchOrNotify() {
  reset();
  storage.setCurrentScheduleTarget(makeTarget({ releaseVersion: "release-b" }));
  let calls = 0;
  releasePackService.loadDetail = async () => {
    calls += 1;
    throw new Error("should not fetch same release");
  };
  const result = await currentScheduleService.ensureCurrentScheduleFresh({
    activeSnapshot: ACTIVE_B,
    force: true,
    notify: true,
  });
  assert.strictEqual(result.status, "UNCHANGED");
  assert.strictEqual(calls, 0);
  assert.strictEqual(result.shouldNotify, undefined);
}

async function testDetailFailureKeepsLastKnownGood() {
  reset();
  storage.setCurrentScheduleTarget(makeTarget());
  releasePackService.loadDetail = async () => {
    throw new Error("network down");
  };
  releasePackService.loadIndex = async () => {
    throw new Error("index down");
  };
  const result = await currentScheduleService.ensureCurrentScheduleFresh({
    activeSnapshot: ACTIVE_B,
    force: true,
  });
  const saved = storage.getCurrentScheduleTarget();
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, "FAILED");
  assert.strictEqual(saved.releaseVersion, "release-a");
  assert.strictEqual(saved.courses[0].courseName, "旧课");
}

async function testStableDetailIdAndExactNameMigration() {
  reset();
  storage.setCurrentScheduleTarget(makeTarget({ detailId: "stable-id", id: "stable-id", classId: "stable-id" }));
  releasePackService.loadDetail = async (type, id) => makeDetail(id);
  let result = await currentScheduleService.ensureCurrentScheduleFresh({ activeSnapshot: ACTIVE_B, force: true });
  assert.strictEqual(result.status, "UPDATED");
  assert.strictEqual(storage.getCurrentScheduleTarget().detailId, "stable-id");

  reset();
  storage.setCurrentScheduleTarget(makeTarget({ id: "", detailId: "", classId: "" }));
  releasePackService.loadDetail = async (type, id) => makeDetail(id);
  releasePackService.loadIndex = async () => ({
    items: [{ id: "migrated-id", detailId: "migrated-id", className: "25动物医学6班", name: "25动物医学6班" }],
  });
  result = await currentScheduleService.ensureCurrentScheduleFresh({ activeSnapshot: ACTIVE_B, force: true });
  assert.strictEqual(result.status, "UPDATED");
  assert.strictEqual(storage.getCurrentScheduleTarget().detailId, "migrated-id");
}

async function testCrossTermMigrationFallsBackToExactName() {
  reset();
  const nextActive = { term: "2026-2027-1", releaseVersion: "release-new" };
  storage.setCurrentScheduleTarget(makeTarget());
  releasePackService.loadDetail = async (type, id, params) => {
    assert.strictEqual(params.term, nextActive.term);
    if (id === "class-1") {
      const error = new Error("DETAIL_NOT_FOUND");
      error.code = "DETAIL_NOT_FOUND";
      throw error;
    }
    return makeDetail(id, {
      term: nextActive.term,
      releaseVersion: nextActive.releaseVersion,
      schedule: Object.assign({}, makeDetail(id).schedule, {
        id,
        detailId: id,
        classId: id,
      }),
    });
  };
  releasePackService.loadIndex = async (type, params) => {
    assert.strictEqual(params.term, nextActive.term);
    return {
      items: [{
        id: "class-new-term",
        detailId: "class-new-term",
        className: makeTarget().name,
        name: makeTarget().name,
      }],
    };
  };
  const result = await currentScheduleService.ensureCurrentScheduleFresh({
    activeSnapshot: nextActive,
    force: true,
  });
  const saved = storage.getCurrentScheduleTarget();
  assert.strictEqual(result.status, "UPDATED");
  assert.strictEqual(saved.term, nextActive.term);
  assert.strictEqual(saved.releaseVersion, nextActive.releaseVersion);
  assert.strictEqual(saved.detailId, "class-new-term");
}

async function testAmbiguousNameDoesNotBind() {
  reset();
  storage.setCurrentScheduleTarget(makeTarget({ id: "", detailId: "", classId: "" }));
  releasePackService.loadIndex = async () => ({
    items: [
      { id: "a", className: "25动物医学6班" },
      { id: "b", className: "25动物医学6班" },
    ],
  });
  const result = await currentScheduleService.ensureCurrentScheduleFresh({ activeSnapshot: ACTIVE_B, force: true });
  assert.strictEqual(result.status, "AMBIGUOUS");
  assert.strictEqual(storage.getCurrentScheduleTarget().releaseVersion, "release-a");
}

async function testPersonalXlsAndCustomCoursesProtected() {
  reset();
  storage.setCurrentScheduleTarget(makeTarget({ type: "personal-xls", releaseVersion: "", source: "personal-xls" }));
  let calls = 0;
  releasePackService.loadDetail = async () => {
    calls += 1;
    return makeDetail();
  };
  const result = await currentScheduleService.ensureCurrentScheduleFresh({ activeSnapshot: ACTIVE_B, force: true });
  assert.strictEqual(result.status, "PROTECTED_PERSONAL_XLS");
  assert.strictEqual(calls, 0);

  reset();
  const target = makeTarget({ classId: "class-1" });
  storage.setCurrentScheduleTarget(target);
  const customKey = `customCourses:${encodeURIComponent("class")}:${encodeURIComponent("2025-2026-2")}:${encodeURIComponent("class-1")}`;
  wx.setStorageSync(customKey, [{ id: "custom-1", courseName: "自定义课程" }]);
  releasePackService.loadDetail = async () => makeDetail("class-1");
  await currentScheduleService.ensureCurrentScheduleFresh({ activeSnapshot: ACTIVE_B, force: true });
  assert.deepStrictEqual(wx.getStorageSync(customKey), [{ id: "custom-1", courseName: "自定义课程" }]);
}

function testSetCurrentScheduleTargetTermAndLegacyMigration() {
  reset();
  storage.setCurrentScheduleTarget(makeTarget({ term: "", semester: "2025-2026-2" }));
  assert.strictEqual(storage.getCurrentScheduleTarget().term, "2025-2026-2");
  assert.strictEqual(storage.getSettings().semester, "2025-2026-2");

  reset();
  wx.setStorageSync(storage.CURRENT_SCHEDULE_TARGET_KEY, {
    type: "class",
    id: "legacy-id",
    name: "旧版班级",
    semester: "2025-2026-2",
    version: "release-a",
    courses: [],
  });
  const migrated = storage.getCurrentScheduleTarget();
  assert.strictEqual(migrated.schemaVersion, storage.CURRENT_SCHEDULE_TARGET_SCHEMA_VERSION);
  assert.strictEqual(migrated.term, "2025-2026-2");
  assert.strictEqual(migrated.releaseVersion, "release-a");
}

function testActiveTermFallbackAndClassNameOnlyLegacyTarget() {
  reset();
  storage.setCurrentScheduleTarget(makeTarget({ term: "", semester: "" }));
  assert.strictEqual(storage.getCurrentScheduleTarget().term, "2025-2026-2");
  assert.strictEqual(storage.getSettings().semester, "2025-2026-2");

  reset();
  wx.setStorageSync(storage.CURRENT_SCHEDULE_TARGET_KEY, {
    type: "class",
    id: "legacy-class-id",
    className: "legacy class",
    version: "release-a",
    courses: [],
  });
  const migrated = storage.getCurrentScheduleTarget();
  assert.strictEqual(migrated.schemaVersion, storage.CURRENT_SCHEDULE_TARGET_SCHEMA_VERSION);
  assert.strictEqual(migrated.name, "legacy class");
  assert.strictEqual(migrated.term, "2025-2026-2");
  assert.strictEqual(migrated.releaseVersion, "release-a");
}

async function run() {
  await testUpdatesOldReleaseToActiveRelease();
  await testSameReleaseDoesNotFetchOrNotify();
  await testDetailFailureKeepsLastKnownGood();
  await testStableDetailIdAndExactNameMigration();
  await testCrossTermMigrationFallsBackToExactName();
  await testAmbiguousNameDoesNotBind();
  await testPersonalXlsAndCustomCoursesProtected();
  testSetCurrentScheduleTargetTermAndLegacyMigration();
  testActiveTermFallbackAndClassNameOnlyLegacyTarget();
  reset();
  console.log("test-current-schedule-refresh passed");
}

run().catch((error) => {
  reset();
  console.error(error);
  process.exit(1);
});
