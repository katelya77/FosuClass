const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function run() {
  const assistant = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
  const school = read("miniprogram/pages/school/school.js");
  const today = read("miniprogram/pages/today/today.js");

  assert(assistant.includes("parseActionUrl"), "ai-assistant should parse action url into path/query");
  assert(assistant.includes("FOSU_AI_PENDING_SCHOOL_QUERY"), "school tabBar query should be written to storage");
  assert(assistant.includes("FOSU_AI_PENDING_TODAY_QUERY"), "today tabBar query should be written to storage");
  assert(/wx\.setStorageSync\(\s*storageKey/.test(assistant), "navigateByUrl should store query before switchTab");
  assert(/wx\.switchTab\(\{\s*url:\s*parsed\.path/.test(assistant), "tabBar switch should use path without dropping stored query");

  assert(school.includes("FOSU_AI_PENDING_SCHOOL_QUERY"), "school should read pending AI query key");
  assert(school.includes("removeStorageSync(AI_PENDING_SCHOOL_QUERY_KEY)"), "school should remove pending query after reading");
  assert(school.includes("applyAiPendingSchoolQuery"), "school should apply pending AI query");
  assert(school.includes("searchTeacherSchedule") && school.includes("searchClassroomSchedule") && school.includes("searchCourseSchedule"),
    "school should trigger typed searches from pending query");

  assert(today.includes("FOSU_AI_PENDING_TODAY_QUERY"), "today should read pending AI query key");
  assert(today.includes("removeStorageSync(AI_PENDING_TODAY_QUERY_KEY)"), "today should remove pending query after reading");
  assert(today.includes("已根据小序建议打开今日安排"), "today should show assistant deeplink toast");

  console.log("test-ai-tabbar-deeplink passed");
}

run();
