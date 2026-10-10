const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
const appConfigService = require("../miniprogram/services/appConfigService");

const componentPath = path.join(__dirname, "..", "miniprogram", "components", "notice-ticker", "notice-ticker.js");
const source = fs.readFileSync(componentPath, "utf-8");
const wxml = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "components", "notice-ticker", "notice-ticker.wxml"), "utf-8");
const wxss = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "components", "notice-ticker", "notice-ticker.wxss"), "utf-8");

assert(source.includes("function normalizeNotices"), "notice ticker should normalize notices");
assert(source.includes("type: null"), "notice ticker property should accept non-array input before normalization");
assert(!source.includes("type: Array"), "notice ticker should not emit expected Array warning for non-array input");
assert(wxml.includes("bindtap=\"openNoticeDetail\""), "notice ticker root should open detail on tap");
assert(!wxml.includes("notice-ticker-view"), "notice ticker should not keep a separate view button");
assert(!wxml.includes(">查看<"), "notice ticker should not render a 查看 button");
assert(!wxss.includes("notice-ticker-view"), "notice ticker css should not keep view button styles");

const normalized = appConfigService.normalizeConfig({
  notices: { title: "bad shape" },
  banners: "bad shape",
  news: null,
});
assert(Array.isArray(normalized.notices), "app config notices should normalize to array");
assert(Array.isArray(normalized.banners), "app config banners should normalize to array");
assert(Array.isArray(normalized.news), "app config news should normalize to array");

const normalizedDaily = appConfigService.normalizeConfig({
  dailyKnowledge: {
    title: "防诈小知识",
    content: "验证码不要告诉任何人。",
    type: "warning",
    date: "2026-08-30",
  },
}).dailyKnowledge;
assert.strictEqual(normalizedDaily.category, "fraud");
assert.strictEqual(normalizedDaily.categoryLabel, "防诈提醒");
assert.strictEqual(normalizedDaily.categoryMark, "盾");
assert.strictEqual(normalizedDaily.dateLabel, "8月30日");

const notices = [
  { id: "a", title: "普通公告", content: "校园活动", priority: "normal", displayMode: "ticker", targetPage: "home", enabled: true, version: "1" },
  { id: "b", title: "重要公告", content: "服务调整", priority: "important", displayMode: "ticker", targetPage: "all", enabled: true, version: "1" },
  { id: "c", title: "紧急公告", content: "安全提醒", priority: "urgent", displayMode: "ticker", targetPage: "home", enabled: true, version: "1" },
];
const home = appConfigService.getPageNotices({ notices }, "home");
const today = appConfigService.getPageNotices({ notices }, "today");
assert.strictEqual(home.length, 3, "home and all targets should appear on home");
assert.deepStrictEqual(today.map((notice) => notice.id), ["b"], "all targets should appear on another supported page");

let definition;
global.Component = (value) => { definition = value; };
require(componentPath);
const component = {
  data: { notices, pageKey: "home", maxCount: 5, detailVisible: false, currentIndex: 0 },
  setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); },
  triggerEvent() {},
  createSelectorQuery() {
    // This state-only harness has no rendered DOM; layout is tested separately.
    const query = { select() { return query; }, boundingClientRect() { return query; }, exec(callback) { callback([null, null, null]); } };
    return query;
  },
  ...definition.methods,
};
component.updateVisibleNotices();
assert.deepStrictEqual(component.data.visibleNotices.map((notice) => notice.id), ["c", "b", "a"], "ticker should order urgent, important, normal");
component.rotateNotice();
assert.strictEqual(component.data.currentNotice.id, "b", "multiple tickers should rotate");
component.rotateNotice();
assert.strictEqual(component.data.currentNotice.id, "a");
component.rotateNotice();
assert.strictEqual(component.data.currentNotice.id, "c", "ticker rotation should wrap");
component.openNoticeDetail();
component.rotateNotice();
assert.strictEqual(component.data.currentNotice.id, "c", "ticker rotation should pause while detail is open");

console.log("test-notice-ticker-array-guard passed");
