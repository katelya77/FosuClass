const COURSE_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#dc2626",
  "#0891b2",
  "#7c3aed",
  "#db2777",
  "#0f766e",
  "#ea580c",
  "#4f46e5",
  "#16a34a",
  "#be123c",
  "#0369a1",
  "#a16207",
  "#9333ea",
  "#15803d",
];

function normalizeCourseColorKey(courseName) {
  return String(courseName || "")
    .toLowerCase()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[【［]/g, "[")
    .replace(/[】］]/g, "]")
    .replace(/\s+/g, "")
    .trim();
}

function hashText(text) {
  let hash = 2166136261;
  const value = normalizeCourseColorKey(text);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function colorForCourse(courseName) {
  return COURSE_COLORS[hashText(courseName) % COURSE_COLORS.length];
}

module.exports = {
  COURSE_COLORS,
  colorForCourse,
  normalizeCourseColorKey,
};
