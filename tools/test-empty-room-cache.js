const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const service = require("../miniprogram/services/emptyRoomService");
const releasePackService = require("../miniprogram/services/releasePackService");

const params = {
  term: "2025-2026-2",
  releaseVersion: "empty-cache-2026-06-02",
  date: "2026-06-02",
  week: 13,
  weekday: 2,
  sections: "3-4",
  building: "C7",
  minFreeSections: "2",
};

async function run() {
  const cacheKey = service.getEmptyRoomCacheKey(params);
  assert(cacheKey.includes("fosu:v6:empty-room"), "empty-room cache should use release pack v6 prefix");
  assert.strictEqual(cacheKey, releasePackService.getEmptyRoomCacheKey(params.term, params.releaseVersion));

  service.writeEmptyRoomCache(params, {
    success: true,
    releaseVersion: params.releaseVersion,
    updatedAt: "2026-06-02T00:00:00.000Z",
    rooms: [{ roomName: "C7-302", freeText: "第3-4节空闲" }],
  });

  const cached = service.readEmptyRoomCache(params);
  assert.strictEqual(cached.rooms[0].roomName, "C7-302");

  service.writeEmptyRoomFavorites({
    buildings: ["实验楼", "实验楼", ""],
    rooms: [
      { roomName: "C7-302", building: "C7" },
      { roomName: "C7-302", building: "C7" },
      "",
    ],
  });
  let favorites = service.readEmptyRoomFavorites();
  assert.deepStrictEqual(favorites.buildings, ["实验楼"], "favorite buildings should be normalized");
  assert.strictEqual(favorites.rooms.length, 1, "favorite rooms should be deduplicated");
  assert.strictEqual(service.isFavoriteRoom("C7-302", favorites), true, "favorite room should be recognized");
  assert.strictEqual(service.isFavoriteBuilding("实验楼", favorites), true, "favorite building should be recognized");

  favorites = service.setFavoriteBuilding("C7", true);
  assert(favorites.buildings.includes("C7"), "setFavoriteBuilding should add a building");
  favorites = service.setFavoriteRoom("C7-303", true, { building: "C7" });
  assert.strictEqual(service.isFavoriteRoom("C7-303", favorites), true, "setFavoriteRoom should add a room");
  favorites = service.setFavoriteRoom("C7-303", false);
  assert.strictEqual(service.isFavoriteRoom("C7-303", favorites), false, "setFavoriteRoom false should remove a room");
  assert(service.buildBuildingOptions(["新楼"], favorites.buildings).includes("实验楼"), "favorite buildings should be merged into building options");

  global.wx.mockRequest = (options) => {
    options.success({
      statusCode: 200,
      data: { success: false, code: "OFFLINE", reasonCode: "OFFLINE" },
    });
  };

  const fallback = await service.queryEmptyRooms(params, { forceNetwork: true });
  assert.strictEqual(fallback.fromStorage, true, "failed network should fall back to cache");
  assert.strictEqual(fallback.fallback, true, "fallback flag should be present");
  assert.strictEqual(fallback.rooms[0].roomName, "C7-302");

  mockEnv.storage.set(cacheKey, {
    savedAt: Date.now(),
    data: {
      success: true,
      term: params.term,
      releaseVersion: params.releaseVersion,
      updatedAt: "2026-06-02T00:00:00.000Z",
      buildings: ["C7"],
      rooms: [{
        roomName: "C7-302",
        building: "C7",
        courses: [],
      }],
    },
  });

  let requested = false;
  global.wx.mockRequest = (options) => {
    requested = true;
    options.success({
      statusCode: 200,
      data: {
        success: true,
        releaseVersion: params.releaseVersion,
        rooms: [{ roomName: "C7-303", freeText: "第3-4节空闲" }],
      },
    });
  };
  const cacheFirst = await service.queryEmptyRooms(params);
  assert.strictEqual(requested, false, "release pack empty-room index should use fresh cache first");
  assert.strictEqual(cacheFirst.fromStorage, true);
  assert.strictEqual(cacheFirst.rooms[0].roomName, "C7-302");

  console.log("test-empty-room-cache passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
