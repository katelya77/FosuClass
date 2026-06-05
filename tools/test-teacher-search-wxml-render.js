const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const wxml = fs.readFileSync(path.join(root, "miniprogram", "pages", "school", "school.wxml"), "utf-8");
const wxss = fs.readFileSync(path.join(root, "miniprogram", "pages", "school", "school.wxss"), "utf-8");
const js = fs.readFileSync(path.join(root, "miniprogram", "pages", "school", "school.js"), "utf-8");

assert(wxml.includes("teachersResult.length"), "teacher result list should be rendered from teachersResult");
assert(wxml.includes("item.detailHint || '课程数据'"), "teacher result should expose partial-detail status text");
assert(wxml.includes("teacherDiagnosticText"), "teacher search diagnostics should render in WXML");
assert(js.includes("课程数据可用，详情待补齐"), "teacher index normalizer should label partial static teacher schedules");
assert(js.includes("this.lastTeacherSearchDebug = data.debug || null"), "teacher search should keep static index debug payload");
assert(js.includes("teacherDiagnosticText: \"\""), "fresh teacher search should clear stale diagnostics");
assert(js.includes("debug.teacherIndexTotal"), "diagnostic popup should include teacher index totals");
assert(wxss.includes("max-width: 240rpx"), "status badge should wrap long partial-detail text");
assert(wxss.includes("white-space: normal"), "status badge should allow multi-line text");

console.log("test-teacher-search-wxml-render passed");
