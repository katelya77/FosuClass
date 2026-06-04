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
assert(wxml.includes("当前 Release Pack 静态索引"), "header should show static release source");
assert(wxml.includes("刷新静态索引"), "refresh button should be explicit");
assert(wxml.includes("continuousText"), "room card should show continuous free length");
assert(wxss.includes(".section-grid"), "section chip grid styles should exist");
assert(wxss.includes(".building-chip"), "building chip styles should exist");

console.log("test-empty-room-ui passed");
