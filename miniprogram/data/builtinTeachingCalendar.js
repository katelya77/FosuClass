const BUILTIN_TERM_CONFIG = {
  term: "2025-2026-2",
  semesterText: "2025-2026学年第二学期",
  termStartDate: "2026-03-09",
  totalWeeks: 19,
  weekStart: "monday",
  source: "builtin-2025-2026-2",
  releaseVersion: "2026-06-11-calendar-v2",
};

const LABOR_DAY_NOTE = "劳动节：5月1日至5日放假调休，共5天。5月9日（星期六）补上5月5日（星期二）的课。";

const BUILTIN_WEEKS = [
  { weekNo: 1, startDate: "2026-03-09", endDate: "2026-03-15", type: "opening", typeText: "开学教学周", title: "开学教学周", note: "3月8日返校报到（开学第一周各二级学院灵活安排注册时间），3月9日开始上课。" },
  { weekNo: 2, startDate: "2026-03-16", endDate: "2026-03-22", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 3, startDate: "2026-03-23", endDate: "2026-03-29", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 4, startDate: "2026-03-30", endDate: "2026-04-05", type: "holiday", typeText: "节假日/调休周", title: "清明节", note: "清明节：4月4日至6日放假，共3天。" },
  { weekNo: 5, startDate: "2026-04-06", endDate: "2026-04-12", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 6, startDate: "2026-04-13", endDate: "2026-04-19", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 7, startDate: "2026-04-20", endDate: "2026-04-26", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 8, startDate: "2026-04-27", endDate: "2026-05-03", type: "holiday", typeText: "节假日/调休周", title: "劳动节", note: LABOR_DAY_NOTE },
  { weekNo: 9, startDate: "2026-05-04", endDate: "2026-05-10", type: "adjustment", typeText: "调整教学周", title: "劳动节调休", note: LABOR_DAY_NOTE },
  { weekNo: 10, startDate: "2026-05-11", endDate: "2026-05-17", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 11, startDate: "2026-05-18", endDate: "2026-05-24", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 12, startDate: "2026-05-25", endDate: "2026-05-31", type: "teaching", typeText: "正常教学周", title: "毕业论文答辩", note: "毕业班：5月29日前完成毕业论文（设计）答辩工作。" },
  { weekNo: 13, startDate: "2026-06-01", endDate: "2026-06-07", type: "teaching", typeText: "正常教学周", title: "毕业生成绩录入", note: "毕业班：6月3日前完成毕业生成绩录入工作。" },
  { weekNo: 14, startDate: "2026-06-08", endDate: "2026-06-14", type: "teaching", typeText: "正常教学周", title: "大学英语四六级考试", note: "大学英语四六级考试：6月13日。" },
  { weekNo: 15, startDate: "2026-06-15", endDate: "2026-06-21", type: "holiday", typeText: "节假日/调休周", title: "端午节", note: "端午节：6月19日至6月21日放假，共3天。" },
  { weekNo: 16, startDate: "2026-06-22", endDate: "2026-06-28", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 17, startDate: "2026-06-29", endDate: "2026-07-05", type: "exam", typeText: "考试周", title: "考试周", note: "考试周。" },
  { weekNo: 18, startDate: "2026-07-06", endDate: "2026-07-12", type: "flexible", typeText: "机动实践周", title: "机动实践周", note: "机动实践周；毕业生离校。" },
  { weekNo: 19, startDate: "2026-07-13", endDate: "2026-07-19", type: "flexible", typeText: "机动实践周", title: "机动实践周", note: "机动实践周。" },
].map((week) => Object.assign({}, week, {
  notes: week.note || "",
}));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getBuiltinTeachingCalendar() {
  return {
    success: true,
    schemaVersion: 2,
    term: BUILTIN_TERM_CONFIG.term,
    semester: BUILTIN_TERM_CONFIG.term,
    releaseVersion: BUILTIN_TERM_CONFIG.releaseVersion,
    semesterText: BUILTIN_TERM_CONFIG.semesterText,
    source: "builtin-fallback",
    updatedAt: "2026-06-11T00:00:00.000Z",
    defaultWeekTitle: "正常教学周",
    termConfig: clone(BUILTIN_TERM_CONFIG),
    weeks: clone(BUILTIN_WEEKS),
  };
}

module.exports = {
  BUILTIN_TERM_CONFIG,
  BUILTIN_WEEKS,
  getBuiltinTeachingCalendar,
};
