const DEFAULT_SEMESTER = "2025-2026学年第二学期";
const DEFAULT_CLASS = "25动物医学6";

function weeksFromRange(startWeek, endWeek) {
  const weeks = [];
  for (let week = startWeek; week <= endWeek; week += 1) {
    weeks.push(week);
  }
  return weeks;
}

/**
 * CourseItem
 * @property {string} id
 * @property {"personal"|"school"|"manual"} source
 * @property {string} semester
 * @property {string} className
 * @property {"student"|"teacher"|"classroom"|"course"} audienceType
 * @property {"personal"|"class"|"teacher"|"classroom"|"course"} sourceType
 * @property {string} courseName
 * @property {string} teacherName
 * @property {string} classroom
 * @property {number} weekday 1-7, Monday is 1
 * @property {number} startSection
 * @property {number} endSection
 * @property {number} startWeek
 * @property {number} endWeek
 * @property {number[]} weeks
 * @property {string} weekText
 * @property {"all"|"odd"|"even"} weekType
 * @property {string} color
 * @property {string} remark
 * @property {string} rawText
 * @property {string} rawHtml
 */
const mockCourses = [
  {
    id: "25-vet6-organic-chemistry-tue",
    source: "school",
    sourceType: "class",
    audienceType: "student",
    semester: DEFAULT_SEMESTER,
    className: DEFAULT_CLASS,
    courseName: "有机化学",
    teacherName: "汪军",
    classroom: "C7-503",
    weekday: 2,
    startSection: 3,
    endSection: 5,
    startWeek: 9,
    endWeek: 16,
    weeks: weeksFromRange(9, 16),
    weekText: "9-16周",
    weekType: "all",
    color: "#5d9cec",
    remark: "演示数据，仅用于第一阶段 UI 展示。",
    rawText: "有机化学\n汪军副教授\n9-16周\nC7-503[03-04-05]节",
    rawHtml: "",
  },
  {
    id: "25-vet6-organic-chemistry-thu",
    source: "school",
    sourceType: "class",
    audienceType: "student",
    semester: DEFAULT_SEMESTER,
    className: DEFAULT_CLASS,
    courseName: "有机化学",
    teacherName: "汪军",
    classroom: "C7-503",
    weekday: 4,
    startSection: 3,
    endSection: 5,
    startWeek: 9,
    endWeek: 16,
    weeks: weeksFromRange(9, 16),
    weekText: "9-16周",
    weekType: "all",
    color: "#5d9cec",
    remark: "演示数据，仅用于第一阶段 UI 展示。",
    rawText: "有机化学\n汪军副教授\n9-16周\nC7-503[03-04-05]节",
    rawHtml: "",
  },
  {
    id: "25-vet6-anatomy-mon",
    source: "school",
    sourceType: "class",
    audienceType: "student",
    semester: DEFAULT_SEMESTER,
    className: DEFAULT_CLASS,
    courseName: "动物解剖学",
    teacherName: "陈芳",
    classroom: "C7-305",
    weekday: 1,
    startSection: 3,
    endSection: 5,
    startWeek: 5,
    endWeek: 15,
    weeks: weeksFromRange(5, 15),
    weekText: "5-15周",
    weekType: "all",
    color: "#ff9f43",
    remark: "演示数据，真实节次以后续同步为准。",
    rawText: "动物解剖学\n陈芳副教授\n5-15周\nC7-305[03-04-05]节",
    rawHtml: "",
  },
  {
    id: "25-vet6-anatomy-thu",
    source: "school",
    sourceType: "class",
    audienceType: "student",
    semester: DEFAULT_SEMESTER,
    className: DEFAULT_CLASS,
    courseName: "动物解剖学",
    teacherName: "陈芳",
    classroom: "C7-305",
    weekday: 4,
    startSection: 6,
    endSection: 7,
    startWeek: 5,
    endWeek: 15,
    weeks: weeksFromRange(5, 15),
    weekText: "5-15周",
    weekType: "all",
    color: "#ff9f43",
    remark: "演示数据，真实节次以后续同步为准。",
    rawText: "动物解剖学\n陈芳副教授\n5-15周\nC7-305[06-07]节",
    rawHtml: "",
  },
  {
    id: "25-vet6-zoology-mon",
    source: "school",
    sourceType: "class",
    audienceType: "student",
    semester: DEFAULT_SEMESTER,
    className: DEFAULT_CLASS,
    courseName: "动物学",
    teacherName: "覃丽梅",
    classroom: "C7-208",
    weekday: 1,
    startSection: 6,
    endSection: 7,
    startWeek: 5,
    endWeek: 14,
    weeks: weeksFromRange(5, 14),
    weekText: "5-14周",
    weekType: "all",
    color: "#26b99a",
    remark: "演示数据，仅用于第一阶段 UI 展示。",
    rawText: "动物学\n覃丽梅\n5-14周\nC7-208[06-07]节",
    rawHtml: "",
  },
  {
    id: "25-vet6-college-english-wed",
    source: "school",
    sourceType: "class",
    audienceType: "student",
    semester: DEFAULT_SEMESTER,
    className: DEFAULT_CLASS,
    courseName: "大学英语2（跨文化交流英语）",
    teacherName: "李德博",
    classroom: "B5-304（语音室）",
    weekday: 3,
    startSection: 11,
    endSection: 12,
    startWeek: 1,
    endWeek: 16,
    weeks: weeksFromRange(1, 16),
    weekText: "1-16周",
    weekType: "all",
    color: "#8e6ee8",
    remark: "演示数据，仅用于第一阶段 UI 展示。",
    rawText: "大学英语2(跨文化交流英语)\n李德博\n1-16周\nB5-304(语音室)[11-12]节",
    rawHtml: "",
  },
  {
    id: "25-vet6-pe-fri",
    source: "school",
    sourceType: "class",
    audienceType: "student",
    semester: DEFAULT_SEMESTER,
    className: DEFAULT_CLASS,
    courseName: "大学体育2",
    teacherName: "体育教师",
    classroom: "慕课 / 默认场地",
    weekday: 5,
    startSection: 8,
    endSection: 10,
    startWeek: 1,
    endWeek: 16,
    weeks: weeksFromRange(1, 16),
    weekText: "1-16周",
    weekType: "all",
    color: "#15b6d4",
    remark: "演示数据，仅用于第一阶段 UI 展示。",
    rawText: "大学体育2\n体育教师\n1-16周\n慕课/默认场地[08-09-10]节",
    rawHtml: "",
  },
  {
    id: "25-vet6-analytical-chemistry-fri",
    source: "school",
    sourceType: "class",
    audienceType: "student",
    semester: DEFAULT_SEMESTER,
    className: DEFAULT_CLASS,
    courseName: "分析化学",
    teacherName: "王选东",
    classroom: "C7-503",
    weekday: 5,
    startSection: 3,
    endSection: 5,
    startWeek: 1,
    endWeek: 7,
    weeks: weeksFromRange(1, 7),
    weekText: "1-7周",
    weekType: "all",
    color: "#ef6f8f",
    remark: "演示数据，仅用于第一阶段 UI 展示。",
    rawText: "分析化学\n王选东\n1-7周\nC7-503[03-04-05]节",
    rawHtml: "",
  },
];

module.exports = {
  DEFAULT_CLASS,
  DEFAULT_SEMESTER,
  mockCourses,
};
