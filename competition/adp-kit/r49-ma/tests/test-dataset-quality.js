"use strict";
// R50.0 T5 — dataset-quality test + coverage report
// 对 competition-demo-v3.json（175 课次匿名数据集）做数据质量断言 + 覆盖度报告：
//   T5.1 确定性重建（generator 重建 == 提交 JSON，seeded byte-stable）
//   T5.2 dataHash 与 canonical 重算一致、重建后 hash 稳定
//   T5.3 周次表达多样性（§5.4：连续/分段/单双周/枚举/跨周不规则）
//   T5.4 前四周高数据密度（§5.1）
//   T5.5 教室-课程模型完整（§5.5）
//   T5.6 campusTravelMatrix（§5.6）
//   T5.7 designed scenarios 可观测（§5.7）
//   T5.8 覆盖度报告 + 结构性断言
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const MOCK_DATA = path.join(__dirname, "..", "..", "mock-data");

const dataset = JSON.parse(
  fs.readFileSync(path.join(MOCK_DATA, "competition-demo-v3.json"), "utf8")
);
const generator = require(path.join(MOCK_DATA, "generate-competition-demo-v3.js"));
const computeDataHash = require(path.join(MOCK_DATA, "data-hash.js")).computeDataHash;

const lessons = dataset.lessons;
const campuses = dataset.campuses;
const colleges = dataset.colleges;
const classes = dataset.classes;
const teachers = dataset.teachers;
const courses = dataset.courses;
const rooms = dataset.rooms;
const matrix = (dataset.campusTravelMatrix || {}).matrix || {};
const periodTime = Object.fromEntries((dataset.meta.periods || []).map((p) => [p.period, p]));

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function regenerate() {
  return generator.buildDataset(generator.buildLessons(generator.resolveRooms()));
}

test("T5.1 确定性重建：generator 重建 == 提交 JSON（seeded byte-stable）", () => {
  assert.strictEqual(
    JSON.stringify(regenerate()),
    JSON.stringify(dataset),
    "重新生成的数据集必须与提交的 competition-demo-v3.json 逐字节一致"
  );
});

test("T5.2 dataHash 一致 + 重建后 hash 稳定", () => {
  assert.match(dataset.meta.dataHash, /^sha1:[0-9a-f]{12}$/);
  assert.strictEqual(dataset.meta.dataHash, computeDataHash(dataset));
  assert.strictEqual(regenerate().meta.dataHash, dataset.meta.dataHash);
});

test("T5.3 周次表达多样性（§5.4 必须真实生成）", () => {
  const exprs = new Set(lessons.map((l) => l.weeks));
  const has = (re) => [...exprs].some((w) => re.test(w));
  assert.ok(has(/^1-16$/), "缺连续整学期 1-16");
  assert.ok(has(/^1-8$/), "缺前半段 1-8");
  assert.ok(has(/^9-16$/), "缺后半段 9-16");
  assert.ok(has(/\(单\)$/), "缺单周课程");
  assert.ok(has(/\(双\)$/), "缺双周课程");
  assert.ok(has(/^\d+-\d+,\d+-\d+$/), "缺跨周不规则（如 1-4,7-10）");
  assert.ok(has(/^\d+,\d+(,\d+)*$/), "缺枚举周次（如 2,4,6,8）");
  // 枚举周次展开抽查
  const enumLesson = lessons.find((l) => /^\d+,\d+(,\d+)*$/.test(l.weeks));
  assert.ok(enumLesson, "应有枚举周次课次");
  assert.deepStrictEqual(enumLesson.weekList, [2, 4, 6, 8], "枚举周次展开应等于 2,4,6,8");
});

test("T5.3b expandWeeks 各表达解析正确", () => {
  assert.deepStrictEqual(generator.expandWeeks("1-16(单)"), [1, 3, 5, 7, 9, 11, 13, 15]);
  assert.deepStrictEqual(generator.expandWeeks("2,4,6,8"), [2, 4, 6, 8]);
  assert.deepStrictEqual(generator.expandWeeks("1-4,7-10"), [1, 2, 3, 4, 7, 8, 9, 10]);
  assert.deepStrictEqual(generator.expandWeeks("1-8(双)"), [2, 4, 6, 8]);
  assert.deepStrictEqual(generator.expandWeeks("1-16"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});

test("T5.4 前四周高数据密度（§5.1 排名/风险/利用率/共同空闲/调课/群体规划素材丰富）", () => {
  const week1 = lessons.filter((l) => l.weekList.includes(1));
  const weeks14 = lessons.filter((l) => l.weekList.some((w) => w >= 1 && w <= 4));
  assert.ok(week1.length >= 80, `第1周有课课次过少: ${week1.length}/175`);
  assert.ok(weeks14.length >= 100, `前4周有课课次过少: ${weeks14.length}/175`);
});
test("T5.5 教室与课程模型完整（§5.5）", () => {
  for (const r of rooms) {
    assert.ok(Number.isInteger(r.capacity) && r.capacity > 0, `${r.id} capacity 非法`);
    assert.ok(typeof r.type === "string" && r.type.length > 0, `${r.id} type 非法`);
    assert.ok(Array.isArray(r.features), `${r.id} features 缺失`);
  }
  for (const c of courses) {
    assert.ok(Array.isArray(c.requiredFeatures), `${c.id} requiredFeatures 缺失`);
    assert.ok(Number.isInteger(c.expectedSize) && c.expectedSize > 0, `${c.id} expectedSize 非法`);
    assert.ok(typeof c.courseType === "string" && c.courseType.length > 0, `${c.id} courseType 缺失`);
  }
  // 课程要求的 feature 必须存在于至少一间教室，否则容量筛选/调课/群体规划永远无法满足
  const featureVocab = new Set(rooms.flatMap((r) => r.features));
  const requiredVocab = new Set(courses.flatMap((c) => c.requiredFeatures));
  for (const f of requiredVocab) {
    assert.ok(featureVocab.has(f), `课程要求 feature ${f} 不在任何教室词表内`);
  }
  assert.ok(featureVocab.size >= 5, `features 词表过窄（${featureVocab.size}），不足支撑 feature 筛选/不匹配样例`);
  assert.ok(requiredVocab.size >= 3, `requiredFeatures 词表过窄（${requiredVocab.size}）`);
});

test("T5.6 campusTravelMatrix（§5.6：分钟、对称、两两可达）", () => {
  const ids = campuses.map((c) => c.id).sort();
  assert.deepStrictEqual(ids, ["campus-a", "campus-b", "campus-c", "campus-d"]);
  assert.strictEqual(dataset.campusTravelMatrix.unit, "minutes");
  for (const a of ids) {
    assert.ok(matrix[a], `matrix 缺 ${a} 行`);
    for (const b of ids) {
      if (a === b) {
        const v = matrix[a][b];
        assert.ok(v === undefined || v === 0, `对角线 ${a}->${a} 应为 0`);
        continue;
      }
      const v = matrix[a][b];
      assert.ok(Number.isInteger(v) && v > 0, `matrix[${a}][${b}] 缺失或非法`);
      assert.strictEqual(matrix[b][a], v, `matrix 不对称 ${a}/${b}`);
    }
  }
});

test("T5.7 designed scenarios 可观测（§5.7）", () => {
  // 场景锚点 g01~g20 齐全
  const gids = dataset.meta.designedScenarios.map((g) => g.id);
  for (let i = 1; i <= 20; i++) {
    const gid = `g${String(i).padStart(2, "0")}`;
    assert.ok(gids.includes(gid), `缺 designedScenario ${gid}`);
  }
  // 硬冲突族（g01~g04）恰好白名单 4 条
  assert.deepStrictEqual(
    generator.findConflicts(lessons).sort(),
    [...generator.EXPECTED_CONFLICT_KEYS].sort()
  );

  // 跨校区衔接对（g04/g05）：同教师同日、周次重叠、跨校区
  const byTeacher = new Map();
  for (const l of lessons) {
    for (const t of l.teacherIds) {
      if (!byTeacher.has(t)) byTeacher.set(t, []);
      byTeacher.get(t).push(l);
    }
  }
  const pairs = [];
  for (const [tid, list] of byTeacher) {
    const byDay = new Map();
    for (const l of list) {
      if (!byDay.has(l.weekday)) byDay.set(l.weekday, []);
      byDay.get(l.weekday).push(l);
    }
    for (const dayList of byDay.values()) {
      const sorted = [...dayList].sort((a, b) => a.periodStart - b.periodStart);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (a.campusId === b.campusId) continue;
        if (!a.weekList.some((w) => b.weekList.includes(w))) continue;
        const gap = toMinutes(periodTime[b.periodStart].start) - toMinutes(periodTime[a.periodEnd].end);
        const travel = matrix[a.campusId][b.campusId];
        pairs.push({ tid, gap, travel, rush: gap <= travel });
      }
    }
  }
  assert.ok(pairs.length > 0, "应存在跨校区衔接对");
  assert.ok(pairs.some((p) => p.rush), "缺跨校区赶场对（g04 风格）");
  assert.ok(pairs.some((p) => !p.rush && p.gap > 0), "缺足够时间跨校区非风险对（g05 风格）");

  // 连续 4 节（g06）
  assert.ok(lessons.some((l) => l.periodEnd - l.periodStart + 1 >= 4), "缺连续4节课程（g06）");
  // 晚间课 g15（第 9 节及以后）
  assert.ok(lessons.some((l) => l.periodStart >= 9), "缺晚间课（g15）");
  // 周末课 g16（weekday>=6）
  assert.ok(lessons.some((l) => l.weekday >= 6), "缺周末课（g16）");
  // 容量分级 g13：60/100/120
  const caps = new Set(rooms.map((r) => r.capacity));
  for (const c of [60, 100, 120]) {
    assert.ok(caps.has(c), `缺 ${c} 人容量教室（g13）`);
  }
  // 高负载 g07（>=8 条）/ 低负载 g08（<=1 条）
  const load = new Map();
  for (const l of lessons) {
    for (const t of l.teacherIds) load.set(t, (load.get(t) || 0) + 1);
  }
  assert.ok(Math.max(...load.values()) >= 8, "缺高负载教师（g07，>=8 条）");
  assert.ok(Math.min(...load.values()) <= 1, "缺低负载教师（g08，<=1 条）");
});

test("T5.8 覆盖度报告 + 结构性断言", () => {
  const perCampus = new Map();
  const perClass = new Map();
  const perTeacher = new Map();
  const perCourse = new Map();
  const perRoom = new Map();
  const perWeek = new Map();
  for (const l of lessons) {
    perCampus.set(l.campusId, (perCampus.get(l.campusId) || 0) + 1);
    for (const cid of l.classIds) perClass.set(cid, (perClass.get(cid) || 0) + 1);
    for (const tid of l.teacherIds) perTeacher.set(tid, (perTeacher.get(tid) || 0) + 1);
    perCourse.set(l.courseId, (perCourse.get(l.courseId) || 0) + 1);
    perRoom.set(l.roomId, (perRoom.get(l.roomId) || 0) + 1);
    for (const w of l.weekList) perWeek.set(w, (perWeek.get(w) || 0) + 1);
  }
  // 结构性断言
  assert.strictEqual(perCampus.size, 4, "4 个校区都应有课次");
  for (const c of classes) assert.ok((perClass.get(c.id) || 0) >= 5, `${c.id} 课次 < 5`);
  for (const t of teachers) assert.ok((perTeacher.get(t.id) || 0) >= 1, `${t.id} 无课次`);
  for (const c of courses) assert.ok((perCourse.get(c.id) || 0) >= 1, `${c.id} 无课次`);
  // 教学周 1..16 全部有课（周 17-20 为复习/考试周，设计上无课）
  for (let w = 1; w <= 16; w++) {
    assert.ok((perWeek.get(w) || 0) >= 20, `教学周 ${w} 课次密度不足: ${perWeek.get(w) || 0}`);
  }
  for (let w = 17; w <= 20; w++) {
    assert.strictEqual(perWeek.get(w) || 0, 0, `周 ${w} 应为复习/考试周（无课）`);
  }
  // 覆盖度报告（console，非断言）
  const teacherLoads = [...perTeacher.values()];
  const weekLoads = [...perWeek.values()];
  const lines = [
    `lessons: ${lessons.length}`,
    `campuses: ${campuses.length} / colleges: ${colleges.length} / classes: ${classes.length}`,
    `teachers: ${teachers.length} / courses: ${courses.length} / rooms: ${rooms.length}`,
    `per-campus: ${[...perCampus.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `teacher-load min/avg/max: ${Math.min(...teacherLoads)}/${Math.round(teacherLoads.reduce((s, v) => s + v, 0) / teacherLoads.length)}/${Math.max(...teacherLoads)}`,
    `week-density min/max (1-16): ${Math.min(...weekLoads)}/${Math.max(...weekLoads)}`,
    `rooms-used: ${perRoom.size}/${rooms.length}`,
  ];
  // eslint-disable-next-line no-console
  console.log(`\n[dataset-quality coverage]\n  ` + lines.join("\n  "));
});
