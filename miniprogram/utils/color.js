const COURSE_COLOR_TOKENS = [
  { name: "mint", background: "#e8f7f1", border: "#a7dfc8", text: "#174a3a", accent: "#23966d", roomText: "#a16207" },
  { name: "sky", background: "#edf5ff", border: "#bad7ff", text: "#1e4e8c", accent: "#3b82c4", roomText: "#b7791f" },
  { name: "apricot", background: "#fff3e3", border: "#ffd19a", text: "#7a3f10", accent: "#d97706", roomText: "#a16207" },
  { name: "rose", background: "#fff0f5", border: "#f9b5cf", text: "#7f2444", accent: "#d65d82", roomText: "#a16207" },
  { name: "lavender", background: "#f3efff", border: "#d4c6ff", text: "#4b367c", accent: "#7c62c9", roomText: "#a16207" },
  { name: "ice", background: "#edf8fb", border: "#a9dce7", text: "#155668", accent: "#2893a8", roomText: "#a16207" },
  { name: "leaf", background: "#f0f8e8", border: "#c9e6a4", text: "#365a20", accent: "#6ca33b", roomText: "#9a5b08" },
  { name: "periwinkle", background: "#f0f3ff", border: "#c9d4ff", text: "#34447a", accent: "#6474c9", roomText: "#a16207" },
];

const COURSE_COLORS = COURSE_COLOR_TOKENS.map((token) => token.background);
const COURSE_MUTED_TOKEN = {
  name: "muted",
  background: "#eef2f6",
  border: "#cbd5e1",
  text: "#64748b",
  accent: "#94a3b8",
  roomText: "#64748b",
};
const COURSE_CONFLICT_TOKEN = {
  name: "conflict",
  background: "#fff1f2",
  border: "#f7b2bd",
  text: "#8c1d35",
  accent: "#be3657",
  roomText: "#b7791f",
};
const COURSE_PARALLEL_TOKEN = {
  name: "parallel",
  background: "#e8f7f8",
  border: "#a6dade",
  text: "#164e55",
  accent: "#2f8f96",
  roomText: "#a16207",
};

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
  return courseColorTokenForCourse(courseName).background;
}

function courseColorTokenForCourse(courseName) {
  return COURSE_COLOR_TOKENS[hashText(courseName) % COURSE_COLOR_TOKENS.length];
}

function courseSemanticColorToken(kind) {
  if (kind === "muted") return COURSE_MUTED_TOKEN;
  if (kind === "conflict" || kind === "true-conflict") return COURSE_CONFLICT_TOKEN;
  if (kind === "parallel" || kind === "parallel-group" || kind === "shared-session") return COURSE_PARALLEL_TOKEN;
  return null;
}

module.exports = {
  COURSE_COLORS,
  COURSE_COLOR_TOKENS,
  COURSE_CONFLICT_TOKEN,
  COURSE_MUTED_TOKEN,
  COURSE_PARALLEL_TOKEN,
  courseColorTokenForCourse,
  colorForCourse,
  courseSemanticColorToken,
  normalizeCourseColorKey,
};
