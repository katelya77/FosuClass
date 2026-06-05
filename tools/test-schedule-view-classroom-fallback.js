const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "schedule-view", "schedule-view.js"), "utf-8");

assert(source.includes("openResolvedClassroomSchedule"), "schedule-view should retry classroom links by resolving roomName");
assert(source.includes("releasePackService.resolveClassroomDetail"), "schedule-view should use releasePack classroom resolver");
assert(source.includes("type === \"classroom\" && decodedName"), "classroom detail failure should trigger name-based fallback");
assert(source.includes("该教室暂无课表详情，但空闲结果仍可参考"), "classroom detail errors should keep empty-room context clear");

console.log("test-schedule-view-classroom-fallback passed");
