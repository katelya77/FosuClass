const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

let navigatedUrl = "";
global.wx.navigateTo = (options) => {
  navigatedUrl = options && options.url || "";
};
global.wx.switchTab = (options) => {
  navigatedUrl = options && options.url || "";
};

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js"), "utf8");
const wxml = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss"), "utf8");
const guideSource = js.slice(js.indexOf("const CAPABILITY_GUIDE_GROUPS"), js.indexOf("const TABBAR_PENDING_QUERY"));

[
  "Provider",
  "DeepSeek",
  "混元",
  "Coze",
  "Oracle",
  "CloudBase",
  "Agent Protocol",
  "competition",
  "比赛模式",
  "Token",
  "白名单",
  "Prompt",
].forEach((word) => {
  assert(!guideSource.includes(word), `capability guide should not expose ${word}`);
});

assert(wxml.includes("aria-label=\"小佛助手说明\"") || wxml.includes("aria-label=\"小佛校园助手说明\""), "guide button should have an accessibility label");
assert(wxml.includes("小佛助手可以帮你完成什么？") || wxml.includes("小佛校园助手可以查询什么？"), "bottom sheet title should exist");
assert(wxml.includes("onCapabilityExampleTap"), "examples should be clickable");
assert(wxml.includes("openCampusMapFromGuide"), "guide should include campus map button");
assert(wxss.includes(".capability-scroll"), "small screens should scroll the guide");

require("../miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
const page = mockEnv.createPageInstance();
assert.strictEqual(page.data.showCapabilityGuide, false, "guide should be closed by default");

page.openCapabilityGuide();
assert.strictEqual(page.data.showCapabilityGuide, true);
const sent = [];
page.sendMessage = (message) => sent.push(message);
page.onCapabilityExampleTap({ currentTarget: { dataset: { text: "佛大有哪些校区" } } });
assert.deepStrictEqual(sent, ["佛大有哪些校区？"]);
assert.strictEqual(page.data.showCapabilityGuide, false);

page.openCapabilityGuide();
page.onCapabilityExampleTap({ currentTarget: { dataset: { text: "查教师课表" } } });
assert.deepStrictEqual(sent, ["佛大有哪些校区？", "查教师课表"]);
assert.strictEqual(page.data.inputValue, "");
assert.strictEqual(page.data.showCapabilityGuide, false);

page.openCapabilityGuide();
page.openCampusMapFromGuide();
assert.strictEqual(page.data.showCapabilityGuide, false);
assert.strictEqual(navigatedUrl, "/packageMaps/pages/campus-map/campus-map");

console.log("test-ai-capability-guide passed");
