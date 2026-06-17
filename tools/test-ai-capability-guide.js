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
const js = fs.readFileSync(path.join(root, "miniprogram/pages/ai-assistant/ai-assistant.js"), "utf8");
const wxml = fs.readFileSync(path.join(root, "miniprogram/pages/ai-assistant/ai-assistant.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(root, "miniprogram/pages/ai-assistant/ai-assistant.wxss"), "utf8");
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

assert(wxml.includes("aria-label=\"小佛能力指南\""), "guide button should have an accessibility label");
assert(wxml.includes("小佛可以帮你"), "bottom sheet title should exist");
assert(wxml.includes("onCapabilityExampleTap"), "examples should be clickable");
assert(wxml.includes("openCampusMapFromGuide"), "guide should include campus map button");
assert(wxss.includes(".capability-scroll"), "small screens should scroll the guide");

require("../miniprogram/pages/ai-assistant/ai-assistant.js");
const page = mockEnv.createPageInstance();
assert.strictEqual(page.data.showCapabilityGuide, false, "guide should be closed by default");

page.openCapabilityGuide();
assert.strictEqual(page.data.showCapabilityGuide, true);
const sent = [];
page.sendMessage = (message) => sent.push(message);
page.onCapabilityExampleTap({ currentTarget: { dataset: { text: "C7 在哪里" } } });
assert.deepStrictEqual(sent, ["C7 在哪里？"]);
assert.strictEqual(page.data.showCapabilityGuide, false);

page.openCapabilityGuide();
page.onCapabilityExampleTap({ currentTarget: { dataset: { text: "查老师课表" } } });
assert.strictEqual(page.data.inputValue, "查某某老师课表");
assert.strictEqual(page.data.inputFocus, true);
assert.strictEqual(page.data.showCapabilityGuide, false);

page.openCapabilityGuide();
page.openCampusMapFromGuide();
assert.strictEqual(page.data.showCapabilityGuide, false);
assert.strictEqual(navigatedUrl, "/pages/campus-map/campus-map");

console.log("test-ai-capability-guide passed");
