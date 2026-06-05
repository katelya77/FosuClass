const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const releasePackService = require("../miniprogram/services/releasePackService");

const term = "2025-2026-2";
const version = "empty-room-resolver-2026-06-05";
const calls = [];
const navigations = [];
const emitted = [];

global.wx.setStorageSync(releasePackService.LOCAL_ACTIVE_RELEASE_KEY, {
  savedAt: Date.now(),
  term,
  releaseVersion: version,
  manifest: {
    success: true,
    term,
    releaseVersion: version,
    indexUrls: {
      classroom: `https://class.katelya.eu.org/static/releases/${version}/index/classroom/all.json`,
    },
    detailUrlPattern: `https://class.katelya.eu.org/static/releases/${version}/detail/{type}/{id}.json`,
  },
});

global.wx.navigateTo = (options) => {
  navigations.push(options.url);
  if (typeof options.success === "function") {
    options.success({
      eventChannel: {
        emit(name, payload) {
          emitted.push({ name, payload });
        },
      },
    });
  }
};

global.wx.mockRequest = (options) => {
  calls.push(options.url);
  const url = new URL(options.url, "https://class.katelya.eu.org");
  if (url.pathname === `/static/releases/${version}/index/classroom/all.json`) {
    setTimeout(() => options.success({
      statusCode: 200,
      data: {
        success: true,
        type: "classroom",
        term,
        semester: term,
        releaseVersion: version,
        items: [
          { id: "classroom-real-c7-208", roomName: "C7-208", classroomName: "C7-208", courseCount: 2 },
        ],
      },
    }), 1);
    return;
  }
  if (url.pathname === `/static/releases/${version}/detail/classroom/classroom-real-c7-208.json`) {
    setTimeout(() => options.success({
      statusCode: 200,
      data: {
        success: true,
        type: "classroom",
        id: "classroom-real-c7-208",
        term,
        releaseVersion: version,
        schedule: {
          id: "classroom-real-c7-208",
          roomName: "C7-208",
          courses: [
            { courseName: "Resolver Test", weekday: 1, sections: [1, 2], startSection: 1, endSection: 2, weeks: [1] },
          ],
        },
      },
    }), 1);
    return;
  }
  if (url.pathname.includes("/api/fosu/schedule-detail")) {
    setTimeout(() => options.fail({ errMsg: "dynamic schedule-detail should not be needed" }), 1);
    return;
  }
  setTimeout(() => options.fail({ errMsg: `unexpected request ${options.url}` }), 1);
};

require("../miniprogram/pages/empty-room/empty-room.js");
const page = mockEnv.createPageInstance();
page.setData({
  activeSnapshot: { term, releaseVersion: version },
  rooms: [
    {
      roomId: "empty-room-c7-208",
      roomName: "C7-208",
      building: "C7",
      sectionChips: ["第1节", "第2节"],
      scheduleBadgeText: "仅空闲数据",
      hasScheduleDetail: false,
    },
  ],
  selectedRoom: null,
});

async function run() {
  page.openClassroomSchedule({ currentTarget: { dataset: { index: 0 } } });
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.strictEqual(navigations.length, 1, "empty-room card should navigate after resolving classroom detail");
  assert(navigations[0].includes("type=classroom"));
  assert(navigations[0].includes("id=classroom-real-c7-208"), "navigation should use classroom detail id");
  assert(!navigations[0].includes("id=C7-208"), "navigation should not use roomName as detail id");
  assert.strictEqual(emitted.length, 1, "resolved schedule should be passed through EventChannel");
  assert.strictEqual(emitted[0].payload.schedule.detailId, "classroom-real-c7-208");
  assert.strictEqual(emitted[0].payload.courses.length, 1);
  assert(calls.some((url) => url.includes("/index/classroom/all.json")), "resolver should read classroom static index");
  assert(calls.some((url) => url.includes("/detail/classroom/classroom-real-c7-208.json")), "resolver should read resolved static classroom detail");
  assert(!calls.some((url) => url.includes("/api/fosu/schedule-detail")), "resolver should not need dynamic detail fallback when static detail exists");

  const filtered = releasePackService.filterEmptyRoomIndex({
    success: true,
    term,
    releaseVersion: version,
    rooms: [
      {
        roomId: "empty-room-c7-208",
        roomName: "C7-208",
        detailId: "classroom-real-c7-208",
        hasScheduleDetail: true,
        courses: [],
      },
    ],
  }, { week: 1, weekday: 1, sections: "1-2" });
  assert.strictEqual(filtered.rooms[0].scheduleBadgeText, "课表");
  assert.deepStrictEqual(filtered.rooms[0].sectionChips, ["第1节", "第2节"]);

  const source = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "empty-room", "empty-room.js"), "utf-8");
  assert(source.includes("releasePackService.resolveClassroomDetail"), "empty-room page should use classroom resolver");
  assert(!source.includes("room.roomId || room.roomName"), "empty-room page should not navigate with roomName fallback as detail id");

  console.log("test-empty-room-classroom-resolver passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
