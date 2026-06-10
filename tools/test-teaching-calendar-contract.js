const assert = require("assert");
const calendar = require("../server/storage/terms/2025-2026-2/teaching-calendar.json");

assert.strictEqual(calendar.term, "2025-2026-2");
assert.strictEqual(calendar.weeks.length, 20);
calendar.weeks.forEach((week, index) => {
  assert.strictEqual(week.weekNo, index + 1);
  assert(week.title && typeof week.title === "string", `week ${week.weekNo} should have readable title`);
});
assert.strictEqual(calendar.weeks[0].title, "开学教学周");
assert.strictEqual(calendar.weeks[3].title, "清明节假期以学校通知为准");
assert.strictEqual(calendar.weeks[7].title, "劳动节假期以学校通知为准");
assert.strictEqual(calendar.weeks[9].title, "期中教学检查");
assert.strictEqual(calendar.weeks[11].title, "常规教学");
assert.strictEqual(calendar.weeks[13].title, "端午节安排以学校通知为准");
assert.strictEqual(calendar.weeks[16].title, "复习考试周");
assert.strictEqual(calendar.weeks[17].title, "考试周");
assert(!JSON.stringify(calendar).includes("当前日期所在教学周"));
console.log("test-teaching-calendar-contract passed");
