const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
require("../miniprogram/pages/empty-room/empty-room.js");

global.wx.mockRequest = (options) => {
  setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
};

async function run() {
  const page = mockEnv.createPageInstance();
  page.setData({
    activeSnapshot: { term: "2025-2026-2", releaseVersion: "empty-room-v1" },
    rooms: [{ roomName: "C7-101", building: "C7", capacityText: "容量未知", freeText: "第1节空闲" }],
    summaryText: "旧查询结果",
    dataState: "success",
  });

  let thrown = null;
  try {
    await page.searchRooms({ forceNetwork: true });
  } catch (error) {
    thrown = error;
  }
  assert(thrown, "network timeout should reject");
  assert.strictEqual(page.data.rooms.length, 1, "old rooms should be kept after timeout");
  assert.strictEqual(page.data.summaryText, "旧查询结果");
  assert(page.data.restoreHint.includes("保留当前结果"));
  console.log("test-empty-room-last-good-timeout passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
