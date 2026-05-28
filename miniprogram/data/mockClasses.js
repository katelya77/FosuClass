const collegeOptions = ["动物科技学院", "食品科学与工程学院", "生命科学与工程学院", "电子信息工程学院"];
const gradeOptions = ["2025级", "2024级", "2023级", "2022级"];
const majorOptions = ["动物医学", "动物科学", "食品质量与安全", "生物工程", "计算机科学与技术"];

const mockClasses = [
  {
    id: "class-25-vet-6",
    className: "25动物医学6",
    college: "动物科技学院",
    grade: "2025级",
    major: "动物医学",
    semester: "2025-2026学年第二学期",
    studentCount: 38,
    scheduleReady: true,
  },
  {
    id: "class-25-animal-science-3",
    className: "25动物科学3",
    college: "动物科技学院",
    grade: "2025级",
    major: "动物科学",
    semester: "2025-2026学年第二学期",
    studentCount: 42,
    scheduleReady: true,
  },
  {
    id: "class-25-vet-1",
    className: "25动物医学1",
    college: "动物科技学院",
    grade: "2025级",
    major: "动物医学",
    semester: "2025-2026学年第二学期",
    studentCount: 40,
    scheduleReady: true,
  },
  {
    id: "class-24-food-safe-2",
    className: "24食品质量与安全2",
    college: "食品科学与工程学院",
    grade: "2024级",
    major: "食品质量与安全",
    semester: "2025-2026学年第二学期",
    studentCount: 36,
    scheduleReady: false,
  },
  {
    id: "class-23-bio-engineering-1",
    className: "23生物工程1",
    college: "生命科学与工程学院",
    grade: "2023级",
    major: "生物工程",
    semester: "2025-2026学年第二学期",
    studentCount: 35,
    scheduleReady: false,
  },
];

module.exports = {
  mockClasses,
  collegeOptions,
  gradeOptions,
  majorOptions,
};
