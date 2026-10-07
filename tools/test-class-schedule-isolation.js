const assert = require("node:assert/strict");
const { test } = require("node:test");
const parser = require("../server/src/utils/parser");
const normalizer = require("../server/src/utils/scheduleNormalizer");

const context = {
  semester: "2026-2027-1", collegeCode: "23", collegeName: "测试学院",
  grade: "2026", majorCode: "bio", majorName: "生物工程",
};
function course(courseName, classNames = [], extra = {}) {
  return Object.assign({
    courseName, classNames, weekday: 1, startSection: 3, endSection: 4,
    weeks: [6, 7], teacherName: "测试教师", classroom: "C7-118",
  }, extra);
}

test("专业导论课程不能使两个真实班级退化为专业聚合", () => {
  const courses = [course("生物工程导论", ["26生物工程1"]), course("普通化学A", ["26生物工程2"])];
  const entries = normalizer.buildClassScheduleEntries(courses, context);
  assert.deepEqual(entries.map(s => s.className), ["26生物工程1班", "26生物工程2班"]);
  assert.deepEqual(entries.map(s => s.courses.map(c => c.courseName)), [["生物工程导论"], ["普通化学A"]]);
});

test("英语、化学等专业名与课程关键词相同仍是行政班", () => {
  for (const majorName of ["园艺", "英语", "材料化学", "物理学", "护理学", "法学", "自动化", "微电子科学与工程"]) {
    const courses = [course(`${majorName}概论`, [`26${majorName}1`]), course("大学英语1", [`26${majorName}2`])];
    const entries = normalizer.buildClassScheduleEntries(courses, { ...context, majorName });
    assert.equal(entries.filter(s => !s.isAggregated).length, 2, majorName);
  }
});

test("归属不明的课程独立保留，不能复制进每一个班级", () => {
  const courses = [course("普通化学A", ["26生物工程1"]), course("实验课程", ["26生物工程2"]), course("归属待核实课程")];
  const entries = normalizer.buildClassScheduleEntries(courses, context);
  assert.deepEqual(entries.filter(s => !s.isAggregated).map(s => s.courses.length), [1, 1]);
  assert.equal(entries.find(s => s.isAggregated).courses[0].courseName, "归属待核实课程");
  assert.equal(entries.find(s => s.isAggregated).courses[0].sharedByMajor, undefined);
});

test("只有显式合班证据才可把同一课程列入两个班", () => {
  const entries = normalizer.buildClassScheduleEntries([course("高等数学B1", ["26生物工程1", "26生物工程2"])], context);
  assert.equal(entries.length, 2);
  assert.ok(entries.every(s => !s.isAggregated && s.courses.length === 1));
});

test("100网两行不同课程经解析和规范化后保持班级隔离", () => {
  const html = '<table id="kbtable"><tr><th>班级</th><th>星期一</th></tr>' +
    '<tr><td>26生物工程1</td><td>生物工程导论<br>测试教师甲<br>6-7周<br>C7-118[03-04]节</td></tr>' +
    '<tr><td>26生物工程2</td><td>普通化学A<br>测试教师乙<br>6-7周<br>C7-203[03-04]节</td></tr></table>';
  const parsed = parser.parseClassScheduleIfrHtml(html, context);
  assert.deepEqual(parsed.courses.map(c => c.classNames), [["26生物工程1"], ["26生物工程2"]]);
  const entries = normalizer.buildClassScheduleEntries(normalizer.normalizeCourseList(parsed.courses, context), context);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(s => s.courses.map(c => c.teacherName)), [["测试教师甲"], ["测试教师乙"]]);
});

test("班名必须属于当前年级专业，不能靠专业名前两个字模糊匹配", () => {
  assert.equal(normalizer.isReliableClassName("25生物工程1", context), false);
  assert.equal(normalizer.isReliableClassName("26生物学1", context), false);
  assert.equal(normalizer.isReliableClassName("大学英语1", context), false);
  assert.equal(normalizer.isReliableClassName("26大学英语1", context), false);
  assert.equal(normalizer.isReliableClassName("26法学4", { ...context, majorName: "法学（涉外法治人才实验班）" }), true);
});

test("旧专业聚合按保留的课程班级证据恢复，并且可重复修复", () => {
  const old = [{ ...context, className: "2026级生物工程专业课表", isAggregated: true, displayType: "major-schedule", classId: "old-aggregate",
    courses: [course("生物工程导论", ["26生物工程1"], { className: "2026级生物工程专业课表", originalClassName: "26生物工程1", sourceClassNameUnreliable: true }),
      course("普通化学A", ["26生物工程2"], { className: "2026级生物工程专业课表", originalClassName: "26生物工程2", sourceClassNameUnreliable: true })] }];
  assert.equal(normalizer.validateClassScheduleIsolation(old).length, 1);
  const repaired = normalizer.repairClassScheduleEntries(old);
  assert.deepEqual(repaired.map(s => s.className), ["26生物工程1班", "26生物工程2班"]);
  assert.ok(repaired.every(s => !s.classId && !s.isAggregated && !s.courses[0].sourceClassNameUnreliable));
  assert.deepEqual(normalizer.repairClassScheduleEntries(repaired), repaired);
  assert.deepEqual(normalizer.validateClassScheduleIsolation(repaired), []);
});

test("旧版复制到多个班的未知课程迁出，原始课程证据不丢失", () => {
  const unresolved = course("待核实课程", [], { id: "unknown", className: "26生物工程1班", originalClassName: "", sourceClassNameUnreliable: true, sharedByMajor: true });
  const old = [1, 2].map(no => ({ ...context, className: `26生物工程${no}班`, isAggregated: false, displayType: "class-schedule",
    courses: [course(`班${no}课程`, [`26生物工程${no}`]), { ...unresolved, className: `26生物工程${no}班` }] }));
  const repaired = normalizer.repairClassScheduleEntries(old);
  assert.deepEqual(repaired.filter(s => !s.isAggregated).map(s => s.courses.length), [1, 1]);
  assert.equal(repaired.find(s => s.isAggregated).courses.length, 1);
  assert.deepEqual(normalizer.validateClassScheduleIsolation(repaired), []);
  assert.deepEqual(normalizer.repairClassScheduleEntries(repaired), repaired);
});

test("无班级证据的旧表仍保留待核实，禁止按专业伪造行政班", () => {
  const repaired = normalizer.repairClassScheduleEntries([{ ...context, className: "2026级生物工程专业课表", isAggregated: true,
    courses: [course("普通化学A")] }]);
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].isAggregated, true);
  assert.equal(repaired[0].classAssignmentStatus, "unresolved");
});

test("发布校验不能用展示班名掩盖一班包含二班课程", () => {
  const misplaced = [{ ...context, className: "26生物工程1班", displayType: "class-schedule",
    courses: [course("普通化学A", ["26生物工程2"], { className: "26生物工程1班" })] }];
  assert.equal(normalizer.validateClassScheduleIsolation(misplaced).length, 1);
});

test("只提供全角数字班名的课程也能归入对应班级", () => {
  const entries = normalizer.buildClassScheduleEntries([course("普通化学A", [], { className: "２６生物工程１" })], context);
  assert.equal(entries[0].className, "26生物工程1班");
  assert.equal(entries[0].isAggregated, false);
});

test("离线修复工具保留课程证据，且拒绝覆盖源文件或已有输出", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const { spawnSync } = require("node:child_process");
  const { repairDocument } = require("./repair-class-schedules");
  const document = { type: "classSchedules", items: [{ ...context, isAggregated: true,
    className: "2026级生物工程专业课表", courses: [course("生物工程导论", ["26生物工程1"]), course("普通化学A", ["26生物工程2"])] }] };
  const repaired = repairDocument(document);
  assert.equal(repaired.report.missingCourseEvidenceCount, 0);
  assert.equal(repaired.report.after.administrativeClasses, 2);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-class-repair-cli-"));
  const source = path.join(temp, "source.json");
  const output = path.join(temp, "repaired.json");
  const report = path.join(temp, "report.json");
  const bytes = JSON.stringify(document);
  fs.writeFileSync(source, bytes);
  try {
    const cli = path.join(__dirname, "repair-class-schedules.js");
    const args = [cli, `--input=${source}`, `--output=${output}`, `--report=${report}`];
    assert.equal(spawnSync(process.execPath, args).status, 0);
    assert.equal(spawnSync(process.execPath, args).status, 1);
    assert.equal(spawnSync(process.execPath, [cli, `--input=${source}`, `--output=${source}`, `--report=${report}`]).status, 1);
    assert.equal(fs.readFileSync(source, "utf8"), bytes);
  } finally {
    const relative = path.relative(os.tmpdir(), path.resolve(temp));
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(temp).startsWith("fosu-class-repair-cli-"));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
