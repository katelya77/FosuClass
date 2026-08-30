const assert = require("assert");
const mockEnv = require("./mock-env");

require("../miniprogram/pages/school/school.js");

const ACTIVE_SNAPSHOT_KEY = "FOSU_ACTIVE_SNAPSHOT";
const term = "2025-2026-2";
const releaseVersion = "2026-06-01T23-44-37";

function createPage() {
  const page = mockEnv.createPageInstance();
  page._schoolRequestSeq = 0;
  page._activeInitSeq = 0;
  return page;
}

function setMock(handler) {
  global.wx.mockRequest = (options) => {
    setTimeout(() => handler(options), 1);
  };
}

async function run() {
  mockEnv.clearStorage();
  setMock((options) => {
    if (options.url.includes("/app-config")) {
      options.success({
        statusCode: 200,
        data: {
          success: true,
          data: {
            currentSemester: term,
            dataVersion: {
              releaseVersion,
              classScheduleUpdatedAt: "2026-06-02T13:43:00.000Z",
            },
            cacheEpoch: 1780378986408,
            notices: [],
          },
        },
      });
      return;
    }
    options.fail({ errMsg: "unexpected request" });
  });
  let page = createPage();
  let result = await page.resolveActiveSnapshot({ forceNetwork: true });
  assert.strictEqual(result.activeSnapshot.releaseVersion, releaseVersion);
  assert.strictEqual(result.activeSnapshot.term, term);
  assert.strictEqual(mockEnv.storage.get(ACTIVE_SNAPSHOT_KEY).releaseVersion, releaseVersion);

  mockEnv.clearStorage();
  setMock((options) => {
    if (options.url.includes("/app-config")) {
      options.fail({ errMsg: "request:fail disconnected" });
      return;
    }
    if (options.url.includes("/bootstrap")) {
      options.success({
        statusCode: 200,
        data: {
          success: true,
          term,
          releaseVersion,
          updatedAt: "2026-06-02T13:43:00.000Z",
          catalog: { colleges: [{ code: "01", name: "college" }] },
        },
      });
      return;
    }
    options.fail({ errMsg: "unexpected request" });
  });
  page = createPage();
  result = await page.resolveActiveSnapshot({ forceNetwork: true });
  assert.strictEqual(result.source, "bootstrap");
  assert.strictEqual(result.activeSnapshot.releaseVersion, releaseVersion);

  mockEnv.clearStorage();
  mockEnv.storage.set(ACTIVE_SNAPSHOT_KEY, { term, releaseVersion, scheduleUpdatedAt: "2026-06-02T13:43:00.000Z" });
  setMock((options) => options.fail({ errMsg: "request:fail disconnected" }));
  page = createPage();
  result = await page.resolveActiveSnapshot({ forceNetwork: true });
  assert.strictEqual(result.fromStorage, true);
  assert.strictEqual(result.activeSnapshot.releaseVersion, releaseVersion);

  mockEnv.clearStorage();
  setMock((options) => options.fail({ errMsg: "request:fail disconnected" }));
  page = createPage();
  result = await page.resolveActiveSnapshot({ forceNetwork: true });
  assert.strictEqual(result.activeSnapshot, null);
  assert.strictEqual(result.state, "networkError");

  page = createPage();
  page.setData({
    activeSnapshot: { term, releaseVersion },
    semesters: [],
    colleges: [],
    teacherColleges: [],
    grades: [],
    selectedSemesterIndex: 0,
  });
  page.originalCatalogData = {
    semesters: [
      { value: term, label: term },
      { value: "2028-2029-1", label: "2028-2029-1" },
    ],
    colleges: [{ code: "01", name: "测试学院" }],
    grades: ["2025"],
  };
  page.applyCatalogFilter();
  assert.deepStrictEqual(page.data.semesters, [{ value: term, label: term }], "catalog term picker must expose only the active release term");

  console.log("test-school-active-snapshot passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
