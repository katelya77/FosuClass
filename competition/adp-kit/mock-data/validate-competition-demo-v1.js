#!/usr/bin/env node
/**
 * competition-demo-v1 匿名演示数据校验器
 *
 * 校验 competition-demo-v1.json 的结构与自洽性：
 * 1. 结构完整：meta / 实体集合 / lessons 均存在且字段齐全
 * 2. 引用完整：lessons 引用的课程、教师、班级、教室、校区均存在
 * 3. 无硬冲突：同一教师 / 班级 / 教室 在同一星期、周次重叠、节次重叠时不允许撞车
 * 4. 周次与节次合法：1-totalWeeks、1-10、periodStart<=periodEnd
 * 5. 设计场景存在：周五A/B冲突、教师003跨校区、演示用户周五全天、思政1-9周、艺术鉴赏双周
 * 6. 匿名性扫描：全数据不得出现真实身份词（佛山/佛大/佛课/FosuClass 等）
 * 7. 覆盖度：每个班级 >=5 条课、每名教师 >=1 条课、演示用户班级存在
 *
 * 运行：node validate-competition-demo-v1.js
 * 退出码：0 = 全部通过；1 = 存在校验失败
 */

const fs = require("fs");
const path = require("path");
const { computeDataHash } = require("./data-hash");

const DATA_PATH = path.join(__dirname, "competition-demo-v1.json");
const DAY_MS = 86400000;

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
  check("dataVersion 正确", data.meta.dataVersion === "competition-demo-v1");
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

  console.log("== 3. 无硬冲突（教师/班级/教室） ==");
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
  for (const [label, map] of Object.entries(groups)) {
    let conflict = null;
    for (const [key, list] of map.entries()) {
      for (let i = 0; i < list.length && !conflict; i += 1) {
        for (let j = i + 1; j < list.length && !conflict; j += 1) {
          const a = list[i]; const b = list[j];
          if (a.weekday !== b.weekday) continue;
          if (!overlap(a.periodStart, a.periodEnd, b.periodStart, b.periodEnd)) continue;
          if (!weeksOverlap(parseWeeks(a), parseWeeks(b))) continue;
          conflict = `${key}: ${a.id} 与 ${b.id} 在周${a.weekday} ${a.periodStart}-${a.periodEnd}节 撞车`;
        }
      }
      if (conflict) break;
    }
    check(`${label} 无硬冲突`, !conflict, conflict || "");
  }

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
  const friOverlapA = data.lessons.some((l) => l.classIds.includes("cls-2025-a") && l.weekday === 5 && overlap(l.periodStart, l.periodEnd, 5, 6) && parseWeeks(l).includes(10));
  const friOverlapB = data.lessons.some((l) => l.classIds.includes("cls-2025-b") && l.weekday === 5 && overlap(l.periodStart, l.periodEnd, 5, 6) && parseWeeks(l).includes(10));
  check("fri-afternoon-ab-overlap（A/B班 周五5-6节 均有课）", friOverlapA && friOverlapB);

  const t3Mon = data.lessons.filter((l) => l.teacherIds.includes("t-003") && l.weekday === 1);
  const t3Campuses = new Set(t3Mon.map((l) => l.campusId));
  check("teacher003-mon-cross-campus（周一跨两校区）", t3Campuses.size === 2, [...t3Campuses].join(","));

  const user = data.demoUsers.find((u) => u.id === "demo-user-001");
  const userFri = data.lessons.filter((l) => l.weekday === 5 && (l.classIds.includes(user.classId) || user.electiveCourseIds.includes(l.courseId)));
  check("demo-user-fri-full-day（周五含必修+双周晚课）", userFri.length >= 2 && userFri.some((l) => l.courseId === "c-16"));

  const sz = data.lessons.filter((l) => l.courseId === "c-08");
  check("sz-weeks-1-9（思政通识止于第9周）", sz.length > 0 && sz.every((l) => Math.max(...parseWeeks(l)) === 9));

  const art = data.lessons.filter((l) => l.courseId === "c-16");
  check("art-even-weeks（艺术鉴赏全部在双周）", art.length > 0 && art.every((l) => parseWeeks(l).every((w) => w % 2 === 0)));

  console.log("== 6. 匿名性扫描 ==");
  const deny = ["佛山", "佛大", "佛课", "FosuClass", "fosu", "katelya", "思囿"];
  const blob = JSON.stringify(data);
  const hit = deny.filter((w) => blob.includes(w));
  check("不含真实身份词", hit.length === 0, hit.join(",") || "");

  console.log("== 7. 覆盖度 ==");
  for (const cls of data.classes) {
    const count = data.lessons.filter((l) => l.classIds.includes(cls.id)).length;
    check(`${cls.name} 课次 ${count} >= 5`, count >= 5);
  }
  for (const t of data.teachers) {
    const count = data.lessons.filter((l) => l.teacherIds.includes(t.id)).length;
    check(`${t.name} 课次 ${count} >= 1`, count >= 1);
  }
  check("演示用户班级存在", classIds.has(user.classId));

  console.log("");
  if (failures > 0) {
    console.error(`[RESULT] 校验失败 ${failures} 项`);
    process.exit(1);
  }
  console.log(`[RESULT] 全部校验通过（lessons=${data.lessons.length}）`);
}

main();
