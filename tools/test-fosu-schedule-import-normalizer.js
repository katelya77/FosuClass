const assert = require("assert");
const {
  buildScheduleImportPreview,
  isClassScopeMatch,
  parseClassScope,
} = require("../server/src/services/scheduleImportNormalizer");

function row(patch) {
  return Object.assign({
    "学生姓名": "王同学",
    "课程名称": "动物解剖学",
    "周次": "1-16",
    "星期几": "星期一",
    "节次": "1-2",
    "课室名称": "C3-101",
    "上课班级": "25动物医学6班",
    "校区": "仙溪校区",
    "特别说明": "",
  }, patch || {});
}

function localCourse(patch) {
  return Object.assign({
    courseName: "动物解剖学",
    teacherName: "李老师",
    classroom: "C3-101",
    weekday: 1,
    sections: [1, 2],
    weeks: Array.from({ length: 16 }, (_, index) => index + 1),
  }, patch || {});
}

function allArrangements(preview) {
  return preview.courseGroups.flatMap((group) => group.arrangements);
}

function testClassScopeParser() {
  assert.strictEqual(isClassScopeMatch(parseClassScope("25动物医学6班"), "25动物医学6班"), "match");
  assert.strictEqual(isClassScopeMatch(parseClassScope("25动物医学[1-6]班"), "25动物医学6班"), "match");
  assert.strictEqual(isClassScopeMatch(parseClassScope("25动物医学[1-5]班"), "25动物医学6班"), "not_match");
  assert.strictEqual(isClassScopeMatch(parseClassScope("25动物科学3班"), "25动物医学6班"), "not_match");
  assert.strictEqual(isClassScopeMatch(parseClassScope("25动物科学[1-3]班"), "25动物医学6班"), "not_match");
  assert.strictEqual(isClassScopeMatch(parseClassScope("25动物医学[1-2]班,25动物医学6班"), "25动物医学6班"), "match");
  assert.strictEqual(isClassScopeMatch(parseClassScope("临班211"), "25动物医学6班"), "unknown");
  assert.strictEqual(isClassScopeMatch(parseClassScope(""), "25动物医学6班"), "unknown");
}

function testGroupingAndDedupe() {
  const preview = buildScheduleImportPreview([
    row({ "课程名称": "大学英语2(跨文化交流英语)", "周次": "1-8", "星期几": "星期一", "节次": "1-2", "课室名称": "A101", "上课班级": "25动物医学[1-6]班" }),
    row({ "课程名称": "大学英语2(跨文化交流英语)", "周次": "1-8", "星期几": "星期一", "节次": "1-2", "课室名称": "A101", "上课班级": "25动物医学[1-6]班" }),
    row({ "课程名称": "大学英语2(跨文化交流英语)", "周次": "1-8", "星期几": "星期一", "节次": "1-2", "课室名称": "A101", "上课班级": "25动物医学6班" }),
    row({ "课程名称": "大学英语2(跨文化交流英语)", "周次": "9-16", "星期几": "星期三", "节次": "3-4", "课室名称": "A102", "上课班级": "25动物医学[1-6]班" }),
  ], {
    studentId: "202512340303",
    semester: "2025-2026-2",
    existingSelectedClassName: "25动物医学6班",
  });

  assert.strictEqual(preview.courseGroups.length, 1);
  assert.strictEqual(preview.courseGroups[0].arrangements.length, 2);
  assert.strictEqual(preview.summary.duplicateMergedCount, 2);
}

function testRecommendationsAndLocalTeacherFill() {
  const preview = buildScheduleImportPreview([
    row(),
    row({ "课程名称": "动物科学概论", "上课班级": "25动物科学3班", "课室名称": "C3-202", "星期几": "星期二", "节次": "3-4" }),
    row({ "课程名称": "劳动教育", "周次": "", "星期几": "", "节次": "", "课室名称": "", "特别说明": "线上课程", "上课班级": "临班211" }),
    row({ "课程名称": "高分子化学（在线课程）", "课室名称": "", "特别说明": "线上", "上课班级": "25动物医学6班", "星期几": "星期四", "节次": "5-6" }),
  ], {
    studentId: "202512340303",
    semester: "2025-2026-2",
    existingSelectedClassName: "25动物医学6班",
    localCourses: [localCourse()],
  });

  const arrangements = allArrangements(preview);
  const anatomy = arrangements.find((item) => item.courseName === "动物解剖学");
  const science = arrangements.find((item) => item.courseName === "动物科学概论");
  const labor = arrangements.find((item) => item.courseName === "劳动教育");
  const online = arrangements.find((item) => item.courseName.includes("在线课程"));

  assert.strictEqual(anatomy.importDecision, "auto_include");
  assert.strictEqual(anatomy.matchStatus, "exact_match");
  assert.strictEqual(anatomy.teacherName, "李老师");
  assert.strictEqual(science.importDecision, "suspected_not_mine");
  assert.strictEqual(labor.importDecision, "unscheduled");
  assert.strictEqual(online.importDecision, "needs_confirm");
}

function testPreviewGridAndConflicts() {
  const preview = buildScheduleImportPreview([
    row({ "课程名称": "第16周课程", "周次": "16", "星期几": "星期一", "节次": "1-2", "课室名称": "B101" }),
    row({ "课程名称": "第9周课程", "周次": "9", "星期几": "星期二", "节次": "3-4", "课室名称": "B102" }),
    row({ "课程名称": "第16周冲突课", "周次": "16", "星期几": "星期一", "节次": "1-2", "课室名称": "B103" }),
    row({ "课程名称": "未排入课程", "周次": "", "星期几": "", "节次": "", "课室名称": "" }),
  ], {
    studentId: "202512340303",
    existingSelectedClassName: "25动物医学6班",
    currentPreviewWeek: 16,
  });

  assert(preview.previewGrid.cells.some((item) => item.courseName === "第16周课程"));
  assert(!preview.previewGrid.cells.some((item) => item.courseName === "第9周课程"));
  assert(!preview.previewGrid.cells.some((item) => item.courseName === "未排入课程"));
  assert(preview.previewGrid.cells.some((item) => item.conflict));
  assert(preview.summary.conflictCount >= 1);

  const week9 = require("../server/src/services/scheduleImportNormalizer")
    .buildPreviewGrid(allArrangements(preview), 9);
  assert(week9.cells.some((item) => item.courseName === "第9周课程"));
  assert(!week9.cells.some((item) => item.courseName === "第16周课程"));
}

testClassScopeParser();
testGroupingAndDedupe();
testRecommendationsAndLocalTeacherFill();
testPreviewGridAndConflicts();

console.log("test-fosu-schedule-import-normalizer passed");
