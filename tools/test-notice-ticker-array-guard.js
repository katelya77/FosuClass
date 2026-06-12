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

console.log("test-notice-ticker-array-guard passed");
