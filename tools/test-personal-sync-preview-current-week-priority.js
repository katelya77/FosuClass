const assert = require("assert");
const path = require("path");

let capturedComponent;
global.Component = (definition) => {
  capturedComponent = definition;
};

const componentPath = path.resolve(__dirname, "../miniprogram/components/schedule-preview-grid/index.js");
delete require.cache[componentPath];
require(componentPath);
delete global.Component;

function renderCourses(grid) {
  let nextData = null;
  capturedComponent.observers["grid, sectionHeight, dayColumnWidth"].call({
    setData(data) {
      nextData = data;
    },
  }, grid, 72, 120);
  return nextData.columns[0].courses;
}

function readZIndex(course) {
  const match = String(course.cardStyle || "").match(/z-index:(\d+)/);
  return match ? Number(match[1]) : 0;
}

const courses = renderCourses({
  week: 16,
  days: [{ weekday: 4, label: "Thu" }],
  sections: Array.from({ length: 4 }, (_, index) => ({ section: index + 1, label: String(index + 1) })),
  cells: [
    {
      id: "inactive-week",
      courseName: "Inactive week course",
      weekday: 4,
      startSection: 1,
      endSection: 4,
      weeks: [15],
      selected: true,
      importDecision: "auto_include",
    },
    {
      id: "active-week",
      courseName: "Active week course",
      weekday: 4,
      startSection: 1,
      endSection: 4,
      weeks: [16],
      selected: true,
      importDecision: "auto_include",
    },
  ],
});

const inactive = courses.find((course) => course.id === "inactive-week");
const active = courses.find((course) => course.id === "active-week");

assert(inactive && active, "preview should render both overlapping courses");
assert.strictEqual(courses[courses.length - 1].id, "active-week", "active-week course should render after inactive overlaps");
assert(readZIndex(active) > readZIndex(inactive), "active-week course z-index should be higher than inactive-week course");

console.log("test-personal-sync-preview-current-week-priority passed");
