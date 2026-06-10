const BUILTIN_TERM_CONFIG = {
  term: "2025-2026-2",
  semesterText: "2025-2026学年第二学期",
  termStartDate: "2026-03-09",
  totalWeeks: 20,
  weekStart: "monday",
  source: "builtin-2025-2026-2",
  releaseVersion: "2026-06-05T12-39-28",
};

const BUILTIN_WEEKS = [
  { weekNo: 1, startDate: "2026-03-09", endDate: "2026-03-15", type: "opening", typeText: "开学教学周", title: "开学教学周", note: "" },
  { weekNo: 2, startDate: "2026-03-16", endDate: "2026-03-22", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 3, startDate: "2026-03-23", endDate: "2026-03-29", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 4, startDate: "2026-03-30", endDate: "2026-04-05", type: "holiday", typeText: "调整教学周", title: "清明节假期以学校通知为准", note: "节假日安排以学校通知为准" },
  { weekNo: 5, startDate: "2026-04-06", endDate: "2026-04-12", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 6, startDate: "2026-04-13", endDate: "2026-04-19", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 7, startDate: "2026-04-20", endDate: "2026-04-26", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 8, startDate: "2026-04-27", endDate: "2026-05-03", type: "holiday", typeText: "调整教学周", title: "劳动节假期以学校通知为准", note: "节假日安排以学校通知为准" },
  { weekNo: 9, startDate: "2026-05-04", endDate: "2026-05-10", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 10, startDate: "2026-05-11", endDate: "2026-05-17", type: "midterm", typeText: "期中教学检查", title: "期中教学检查", note: "" },
  { weekNo: 11, startDate: "2026-05-18", endDate: "2026-05-24", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 12, startDate: "2026-05-25", endDate: "2026-05-31", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 13, startDate: "2026-06-01", endDate: "2026-06-07", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 14, startDate: "2026-06-08", endDate: "2026-06-14", type: "holiday", typeText: "调整教学周", title: "端午节安排以学校通知为准", note: "节假日安排以学校通知为准" },
  { weekNo: 15, startDate: "2026-06-15", endDate: "2026-06-21", type: "teaching", typeText: "正常教学周", title: "正常教学周", note: "" },
  { weekNo: 16, startDate: "2026-06-22", endDate: "2026-06-28", type: "closing", typeText: "结课周", title: "结课周", note: "" },
  { weekNo: 17, startDate: "2026-06-29", endDate: "2026-07-05", type: "review", typeText: "复习周", title: "复习考试周", note: "" },
  { weekNo: 18, startDate: "2026-07-06", endDate: "2026-07-12", type: "exam", typeText: "考试周", title: "考试周", note: "" },
  { weekNo: 19, startDate: "2026-07-13", endDate: "2026-07-19", type: "flexible", typeText: "机动周", title: "机动周", note: "" },
  { weekNo: 20, startDate: "2026-07-20", endDate: "2026-07-26", type: "closing", typeText: "结课周", title: "暑假前教学安排", note: "" },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getBuiltinTeachingCalendar() {
  return {
    success: true,
    schemaVersion: 1,
    term: BUILTIN_TERM_CONFIG.term,
    semester: BUILTIN_TERM_CONFIG.term,
    releaseVersion: BUILTIN_TERM_CONFIG.releaseVersion,
    semesterText: BUILTIN_TERM_CONFIG.semesterText,
    source: "builtin-fallback",
    updatedAt: "2026-06-10T00:00:00.000Z",
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
