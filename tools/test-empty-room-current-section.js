const assert = require("assert");
require("./mock-env");

const service = require("../miniprogram/services/emptyRoomService");

function makeDate(timeText) {
  const [hour, minute] = timeText.split(":").map(Number);
  return new Date(2026, 5, 2, hour, minute, 0, 0);
}

assert.strictEqual(service.getCurrentSectionNumber(makeDate("08:10")), 1);
assert.strictEqual(service.getCurrentSectionValue(makeDate("08:10")), "1-1");
assert.strictEqual(service.getNextSectionValue(makeDate("08:10")), "2-2");
assert.strictEqual(service.getCurrentSectionNumber(makeDate("09:30")), 3, "between sections should choose next section");
assert.strictEqual(service.getPresetSectionValue("morning"), "1-5");
assert.strictEqual(service.getPresetSectionValue("afternoon"), "6-10");
assert.strictEqual(service.getPresetSectionValue("evening"), "11-14");

console.log("test-empty-room-current-section passed");
