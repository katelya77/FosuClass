const assert = require("assert");
const toolRegistry = require("../server/src/services/ai/toolRegistry");
const todayReminder = require("../miniprogram/utils/todayReminder");
const { buildAiContext, courses, currentWeek, weekday } = require("./fixtures/ai-today-courses.fixture");

function sortedNames(list) {
  return (list || []).map((course) => course.courseName).sort();
}

function run() {
  const pageCourses = courses
    .filter((course) => Number(course.weekday) === weekday)
    .filter((course) => todayReminder.isCourseActiveInCurrentWeek(course, currentWeek));
  const aiResult = toolRegistry.executeTool("get_today_courses", {}, buildAiContext("2026-06-08T08:20:00+08:00"));

  assert.deepStrictEqual(
    sortedNames(aiResult.courses),
    sortedNames(pageCourses),
    "AI get_today_courses must match todayReminder active-week filtering"
  );

  console.log("test-ai-today-consistency-with-page passed");
}

run();
