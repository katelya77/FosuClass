const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const wxml = fs.readFileSync(path.join(root, "miniprogram/pages/today/today.wxml"), "utf8");
const js = fs.readFileSync(path.join(root, "miniprogram/pages/today/today.js"), "utf8");
const wxss = fs.readFileSync(path.join(root, "miniprogram/pages/today/today.wxss"), "utf8");

assert(!wxml.includes("releaseNote || dataVersionText"), "today page must not render releaseNote/dataVersionText as an alert");
assert(!wxml.includes("今日提醒"), "ordinary today reminder card should be removed");
assert(!wxml.includes("Published by fosu-publisher"), "publisher text must not be visible on today page");
assert(!/releaseNote\s*:/.test(js), "releaseNote state should not be kept for today reminder rendering");
assert(wxml.includes("urgentNotice"), "urgent notice should still render");
assert(wxml.includes("notice-ticker"), "notice ticker should still render");
assert(wxml.includes("dataVersionText"), "top data update text should remain");
assert(wxss.includes(".today-alert.urgent"), "urgent alert style should remain");

console.log("test-today-page-release-note-hidden passed");
