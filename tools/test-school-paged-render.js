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
  className: `class-${index + 1}`,
  displayTitle: `class-${index + 1}`,
}));
const aggregateItems = Array.from({ length: 45 }, (_, index) => ({
  scheduleKey: `aggregate-${index}`,
  className: `major-${index + 1}`,
  displayTitle: `major-${index + 1}`,
}));

page.setClassPagedResults({
  admin: adminItems,
  aggregate: aggregateItems,
});
assert.strictEqual(page.data.classAdminResults.length, 20, "class admin first render should be paged");
assert.strictEqual(page.data.classAggregateResults.length, 20, "aggregate first render should be paged");
assert.strictEqual(page.data.classAdminTotal, 75, "class admin total should remain visible");
assert.strictEqual(page.data.classAggregateTotal, 45, "aggregate total should remain visible");
assert.strictEqual(page.data.hasMoreClassAdmin, true, "class admin should expose load-more state");

page.data.activeTab = "class";
page.loadMoreActiveResults();
assert.strictEqual(page.data.classAdminResults.length, 40, "class admin load-more should append one page");

page.data.activeTab = "teacher";
const teacherItems = Array.from({ length: 80 }, (_, index) => ({
  teacherName: `teacher-${index + 1}`,
}));
page.setSimplePagedResults("teacher", "teachersResult", teacherItems, "teacherHitCount", "hasMoreTeachers");
assert.strictEqual(page.data.teachersResult.length, 20, "teacher first render should be paged");
assert.strictEqual(page.data.teacherHitCount, 80, "teacher total should remain visible");
page.onReachBottom();
assert.strictEqual(page.data.teachersResult.length, 40, "onReachBottom should append active teacher page");

const beforeBusy = page.data.teachersResult.length;
page._loadMoreBusy = true;
page.onReachBottom();
assert.strictEqual(page.data.teachersResult.length, beforeBusy, "busy load-more should not append again");
page._loadMoreBusy = false;

page.clearPagedResults("teacher");
assert.strictEqual(page.data.teachersResult.length, 0, "new keyword should clear visible teacher results");
assert.strictEqual(page._schoolResultStore.teacher.length, 0, "new keyword should clear non-reactive teacher store");

const schoolJs = fs.readFileSync(path.join(__dirname, "..", "miniprogram/pages/school/school.js"), "utf-8");
assert(schoolJs.includes("const SCHOOL_RESULT_PAGE_SIZE = 20"), "school page should use 20 item first page");
assert(schoolJs.includes("const SCHOOL_RESULT_PAGE_STEP = 20"), "school page should append 20 items per batch");
assert(schoolJs.includes("const SCHOOL_KEYWORD_DEBOUNCE_MS = 300"), "keyword input should debounce at 300ms");
assert(/\+\+this\._schoolRequestSeq/.test(schoolJs), "search requests should have a sequence guard");
assert(/seq !== this\._schoolRequestSeq/.test(schoolJs), "old requests should not overwrite new results");

const wxml = fs.readFileSync(path.join(__dirname, "..", "miniprogram/pages/school/school.wxml"), "utf-8");
assert(wxml.includes("loadMoreActiveResults"), "school page should expose load-more entry");
assert(wxml.includes("loadMoreText"), "school page should show load-more state text");
assert(wxml.includes("校园地图"), "classroom tab should expose campus map entry");

console.log("test-school-paged-render passed");
