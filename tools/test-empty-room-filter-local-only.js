const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
require("../miniprogram/pages/empty-room/empty-room");

function emptyRoomIndex() {
  return {
    success: true,
    term: "2025-2026-2",
    releaseVersion: "empty-local",
    updatedAt: "2026-06-04T00:00:00.000Z",
    buildings: ["C7", "B8", "其他/未识别"],
    rooms: [
      {
        roomId: "c7-119",
        roomName: "C7-119",
        building: "C7",
        buildingCode: "C7",
        courses: [{ courseName: "占用", weekday: 1, weeks: [1], sections: [1], startSection: 1, endSection: 1 }],
      },
      {
        roomId: "b8-202",
        roomName: "B8-202",
        building: "B8",
        buildingCode: "B8",
        courses: [],
      },
      {
        roomId: "unknown",
        roomName: "未知地点",
        building: "其他/未识别",
        buildingCode: "UNKNOWN",
        courses: [],
      },
    ],
  };
}

async function run() {
  let requestCount = 0;
  global.wx.mockRequest = (options) => {
    requestCount += 1;
    setTimeout(() => options.fail({ errMsg: "network should not be used" }), 1);
  };
  const page = mockEnv.createPageInstance();
  page.favoriteState = { buildings: [], rooms: [] };
  page.initDefaults({ date: "2026-06-01", week: "1", weekday: "1", sections: "1-2" });
  page.setData({
    activeSnapshot: { term: "2025-2026-2", releaseVersion: "empty-local" },
    buildingOptions: ["全部", "C7", "B8", "其他/未识别"],
    selectedBuildingIndex: 0,
  });
  page.emptyRoomIndex = emptyRoomIndex();
  page.emptyRoomIndexKey = "2025-2026-2:empty-local";
  await page.applyLocalSearch();
  assert.strictEqual(requestCount, 0, "initial local filter should not request network");
  assert(page.data.rooms.length >= 1, "local filter should produce rooms");

  page.onQuickFilterTap({ currentTarget: { dataset: { key: "continuous2" } } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.strictEqual(requestCount, 0, "quick chip should not request network");
  assert.strictEqual(page.data.selectedMinFreeIndex, 1);
  console.log("test-empty-room-filter-local-only passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
