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
    id: "fallback-organic-chemistry",
    source: "school",
    semester: "2025-2026学年第二学期",
    className: "25动物医学6",
    courseName: "有机化学",
    teacherName: "张三",
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
    remark: "云函数本地缓存兜底数据。",
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
    semester: "2025-2026-2",
    weekNo: 12,
    startDate: "2026-05-25",
    endDate: "2026-05-31",
    notes: "当前日期所在教学周",
  },
];

module.exports = {
  mockCourses: (miniprogramCourses && miniprogramCourses.mockCourses) || fallbackCourses,
  mockClasses: (miniprogramClasses && miniprogramClasses.mockClasses) || fallbackClasses,
  mockCalendar: (miniprogramCalendar && miniprogramCalendar.mockCalendar) || fallbackCalendar,
};
