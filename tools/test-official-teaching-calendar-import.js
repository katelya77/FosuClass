"use strict";

const assert = require("assert");
const XLSX = require("../server/node_modules/xlsx");
const { parseOfficialTeachingCalendarWorkbook } = require("./fosu-sync-client/official-teaching-calendar");

const rows = [
  ["2026-2027学年 第1学期  教学周历"],
  ["星期/周次", "星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "备注"],
];
for (let weekNo = 1; weekNo <= 19; weekNo += 1) {
  let note = "";
  if (weekNo === 1) note = "老生9月6日返校报到，9月7日正式上课。新生9月13日入学报到，9月14日-30日军训，10月9日正式上课。";
  if (weekNo === 3) note = "中秋节：9月25日至27日放假，共3天。国庆节补课：9月20日（周日）补10月6日（周二）的课。";
  if (weekNo === 4) note = "国庆节：10月1日至7日放假调休，共7天。10月10日（周六）补10月7日（周三）的课。";
  if (weekNo === 17) note = "老生机动实践周、新生教学周。";
  if (weekNo === 19) note = "考试周";
  rows.push([weekNo, weekNo === 1 ? "09月06日" : "", weekNo === 1 ? "07" : "", "", "", "", "", "", note]);
}
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "教学周历");
const buffer = XLSX.write(workbook, { type: "buffer", bookType: "biff8" });
const calendar = parseOfficialTeachingCalendarWorkbook(buffer, {
  term: "2026-2027-1",
  termStartDate: "2026-09-07",
  sourceFileName: "official.xls",
  updatedAt: "2026-08-13T00:00:00.000Z",
});

assert.strictEqual(calendar.sourceStatus, "CALENDAR_SOURCE_COMPLETE");
assert.strictEqual(calendar.totalWeeks, 19);
assert.strictEqual(calendar.weeks.length, 19);
assert.strictEqual(calendar.weeks[0].startDate, "2026-09-07");
assert.strictEqual(calendar.weeks[18].endDate, "2027-01-17");
assert.strictEqual(calendar.specialDates.length, 12);
assert.deepStrictEqual(calendar.specialDates.find((item) => item.date === "2026-09-20"), {
  date: "2026-09-20",
  type: "makeup",
  scheduleSourceDate: "2026-10-06",
  note: "补10月6日的课",
  audience: "all",
});
assert(calendar.specialDates.some((item) => item.date === "2026-10-01" && item.type === "holiday"));
assert.strictEqual(calendar.cohortMilestones.length, 5);
assert.strictEqual(calendar.weeks[18].type, "exam");
assert.throws(() => parseOfficialTeachingCalendarWorkbook(buffer, {
  term: "2025-2026-2",
  termStartDate: "2026-03-09",
}), (error) => error && error.code === "CALENDAR_WORKBOOK_TERM_MISMATCH");
console.log("test-official-teaching-calendar-import passed");
