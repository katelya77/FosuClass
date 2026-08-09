/**
 * CampusTools 数据层：加载 competition-demo-v1 匿名演示数据并建立索引。
 *
 * 安全约束（比赛铁律）：
 * - 默认且仅允许读取 competition-demo-* 匿名数据集；
 * - 禁止任何“比赛接口失败后回退读取 production 真实数据”的行为；
 * - 数据文件名校验：basename 必须以 competition-demo 开头，否则拒绝加载。
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_PATH = path.join(__dirname, "..", "..", "..", "mock-data", "competition-demo-v1.json");

let cached = null;

function assertCompetitionData(filePath) {
  const base = path.basename(filePath);
  if (!/^competition-demo/.test(base)) {
    const err = new Error(`拒绝加载非比赛匿名数据文件: ${base}（仅允许 competition-demo-*）`);
    err.code = "DATA_GUARD";
    throw err;
  }
}

function loadDataset() {
  if (cached) return cached;
  const filePath = process.env.CAMPUS_DATA_PATH
    ? path.resolve(process.env.CAMPUS_DATA_PATH)
    : DEFAULT_DATA_PATH;
  assertCompetitionData(filePath);
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  const byId = {};
  for (const key of ["campuses", "colleges", "classes", "teachers", "courses", "rooms", "demoUsers"]) {
    byId[key] = Object.fromEntries(data[key].map((x) => [x.id, x]));
  }

  const idx = { teacher: new Map(), class: new Map(), room: new Map(), course: new Map() };
  for (const les of data.lessons) {
    const add = (map, id) => {
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(les);
    };
    les.teacherIds.forEach((t) => add(idx.teacher, t));
    les.classIds.forEach((c) => add(idx.class, c));
    add(idx.room, les.roomId);
    add(idx.course, les.courseId);
  }

  cached = {
    data,
    byId,
    idx,
    dataVersion: data.meta.dataVersion,
    dataHash: data.dataHash,
  };
  return cached;
}

/** 周次表达式展开（与生成器同规则） */
function expandWeeks(lesson) {
  if (Array.isArray(lesson.weekList) && lesson.weekList.length) return lesson.weekList;
  const weeks = new Set();
  for (const part of String(lesson.weeks).split(",")) {
    const m = part.trim().match(/^(\d+)-(\d+)$/);
    if (m) for (let w = +m[1]; w <= +m[2]; w += 1) weeks.add(w);
    else weeks.add(+part);
  }
  return [...weeks].sort((a, b) => a - b);
}

/**
 * 将 YYYY-MM-DD 解析为 UTC 零点时间戳。
 *
 * 这里只把 UTC 当作“无时区的日历算术容器”，避免在不同时区运行时把
 * Asia/Shanghai 的零点换算到前一天，从而造成星期与周次偏移。
 */
function parseCalendarDate(dateStr) {
  const match = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return timestamp;
}

/** 日期（YYYY-MM-DD）→ 教学周（从学期起始周一计算）；越界返回 null */
function dateToWeek(dateStr) {
  const { data } = loadDataset();
  const start = parseCalendarDate(data.meta.semester.startDate);
  const target = parseCalendarDate(dateStr);
  if (start == null || target == null) return null;
  const diffDays = Math.floor((target - start) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  if (week < 1 || week > data.meta.semester.totalWeeks) return null;
  return week;
}

/** 日期（YYYY-MM-DD）→ 星期（1=周一 … 7=周日） */
function dateToWeekday(dateStr) {
  const timestamp = parseCalendarDate(dateStr);
  if (timestamp == null) return null;
  const day = new Date(timestamp).getUTCDay();
  return day === 0 ? 7 : day;
}

/** 教学周 + 星期 → 日期（YYYY-MM-DD） */
function weekWeekdayToDate(week, weekday) {
  const { data } = loadDataset();
  const start = parseCalendarDate(data.meta.semester.startDate);
  if (start == null) return null;
  const d = new Date(start + ((week - 1) * 7 + (weekday - 1)) * 86400000);
  return d.toISOString().slice(0, 10);
}

function lessonDisplay(les) {
  const { byId, data } = loadDataset();
  const course = byId.courses[les.courseId];
  const room = byId.rooms[les.roomId];
  const campus = byId.campuses[les.campusId];
  const periodTimes = data.meta.periods;
  return {
    lessonId: les.id,
    courseId: les.courseId,
    courseName: course ? course.name : les.courseId,
    teachers: les.teacherIds.map((t) => (byId.teachers[t] ? byId.teachers[t].name : t)),
    classes: les.classIds.map((c) => (byId.classes[c] ? byId.classes[c].name : c)),
    roomId: les.roomId,
    roomName: room ? room.name : les.roomId,
    building: room ? room.building : null,
    campusId: les.campusId,
    campusName: campus ? campus.name : les.campusId,
    weekday: les.weekday,
    weekdayName: data.meta.weekdayNames[les.weekday - 1],
    periodStart: les.periodStart,
    periodEnd: les.periodEnd,
    periodText: `第${les.periodStart}-${les.periodEnd}节`,
    startTime: periodTimes[les.periodStart - 1] ? periodTimes[les.periodStart - 1].start : null,
    endTime: periodTimes[les.periodEnd - 1] ? periodTimes[les.periodEnd - 1].end : null,
    weeks: les.weeks,
  };
}

module.exports = {
  loadDataset,
  expandWeeks,
  dateToWeek,
  dateToWeekday,
  weekWeekdayToDate,
  lessonDisplay,
  parseCalendarDate,
};
