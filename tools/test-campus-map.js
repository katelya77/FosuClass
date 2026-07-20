const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.AI_AGENT_ENABLED = "false";
process.env.AI_RUNTIME_MODE = "public";

const root = path.resolve(__dirname, "..");
const campusData = require("../server/data/ai/campus-places.json");
const miniprogramData = require("../miniprogram/data/campusPlaces");
const campusMapService = require("../server/src/services/ai/campusMapService");
const payloadContract = require("../server/src/services/ai/generatedPayloadContract");
const toolRegistry = require("../server/src/services/ai/toolRegistry");
const mockProvider = require("../server/src/services/ai/providers/mockProvider");

[
  "campus-map-overview.jpg",
  "campus-map-jiangwan.jpg",
  "campus-map-xianxi-north.jpg",
  "campus-map-xianxi-south.jpg",
  "campus-map-hebin.jpg",
].forEach((name) => {
  const file = path.join(root, "miniprogram/packageMaps/assets/maps", name);
  assert(fs.existsSync(file), `${name} should exist under packageMaps subpackage`);
  assert(fs.statSync(file).size > 10 * 1024, `${name} should not be an empty placeholder`);
});

assert.strictEqual(campusData.places.length, miniprogramData.places.length, "miniprogram map data should mirror server data");
assert(campusData.places.some((place) => place.campus === "江湾校区"));
assert(campusData.places.some((place) => place.campus === "仙溪校区" && place.area === "北区"));
assert(campusData.places.some((place) => place.campus === "仙溪校区" && place.area === "南区"));
assert(campusData.places.some((place) => place.campus === "河滨校区"), "hebin campus should be included");

const c7 = campusMapService.searchCampusPlace({ q: "C7" });
assert.strictEqual(c7.success, true);
assert(c7.items.some((item) => item.code === "C7" && item.campus === "仙溪校区" && item.area === "南区"));

const b8 = campusMapService.searchCampusPlace({ q: "B8" });
assert(b8.items.some((item) => item.code === "B8"));

const hebin = campusMapService.searchCampusPlace({ q: "河滨校区有哪些主要地点", limit: 10 });
assert(hebin.items.length >= 3, "hebin campus query should return multiple places");
assert(hebin.items.every((item) => !item.mapAsset), "public tool results must not expose asset paths");

const route = campusMapService.getCampusRoute({ from: "C7", to: "B8" });
assert.strictEqual(route.success, false);
assert.strictEqual(route.code, "ROUTE_DATA_INCOMPLETE");
assert(route.summary.includes("暂不提供精确步行路线"));

const action = c7.items[0].actionUrl;
assert(action.startsWith("/packageMaps/pages/campus-map/campus-map"));
assert(!/[?&]q=/.test(action), "map card action should not inject default search query");
assert.strictEqual(payloadContract.isAllowedNavigationUrl(action), true, "map card action should be a safe mini program page");

const rendered = mockProvider.generate({
  intent: { name: "get_classroom_location" },
  toolResults: [{ name: "get_classroom_location", result: campusMapService.getClassroomLocation({ classroom: "C7-305" }) }],
});
const visible = JSON.stringify({ answer: rendered.answer, cards: rendered.cards, suggestions: rendered.suggestions });
assert(!visible.includes("/assets/maps"), "public AI output must not expose local asset paths");
assert(visible.includes("/packageMaps/pages/campus-map/campus-map"), "map card should open the campus map page");

const context = {
  term: "2025-2026-2",
  releaseVersion: "release-b",
  currentTeachingWeek: 1,
  clientLocalTime: "2026-06-17T08:00:00+08:00",
  currentScheduleSummary: {
    enabled: true,
    courses: [{
      courseName: "动物病理学",
      teacherName: "老师",
      classroom: "C7-305",
      weekday: 3,
      startSection: 3,
      endSection: 4,
      weeks: [1],
      weekText: "1周",
    }],
  },
};
const intent = toolRegistry.resolveIntent("下一节课在哪里", context);
assert.strictEqual(intent.name, "next_course_location");
const calls = toolRegistry.runToolChainForIntent(intent, "下一节课在哪里", context);
assert.deepStrictEqual(calls.map((item) => item.name), ["get_next_course", "get_classroom_location"]);

console.log("test-campus-map passed");
