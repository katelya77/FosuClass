const COURSE_COLOR_TOKENS = [
  { name: "blue-solid", background: "#4f93dc", border: "#3e82cb", text: "#ffffff", metaText: "rgba(255,255,255,0.88)", accent: "#2f70bb", roomText: "#fff36a" },
  { name: "green-solid", background: "#43b883", border: "#34a975", text: "#ffffff", metaText: "rgba(255,255,255,0.9)", accent: "#258f61", roomText: "#fff36a" },
  { name: "rose-solid", background: "#ea638e", border: "#d94f7b", text: "#ffffff", metaText: "rgba(255,255,255,0.88)", accent: "#c93b68", roomText: "#fff0a6" },
  { name: "cyan-solid", background: "#1fb7ca", border: "#14a7b9", text: "#ffffff", metaText: "rgba(255,255,255,0.88)", accent: "#0a8fa0", roomText: "#fff36a" },
  { name: "orange-solid", background: "#f3a32d", border: "#df901a", text: "#ffffff", metaText: "rgba(255,255,255,0.9)", accent: "#c9770b", roomText: "#fff36a" },
  { name: "purple-solid", background: "#8d65df", border: "#7b53cc", text: "#ffffff", metaText: "rgba(255,255,255,0.88)", accent: "#6843ba", roomText: "#fff0a6" },
  { name: "teal-solid", background: "#25a99a", border: "#169989", text: "#ffffff", metaText: "rgba(255,255,255,0.88)", accent: "#0e8275", roomText: "#fff36a" },
  { name: "indigo-solid", background: "#5d7fdf", border: "#4b6ed0", text: "#ffffff", metaText: "rgba(255,255,255,0.88)", accent: "#3a5ab7", roomText: "#fff36a" },
  { name: "lime-solid", background: "#79b94c", border: "#68a73c", text: "#ffffff", metaText: "rgba(255,255,255,0.88)", accent: "#548d2f", roomText: "#fff36a" },
  { name: "coral-solid", background: "#ee755f", border: "#dc604a", text: "#ffffff", metaText: "rgba(255,255,255,0.88)", accent: "#c24c39", roomText: "#fff0a6" },
  { name: "sky-solid", background: "#32a9df", border: "#2298cd", text: "#ffffff", metaText: "rgba(255,255,255,0.88)", accent: "#147fb1", roomText: "#fff36a" },
  { name: "mauve-solid", background: "#a267d7", border: "#9256c7", text: "#ffffff", metaText: "rgba(255,255,255,0.88)", accent: "#7b43af", roomText: "#fff0a6" },
];

const COURSE_FEATURE_TOKENS = COURSE_COLOR_TOKENS;
const COURSE_BASE_TOKENS = COURSE_COLOR_TOKENS;

const COURSE_COLORS = COURSE_COLOR_TOKENS.map((token) => token.background);
const COURSE_MUTED_TOKEN = {
  name: "muted",
  background: "#e8edf5",
  border: "#d6deea",
  text: "#7a8392",
  metaText: "#596675",
  accent: "#a8b3c2",
  roomText: "#f1c40f",
};
const COURSE_CONFLICT_TOKEN = {
  name: "conflict",
  background: "#fff1f2",
  border: "#f7b2bd",
  text: "#8c1d35",
  metaText: "#8c1d35",
  accent: "#be3657",
  roomText: "#b7791f",
};
const COURSE_PARALLEL_TOKEN = {
  name: "parallel",
  background: "#25a99a",
  border: "#169989",
  text: "#ffffff",
  metaText: "rgba(255,255,255,0.88)",
  accent: "#0e8275",
  roomText: "#fff36a",
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
  COURSE_BASE_TOKENS,
  COURSE_COLOR_TOKENS,
  COURSE_CONFLICT_TOKEN,
  COURSE_FEATURE_TOKENS,
  COURSE_MUTED_TOKEN,
  COURSE_PARALLEL_TOKEN,
  courseColorTokenForCourse,
  colorForCourse,
  courseSemanticColorToken,
  normalizeCourseColorKey,
};
