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

assert(COURSE_COLOR_TOKENS.length >= 6, "course color system should expose at least six tokens");
assert.strictEqual(colorForCourse("动物解剖学"), colorForCourse("动物解剖学"), "same course should keep a stable color");
assert.notStrictEqual(
  colorForCourse("动物解剖学"),
  colorForCourse("大学英语"),
  "different sample courses should be visually distinguishable"
);

COURSE_COLOR_TOKENS.forEach((token) => {
  assert(relativeLuminance(token.background) > 0.82, `${token.name} background must be light`);
  assert(contrastRatio(token.background, token.text) >= 4.5, `${token.name} text contrast must be readable`);
  assert.notStrictEqual(token.background, COURSE_MUTED_TOKEN.background, `${token.name} should not reuse muted gray`);
});

const token = courseColorTokenForCourse("高等数学");
["background", "border", "text", "accent", "roomText"].forEach((key) => {
  assert(token[key], `course color token should include ${key}`);
});

console.log("test-course-color-system passed");
