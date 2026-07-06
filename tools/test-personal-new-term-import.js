const assert = require("assert");
const XLSX = require("../server/node_modules/xlsx");
const { parsePersonalXlsBuffer, _test } = require("../server/src/utils/personal-xls-parser");

function buildNewTermWorkbook() {
  const rows = [
    ["佛山大学 李同学 学生个人课表", "", "", "", "", "", "", "", ""],
    ["学年学期：2026-2027学年第一学期", "班级：26智能科学1班", "学院：电子信息工程学院", "打印日期：2026年09月02日", "", "", "", "", ""],
    ["节次", "时间", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"],
    [
      "[03-04]节",
      "10:00-11:40",
      "课程名称：机器学习导论\n任课教师：李明 副教授\n上课周次：１－１６周\n单双周：单周\n上课地点：仙溪C7-101\n节次：０３－０４节",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "[05-06]节",
      "14:00-15:40",
      "",
      "数据科学基础\n王芳 老师\n2-8周(双)\nC1-202[05-06]节",
      "",
      "",
      "",
      "",
      "",
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "new-term");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function buildHtmlSchedule() {
  return `
    <html><body>
      <div>学年学期：2026-2027-1</div>
      <table id="kbtable">
        <tr>
          <th>节次</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th>
        </tr>
        <tr>
          <td>第一大节</td>
          <td>课程名称：HTML课程<br/>教师：周宁 讲师<br/>周次：1-4周<br/>上课地点：B2-301<br/>节次：1-2节</td>
          <td></td><td></td><td></td><td></td><td></td><td></td>
        </tr>
      </table>
    </body></html>
  `;
}

function run() {
  assert.strictEqual(_test.normalizeTermText("2026-2027学年第一学期"), "2026-2027-1");
  assert.strictEqual(_test.normalizeTermText("2025－2026 学年 第二 学期"), "2025-2026-2");
  assert.strictEqual(_test.normalizeTermText("学年学期：2027-2028-1"), "2027-2028-1");

  const xlsxResult = parsePersonalXlsBuffer(buildNewTermWorkbook(), "2026-2027-1", "2026-2027第一学期个人课表.xlsx");
  assert.strictEqual(xlsxResult.term, "2026-2027-1");
  assert.strictEqual(xlsxResult.metadata.term, "2026-2027-1");
  assert.strictEqual(xlsxResult.metadata.className, "26智能科学1班");
  assert.strictEqual(xlsxResult.metadata.printDate, "2026-09-02");
  assert.strictEqual(xlsxResult.courses.length, 2);

  const machineLearning = xlsxResult.courses.find((course) => course.courseName === "机器学习导论");
  assert(machineLearning, "labeled new-term course should be parsed");
  assert.strictEqual(machineLearning.teacherName, "李明");
  assert.strictEqual(machineLearning.classroom, "仙溪C7-101");
  assert.deepStrictEqual(machineLearning.sections, [3, 4]);
  assert.deepStrictEqual(machineLearning.weeks, [1, 3, 5, 7, 9, 11, 13, 15]);

  const dataScience = xlsxResult.courses.find((course) => course.courseName === "数据科学基础");
  assert(dataScience, "legacy line-order course should still be parsed");
  assert.strictEqual(dataScience.teacherName, "王芳");
  assert.deepStrictEqual(dataScience.sections, [5, 6]);
  assert.deepStrictEqual(dataScience.weeks, [2, 4, 6, 8]);

  const htmlResult = parsePersonalXlsBuffer(Buffer.from(buildHtmlSchedule(), "utf8"), "", "personal-schedule.html");
  assert.strictEqual(htmlResult.term, "2026-2027-1");
  assert.strictEqual(htmlResult.metadata.source, "fosu-100-print-html");
  assert.strictEqual(htmlResult.courses.length, 1);
  assert.strictEqual(htmlResult.courses[0].courseName, "HTML课程");
  assert.strictEqual(htmlResult.courses[0].teacherName, "周宁");
  assert.strictEqual(htmlResult.courses[0].classroom, "B2-301");

  let failed = false;
  try {
    parsePersonalXlsBuffer(Buffer.from("not a schedule", "utf8"), "2026-2027-1", "empty.txt");
  } catch (error) {
    failed = true;
    assert(["PERSONAL_SCHEDULE_HEADER_NOT_FOUND", "UNSUPPORTED_PERSONAL_SCHEDULE_FILE"].includes(error.code));
    assert(error.message && error.message.length > 10, "failure should include a specific reason");
  }
  assert(failed, "plain invalid text should fail with a specific reason");

  console.log("test-personal-new-term-import passed");
}

run();
