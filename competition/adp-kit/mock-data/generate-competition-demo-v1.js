#!/usr/bin/env node
/**
 * competition-demo-v1 匿名演示数据生成器
 *
 * 用途：为腾讯云 ADP 参赛智能体「校园智序 · 小序」生成完全虚构、自洽的校园演示数据。
 *
 * 设计原则：
 * 1. 全部实体为匿名虚构：学院A/B、校区A/B、教师00X、2025级X班、演示用户001。
 *    不对应任何真实学校、学院、教师、学生与团队成员；不是由真实数据改字符串得到。
 * 2. 数据由下方 LESSON_TABLE 规则表确定性展开，无随机数，重复生成结果完全一致。
 * 3. 数据必须自洽并通过 validate-competition-demo-v1.js 校验：
 *    引用完整、无教师/班级/教室硬冲突、周次范围合法、设计场景存在。
 *
 * 内置设计场景（供工作流调试与评测用例锚定）：
 * - fri-afternoon-ab-overlap：2025级A班与B班 周五5-6节 均有课（课程冲突比较阳性样例）
 * - teacher003-mon-cross-campus：教师003 周一 5-6节@校区A → 7-8节@校区B 跨校区赶场
 * - demo-user-fri-full-day：演示用户001 周五 思政(1-9周)+物理+双周晚课艺术鉴赏@校区B
 * - sz-weeks-1-9：思政通识仅 1-9 周 → 第10周起查该课程返回空（空结果样例）
 * - art-even-weeks：艺术鉴赏仅双周 → 单周查询返回空（空结果/周次过滤样例）
 *
 * 运行：node generate-competition-demo-v1.js
 * 输出：competition-demo-v1.json（同目录）
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_VERSION = "competition-demo-v1";
const SEMESTER_START_DATE = "2026-08-31";
const TOTAL_WEEKS = 20;

function addCalendarDays(dateStr, days) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + Number(days) * 86400000)
    .toISOString()
    .slice(0, 10);
}

const SEMESTER_END_DATE = addCalendarDays(SEMESTER_START_DATE, TOTAL_WEEKS * 7 - 1);

// ---------------------------------------------------------------------------
// 元信息：学期与节次时间轴
// ---------------------------------------------------------------------------
const META = {
  dataVersion: DATA_VERSION,
  schema: "campus-demo/v1",
  timezone: "Asia/Shanghai",
  // 只用于固定评测基准；真实请求默认按 Asia/Shanghai 当前日期解析。
  demoReferenceDate: SEMESTER_START_DATE,
  generatedBy: "competition/adp-kit/mock-data/generate-competition-demo-v1.js",
  anonymization:
    "本数据集全部为虚构匿名演示数据，不对应任何真实学校、学院、教师、学生、用户与团队身份。",
  semester: {
    id: "2026-2027-1",
    name: "2026-2027学年第一学期",
    // 2026-08-31 为周一；结束日期始终由起始日和总周数确定性计算。
    startDate: SEMESTER_START_DATE,
    endDate: SEMESTER_END_DATE,
    totalWeeks: TOTAL_WEEKS,
  },
  // 节次时间轴：1-10 节，两节为一大节
  periods: [
    { period: 1, start: "08:00", end: "08:45" },
    { period: 2, start: "08:55", end: "09:40" },
    { period: 3, start: "10:00", end: "10:45" },
    { period: 4, start: "10:55", end: "11:40" },
    { period: 5, start: "14:00", end: "14:45" },
    { period: 6, start: "14:55", end: "15:40" },
    { period: 7, start: "16:00", end: "16:45" },
    { period: 8, start: "16:55", end: "17:40" },
    { period: 9, start: "19:00", end: "19:45" },
    { period: 10, start: "19:55", end: "20:40" },
  ],
  weekdayNames: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
};

// ---------------------------------------------------------------------------
// 基础实体：校区 / 学院 / 班级 / 教师 / 课程 / 教室
// ---------------------------------------------------------------------------
const CAMPUSES = [
  { id: "campus-a", name: "校区A", buildings: ["教学楼A1", "教学楼A2", "实验楼A1", "体育场馆A1"] },
  { id: "campus-b", name: "校区B", buildings: ["教学楼B1", "实验楼B1", "体育场馆B1"] },
];

const COLLEGES = [
  { id: "college-a", name: "学院A" },
  { id: "college-b", name: "学院B" },
];

const CLASSES = [
  { id: "cls-2025-a", name: "2025级A班", collegeId: "college-a", campusId: "campus-a", size: 45 },
  { id: "cls-2025-b", name: "2025级B班", collegeId: "college-a", campusId: "campus-a", size: 44 },
  { id: "cls-2025-c", name: "2025级C班", collegeId: "college-b", campusId: "campus-b", size: 40 },
  { id: "cls-2025-d", name: "2025级D班", collegeId: "college-b", campusId: "campus-b", size: 42 },
];

const TEACHERS = [
  { id: "t-001", name: "教师001", collegeId: "college-a", title: "副教授" },
  { id: "t-002", name: "教师002", collegeId: "college-a", title: "讲师" },
  { id: "t-003", name: "教师003", collegeId: "college-a", title: "教授" },
  { id: "t-004", name: "教师004", collegeId: "college-a", title: "讲师" },
  { id: "t-005", name: "教师005", collegeId: "college-a", title: "副教授" },
  { id: "t-006", name: "教师006", collegeId: "college-b", title: "讲师" },
  { id: "t-007", name: "教师007", collegeId: "college-b", title: "副教授" },
  { id: "t-008", name: "教师008", collegeId: "college-b", title: "讲师" },
];

const COURSES = [
  { id: "c-01", name: "高等数学A", credits: 5, collegeId: "college-a", category: "必修" },
  { id: "c-02", name: "大学英语A", credits: 4, collegeId: "college-a", category: "必修" },
  { id: "c-03", name: "程序设计基础", credits: 4, collegeId: "college-a", category: "必修" },
  { id: "c-04", name: "程序设计基础实验", credits: 1, collegeId: "college-a", category: "实验" },
  { id: "c-05", name: "大学物理B", credits: 4, collegeId: "college-a", category: "必修" },
  { id: "c-06", name: "线性代数", credits: 3, collegeId: "college-a", category: "必修" },
  { id: "c-07", name: "大学体育", credits: 1, collegeId: "college-a", category: "必修" },
  { id: "c-08", name: "思政通识", credits: 2, collegeId: "college-a", category: "必修" },
  { id: "c-09", name: "数据结构", credits: 4, collegeId: "college-a", category: "必修" },
  { id: "c-10", name: "概率论", credits: 3, collegeId: "college-a", category: "必修" },
  { id: "c-11", name: "电路分析", credits: 3, collegeId: "college-b", category: "必修" },
  { id: "c-12", name: "数据库基础", credits: 3, collegeId: "college-b", category: "必修" },
  { id: "c-13", name: "软件工程导论", credits: 3, collegeId: "college-b", category: "必修" },
  { id: "c-14", name: "计算机组成原理", credits: 4, collegeId: "college-b", category: "必修" },
  { id: "c-15", name: "大学化学", credits: 3, collegeId: "college-b", category: "必修" },
  { id: "c-16", name: "通识选修·艺术鉴赏", credits: 2, collegeId: "college-b", category: "选修" },
];

// 教室：id / 名称 / 校区 / 楼栋 / 容量 / 类型
const ROOMS = [
  { id: "r-a1-101", name: "A1-101", campusId: "campus-a", building: "教学楼A1", capacity: 60, type: "多媒体" },
  { id: "r-a1-102", name: "A1-102", campusId: "campus-a", building: "教学楼A1", capacity: 60, type: "多媒体" },
  { id: "r-a1-103", name: "A1-103", campusId: "campus-a", building: "教学楼A1", capacity: 80, type: "多媒体" },
  { id: "r-a1-104", name: "A1-104", campusId: "campus-a", building: "教学楼A1", capacity: 60, type: "普通" },
  { id: "r-a1-105", name: "A1-105", campusId: "campus-a", building: "教学楼A1", capacity: 60, type: "普通" },
  { id: "r-a1-106", name: "A1-106", campusId: "campus-a", building: "教学楼A1", capacity: 80, type: "多媒体" },
  { id: "r-a1-201", name: "A1-201", campusId: "campus-a", building: "教学楼A1", capacity: 120, type: "阶梯" },
  { id: "r-a1-202", name: "A1-202", campusId: "campus-a", building: "教学楼A1", capacity: 120, type: "阶梯" },
  { id: "r-a1-203", name: "A1-203", campusId: "campus-a", building: "教学楼A1", capacity: 90, type: "多媒体" },
  { id: "r-a2-301", name: "A2-301", campusId: "campus-a", building: "教学楼A2", capacity: 50, type: "机房" },
  { id: "r-a2-302", name: "A2-302", campusId: "campus-a", building: "教学楼A2", capacity: 50, type: "机房" },
  { id: "r-la-401", name: "实验楼A1-401", campusId: "campus-a", building: "实验楼A1", capacity: 40, type: "实验室" },
  { id: "r-gym-a", name: "体育场馆A1", campusId: "campus-a", building: "体育场馆A1", capacity: 200, type: "体育场地" },
  { id: "r-b1-101", name: "B1-101", campusId: "campus-b", building: "教学楼B1", capacity: 70, type: "多媒体" },
  { id: "r-b1-102", name: "B1-102", campusId: "campus-b", building: "教学楼B1", capacity: 70, type: "多媒体" },
  { id: "r-b1-103", name: "B1-103", campusId: "campus-b", building: "教学楼B1", capacity: 80, type: "普通" },
  { id: "r-b1-104", name: "B1-104", campusId: "campus-b", building: "教学楼B1", capacity: 70, type: "普通" },
  { id: "r-b1-105", name: "B1-105", campusId: "campus-b", building: "教学楼B1", capacity: 100, type: "阶梯" },
  { id: "r-b1-106", name: "B1-106", campusId: "campus-b", building: "教学楼B1", capacity: 80, type: "多媒体" },
  { id: "r-b1-201", name: "B1-201", campusId: "campus-b", building: "教学楼B1", capacity: 90, type: "多媒体" },
  { id: "r-lb-301", name: "实验楼B1-301", campusId: "campus-b", building: "实验楼B1", capacity: 45, type: "实验室" },
  { id: "r-gym-b", name: "体育场馆B1", campusId: "campus-b", building: "体育场馆B1", capacity: 200, type: "体育场地" },
];

// ---------------------------------------------------------------------------
// 课表规则表：每条 = 课程 + 教师 + 班级 + 教室 + 星期 + 起止节 + 周次
// weeks 语法："1-20" 区间 或 "2,4,6" 枚举
// ---------------------------------------------------------------------------
const LESSON_TABLE = [
  // ---- 2025级A班（校区A）----
  { course: "高等数学A", teachers: ["教师001"], classes: ["2025级A班"], room: "A1-101", weekday: 1, ps: 1, pe: 2, weeks: "1-20" },
  { course: "高等数学A", teachers: ["教师001"], classes: ["2025级A班"], room: "A1-101", weekday: 3, ps: 3, pe: 4, weeks: "1-20" },
  { course: "大学英语A", teachers: ["教师002"], classes: ["2025级A班"], room: "A1-102", weekday: 2, ps: 1, pe: 2, weeks: "1-20" },
  { course: "大学英语A", teachers: ["教师002"], classes: ["2025级A班"], room: "A1-102", weekday: 4, ps: 3, pe: 4, weeks: "1-20" },
  { course: "程序设计基础", teachers: ["教师003"], classes: ["2025级A班"], room: "A2-301", weekday: 1, ps: 5, pe: 6, weeks: "1-20" },
  { course: "程序设计基础实验", teachers: ["教师003"], classes: ["2025级A班"], room: "实验楼A1-401", weekday: 4, ps: 7, pe: 8, weeks: "1-20" },
  // 设计场景：周五下午冲突锚点（A班）
  { course: "大学物理B", teachers: ["教师004"], classes: ["2025级A班"], room: "A1-201", weekday: 5, ps: 5, pe: 6, weeks: "1-20" },
  { course: "线性代数", teachers: ["教师005"], classes: ["2025级A班"], room: "A1-103", weekday: 2, ps: 3, pe: 4, weeks: "1-20" },
  { course: "大学体育", teachers: ["教师006"], classes: ["2025级A班"], room: "体育场馆A1", weekday: 3, ps: 7, pe: 8, weeks: "1-20" },
  // 设计场景：思政通识仅 1-9 周
  { course: "思政通识", teachers: ["教师007"], classes: ["2025级A班"], room: "A1-201", weekday: 5, ps: 1, pe: 2, weeks: "1-9" },

  // ---- 2025级B班（校区A）----
  { course: "高等数学A", teachers: ["教师001"], classes: ["2025级B班"], room: "A1-104", weekday: 1, ps: 3, pe: 4, weeks: "1-20" },
  { course: "高等数学A", teachers: ["教师001"], classes: ["2025级B班"], room: "A1-104", weekday: 3, ps: 1, pe: 2, weeks: "1-20" },
  { course: "大学英语A", teachers: ["教师002"], classes: ["2025级B班"], room: "A1-105", weekday: 2, ps: 5, pe: 6, weeks: "1-20" },
  { course: "大学英语A", teachers: ["教师002"], classes: ["2025级B班"], room: "A1-105", weekday: 4, ps: 1, pe: 2, weeks: "1-20" },
  { course: "数据结构", teachers: ["教师003"], classes: ["2025级B班"], room: "A2-302", weekday: 5, ps: 7, pe: 8, weeks: "1-20" },
  { course: "数据结构", teachers: ["教师003"], classes: ["2025级B班"], room: "A2-302", weekday: 3, ps: 5, pe: 6, weeks: "1-20" },
  // 设计场景：周五下午冲突锚点（B班，与 A班 同节次）
  { course: "大学物理B", teachers: ["教师008"], classes: ["2025级B班"], room: "A1-202", weekday: 5, ps: 5, pe: 6, weeks: "1-20" },
  { course: "概率论", teachers: ["教师005"], classes: ["2025级B班"], room: "A1-106", weekday: 2, ps: 7, pe: 8, weeks: "1-20" },
  { course: "电路分析", teachers: ["教师008"], classes: ["2025级B班"], room: "A1-203", weekday: 4, ps: 5, pe: 6, weeks: "1-20" },

  // ---- 2025级C班（校区B）----
  { course: "数据库基础", teachers: ["教师007"], classes: ["2025级C班"], room: "B1-101", weekday: 1, ps: 1, pe: 2, weeks: "1-20" },
  { course: "数据库基础", teachers: ["教师007"], classes: ["2025级C班"], room: "B1-101", weekday: 3, ps: 3, pe: 4, weeks: "1-20" },
  { course: "软件工程导论", teachers: ["教师008"], classes: ["2025级C班"], room: "B1-102", weekday: 2, ps: 1, pe: 2, weeks: "1-20" },
  { course: "软件工程导论", teachers: ["教师008"], classes: ["2025级C班"], room: "B1-102", weekday: 4, ps: 3, pe: 4, weeks: "1-20" },
  // 设计场景：教师003 周一 5-6节@校区A 后 7-8节@校区B 跨校区赶场
  { course: "计算机组成原理", teachers: ["教师003"], classes: ["2025级C班"], room: "B1-201", weekday: 1, ps: 7, pe: 8, weeks: "1-20" },
  { course: "大学英语A", teachers: ["教师002"], classes: ["2025级C班"], room: "B1-103", weekday: 3, ps: 5, pe: 6, weeks: "1-20" },
  { course: "大学体育", teachers: ["教师006"], classes: ["2025级C班"], room: "体育场馆B1", weekday: 5, ps: 3, pe: 4, weeks: "1-20" },

  // ---- 2025级D班（校区B）----
  { course: "大学化学", teachers: ["教师004"], classes: ["2025级D班"], room: "实验楼B1-301", weekday: 1, ps: 3, pe: 4, weeks: "1-20" },
  { course: "线性代数", teachers: ["教师005"], classes: ["2025级D班"], room: "B1-104", weekday: 3, ps: 5, pe: 6, weeks: "1-20" },
  // 设计场景：教师007 周五 1-2节@校区A（1-9周）后 3-4节@校区B 跨校区赶场
  { course: "数据库基础", teachers: ["教师007"], classes: ["2025级D班"], room: "B1-104", weekday: 5, ps: 3, pe: 4, weeks: "1-20" },
  { course: "大学英语A", teachers: ["教师002"], classes: ["2025级D班"], room: "B1-106", weekday: 1, ps: 5, pe: 6, weeks: "1-20" },
  // 设计场景：艺术鉴赏仅双周（演示用户001 的选修课）
  { course: "通识选修·艺术鉴赏", teachers: ["教师006"], classes: ["2025级D班"], room: "B1-105", weekday: 5, ps: 9, pe: 10, weeks: "2,4,6,8,10,12,14,16,18,20" },
  { course: "大学体育", teachers: ["教师006"], classes: ["2025级D班"], room: "体育场馆B1", weekday: 2, ps: 5, pe: 6, weeks: "1-20" },
];

// ---------------------------------------------------------------------------
// 演示用户：2025级A班 学生 + 选修「通识选修·艺术鉴赏」
// ---------------------------------------------------------------------------
const DEMO_USERS = [
  {
    id: "demo-user-001",
    name: "演示用户001",
    visitorId: "visitor-demo-001",
    classId: "cls-2025-a",
    electiveCourseIds: ["c-16"],
    preferredCampus: "campus-a",
  },
];

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
function expandWeeks(expr) {
  const weeks = new Set();
  for (const part of String(expr).split(",")) {
    const seg = part.trim();
    const m = seg.match(/^(\d+)-(\d+)$/);
    if (m) {
      for (let w = Number(m[1]); w <= Number(m[2]); w += 1) weeks.add(w);
    } else if (/^\d+$/.test(seg)) {
      weeks.add(Number(seg));
    } else {
      throw new Error(`非法周次表达式: ${expr}`);
    }
  }
  return [...weeks].sort((a, b) => a - b);
}

function buildIndexes(dataset) {
  const byName = {};
  const register = (kind, item) => {
    byName[`${kind}:${item.name}`] = item.id;
  };
  dataset.campuses.forEach((x) => register("campus", x));
  dataset.colleges.forEach((x) => register("college", x));
  dataset.classes.forEach((x) => register("class", x));
  dataset.teachers.forEach((x) => register("teacher", x));
  dataset.courses.forEach((x) => register("course", x));
  dataset.rooms.forEach((x) => register("room", x));
  return byName;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function main() {
  const courseByName = Object.fromEntries(COURSES.map((c) => [c.name, c]));
  const teacherByName = Object.fromEntries(TEACHERS.map((t) => [t.name, t]));
  const classByName = Object.fromEntries(CLASSES.map((c) => [c.name, c]));
  const roomByName = Object.fromEntries(ROOMS.map((r) => [r.name, r]));

  const lessons = LESSON_TABLE.map((row, idx) => {
    const course = courseByName[row.course];
    const room = roomByName[row.room];
    if (!course) throw new Error(`未知课程: ${row.course}`);
    if (!room) throw new Error(`未知教室: ${row.room}`);
    const teacherIds = row.teachers.map((n) => {
      const t = teacherByName[n];
      if (!t) throw new Error(`未知教师: ${n}`);
      return t.id;
    });
    const classIds = row.classes.map((n) => {
      const c = classByName[n];
      if (!c) throw new Error(`未知班级: ${n}`);
      return c.id;
    });
    return {
      id: `les-${String(idx + 1).padStart(3, "0")}`,
      courseId: course.id,
      teacherIds,
      classIds,
      roomId: room.id,
      campusId: room.campusId,
      weekday: row.weekday,
      periodStart: row.ps,
      periodEnd: row.pe,
      weeks: row.weeks,
      weekList: expandWeeks(row.weeks),
    };
  });

  const dataset = {
    meta: {
      ...META,
      designedScenarios: [
        "fri-afternoon-ab-overlap",
        "teacher003-mon-cross-campus",
        "demo-user-fri-full-day",
        "sz-weeks-1-9",
        "art-even-weeks",
      ],
      entityCounts: {
        campuses: CAMPUSES.length,
        colleges: COLLEGES.length,
        classes: CLASSES.length,
        teachers: TEACHERS.length,
        courses: COURSES.length,
        rooms: ROOMS.length,
        lessons: lessons.length,
        demoUsers: DEMO_USERS.length,
      },
    },
    campuses: CAMPUSES,
    colleges: COLLEGES,
    classes: CLASSES,
    teachers: TEACHERS,
    courses: COURSES,
    rooms: ROOMS,
    lessons,
    demoUsers: DEMO_USERS,
    nameIndex: null,
    dataHash: null,
  };

  dataset.nameIndex = buildIndexes(dataset);

  // 数据指纹：覆盖学期、节次与核心事实。修改时间规则或课程事实都会改变哈希。
  const hash = crypto.createHash("sha1");
  hash.update(JSON.stringify({
    semester: META.semester, periods: META.periods,
    campuses: CAMPUSES, colleges: COLLEGES, classes: CLASSES,
    teachers: TEACHERS, courses: COURSES, rooms: ROOMS, lessons,
  }));
  dataset.dataHash = `sha1:${hash.digest("hex").slice(0, 12)}`;

  const outPath = path.join(__dirname, "competition-demo-v1.json");
  fs.writeFileSync(outPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  const stats = fs.statSync(outPath);
  console.log(`[ok] 生成 ${outPath}`);
  console.log(`[ok] dataVersion=${DATA_VERSION} dataHash=${dataset.dataHash} size=${stats.size}B lessons=${lessons.length}`);
}

main();
