const assert = require("assert");
const fs = require("fs");
const path = require("path");

const targets = [
  path.join(__dirname, "..", "server", "src", "routes", "adminPages.js"),
  path.join(__dirname, "..", "server", "src", "routes", "admin.js"),
  path.join(__dirname, "..", "server", "src", "shared", "syncPlan.js"),
];

const forbidden = [
  "Daily all dynamic schedules",
  "Daily class schedules",
  "Teacher dimension refresh",
  "Class schedule changes",
  "Campus network",
  "Force confirmation",
];

targets.forEach((filePath) => {
  const source = fs.readFileSync(filePath, "utf-8");
  forbidden.forEach((needle) => {
    assert(!source.includes(needle), `${path.basename(filePath)} should not display ${needle}`);
  });
});

const syncPlan = require("../server/src/shared/syncPlan");
const names = syncPlan.getRecommendedOperations({ term: "2025-2026-2" }).map((item) => item.displayName || item.name);
[
  "日常同步：全部动态课表",
  "日常同步：班级课表",
  "日常同步：教师课表",
  "日常同步：教室课表",
  "日常同步：课程课表",
  "自定义同步范围",
  "新学期全量采集",
  "上传本地暂存文件",
  "恢复中断任务",
].forEach((needle) => assert(names.includes(needle), `missing Chinese command name: ${needle}`));

console.log("test-admin-chinese-copy passed");
