const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
require("../miniprogram/pages/school/school.js");

const page = mockEnv.createPageInstance();
const term = "2025-2026-2";
const version = "filter-downgrade-2026-06-04";

page._schoolRequestSeq = 0;
page._activeInitSeq = 0;
page.setData({
  semesters: [{ label: term, value: term }],
  selectedSemesterIndex: 0,
  activeSnapshot: { releaseVersion: version, term },
  catalogVersion: version,
  catalogUpdatedAt: "2026-06-04T00:00:00.000Z",
  colleges: [{ code: "04", name: "测试学院" }],
  grades: ["2025"],
  originalCatalogData: {
    majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
    classes: [],
  },
});

page.hasSharedQuery = () => false;
page.originalCatalogData = {
  majors: [{ collegeCode: "04", code: "0401", name: "测试专业", grade: "2025" }],
};
page.applySharedQueryIfNeeded = function() {
  this.sharedApplied = true;
};
page.showFilterChangedHint = function(message) {
  this.lastFilterHint = message;
};
page.showRestoreHint = function() {
  this.restoreShown = true;
};

const cacheKey = page.getFilterCacheKey();
global.wx.setStorageSync(cacheKey, {
  semesterValue: term,
  collegeCode: "04",
  collegeName: "测试学院",
  grade: "2025",
  majorCode: "0401",
  majorName: "测试专业",
  classId: "old-class-id",
  className: "",
  catalogVersion: "old-release",
  lastUpdatedAt: Date.now() - 1000,
});

async function run() {
  page.restoreFilterCache();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.strictEqual(page.data.selectedCollegeIndex, 0, "college should remain restored");
  assert.strictEqual(page.data.selectedGradeIndex, 0, "grade should remain restored");
  assert.strictEqual(page.data.selectedMajorIndex, 0, "major should remain restored");
  assert.strictEqual(page.data.selectedClassIndex, -1, "missing old class should downgrade to major level");
  assert.strictEqual(page.sharedApplied, true, "shared query hook should continue after downgrade");

  const downgraded = global.wx.getStorageSync(cacheKey);
  assert.strictEqual(downgraded.collegeCode, "04");
  assert.strictEqual(downgraded.grade, "2025");
  assert.strictEqual(downgraded.majorCode, "0401");
  assert.strictEqual(downgraded.classId, "", "invalid class should be removed from filter cache");
  assert.strictEqual(downgraded.className, "", "invalid class name should be removed from filter cache");

  console.log("test-school-filter-cache-downgrade passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
