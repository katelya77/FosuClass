const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-class-isolation-"));
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
const releaseService = require("../server/src/services/releaseService");
const { repairClassScheduleEntries } = require("../server/src/utils/scheduleNormalizer");

function snapshot() {
  const term = "2026-2027-1";
  return {
    version: "class-isolation-test", releaseVersion: "class-isolation-test", term, semester: term,
    termStartDate: "2026-09-07", totalWeeks: 20,
    teachingCalendar: { term, termStartDate: "2026-09-07", totalWeeks: 20, weekStart: "monday", weeks: [] },
    catalog: { colleges: [{ code: "23", name: "测试学院" }] },
    majors: [{ collegeCode: "23", code: "bio", grade: "2026", name: "生物工程" }],
    classSchedules: [{ semester: term, collegeCode: "23", grade: "2026", majorCode: "bio", majorName: "生物工程",
      className: "2026级生物工程专业课表", isAggregated: true, displayType: "major-schedule",
      courses: [1, 2].map(no => ({ id: `source-${no}`, courseName: no === 1 ? "生物工程导论" : "普通化学A",
        classNames: [`26生物工程${no}`], originalClassName: `26生物工程${no}`, className: "2026级生物工程专业课表",
        weekday: 1, startSection: 3, endSection: 4, weeks: [6, 7], classroom: `C7-20${no}` })) }],
  };
}

test("Release Pack 拒绝仍可拆出行政班的错误聚合", () => {
  const validation = releaseService.validateReleaseSnapshot(snapshot());
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => /administrative classes/.test(error)));
});

test("隔离检查兼容非法条目并保留快照既有校验", () => {
  const { validateClassScheduleIsolation } = require("../server/src/utils/scheduleNormalizer");
  for (const classSchedules of [{}, [null], [{ className: "测试", courses: [null] }]]) {
    assert.doesNotThrow(() => validateClassScheduleIsolation(classSchedules));
  }
  const validation = releaseService.validateReleaseSnapshot({ ...snapshot(), classSchedules: {} });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length);
});

test("修复候选生成的索引、分片和详情使用各自班级及课程", () => {
  const repaired = snapshot();
  repaired.classSchedules = repairClassScheduleEntries(repaired.classSchedules);
  assert.equal(releaseService.validateReleaseSnapshot(repaired).valid, true);
  releaseService.writeReleaseSnapshot(repaired);
  const files = releaseService.getReleaseFiles(repaired.version);
  const index = JSON.parse(fs.readFileSync(files.classesIndexPath));
  assert.deepEqual(index.map(s => s.className), ["26生物工程1班", "26生物工程2班"]);
  assert.equal(new Set(index.map(s => s.id)).size, 2);
  for (const item of index) {
    const detail = JSON.parse(fs.readFileSync(path.join(files.classScheduleDir, `${item.id}.json`)));
    assert.equal(detail.courses.length, 1);
    assert.equal(detail.courses[0].className, item.className);
  }
  const shard = JSON.parse(fs.readFileSync(path.join(files.publicReleaseDir, "index/class/by-major/23-2026-bio.json")));
  assert.deepEqual(shard.items.map(s => s.className), index.map(s => s.className));
});

test("同步器复用旧断点缓存时，仍在生成快照前恢复分班", () => {
  const old = snapshot();
  global.SYNC_PLAN = { term: old.term, runId: "class-isolation-resume-test", mergeOldData: false };
  global.TERM_CONFIG = { term: old.term, termStartDate: old.termStartDate, totalWeeks: 20, weekStart: "monday" };
  global.CLI_PARAMS = { includeScopes: ["classSchedules"] };
  // The import is read-only; no main() or network action runs.
  const { buildSnapshot, prepareClassSchedulesForPublication } = require("./fosu-sync-client/sync");
  const repaired = prepareClassSchedulesForPublication(old.classSchedules);
  assert.equal(repaired.length, 2);
  const built = buildSnapshot(old.catalog, old.majors, old.classSchedules, null, { resources: {} });
  assert.deepEqual(built.classSchedules.map(s => s.className), ["26生物工程1班", "26生物工程2班"]);
  assert.equal(built.classSchedules[0].courses.length, 1);
  assert.equal(built.coverage.adminClassCount, 2);
  assert.equal(built.coverage.majorAggregateCount, 0);
  delete global.SYNC_PLAN;
  delete global.TERM_CONFIG;
  delete global.CLI_PARAMS;
});

test("本地 publisher 校验阻断错误聚合，不能只靠服务端拒绝", () => {
  const old = snapshot();
  const file = path.join(tempRoot, "bad-staging.json");
  fs.writeFileSync(file, JSON.stringify(old));
  const { validateStaging } = require("./fosu-publisher/publish");
  assert.throws(() => validateStaging(file, old.term), error =>
    error.code === "LOCAL_STAGING_VALIDATION_FAILED" && error.validation.errors.some(message => /administrative classes/.test(message)));
});

after(() => {
  const relative = path.relative(os.tmpdir(), path.resolve(tempRoot));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(tempRoot).startsWith("fosu-class-isolation-"));
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
