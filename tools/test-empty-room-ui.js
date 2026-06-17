const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wxml = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "empty-room", "empty-room.wxml"), "utf-8");
const wxss = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "empty-room", "empty-room.wxss"), "utf-8");
const js = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "empty-room", "empty-room.js"), "utf-8");

assert(js.includes("现在可用"), "quick filter should include now");
assert(wxml.includes("上午 1-5"), "section preset should include morning");
assert(wxml.includes("下午 6-10"), "section preset should include afternoon");
assert(wxml.includes("晚上 11-14"), "section preset should include evening");
assert(wxml.includes("查询空教室"), "first screen should expose a single primary query button");
assert(wxml.includes("更多筛选"), "advanced filters should be in a bottom sheet entry");
assert(wxml.includes("filterSheetVisible"), "advanced filter sheet should be state-driven");
assert(!wxml.includes("Release Pack"), "public empty-room page must not expose Release Pack wording");
assert(!wxml.includes("静态索引"), "public empty-room page must not expose static index wording");
assert(!wxml.includes("manifest"), "public empty-room page must not expose manifest wording");
assert(wxml.includes("continuousText"), "room card should show continuous free length");
assert(wxml.includes("visibleRoomGroups"), "results should render grouped room data");
assert(wxss.includes(".section-grid"), "section chip grid styles should exist");
assert(wxss.includes(".building-chip"), "building chip styles should exist");
assert(wxss.includes(".filter-sheet"), "bottom sheet styles should exist");

console.log("test-empty-room-ui passed");
