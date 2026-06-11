const assert = require("assert");
const calendar = require("../server/storage/terms/2025-2026-2/teaching-calendar.json");

assert.strictEqual(calendar.term, "2025-2026-2");
assert.strictEqual(calendar.termStartDate, "2026-03-09");
assert.strictEqual(calendar.totalWeeks, 19);
assert.strictEqual(calendar.weekStart, "monday");
assert.strictEqual(calendar.weeks.length, 19);
calendar.weeks.forEach((week, index) => {
  assert.strictEqual(week.weekNo, index + 1);
  assert(week.title && typeof week.title === "string", `week ${week.weekNo} should have readable title`);
});
assert.strictEqual(calendar.weeks[0].title, "开学教学周");
assert.strictEqual(calendar.weeks[0].note, "3月8日返校报到（开学第一周各二级学院灵活安排注册时间），3月9日开始上课。");
assert.strictEqual(calendar.weeks[3].note, "清明节：4月4日至6日放假，共3天。");
assert.strictEqual(calendar.weeks[7].note, "劳动节：5月1日至5日放假调休，共5天。5月9日（星期六）补上5月5日（星期二）的课。");
assert.strictEqual(calendar.weeks[8].note, "劳动节：5月1日至5日放假调休，共5天。5月9日（星期六）补上5月5日（星期二）的课。");
assert.strictEqual(calendar.weeks[11].note, "毕业班：5月29日前完成毕业论文（设计）答辩工作。");
assert.strictEqual(calendar.weeks[12].note, "毕业班：6月3日前完成毕业生成绩录入工作。");
assert.strictEqual(calendar.weeks[13].note, "大学英语四六级考试：6月13日。");
assert.strictEqual(calendar.weeks[14].note, "端午节：6月19日至6月21日放假，共3天。");
assert.strictEqual(calendar.weeks[16].note, "考试周。");
assert.strictEqual(calendar.weeks[17].note, "机动实践周；毕业生离校。");
assert.strictEqual(calendar.weeks[18].note, "机动实践周。");
assert(!JSON.stringify(calendar).includes("当前日期所在教学周"));
console.log("test-teaching-calendar-contract passed");
