const weekday = 1;
const currentWeek = 14;
const date = "2026-06-08";

const courses = [
  {
    courseName: "inactive-array-week",
    teacherName: "T1",
    classroom: "C7-101",
    weekday,
    startSection: 1,
    endSection: 2,
    weeks: [1, 2, 3],
  },
  {
    courseName: "active-array-week",
    teacherName: "T2",
    classroom: "C7-102",
    weekday,
    startSection: 3,
    endSection: 4,
    weeks: [14],
  },
  {
    courseName: "inactive-odd-week",
    teacherName: "T3",
    classroom: "C7-103",
    weekday,
    startSection: 5,
    endSection: 6,
    weekText: "1-16周(单)",
  },
  {
    courseName: "active-even-week",
    teacherName: "T4",
    classroom: "C7-104",
    weekday,
    startSection: 7,
    endSection: 8,
    weekText: "1-16周(双)",
  },
  {
    courseName: "uncertain-no-week",
    teacherName: "T5",
    classroom: "C7-105",
    weekday,
    startSection: 9,
    endSection: 10,
  },
  {
    courseName: "finished-evening-week",
    teacherName: "T6",
    classroom: "C7-106",
    weekday,
    startSection: 13,
    endSection: 14,
    weeks: [14],
  },
  {
    courseName: "other-day-active",
    teacherName: "T7",
    classroom: "C7-107",
    weekday: 2,
    startSection: 1,
    endSection: 2,
    weeks: [14],
  },
];

function buildAiContext(clientLocalTime = "2026-06-08T22:00:00+08:00") {
  return {
    term: "2025-2026-2",
    currentTeachingWeek: currentWeek,
    todayWeekday: weekday,
    todayDate: date,
    termStartDate: "2026-03-09",
    totalWeeks: 20,
    clientLocalTime,
    timezone: "Asia/Shanghai",
    currentScheduleSummary: {
      enabled: true,
      targetType: "class",
      targetName: "fixture",
      courses,
    },
  };
}

module.exports = {
  buildAiContext,
  courses,
  currentWeek,
  date,
  weekday,
};
