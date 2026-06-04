const assert = require("assert");
const mockEnv = require("./mock-env");
const releasePackService = require("../miniprogram/services/releasePackService");

mockEnv.clearStorage();
require("../miniprogram/pages/school/school.js");

const term = "2025-2026-2";
const type = "class";

function writeIndex(version, className) {
  mockEnv.storage.set(releasePackService.getIndexCacheKey(term, version, type), {
    savedAt: Date.now(),
    data: {
      success: true,
      type,
      term,
      semester: term,
      releaseVersion: version,
      version,
      items: [{
        id: `class-${version}`,
        className,
        name: className,
        semester: term,
        collegeCode: "04",
        grade: "2025",
        majorCode: "0401",
        courseCount: 1,
      }],
    },
  });
}

function createPage(version) {
  const page = mockEnv.createPageInstance();
  page._schoolRequestSeq = 0;
  page._activeInitSeq = 0;
  page.setData({
    activeSnapshot: { term, releaseVersion: version },
    catalogVersion: version,
    semesters: [{ label: term, value: term }],
    selectedSemesterIndex: 0,
  });
  return page;
}

global.wx.mockRequest = (options) => {
  setTimeout(() => options.success({
    statusCode: 200,
    data: { success: false, code: "OFFLINE", reasonCode: "OFFLINE" },
  }), 1);
};

async function renderSearch(page, version) {
  const query = {
    term,
    releaseVersion: version,
    type,
    collegeCode: "04",
    grade: "2025",
    majorCode: "0401",
    limit: 100,
  };
  return new Promise((resolve) => {
    page.executeSearch(type, query, (data, isFromCache) => {
      resolve({ data, isFromCache });
    }, () => {});
  });
}

async function run() {
  writeIndex("release-v1", "25版本隔离1班");
  writeIndex("release-v2", "25版本隔离2班");

  let page = createPage("release-v1");
  let rendered = await renderSearch(page, "release-v1");
  assert.strictEqual(rendered.isFromCache, true);
  assert.strictEqual(rendered.data.items[0].className, "25版本隔离1班");

  page = createPage("release-v2");
  rendered = await renderSearch(page, "release-v2");
  assert.strictEqual(rendered.isFromCache, true);
  assert.strictEqual(rendered.data.items[0].className, "25版本隔离2班");

  console.log("test-school-version-isolation passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
