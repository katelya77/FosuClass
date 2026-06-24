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

function asciiRow(patch) {
  return Object.assign({
    studentName: "Wang",
    courseName: "Anatomy",
    weekText: "1-16",
    weekdayText: "1",
    sectionText: "1-2",
    roomName: "C3-101",
    className: "25动物医学6班",
    campus: "Xianxi",
    specialNote: "",
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

function testSelectedClassPriorityAndNewBuckets() {
  const preview = buildScheduleImportPreview([
    asciiRow({ courseName: "Foreign class A", className: "25动物科学3班" }),
    asciiRow({ courseName: "Foreign class B", className: "25动物科学3班", weekdayText: "2", sectionText: "3-4" }),
    asciiRow({ courseName: "Mine", className: "25动物医学6班", weekdayText: "3", sectionText: "5-6" }),
    asciiRow({ courseName: "Online safety", className: "25动物医学6班", specialNote: "线上", weekdayText: "4", sectionText: "7-8" }),
    asciiRow({ courseName: "Unplaced practice", className: "临班211", weekText: "", weekdayText: "", sectionText: "", roomName: "" }),
  ], {
    studentId: "202512340303",
    semester: "2025-2026-2",
    existingSelectedClassName: "25动物医学6班",
  });

  assert.strictEqual(preview.profile.className, "25动物医学6班");
  assert.strictEqual(preview.profile.classNameSource, "selected_class");
  assert(preview.buckets.recommended.length >= 1, "recommended bucket should exist");
  assert(preview.buckets.pending.length >= 1, "pending bucket should include online/irregular courses");
  assert(preview.buckets.unplaced.length >= 1, "unplaced bucket should include courses without fixed time");
  assert(preview.buckets.suspected.length >= 1, "suspected bucket should include non-target class courses");
  assert.strictEqual(preview.groups.autoInclude.length, preview.buckets.recommended.length);
  assert.strictEqual(preview.groups.needsConfirm.length, preview.buckets.pending.length);
  assert.strictEqual(preview.groups.unscheduled.length, preview.buckets.unplaced.length);
  assert.strictEqual(preview.groups.suspectedNotMine.length, preview.buckets.suspected.length);
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

function testDispersedOfficialCourseRecommended() {
  const courseName = "大学生职业发展与就业指导1";
  const preview = buildScheduleImportPreview([
    row({ "课程名称": courseName, "周次": "1", "星期几": "星期一", "节次": "3-4", "课室名称": "C7-316" }),
    row({ "课程名称": courseName, "周次": "4", "星期几": "星期一", "节次": "3-4", "课室名称": "C7-316" }),
    row({ "课程名称": courseName, "周次": "6-16", "星期几": "星期一", "节次": "3-4", "课室名称": "C7-316" }),
  ], {
    studentId: "202512340303",
    semester: "2025-2026-2",
    existingSelectedClassName: "25动物医学6班",
  });

  const group = preview.courseGroups.find((item) => item.displayCourseName === courseName);
  assert(group, "dispersed career course group should exist");
  assert.strictEqual(group.importDecision, "auto_include");
  assert.strictEqual(group.arrangements.length, 3);
  assert(group.analysis.coverageCount >= 13, "coverage analysis should count unique covered weeks");
  assert(group.reason.includes("分散周次"), "group should explain dispersed week normalization");
  assert(preview.buckets.recommended.some((item) => item.displayCourseName === courseName));
  assert.strictEqual(preview.buckets.pending.some((item) => item.displayCourseName === courseName), false);
}

function testWeekendCoursesHiddenFromDefaultPreview() {
  const preview = buildScheduleImportPreview([
    row({ "课程名称": "工作日课程", "周次": "16", "星期几": "星期一", "节次": "1-2", "课室名称": "B101" }),
    row({ "课程名称": "周末课程", "周次": "16", "星期几": "星期六", "节次": "3-4", "课室名称": "B102" }),
  ], {
    studentId: "202512340303",
    existingSelectedClassName: "25动物医学6班",
    currentPreviewWeek: 16,
  });

  assert.strictEqual(preview.previewGrid.days.length, 5);
  assert(preview.previewGrid.hasWeekendCourses, "preview should expose weekend-course hint state");
  assert(preview.allArrangements.some((item) => item.courseName === "周末课程" && item.weekday === 6));
  assert(!preview.previewGrid.cells.some((item) => item.weekday > 5), "default grid should not render weekend columns or cells");
}

function testMixedGroupSplitsUnplacedArrangement() {
  const courseName = "生产见习";
  const preview = buildScheduleImportPreview([
    row({ "课程名称": courseName, "周次": "10-12", "星期几": "星期二", "节次": "8-9", "课室名称": "C7-316" }),
    row({ "课程名称": courseName, "周次": "", "星期几": "", "节次": "", "课室名称": "" }),
  ], {
    studentId: "202512340303",
    existingSelectedClassName: "25动物医学6班",
  });

  assert(preview.buckets.recommended.some((item) => item.displayCourseName === courseName && item.arrangements.length === 1));
  assert(preview.buckets.unplaced.some((item) => item.displayCourseName === courseName && item.arrangements.length === 1));
  assert.strictEqual(preview.scheduledCourses.length, 1);
  assert(preview.unscheduledCourses.some((item) => item.courseName === courseName));
}

function testSmallConflictDoesNotDemoteRecommendedCourses() {
  const preview = buildScheduleImportPreview([
    row({ "课程名称": "正式课程A", "周次": "1-16", "星期几": "星期三", "节次": "5-6", "课室名称": "B101" }),
    row({ "课程名称": "正式课程B", "周次": "10-12", "星期几": "星期三", "节次": "5-6", "课室名称": "B102" }),
  ], {
    studentId: "202512340303",
    existingSelectedClassName: "25动物医学6班",
    currentPreviewWeek: 10,
  });

  const conflicted = allArrangements(preview).filter((item) => item.conflict);
  assert.strictEqual(conflicted.length, 2);
  assert(conflicted.every((item) => item.importDecision === "auto_include"));
  assert(preview.buckets.recommended.some((item) => item.displayCourseName === "正式课程A"));
  assert(preview.buckets.recommended.some((item) => item.displayCourseName === "正式课程B"));
}

testClassScopeParser();
testGroupingAndDedupe();
testRecommendationsAndLocalTeacherFill();
testSelectedClassPriorityAndNewBuckets();
testPreviewGridAndConflicts();
testDispersedOfficialCourseRecommended();
testWeekendCoursesHiddenFromDefaultPreview();
testMixedGroupSplitsUnplacedArrangement();
testSmallConflictDoesNotDemoteRecommendedCourses();

console.log("test-fosu-schedule-import-normalizer passed");
