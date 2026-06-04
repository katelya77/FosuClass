const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const releasePackService = require("../miniprogram/services/releasePackService");

const index = {
  success: true,
  term: "2025-2026-2",
  releaseVersion: "empty-rules",
  updatedAt: "2026-06-04T00:00:00.000Z",
  buildings: ["C7", "B8", "其他/未识别"],
  rooms: [
    {
      roomId: "b8-long",
      roomName: "B8-202",
      building: "B8",
      buildingCode: "B8",
      courses: [{ courseName: "晚课", weekday: 1, weeks: [1], sections: [9, 10], startSection: 9, endSection: 10 }],
    },
    {
      roomId: "c7-short",
      roomName: "C7-119",
      building: "C7",
      buildingCode: "C7",
      courses: [{ courseName: "占用", weekday: 1, weeks: [1], sections: [5, 6, 7, 8, 9, 10, 11, 12], startSection: 5, endSection: 12 }],
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

function runSort() {
  const result = releasePackService.filterEmptyRoomIndex(index, {
    week: 1,
    weekday: 1,
    sections: "1-2",
    minFreeSections: 2,
    building: "全部",
    excludeUnknown: "1",
  });
  assert(result.rooms.length >= 2);
  assert.strictEqual(result.rooms[0].roomName, "B8-202", "longer continuous free rooms should sort first");
  assert(result.rooms[0].continuousFreeSections > result.rooms[1].continuousFreeSections);
}

function runUnknown() {
  const hidden = releasePackService.filterEmptyRoomIndex(index, {
    week: 1,
    weekday: 1,
    sections: "1-2",
    building: "全部",
    excludeUnknown: "1",
  });
  assert(!hidden.rooms.some((room) => room.buildingCode === "UNKNOWN"), "unknown buildings should be hidden by default");

  const shown = releasePackService.filterEmptyRoomIndex(index, {
    week: 1,
    weekday: 1,
    sections: "1-2",
    building: "全部",
    excludeUnknown: "",
  });
  assert(shown.rooms.some((room) => room.buildingCode === "UNKNOWN"), "unknown buildings can be shown when requested");
}

runSort();
runUnknown();
console.log("test-empty-room-filter-rules passed");
