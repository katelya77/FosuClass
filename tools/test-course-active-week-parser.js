const assert = require("assert");
const { parseWeekText } = require("../miniprogram/utils/courseParser");
const { isCourseActiveInCurrentWeek } = require("../miniprogram/utils/course");

function courseFromWeekText(text) {
  const parsed = parseWeekText(text, {
    defaultStartWeek: 1,
    defaultEndWeek: 20,
  });
  return {
    startWeek: parsed.startWeek,
    endWeek: parsed.endWeek,
    weeks: parsed.weeks,
    weekText: parsed.weekText,
    weekType: parsed.weekType,
  };
}

const odd = courseFromWeekText("第1-8周 单周");
assert.strictEqual(isCourseActiveInCurrentWeek(odd, 1), true);
assert.strictEqual(isCourseActiveInCurrentWeek(odd, 2), false);
assert.strictEqual(isCourseActiveInCurrentWeek(odd, 9), false);

const even = courseFromWeekText("２-６周 双周");
assert.deepStrictEqual(even.weeks, [2, 4, 6]);
assert.strictEqual(isCourseActiveInCurrentWeek(even, 4), true);
assert.strictEqual(isCourseActiveInCurrentWeek(even, 5), false);

const explicit = courseFromWeekText("1,3,5周");
assert.strictEqual(isCourseActiveInCurrentWeek(explicit, 3), true);
assert.strictEqual(isCourseActiveInCurrentWeek(explicit, 4), false);

const fallback = {
  startWeek: 4,
  endWeek: 6,
  weeks: [],
  weekType: "all",
};
assert.strictEqual(isCourseActiveInCurrentWeek(fallback, 4), true);
assert.strictEqual(isCourseActiveInCurrentWeek(fallback, 7), false);

console.log("test-course-active-week-parser passed");
