let miniprogramCourses = null;
let miniprogramClasses = null;
let miniprogramCalendar = null;

try {
  miniprogramCourses = require("../../miniprogram/data/mockCourses");
  miniprogramClasses = require("../../miniprogram/data/mockClasses");
  miniprogramCalendar = require("../../miniprogram/data/mockCalendar");
} catch (error) {
  miniprogramCourses = null;
}

const fallbackCourses = [
  {
    id: "mock-organic-chemistry",
    source: "school",
    semester: "2025-2026学年第二学期",
    className: "25动物医学6",
    courseName: "有机化学",
    teacherName: "汪军",
    classroom: "C7-503",
    weekday: 2,
    startSection: 3,
    endSection: 5,
    startWeek: 9,
    endWeek: 16,
    weeks: [9, 10, 11, 12, 13, 14, 15, 16],
    weekText: "9-16周",
    weekType: "all",
    color: "#5d9cec",
    remark: "Cloud function fallback mock.",
    rawText: "",
    rawHtml: "",
  },
];

const fallbackClasses = [
  {
    id: "class-25-vet-6",
    className: "25动物医学6",
    college: "动物科技学院",
    grade: "2025级",
    major: "动物医学",
    semester: "2025-2026学年第二学期",
    scheduleReady: true,
  },
];

const fallbackCalendar = [
  {
    week: 12,
    startDate: "2026-05-25",
    endDate: "2026-05-31",
    note: "当前周 Mock 高亮",
  },
];

module.exports = {
  mockCourses: (miniprogramCourses && miniprogramCourses.mockCourses) || fallbackCourses,
  mockClasses: (miniprogramClasses && miniprogramClasses.mockClasses) || fallbackClasses,
  mockCalendar: (miniprogramCalendar && miniprogramCalendar.mockCalendar) || fallbackCalendar,
};
