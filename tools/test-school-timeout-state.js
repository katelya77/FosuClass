const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
require("../miniprogram/pages/school/school.js");

const page = mockEnv.createPageInstance();
page._schoolRequestSeq = 0;
page.setData({
  activeSnapshot: { term: "2025-2026-2", releaseVersion: "2026-06-01T23-44-37" },
  catalogVersion: "2026-06-01T23-44-37",
  semesters: [{ label: "2025-2026-2", value: "2025-2026-2" }],
  selectedSemesterIndex: 0,
});

assert.strictEqual(page.getStateFromError({ code: "REQUEST_TIMEOUT" }), "timeout");
assert.strictEqual(page.getStateFromError({ code: "NETWORK_DOWN" }), "networkError");

global.wx.mockRequest = (options) => {
  setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 5);
};

page.executeSearch("class", { term: "2025-2026-2", releaseVersion: "2026-06-01T23-44-37" }, () => {}, () => {});

setTimeout(() => {
  assert.strictEqual(page.data.loadingState, "timeout");
  assert.notStrictEqual(page.data.dataLoadState, "noRelease");

  global.wx.mockRequest = (options) => {
    setTimeout(() => options.fail({ errMsg: "request:fail disconnected" }), 5);
  };
  page.executeSearch("teacher", { term: "2025-2026-2", releaseVersion: "2026-06-01T23-44-37", q: "x" }, () => {}, () => {});

  setTimeout(() => {
    assert.strictEqual(page.data.loadingState, "networkError");
    assert.notStrictEqual(page.data.dataLoadState, "noRelease");
    console.log("test-school-timeout-state passed");
    process.exit(0);
  }, 40);
}, 40);
