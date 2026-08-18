/**
 * competition-demo-v3 匿名演示数据校验器
 *
 * 校验目标（与 R50.0-SEMANTIC-CORE-DESIGN.md §5 V3 数据契约一致）：
 * 1. 结构完整：meta / campusTravelMatrix / 实体集合 / lessons 均存在且字段齐全
 * 2. 引用完整：lessons 引用的课程、教师、班级、教室、校区均存在；教室容量>=班级规模；features 覆盖课程 requiredFeatures
 * 3. 硬冲突白名单：仅 4 条设计冲突（teacher-012 / room-a-101 / class-life-01 / teacher-019），其余硬冲突视为数据错误
 * 4. 周次与节次合法：1~20 周、1~10 节、periodStart<=periodEnd、weekList 与 weeks 表达式一致
 * 5. 设计场景存在：meta.designedScenarios 含 g01~g20；关键场景（赶场/晚间课/周末课/跨周不规则）结构性可验证
 * 6. 匿名性扫描：全量 JSON 不得出现真实身份词（佛山/佛大/佛课/FosuClass/katelya/思囿）及邮箱/手机/身份证模式
 * 7. 规模范围：班级 24~32 / 教师 36~48 / 课程 60~80 / 教室 72~96 / 课次 160~220
 * 8. 覆盖度：每个班级 >=5 条课、每名教师 >=1 条课、每门课程 >=1 条课、演示用户引用有效
 * 9. campusTravelMatrix：4 校区两两可达、对称、单位分钟、取值合法
 * 10. dataHash 与 canonical dataset 一致
 *
 * 运行：node validate-competition-demo-v3.js
 * 退出码：0 = 全部通过；1 = 存在校验失败
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { computeDataHash } = require("./data-hash");

const DATA_PATH = path.join(__dirname, "competition-demo-v3.json");
const DAY_MS = 86400000;

// V3 故意内置的 4 条硬冲突（供 compare_schedules / 调课可行性等工具演示，见 g01~g04）。
const EXPECTED_CONFLICT_KEYS = [
  "teacher:teacher-012", // g01 周二5-6 计算思维 + 信息素养
  "room:room-a-101", // g03 周四5-6 统计学 + 电路基础
  "class:class-life-01", // g02 周五5-6 普通生物学 + 生物实验
  "teacher:teacher-019", // g04 周五5-6 化学实验 + 生物实验
];

let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`  [pass] ${name}`);
  } else {
    failures += 1;
    console.error(`  [FAIL] ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

function expectedEndDate(startDate, totalWeeks) {
  const [year, month, day] = String(startDate).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + (Number(totalWeeks) * 7 - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// 解析 weeks 表达式为周集合（与生成器 expandWeeks 语义一致）
function parseWeeks(lesson) {
  if (Array.isArray(lesson.weekList) && lesson.weekList.length) return lesson.weekList;
  const out = [];
  for (const raw of String(lesson.weeks || "").split(",")) {
    const part = raw.trim();
    const odd = part.endsWith("(单)");
    const even = part.endsWith("(双)");
    const core = part.replace(/\(单\)$|\(双\)$/, "");
    const range = core.split("-").map(Number);
    if (range.length === 1) {
      if ((odd && range[0] % 2 === 1) || (!odd && !even) || (even && range[0] % 2 === 0)) out.push(range[0]);
    } else {
      for (let w = range[0]; w <= range[1]; w += 1) {
        if (odd && w % 2 === 0) continue;
        if (even && w % 2 === 1) continue;
        out.push(w);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function overlap(aPs, aPe, bPs, bPe) {
  return aPs <= bPe && bPs <= aPe;
}

function weeksOverlap(a, b) {
  const set = new Set(a);
  return b.some((w) => set.has(w));
}

function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`[FATAL] 未找到 ${DATA_PATH}，请先运行生成器`);
    process.exit(1);
  }
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  const data = JSON.parse(raw);
  const totalWeeks = data.meta.semester.totalWeeks;

  console.log("== 1. 结构完整 ==");
  ["campuses", "colleges", "classes", "teachers", "courses", "rooms", "lessons", "demoUsers"].forEach((key) => {
    check(`存在集合 ${key}`, Array.isArray(data[key]) && data[key].length > 0);
  });
  check("存在 campusTravelMatrix", data.campusTravelMatrix && data.campusTravelMatrix.matrix);
  check("dataVersion 正确", data.meta.dataVersion === "competition-demo-v3", data.meta.dataVersion);
  check("schema 标识正确", data.meta.schema === "campus-demo/v3", data.meta.schema);
  check("演示参考日期存在且在学期内", /^\d{4}-\d{2}-\d{2}$/.test(data.meta.demoReferenceDate || "") && data.meta.demoReferenceDate >= data.meta.semester.startDate && data.meta.demoReferenceDate <= data.meta.semester.endDate);
  check("学期标识正确", data.meta.semester.id === "2026-2027-1" && data.meta.semester.name === "2026-2027学年第一学期");
  check("学期从 2026-08-31 周一开始", data.meta.semester.startDate === "2026-08-31");
  check("学期共 20 周", data.meta.semester.totalWeeks === 20);
  check("学期结束日期由 startDate + totalWeeks 自动确定", data.meta.semester.endDate === expectedEndDate(data.meta.semester.startDate, data.meta.semester.totalWeeks));
  check("meta.dataHash 存在且格式合法", /^sha1:[0-9a-f]{12}$/.test(data.meta.dataHash || ""), data.meta.dataHash);
  check("dataHash 与 canonical dataset 一致", data.meta.dataHash === computeDataHash(data), `${data.meta.dataHash} != ${computeDataHash(data)}`);
  check("校区恰好为 A/B/C/D 四校区", JSON.stringify(data.campuses.map((c) => c.name).sort()) === JSON.stringify(["校区A", "校区B", "校区C", "校区D"]));
  check("教师全部为匿名编号（教师001…）", data.teachers.every((t) => /^教师\d{3}$/.test(t.name) && /^teacher-\d{3}$/.test(t.id)));
  check("班级全部为合成专业簇命名", data.classes.every((c) => /^202[45]级.+类\d{2}班$/.test(c.name) && /^class-[a-z]+-\d{2}$/.test(c.id)));
  check("rooms 均含 features[]", data.rooms.every((r) => Array.isArray(r.features) && r.features.length >= 0));
  check("courses 均含 requiredFeatures[]/expectedSize/courseType", data.courses.every((c) => Array.isArray(c.requiredFeatures) && typeof c.expectedSize === "number" && typeof c.courseType === "string"));
  check("periods 覆盖 1-10 节", data.meta.periods.length === 10 && data.meta.periods.every((p) => p.period >= 1 && p.period <= 10));

  console.log("== 2. 引用完整 ==");
  const courseIds = new Set(data.courses.map((x) => x.id));
  const teacherIds = new Set(data.teachers.map((x) => x.id));
  const classIds = new Set(data.classes.map((x) => x.id));
  const roomIds = new Set(data.rooms.map((x) => x.id));
  const campusIds = new Set(data.campuses.map((x) => x.id));
  const roomById = Object.fromEntries(data.rooms.map((r) => [r.id, r]));
  const classById = Object.fromEntries(data.classes.map((c) => [c.id, c]));
  const courseById = Object.fromEntries(data.courses.map((c) => [c.id, c]));
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

  console.log("== 3. 教室容量与 feature 覆盖 ==");
  let capOk = true;
  let featOk = true;
  for (const les of data.lessons) {
    const room = roomById[les.roomId];
    const course = courseById[les.courseId];
    for (const cid of les.classIds) {
      const cls = classById[cid];
      if (!cls) { capOk = false; continue; }
      if (room.capacity < cls.size) {
        capOk = false;
        console.error(`    ${les.id}: ${cid}(size=${cls.size}) 进 ${les.roomId}(cap=${room.capacity}) 容量不足`);
      }
    }
    if (course && !course.requiredFeatures.every((f) => room.features.includes(f))) {
      featOk = false;
      console.error(`    ${les.id}: ${les.courseId} 要求 [${course.requiredFeatures}]，${les.roomId} features=[${room.features}] 未覆盖`);
    }
  }
  check("每条 lesson 教室容量 >= 班级规模", capOk);
  check("每条 lesson 教室 features 覆盖课程 requiredFeatures", featOk);

  console.log("== 4. 硬冲突仅限设计白名单 ==");
  const keys = [];
  for (let i = 0; i < data.lessons.length; i += 1) {
    for (let j = i + 1; j < data.lessons.length; j += 1) {
      const a = data.lessons[i];
      const b = data.lessons[j];
      if (a.weekday !== b.weekday) continue;
      if (!overlap(a.periodStart, a.periodEnd, b.periodStart, b.periodEnd)) continue;
      if (!weeksOverlap(parseWeeks(a), parseWeeks(b))) continue;
      if (a.teacherIds[0] === b.teacherIds[0]) keys.push(`teacher:${a.teacherIds[0]}`);
      if (a.classIds[0] === b.classIds[0]) keys.push(`class:${a.classIds[0]}`);
      if (a.roomId === b.roomId) keys.push(`room:${a.roomId}`);
    }
  }
  const actual = keys.sort();
  const expected = [...EXPECTED_CONFLICT_KEYS].sort();
  check(
    "硬冲突恰好等于 4 条设计白名单",
    JSON.stringify(actual) === JSON.stringify(expected),
    `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  );

  console.log("== 5. 周次与节次合法 ==");
  let wkOk = true;
  for (const les of data.lessons) {
    const weeks = parseWeeks(les);
    if (weeks.length === 0) { wkOk = false; console.error(`    ${les.id}: 空周次 ${les.weeks}`); continue; }
    if (weeks.some((w) => w < 1 || w > totalWeeks)) { wkOk = false; console.error(`    ${les.id}: 周次越界 ${les.weeks}`); }
    if (les.periodStart < 1 || les.periodEnd > 10 || les.periodStart > les.periodEnd) {
      wkOk = false;
      console.error(`    ${les.id}: 节次非法 ${les.periodStart}-${les.periodEnd}`);
    }
    if (Array.isArray(les.weekList) && JSON.stringify(les.weekList) !== JSON.stringify(weeks)) {
      wkOk = false;
      console.error(`    ${les.id}: weekList 与 weeks 表达式不一致`);
    }
  }
  check("周次/节次全部合法且 weekList 一致", wkOk);

  console.log("== 6. 设计场景存在 ==");
  const scenarioIds = new Set((data.meta.designedScenarios || []).map((s) => s.id));
  const gIds = ["g01", "g02", "g03", "g04", "g05", "g06", "g07", "g08", "g09", "g10", "g11", "g12", "g13", "g14", "g15", "g16", "g17", "g18", "g19", "g20"];
  check("designedScenarios 含 g01~g20", gIds.every((g) => scenarioIds.has(g)));
  const find = (pred) => data.lessons.filter(pred);
  const hasT003Rush = find((l) => l.teacherIds[0] === "teacher-003" && l.weekday === 1 && l.periodStart === 5 && l.campusId === "campus-a").length > 0
    && find((l) => l.teacherIds[0] === "teacher-003" && l.weekday === 1 && l.periodStart === 7 && l.campusId === "campus-b").length > 0;
  const hasT030Rush = find((l) => l.teacherIds[0] === "teacher-030" && l.weekday === 3 && l.periodStart === 5 && l.campusId === "campus-c").length > 0
    && find((l) => l.teacherIds[0] === "teacher-030" && l.weekday === 3 && l.periodStart === 7 && l.campusId === "campus-d").length > 0;
  const hasEvening = data.lessons.some((l) => l.periodStart >= 9);
  const hasWeekend = data.lessons.some((l) => l.weekday >= 6);
  const hasIrregular = data.lessons.some((l) => /,/.test(l.weeks || "") && /(单|双)/.test(l.weeks || "") === false);
  const hasOddEven = data.lessons.some((l) => /\((单|双)\)$/.test(l.weeks || ""));
  const hasHighLoad = find((l) => l.teacherIds[0] === "teacher-039").length >= 8;
  const hasLowLoad = find((l) => l.teacherIds[0] === "teacher-038").length <= 1;
  check("g04 teacher-003 周一 A→B 赶场存在", hasT003Rush);
  check("g05 teacher-030 周三 C→D 赶场存在", hasT030Rush);
  check("g15 晚间课（第9节及以后）存在", hasEvening);
  check("g16 周末课（weekday>=6）存在", hasWeekend);
  check("g17 单/双周课存在", hasOddEven);
  check("g18 跨周不规则课存在", hasIrregular);
  check("g07 teacher-039 高负载（>=8 条）", hasHighLoad);
  check("g08 teacher-038 低负载（<=1 条）", hasLowLoad);

  console.log("== 7. 匿名性扫描 ==");
  const anonHits = [];
  const anonWords = ["佛山", "佛大", "佛课", "FosuClass", "katelya", "思囿"];
  for (const w of anonWords) {
    const re = new RegExp(w, "i");
    if (re.test(raw)) anonHits.push(`命中身份词:${w}`);
  }
  if (/([\w.+-]+@[\w-]+\.[\w.]+)/.test(raw)) anonHits.push("命中邮箱模式");
  if (/(1[3-9]\d{9})/.test(raw)) anonHits.push("命中手机号模式");
  if (/(\d{17}[\dXx])/.test(raw)) anonHits.push("命中身份证模式");
  check("全量数据无真实身份信息", anonHits.length === 0, anonHits.join("; "));

  console.log("== 8. 规模范围 ==");
  check("班级数 24~32", data.classes.length >= 24 && data.classes.length <= 32, data.classes.length);
  check("教师数 36~48", data.teachers.length >= 36 && data.teachers.length <= 48, data.teachers.length);
  check("课程数 60~80", data.courses.length >= 60 && data.courses.length <= 80, data.courses.length);
  check("教室数 72~96", data.rooms.length >= 72 && data.rooms.length <= 96, data.rooms.length);
  check("课次数 160~220", data.lessons.length >= 160 && data.lessons.length <= 220, data.lessons.length);

  console.log("== 9. 覆盖度 ==");
  const classCount = new Map();
  const teacherCount = new Map();
  const courseCount = new Map();
  for (const les of data.lessons) {
    for (const c of les.classIds) classCount.set(c, (classCount.get(c) || 0) + 1);
    for (const t of les.teacherIds) teacherCount.set(t, (teacherCount.get(t) || 0) + 1);
    courseCount.set(les.courseId, (courseCount.get(les.courseId) || 0) + 1);
  }
  check("每个班级 >=5 条课", data.classes.every((c) => (classCount.get(c.id) || 0) >= 5));
  check("每名教师 >=1 条课", data.teachers.every((t) => (teacherCount.get(t.id) || 0) >= 1));
  check("每门课程 >=1 条课", data.courses.every((c) => (courseCount.get(c.id) || 0) >= 1));
  const demoClassIds = new Set(data.demoUsers.flatMap((u) => u.classIds || []).filter(Boolean));
  const demoTeacherIds = new Set(data.demoUsers.map((u) => u.teacherId).filter(Boolean));
  check("演示用户引用的班级/教师有效", [...demoClassIds].every((c) => classIds.has(c)) && [...demoTeacherIds].every((t) => teacherIds.has(t)));

  console.log("== 10. campusTravelMatrix ==");
  const matrix = data.campusTravelMatrix;
  let mOk = matrix && matrix.unit === "minutes";
  const campusNames = data.campuses.map((c) => c.id);
  if (mOk) {
    for (const a of campusNames) {
      for (const b of campusNames) {
        if (a === b) continue;
        const v = matrix.matrix[a] && matrix.matrix[a][b];
        if (typeof v !== "number" || v <= 0) { mOk = false; console.error(`    ${a}->${b} 缺失或非法: ${v}`); }
        else if (matrix.matrix[b][a] !== v) { mOk = false; console.error(`    ${a}->${b} 与 ${b}->${a} 不对称`); }
      }
    }
  }
  check("campusTravelMatrix 单位分钟、对称、两两可达", mOk);

  console.log(`\n结果: ${failures === 0 ? "ALL PASS ✅" : `${failures} FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
