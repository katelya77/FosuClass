const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const js = read("miniprogram/pages/campus-map/campus-map.js");
const wxml = read("miniprogram/pages/campus-map/campus-map.wxml");
const wxss = read("miniprogram/pages/campus-map/campus-map.wxss");

const order = [
  js.indexOf('key: "xianxi"'),
  js.indexOf('key: "jiangwan"'),
  js.indexOf('key: "hebin"'),
];
assert(order.every((index) => index >= 0), "campus tabs should include xianxi, jiangwan, hebin");
assert(order[0] < order[1] && order[1] < order[2], "campus tabs should be xianxi, jiangwan, hebin");
assert(wxml.includes('role="button"'), "campus tabs should avoid native button layout defaults");
assert(wxss.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"), "campus tabs should be three equal columns");
assert(wxss.includes("overflow: hidden"), "campus tab container should hide overflow");
assert(wxss.includes(".campus-tab") && wxss.includes("min-width: 0"), "campus tab item should allow shrinking on 320px");
assert(!/scroll-x/.test(wxml.split("campus-tabs")[1].split("area-tabs")[0]), "campus tabs should not scroll horizontally");

assert(js.includes("wx.getImageInfo"), "single-image preview should resolve image info first");
assert(js.includes("urls: [path]"), "previewImage should only receive the current image");
assert(!/urls:\s*this\.data\.maps/.test(js), "previewImage must not pass every campus map");
assert(wxml.includes("movable-area") && wxml.includes("movable-view"), "custom preview layer should support pan/zoom");
assert(wxml.includes("retryPreviewImage") && wxml.includes("retryMapImage"), "map image failures should expose retry");
assert(/place\.verified\s*!==\s*true/.test(js), "unverified places should not render precise marker boxes");
assert(wxml.includes("未人工核对") || wxml.includes("待人工核对"), "unverified places should show review state");
assert(js.includes("/pages/school/school?type=classroom"), "map building query should deep link to school classroom tab");

const packageJson = JSON.parse(read("package.json"));
assert.strictEqual(packageJson.scripts["campus-map:editor"], "node tools/campus-map-editor/server.js");

const editorClient = read("tools/campus-map-editor/public/client.js");
[
  "addPlaceAt",
  "onPlacePointerDown",
  "onWheel",
  "saveDraft",
  "applyToMiniprogram",
  "exportJson",
  "importJson",
  "setSelectedVerified",
].forEach((needle) => assert(editorClient.includes(needle), `editor should include ${needle}`));

const editorHtml = read("tools/campus-map-editor/public/index.html");
["仙溪北区", "仙溪南区", "江湾校区", "河滨校区"].forEach((label) => {
  assert(editorClient.includes(label), `editor should support ${label}`);
});
[
  "新增地点",
  "删除地点",
  "撤销",
  "恢复",
  "保存草稿",
  "标记为已人工核对",
  "取消核对",
  "导出 JSON",
  "导入 JSON",
  "应用到小程序数据",
  "下载备份",
].forEach((label) => assert(editorHtml.includes(label), `editor should expose ${label}`));

const editorLib = require("./campus-map-editor/lib");
assert(editorLib.SERVER_DATA_FILE.endsWith(path.join("server", "data", "ai", "campus-places.json")), "editor should know the server map mirror");
const region = editorLib.regionFromPixels(
  { left: 50, top: 25, width: 200, height: 100 },
  { left: 0, top: 0, width: 1000, height: 500 }
);
assert.deepStrictEqual(region, { x: 0.05, y: 0.05, width: 0.2, height: 0.2 }, "dragged rectangle should convert to normalized coordinates");

const validData = {
  version: "test",
  places: [{
    id: "test-c7",
    campus: "仙溪校区",
    area: "南区",
    name: "C7",
    code: "C7",
    type: "teaching_building",
    aliases: [],
    description: "",
    mapRegion: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    verified: true,
  }],
};
assert.strictEqual(editorLib.validateCampusPlaces(validData).ok, true, "valid editor payload should pass");
const duplicate = JSON.parse(JSON.stringify(validData));
duplicate.places.push(Object.assign({}, duplicate.places[0]));
assert.strictEqual(editorLib.validateCampusPlaces(duplicate).ok, false, "duplicate IDs must fail validation");

const backup = editorLib.createBackup(validData);
assert(fs.existsSync(backup), "editor should generate a backup file");
assert(backup.includes(path.join(".local", "campus-map-backups")), "backup should be under .local/campus-map-backups");
fs.unlinkSync(backup);

console.log("test-campus-map-ui-and-editor passed");
