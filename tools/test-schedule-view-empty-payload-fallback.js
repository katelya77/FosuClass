const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

wx.setNavigationBarTitle = () => {};
wx.switchTab = () => {};

const releasePackService = require("../miniprogram/services/releasePackService");
const teachingCalendarService = require("../miniprogram/services/teachingCalendarService");

const originalLoadDetail = releasePackService.loadDetail;
const originalGetLocalActiveRelease = releasePackService.getLocalActiveRelease;
const originalLoadCalendar = teachingCalendarService.loadActiveTeachingCalendar;
const originalSetTimeout = global.setTimeout;

let loadDetailCalls = 0;
releasePackService.getLocalActiveRelease = () => ({
  term: "2026-2027-1",
  releaseVersion: "release-2026-fall",
});
releasePackService.loadDetail = () => {
  loadDetailCalls += 1;
  return Promise.resolve({
    success: true,
    releaseVersion: "release-2026-fall",
    schedule: {
      id: "class-26-vet-2",
      detailId: "class-26-vet-2",
      className: "26动物医学2班",
      courses: [{
        id: "course-1",
        courseName: "动物解剖学",
        weekday: 1,
        startSection: 1,
        endSection: 2,
        weeks: [1],
      }],
    },
  });
};
teachingCalendarService.loadActiveTeachingCalendar = () => Promise.resolve(
  teachingCalendarService.getImmediateActiveCalendar({ term: "2026-2027-1" })
);
global.setTimeout = (handler) => {
  handler();
  return 1;
};

require("../miniprogram/pages/schedule-view/schedule-view.js");

async function run() {
  const page = mockEnv.createPageInstance();
  page.getOpenerEventChannel = () => ({
    on(eventName, handler) {
      assert.strictEqual(eventName, "acceptDataFromOpenerPage");
      handler({
        schedule: {
          id: "class-26-vet-2",
          detailId: "class-26-vet-2",
          className: "26动物医学2班",
          releaseVersion: "release-2026-fall",
        },
        courses: [],
      });
    },
  });

  page.onLoad({
    type: "class",
    id: "class-26-vet-2",
    name: encodeURIComponent("26动物医学2班"),
    term: "2026-2027-1",
    releaseVersion: "release-2026-fall",
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.strictEqual(loadDetailCalls, 1, "empty opener payload must rehydrate from Release Pack");
  assert.strictEqual(page.data.allCourses.length, 1, "Release Pack courses should replace the empty payload");
  assert.strictEqual(page.data.allCourses[0].courseName, "动物解剖学");
  console.log("test-schedule-view-empty-payload-fallback passed");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    releasePackService.loadDetail = originalLoadDetail;
    releasePackService.getLocalActiveRelease = originalGetLocalActiveRelease;
    teachingCalendarService.loadActiveTeachingCalendar = originalLoadCalendar;
    global.setTimeout = originalSetTimeout;
  });
