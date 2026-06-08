const assert = require("assert");
const toolRegistry = require("../server/src/services/ai/toolRegistry");
const { buildAiContext } = require("./fixtures/ai-today-courses.fixture");

function names(result) {
  return (result.courses || []).map((course) => course.courseName);
}

function run() {
  const result = toolRegistry.executeTool("get_today_courses", {}, buildAiContext("2026-06-08T22:00:00+08:00"));
  const courseNames = names(result);

  assert.strictEqual(result.currentWeek, 14, "current week should resolve to 14");
  assert(!courseNames.includes("inactive-array-week"), "weeks=[1,2,3] must not be active in week 14");
  assert(courseNames.includes("active-array-week"), "weeks=[14] must be active in week 14");
  assert(!courseNames.includes("inactive-odd-week"), "1-16周(单) must not be active in week 14");
  assert(courseNames.includes("active-even-week"), "1-16周(双) must be active in week 14");
  assert(!courseNames.includes("uncertain-no-week"), "missing week info must not default to active");
  assert(result.uncertainWeekCoursesCount >= 1, "missing week info should be counted as uncertain");
  assert(result.inactiveFilteredCount >= 2, "inactive courses should be counted");
  assert.strictEqual(result.activeCourseCount, result.courses.length, "activeCourseCount should match returned courses");
  assert.strictEqual(result.nextCourse, null, "at 22:00 all courses should be finished");
  assert.strictEqual(result.allFinished, true, "all active courses should be finished at 22:00");

  console.log("test-ai-today-active-week passed");
}

run();
