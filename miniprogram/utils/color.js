const COURSE_COLORS = [
  "#5d9cec",
  "#26b99a",
  "#ff9f43",
  "#8e6ee8",
  "#ef6f8f",
  "#15b6d4",
  "#f3a63b",
  "#4f8fdf",
  "#43b883",
  "#d96bd8",
];

function hashText(text) {
  let hash = 0;
  const value = text || "";
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 100000;
  }
  return hash;
}

function colorForCourse(courseName) {
  return COURSE_COLORS[hashText(courseName) % COURSE_COLORS.length];
}

module.exports = {
  COURSE_COLORS,
  colorForCourse,
};
