const assert = require("assert");
const {
  buildImportPreview,
  inferClassName,
  normalizeScheduleRows,
  parseSections,
  parseWeekday,
  parseWeeks,
} = require("../server/src/utils/studentScheduleRowParser");

function testParseWeeks() {
  assert.deepStrictEqual(parseWeeks("1-16"), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.deepStrictEqual(parseWeeks("1-4,6-16"), [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepStrictEqual(parseWeeks("5-8,10-15"), [5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
  assert.deepStrictEqual(parseWeeks("11,13"), [11, 13]);
  assert.deepStrictEqual(parseWeeks(""), []);
}

function testParseWeekday() {
  assert.strictEqual(parseWeekday("星期一"), 1);
  assert.strictEqual(parseWeekday("星期二"), 2);
  assert.strictEqual(parseWeekday("星期三"), 3);
  assert.strictEqual(parseWeekday("星期四"), 4);
  assert.strictEqual(parseWeekday("星期五"), 5);
  assert.strictEqual(parseWeekday("星期六"), 6);
  assert.strictEqual(parseWeekday("星期日"), 7);
  assert.strictEqual(parseWeekday("星期天"), 7);
  assert.strictEqual(parseWeekday(""), null);
}

function testParseSections() {
  assert.deepStrictEqual(parseSections("1-2"), [1, 2]);
  assert.deepStrictEqual(parseSections("3-5"), [3, 4, 5]);
  assert.deepStrictEqual(parseSections("11-14"), [11, 12, 13, 14]);
  assert.deepStrictEqual(parseSections("8-9"), [8, 9]);
  assert.deepStrictEqual(parseSections(""), []);
}

function sampleRow(patch) {
  return Object.assign({
    "学生姓名": "王同学",
    "课程名称": "动物解剖学",
    "周次": "1-16",
    "星期几": "星期三",
    "节次": "3-4",
    "课室名称": "仙溪A101",
    "上课班级": "25动物医学6班",
    "校区": "仙溪校区",
    "特别说明": "",
  }, patch || {});
}

function testNormalizeScheduleRows() {
  const rawRows = [
    sampleRow(),
    sampleRow({ "课程名称": "线上通识课", "课室名称": "", "特别说明": "线上课程" }),
    sampleRow({ "课程名称": "劳动教育", "周次": "" }),
    sampleRow({ "课程名称": "生产见习", "星期几": "" }),
    sampleRow({ "课程名称": "创新创业", "节次": "" }),
    sampleRow({ "课程名称": "合班课程", "上课班级": "25动物医学[1-2]班" }),
    sampleRow({ "课程名称": "动物解剖学", "星期几": "星期四", "节次": "8-9" }),
  ];
  const normalized = normalizeScheduleRows(rawRows, {
    studentId: "202512340303",
    semester: "2025-2026-2",
  });

  assert.strictEqual(normalized.scheduled.length, 4);
  assert.strictEqual(normalized.unscheduled.length, 3);
  assert.strictEqual(normalized.scheduled[0].weekday, 3);
  assert.deepStrictEqual(normalized.scheduled[0].sections, [3, 4]);
  assert.strictEqual(normalized.scheduled[1].classroom, "线上/待定");
  assert.strictEqual(normalized.unscheduled[0].reason, "缺少周次、星期或节次");
  assert.strictEqual(normalized.scheduled[3].weekday, 4);
  assert.deepStrictEqual(normalized.scheduled[3].sections, [8, 9]);
}

function testClassInferenceAndPreview() {
  const rows = [
    sampleRow(),
    sampleRow({ "课程名称": "大学英语" }),
    sampleRow({ "课程名称": "合班课程", "上课班级": "25动物医学[1-2]班" }),
  ];
  const normalized = normalizeScheduleRows(rows, { studentId: "202512340303" });
  const inferred = inferClassName(normalized.rows);
  assert.strictEqual(inferred.className, "25动物医学6班");
  assert.strictEqual(inferred.classNameConfidence, "high");

  const preview = buildImportPreview(rows, { studentId: "202512340303", semester: "当前学期" });
  assert.strictEqual(preview.profile.studentName, "王同学");
  assert.strictEqual(preview.summary.rawRowCount, 3);
  assert.strictEqual(preview.summary.scheduledCourseCount, 3);
  assert.strictEqual(preview.preview.scheduled.length, 3);
}

testParseWeeks();
testParseWeekday();
testParseSections();
testNormalizeScheduleRows();
testClassInferenceAndPreview();

console.log("test-fosu-apaas-parser passed");
