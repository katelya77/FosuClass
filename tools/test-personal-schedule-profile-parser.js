const assert = require("assert");
const {
  parsePersonalScheduleHtml,
  parsePersonalSchedulePageMetadata,
} = require("../server/src/utils/personal-schedule-parser");

function page(options = {}) {
  const name = options.name == null ? "王同学" : options.name;
  const nameHtml = options.nameHtml || (name ? `<td>姓名</td><td>${name}</td>` : "<td>姓名</td><td></td>");
  const remarks = options.remarks == null
    ? "<tr><td>备注</td><td>大学体育3……<br>劳动教育3……</td></tr>"
    : options.remarks;
  return [
    "<html><body>",
    `<table><tr>${nameHtml}<td>学号</td><td>20250000101</td></tr></table>`,
    "<table id=\"kbtable\">",
    "<tr><td>节次</td><td>星期一</td><td>星期二</td><td>星期三</td><td>星期四</td><td>星期五</td><td>星期六</td><td>星期日</td></tr>",
    "<tr><td>第一大节</td><td>动物解剖<br>1-16周<br>[1-2节]<br>C3-101<br>李老师</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>",
    remarks,
    "</table></body></html>",
  ].join("");
}

function testNameAndRemarks() {
  const meta = parsePersonalSchedulePageMetadata(page());
  assert.strictEqual(meta.studentName, "王同学");
  assert.deepStrictEqual(meta.pageRemarks, ["大学体育3……", "劳动教育3……"]);
  const courses = parsePersonalScheduleHtml(page());
  assert.ok(courses.some((course) => /动物解剖/.test(course.courseName)));
  assert.ok(!courses.some((course) => /备注|大学体育3|劳动教育3/.test(course.courseName || "")));
}

function testWrappedName() {
  const html = page({
    nameHtml: "<td><div><span>姓名</span></div></td><td><span>　李示例　</span></td>",
  });
  assert.strictEqual(parsePersonalSchedulePageMetadata(html).studentName, "李示例");
}

function testMissingName() {
  const meta = parsePersonalSchedulePageMetadata(page({ name: "" }));
  assert.strictEqual(meta.studentName, "");
}

function testRemarkVariants() {
  const single = parsePersonalSchedulePageMetadata(page({
    remarks: "<tr><td>备注：</td><td>农业生态学（在线课程）……</td></tr>",
  }));
  assert.deepStrictEqual(single.pageRemarks, ["农业生态学（在线课程）……"]);

  const url = parsePersonalSchedulePageMetadata(page({
    remarks: "<tr><td>备注</td><td>说明 https://example.edu/course</td></tr>",
  }));
  assert.strictEqual(url.pageRemarks[0], "说明 https://example.edu/course");

  const script = parsePersonalSchedulePageMetadata(page({
    remarks: "<tr><td>备注</td><td>课前阅读<script>alert(1)</script>即可</td></tr>",
  }));
  assert.ok(!script.pageRemarks.join("").includes("script"));
  assert.ok(!script.pageRemarks.join("").includes("alert"));

  const tag = parsePersonalSchedulePageMetadata(page({
    remarks: "<tr><td>备注</td><td><b>周老师</b> QQ群 10000</td></tr>",
  }));
  assert.strictEqual(tag.pageRemarks[0], "周老师 QQ群 10000");

  const none = parsePersonalSchedulePageMetadata(page({ remarks: "" }));
  assert.deepStrictEqual(none.pageRemarks, []);

  const longLine = `说明${"甲".repeat(400)}`;
  const longMeta = parsePersonalSchedulePageMetadata(page({
    remarks: `<tr><td>备注</td><td>${longLine}</td></tr>`,
  }));
  assert.ok(longMeta.pageRemarks[0].length <= 240);
}

testNameAndRemarks();
testWrappedName();
testMissingName();
testRemarkVariants();
console.log("personal schedule page metadata ok");
