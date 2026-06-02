const assert = require("assert");
const mockEnv = require("./mock-env");
const { writeSameVersionIndexCache } = require("../miniprogram/utils/storage");

mockEnv.clearStorage();
require("../miniprogram/pages/school/school.js");

const term = "2025-2026-2";
const releaseVersion = "2026-06-01T23-44-37";
const type = "class";
const query = { term, releaseVersion, type, collegeCode: "01", grade: "2025", majorCode: "090401" };

writeSameVersionIndexCache(term, releaseVersion, type, {
  success: true,
  term,
  releaseVersion,
  items: [{ id: "class-6", className: "25animal6" }],
  total: 1,
}, query);

const page = mockEnv.createPageInstance();
page._schoolRequestSeq = 0;
page.setData({
  activeSnapshot: { term, releaseVersion },
  catalogVersion: releaseVersion,
  semesters: [{ label: term, value: term }],
  selectedSemesterIndex: 0,
});

global.wx.mockRequest = (options) => {
  setTimeout(() => options.fail({ errMsg: "request:fail disconnected" }), 5);
};

let rendered = null;
page.executeSearch(type, query, (data, isFromCache) => {
  rendered = { data, isFromCache };
}, () => {});

setTimeout(() => {
  assert(rendered, "cached index should render immediately");
  assert.strictEqual(rendered.isFromCache, true);
  assert.strictEqual(rendered.data.items[0].className, "25animal6");
  assert.strictEqual(page.data.loadingState, "none");
  assert.strictEqual(page.data.dataLoadState, "success");
  console.log("test-school-index-cache-fallback passed");
  process.exit(0);
}, 80);
