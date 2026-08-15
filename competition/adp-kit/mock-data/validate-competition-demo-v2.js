#!/usr/bin/env node
/**
 * competition-demo-v2 匿名演示数据校验器
 *
 * 与 v1 校验器同源，但适配 v2 数据集的三校区 ID 体系
 * （campus-a/b/c、teacher-001…、class-a…f、course-01…24、room-x-yyy、lesson-NNN）：
 * 1. 结构完整：meta / 实体集合 / lessons 均存在且字段齐全
 * 2. 引用完整：lessons 引用的课程、教师、班级、教室、校区均存在
 * 3. 硬冲突白名单：v2 故意内置了供冲突工具演示的设计冲突（见 DESIGNED_CONFLICTS），
 *    除此之外不得出现任何其他教师 / 班级 / 教室硬冲突
 * 4. 周次与节次合法：1-totalWeeks、1-10、periodStart<=periodEnd
 * 5. 设计场景存在：教师003周一A→B赶场、教师009周三B→C赶场、教师005第2周冲突、
 *    A/B班周五5-6节冲突、三校区空间规划、演示用户周五满档
 * 6. 匿名性扫描：全数据不得出现真实身份词（佛山/佛大/佛课/FosuClass 等）
 * 7. 覆盖度：每个班级 >=5 条课、每名教师 >=1 条课、演示用户班级存在
 *
 * 运行：node validate-competition-demo-v2.js
 * 退出码：0 = 全部通过；1 = 存在校验失败
 */

const fs = require("fs");
const path = require("path");
const { computeDataHash } = require("./data-hash");

const DATA_PATH = path.join(__dirname, "competition-demo-v2.json");
const DAY_MS = 86400000;

// v2 数据集故意内置的硬冲突（供 compare_schedules / 态势工具演示）。
// 任何不在此表内的硬冲突都视为数据错误。
const DESIGNED_CONFLICTS = [
  "class:class-a:lesson-001:lesson-049",
  "room:room-a-102:lesson-001:lesson-049",
  "teacher:teacher-003:lesson-006:lesson-049",
  "teacher:teacher-005:lesson-053:lesson-054",
  "teacher:teacher-009:lesson-018:lesson-051",
  "teacher:teacher-009:lesson-032:lesson-052",
  "class:class-d:lesson-018:lesson-051",
  "class:class-e:lesson-044:lesson-052",
];

function expectedEndDate(startDate, totalWeeks) {
  const [year, month, day] = String(startDate).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + (Number(totalWeeks) * 7 - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`  [pass] ${name}`);
  } else {
    failures += 1;
    console.error(`  [FAIL] ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

function parseWeeks(lesson) {
  if (Array.isArray(lesson.weekList) && lesson.weekList.length) return lesson.weekList;
  const weeks = new Set();
  for (const part of String(lesson.weeks).split(",")) {
    const m = part.trim().match(/^(\d+)-(\d+)$/);
    if (m) for (let w = +m[1]; w <= +m[2]; w += 1) weeks.add(w);
    else weeks.add(+part);
  }
  return [...weeks];
}

function overlap(aPs, aPe, bPs, bPe) {
  return aPs <= bPe && bPs <= aPe;
}

function weeksOverlap(a, b) {
  const set = new Set(a);
  return b.some((w) => set.has(w));
}

function main() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  const data = JSON.parse(raw);
  const totalWeeks = data.meta.semester.totalWeeks;

  console.log("== 1. 结构完整 ==");
  ["campuses", "colleges", "classes", "teachers", "courses", "rooms", "lessons", "demoUsers"].forEach((key) => {
    check(`存在集合 ${key}`, Array.isArray(data[key]) && data[key].length > 0);
  });
  check("dataVersion 正确", data.meta.dataVersion === "competition-demo-v2");
  check("schema 标识正确", data.meta.schema === "campus-demo/v2", data.meta.schema);
  check("演示参考日期存在", /^\d{4}-\d{2}-\d{2}$/.test(data.meta.demoReferenceDate || ""));
  check("演示参考日期在学期内", data.meta.demoReferenceDate >= data.meta.semester.startDate && data.meta.demoReferenceDate <= data.meta.semester.endDate);
  check("学期标识正确", data.meta.semester.id === "2026-2027-1" && data.meta.semester.name === "2026-2027学年第一学期");
  check("学期从 2026-08-31 周一开始", data.meta.semester.startDate === "2026-08-31");
  check("学期共 20 周", data.meta.semester.totalWeeks === 20);
  check(
    "学期结束日期由 startDate + totalWeeks 自动确定",
    data.meta.semester.endDate === expectedEndDate(data.meta.semester.startDate, data.meta.semester.totalWeeks),
    `${data.meta.semester.endDate} != ${expectedEndDate(data.meta.semester.startDate, data.meta.semester.totalWeeks)}`,
  );
  check("dataHash 存在", /^sha1:[0-9a-f]{12}$/.test(data.dataHash || ""));
  check("dataHash 与 canonical dataset 一致", data.dataHash === computeDataHash(data), `${data.dataHash} != ${computeDataHash(data)}`);
  check(
    "校区恰好为 A/B/C 三校区",
    JSON.stringify(data.campuses.map((c) => c.name).sort()) === JSON.stringify(["校区A", "校区B", "校区C"]),
    data.campuses.map((c) => c.name).join(","),
  );
  check(
    "教师全部为匿名编号（教师001…）",
    data.teachers.every((t) => /^教师\d{3}$/.test(t.name) && /^teacher-\d{3}$/.test(t.id)),
  );

  console.log("== 2. 引用完整 ==");
  const courseIds = new Set(data.courses.map((x) => x.id));
  const teacherIds = new Set(data.teachers.map((x) => x.id));
  const classIds = new Set(data.classes.map((x) => x.id));
  const roomIds = new Set(data.rooms.map((x) => x.id));
  const campusIds = new Set(data.campuses.map((x) => x.id));
  const roomById = Object.fromEntries(data.rooms.map((r) => [r.id, r]));
  let refOk = true;
  for (const les of data.lessons) {
    if (!courseIds.has(les.courseId)) { refOk = false; console.error(`    ${les.id}: 未知课程 ${les.courseId}`); }
    for (const t of les.teacherIds) if (!teacherIds.has(t)) { refOk = false; console.error(`    ${les.id}: 未知教师 ${t}`); }
    for (const c of les.classIds) if (!classIds.has(c)) { refOk = false; console.error(`    ${les.id}: 未知班级 ${c}`); }
    if (!roomIds.has(les.roomId)) { refOk = false; console.error(`    ${les.id}: 未知教室 ${les.roomId}`); }
    else if (roomById[les.roomId].campusId !== les.campusId) { refOk = false; console.error(`    ${les.id}: campusId 与教室所属校区不一致`); }
    if (!campusIds.has(les.campusId)) { refOk = false; console.error(`    ${les.id}: 未知校区 ${les.campusId}`); }
  }
  check("lessons 引用全部有效", refOk);

  console.log("== 3. 硬冲突仅限设计白名单 ==");
  const groups = { teacher: new Map(), class: new Map(), room: new Map() };
  const push = (map, key, les) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(les);
  };
  for (const les of data.lessons) {
    les.teacherIds.forEach((t) => push(groups.teacher, t, les));
    les.classIds.forEach((c) => push(groups.class, c, les));
    push(groups.room, les.roomId, les);
  }
  const actualConflicts = [];
  for (const [label, map] of Object.entries(groups)) {
    for (const [key, list] of map.entries()) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i]; const b = list[j];
          if (a.weekday !== b.weekday) continue;
          if (!overlap(a.periodStart, a.periodEnd, b.periodStart, b.periodEnd)) continue;
          if (!weeksOverlap(parseWeeks(a), parseWeeks(b))) continue;
          actualConflicts.push(`${label}:${key}:${[a.id, b.id].sort().join(":")}`);
        }
      }
    }
  }
  const expected = [...DESIGNED_CONFLICTS].sort();
  const actual = actualConflicts.sort();
  check(
    "硬冲突集合与设计白名单完全一致",
    JSON.stringify(actual) === JSON.stringify(expected),
    `实际 ${actual.length} 条: ${actual.join(" | ")}`,
  );

  console.log("== 4. 周次与节次合法 ==");
  let rangeOk = true;
  for (const les of data.lessons) {
    if (les.weekday < 1 || les.weekday > 7) { rangeOk = false; console.error(`    ${les.id}: weekday=${les.weekday}`); }
    if (les.periodStart < 1 || les.periodEnd > 10 || les.periodStart > les.periodEnd) {
      rangeOk = false; console.error(`    ${les.id}: periods=${les.periodStart}-${les.periodEnd}`);
    }
    for (const w of parseWeeks(les)) {
      if (w < 1 || w > totalWeeks) { rangeOk = false; console.error(`    ${les.id}: week=${w}`); }
    }
  }
  check("weekday/periods/weeks 全部合法", rangeOk);

  console.log("== 5. 设计场景存在 ==");
  const friA = data.lessons.some((l) => l.classIds.includes("class-a") && l.weekday === 5 && overlap(l.periodStart, l.periodEnd, 5, 6));
  const friB = data.lessons.some((l) => l.classIds.includes("class-b") && l.weekday === 5 && overlap(l.periodStart, l.periodEnd, 5, 6));
  check("g01-g02-fri-overlap（A/B班 周五5-6节 均有课）", friA && friB);

  const t3Mon = data.lessons.filter((l) => l.teacherIds.includes("teacher-003") && l.weekday === 1);
  const t3Campuses = new Set(t3Mon.map((l) => l.campusId));
  check("teacher003-mon-a-to-b-rush（周一跨 A/B 两校区）", t3Campuses.has("campus-a") && t3Campuses.has("campus-b"), [...t3Campuses].join(","));

  const t9Wed = data.lessons.filter((l) => l.teacherIds.includes("teacher-009") && l.weekday === 3);
  const t9Campuses = new Set(t9Wed.map((l) => l.campusId));
  check("teacher009-wed-b-to-c-rush（周三跨 B/C 两校区）", t9Campuses.has("campus-b") && t9Campuses.has("campus-c"), [...t9Campuses].join(","));

  const t5w2 = data.lessons.filter((l) => l.teacherIds.includes("teacher-005") && parseWeeks(l).includes(2) && l.weekday === 2 && overlap(l.periodStart, l.periodEnd, 5, 6));
  check("teacher005-week2-overlap（第2周周二5-6节 双校区撞车）", t5w2.length === 2 && new Set(t5w2.map((l) => l.campusId)).size === 2);

  check(
    "three-campus-space-planning（三校区各有教室，且各有 60+ 容量教室）",
    data.campuses.every((c) => {
      const rooms = data.rooms.filter((r) => r.campusId === c.id);
      return rooms.length > 0 && rooms.some((r) => r.capacity >= 60);
    }),
  );

  const user = data.demoUsers.find((u) => u.id === "user-demo-001");
  check("演示用户 user-demo-001 存在", Boolean(user));
  if (user) {
    const userFri = data.lessons.filter((l) => l.weekday === 5 && (l.classIds.includes(user.classId) || user.electiveCourseIds.includes(l.courseId)));
    check("demo-user-friday-rich-day（周五 >=3 条课）", userFri.length >= 3, `friday=${userFri.length}`);
  }

  console.log("== 6. 匿名性扫描 ==");
  const deny = ["佛山", "佛大", "佛课", "FosuClass", "fosu", "katelya", "思囿"];
  const blob = JSON.stringify(data);
  const hit = deny.filter((w) => blob.includes(w));
  check("不含真实身份词", hit.length === 0, hit.join(",") || "");
  const pii = [
    ["邮箱", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ["手机号", /1[3-9]\d{9}/],
    ["身份证号", /\d{17}[\dXx]/],
  ];
  for (const [label, re] of pii) {
    check(`不含${label}`, !re.test(blob));
  }

  console.log("== 7. 覆盖度 ==");
  for (const cls of data.classes) {
    const count = data.lessons.filter((l) => l.classIds.includes(cls.id)).length;
    check(`${cls.name} 课次 ${count} >= 5`, count >= 5);
  }
  for (const t of data.teachers) {
    const count = data.lessons.filter((l) => l.teacherIds.includes(t.id)).length;
    check(`${t.name} 课次 ${count} >= 1`, count >= 1);
  }
  if (user) check("演示用户班级存在", classIds.has(user.classId));

  console.log("");
  if (failures > 0) {
    console.error(`[RESULT] 校验失败 ${failures} 项`);
    process.exit(1);
  }
  console.log(`[RESULT] 全部校验通过（lessons=${data.lessons.length}）`);
}

main();
