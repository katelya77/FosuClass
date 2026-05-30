/**
 * 个人学号课表解析器测试
 * NOTE: 使用本地脱敏的 HAR 抓包样本，模拟真实的 /xskb/xskb_list.do HTML 页面进行测试并验证解析准确度。
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { parsePersonalScheduleHtml } = require("../src/utils/personal-schedule-parser");

const HAR_PATH = path.resolve(__dirname, "../../docs/captures/ProxyPin5-28_16_57_23.sanitized(1).har");

/**
 * 提取 HAR 响应里的明文文本 (支持 Base64 解码)
 * @param {Object} entry HAR Entry
 * @returns {string} 响应文本内容
 */
function getResponseText(entry) {
  const content = entry && entry.response && entry.response.content;
  if (!content || typeof content.text !== "string") {
    return "";
  }
  if (String(content.encoding || "").toLowerCase() === "base64") {
    return Buffer.from(content.text, "base64").toString("utf8");
  }
  return content.text;
}

function testParser() {
  if (!fs.existsSync(HAR_PATH)) {
    console.log(`HAR 抓包文件不存在: ${HAR_PATH}，跳过个人课表解析测试。`);
    return;
  }

  const har = JSON.parse(fs.readFileSync(HAR_PATH, "utf8"));
  const entries = har.log.entries || [];
  
  // 匹配含有 /xskb/xskb_list.do 的响应
  const entry = entries.find((e) => e.request.url.includes("/xskb/xskb_list.do"));
  if (!entry) {
    console.log("未在 HAR 中找到个人课表请求条目，跳过解析测试。");
    return;
  }

  const html = getResponseText(entry);
  const result = parsePersonalScheduleHtml(html, { semester: "2025-2026-2" });
  
  console.log(`从 HAR 中成功解析出 ${result.length} 门课程。`);
  assert.ok(result.length > 0, "解析结果不能为 0 门课程");
  
  // 检验第 1 门课的关键属性
  const course = result[0];
  console.log("解析出样本课程:", {
    courseName: course.courseName,
    teacherName: course.teacherName,
    classroom: course.classroom,
    weekDay: course.weekDay,
    sections: course.sections,
    weeks: course.weeks.slice(0, 3) + "...",
    rawText: course.rawText,
  });
  
  assert.ok(course.courseName, "课程名称提取不可为空");
  assert.ok(course.weekDay >= 1 && course.weekDay <= 7, "星期必须处于 1-7 之间");
  assert.ok(Array.isArray(course.sections) && course.sections.length > 0, "节次必须为非空数组");
  assert.ok(Array.isArray(course.weeks) && course.weeks.length > 0, "周次必须为非空数组");
  assert.strictEqual(course.source, "personal-xskb", "数据源必须标记为 personal-xskb");

  console.log("✔ Personal parser tests passed successfully");
}

try {
  testParser();
} catch (error) {
  console.error("✘ Personal parser tests failed:", error);
  process.exit(1);
}
