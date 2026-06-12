const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
require("../miniprogram/pages/school/school.js");

const page = mockEnv.createPageInstance();
page.resetPagedResultStore();

const adminItems = Array.from({ length: 75 }, (_, index) => ({
  scheduleKey: `admin-${index}`,
  className: `25测试${index + 1}班`,
  displayTitle: `25测试${index + 1}班`,
}));
const aggregateItems = Array.from({ length: 45 }, (_, index) => ({
  scheduleKey: `aggregate-${index}`,
  className: `25专业共享${index + 1}`,
  displayTitle: `25专业共享${index + 1}`,
}));

page.setClassPagedResults({
  admin: adminItems,
  aggregate: aggregateItems,
});
assert.strictEqual(page.data.classAdminResults.length, 30, "class admin first render should be paged");
assert.strictEqual(page.data.classAggregateResults.length, 30, "aggregate first render should be paged");
assert.strictEqual(page.data.classAdminTotal, 75, "class admin total should remain visible");
assert.strictEqual(page.data.classAggregateTotal, 45, "aggregate total should remain visible");
assert.strictEqual(page.data.hasMoreClassAdmin, true, "class admin should expose load-more state");

page.data.activeTab = "class";
page.loadMoreActiveResults();
assert.strictEqual(page.data.classAdminResults.length, 60, "class admin load-more should append one page");

page.data.activeTab = "teacher";
const teacherItems = Array.from({ length: 80 }, (_, index) => ({
  teacherName: `测试教师${index + 1}`,
}));
page.setSimplePagedResults("teacher", "teachersResult", teacherItems, "teacherHitCount", "hasMoreTeachers");
assert.strictEqual(page.data.teachersResult.length, 30, "teacher first render should be paged");
assert.strictEqual(page.data.teacherHitCount, 80, "teacher total should remain visible");
page.onReachBottom();
assert.strictEqual(page.data.teachersResult.length, 60, "onReachBottom should append active teacher page");

const wxml = fs.readFileSync(path.join(__dirname, "..", "miniprogram/pages/school/school.wxml"), "utf-8");
assert(wxml.includes("loadMoreActiveResults"), "school page should expose load-more entry");
assert(wxml.includes("hasMoreTeachers"), "teacher list should be lazy-loaded");

console.log("test-school-paged-render passed");
