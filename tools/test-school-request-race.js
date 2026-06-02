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

let requestCount = 0;
global.wx.mockRequest = (options) => {
  if (!options.url.includes("/search-index")) {
    options.success({ statusCode: 200, data: { success: true } });
    return;
  }
  requestCount += 1;
  const current = requestCount;
  const delay = current === 1 ? 40 : 5;
  const className = current === 1 ? "old-result" : "new-result";
  setTimeout(() => {
    options.success({
      statusCode: 200,
      data: {
        success: true,
        term: "2025-2026-2",
        releaseVersion: "2026-06-01T23-44-37",
        updatedAt: "2026-06-02T13:43:00.000Z",
        items: [{ id: className, className }],
        total: 1,
      },
    });
  }, delay);
};

const rendered = [];
page.executeSearch("class", { term: "2025-2026-2", releaseVersion: "2026-06-01T23-44-37" }, (data) => {
  rendered.push(data.items[0].className);
}, () => {});
page.executeSearch("class", { term: "2025-2026-2", releaseVersion: "2026-06-01T23-44-37" }, (data) => {
  rendered.push(data.items[0].className);
}, () => {});

setTimeout(() => {
  assert.deepStrictEqual(rendered, ["new-result"]);
  console.log("test-school-request-race passed");
  process.exit(0);
}, 100);
