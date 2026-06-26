const assert = require("assert");
const {
  COURSE_COLOR_TOKENS,
  COURSE_MUTED_TOKEN,
  colorForCourse,
  courseColorTokenForCourse,
} = require("../miniprogram/utils/color");

function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  assert.strictEqual(value.length, 6, `invalid hex color: ${hex}`);
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex) {
  return hexToRgb(hex)
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(left, right) {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

assert(COURSE_COLOR_TOKENS.length >= 10, "active course color system should expose a rich palette");
assert.strictEqual(colorForCourse("动物解剖学"), colorForCourse("动物解剖学"), "same course should keep a stable color");
assert.notStrictEqual(
  colorForCourse("动物解剖学"),
  colorForCourse("大学英语2"),
  "different sample courses should be visually distinguishable"
);

// 验证幂等性：同一课程在多次调用中颜色必须保持稳定一致
assert.strictEqual(courseColorTokenForCourse("动物学").name, courseColorTokenForCourse("动物学").name, "course color must remain stable");
assert.strictEqual(courseColorTokenForCourse("分析化学").name, courseColorTokenForCourse("分析化学").name, "course color must remain stable");

// 验证多样性：多门不同课程计算出的颜色不应该全部相同，能够均匀分散在调色盘中
const testCourses = [
  "动物学",
  "动物解剖学",
  "分析化学",
  "中国近现代史纲要",
  "大学英语2",
  "大学体育2",
  "动物解剖学实验技术",
  "高等数学",
  "线性代数",
  "大学物理"
];
const colorSet = new Set(testCourses.map(c => courseColorTokenForCourse(c).name));
assert(colorSet.size >= 4, "different courses should distribute across multiple colors for diversity");

COURSE_COLOR_TOKENS.forEach((token) => {
  assert.notStrictEqual(token.background, COURSE_MUTED_TOKEN.background, `${token.name} should not reuse muted gray`);
  assert(relativeLuminance(token.background) < 0.56, `${token.name} active background should be saturated`);
  assert(contrastRatio(token.background, token.text) >= 2, `${token.name} bold active text contrast must stay readable`);
  assert(/^#fff/i.test(token.roomText), `${token.name} classroom text should use a bright yellow highlight`);
});

assert(relativeLuminance(COURSE_MUTED_TOKEN.background) > 0.78, "inactive courses should use a pale grey-blue background");
assert(contrastRatio(COURSE_MUTED_TOKEN.background, COURSE_MUTED_TOKEN.text) >= 2.8, "inactive course text should stay readable");

const token = courseColorTokenForCourse("高等数学");
["background", "border", "text", "metaText", "accent", "roomText"].forEach((key) => {
  assert(token[key], `course color token should include ${key}`);
});

console.log("test-course-color-system passed");
