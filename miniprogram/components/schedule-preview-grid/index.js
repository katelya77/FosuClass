const { colorForCourse } = require("../../utils/color");

const TIME_AXIS_WIDTH = 64;
const DEFAULT_DAY_WIDTH = 120;
const DEFAULT_SECTION_HEIGHT = 72;

function toNumberList(values) {
  return (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((item) => Number.isInteger(item) && item > 0)
    .sort((left, right) => left - right);
}

function decisionBadge(decision, conflict, selected) {
  if (conflict) return "冲突";
  if (selected === false) return "未选";
  return "";
}

function colorForCell(cell) {
  if (cell.selected === false) return "#94a3b8";
  return colorForCourse(cell.normalizedCourseName || cell.displayCourseName || cell.courseName || "");
}

function buildDefaultDays() {
  return Array.from({ length: 5 }, (_, index) => ({
    weekday: index + 1,
    label: `周${"一二三四五六日"[index]}`,
  }));
}

function buildColumns(grid, sectionHeight, dayColumnWidth) {
  const days = (grid && grid.days || []).length ? grid.days : buildDefaultDays();
  const cells = grid && Array.isArray(grid.cells) ? grid.cells : [];
  return days.map((day) => {
    const courses = cells
      .filter((cell) => Number(cell.weekday) === Number(day.weekday))
      .map((cell) => {
        const sections = toNumberList(cell.sections);
        const startSection = Number(cell.startSection || sections[0] || 1);
        const endSection = Number(cell.endSection || sections[sections.length - 1] || startSection);
        const span = Math.max(1, endSection - startSection + 1);
        const top = (startSection - 1) * sectionHeight + 6;
        const height = span * sectionHeight - 12;
        const background = colorForCell(cell);
        const weekText = cell.displayWeekText || cell.weekText || "";
        const subText = [cell.teacherName, weekText].filter(Boolean).join(" · ");
        return Object.assign({}, cell, {
          id: cell.id || cell.arrangementId,
          startSection,
          endSection,
          sections,
          previewGrid: true,
          color: background,
          active: cell.selected !== false,
          badgeText: decisionBadge(cell.importDecision, cell.conflict, cell.selected),
          eventKind: cell.conflict ? "true-conflict" : "",
          classroom: cell.roomName || cell.classroom || "",
          weekText,
          subText,
          cardStyle: [
            `top:${top}rpx`,
            `height:${height}rpx`,
            `background:${background}`,
            "left:3rpx",
            "right:3rpx",
          ].join(";") + ";",
        });
      });
    return Object.assign({}, day, { courses });
  });
}

Component({
  properties: {
    grid: {
      type: Object,
      value: {},
    },
    sectionHeight: {
      type: Number,
      value: DEFAULT_SECTION_HEIGHT,
    },
    dayColumnWidth: {
      type: Number,
      value: DEFAULT_DAY_WIDTH,
    },
  },

  data: {
    sections: [],
    columns: [],
    gridWidth: TIME_AXIS_WIDTH + DEFAULT_DAY_WIDTH * 5,
    dayTrackWidth: DEFAULT_DAY_WIDTH * 5,
    scheduleHeight: DEFAULT_SECTION_HEIGHT * 14,
  },

  observers: {
    "grid, sectionHeight, dayColumnWidth": function (grid, sectionHeight, dayColumnWidth) {
      const height = Number(sectionHeight || DEFAULT_SECTION_HEIGHT) || DEFAULT_SECTION_HEIGHT;
      const width = Number(dayColumnWidth || DEFAULT_DAY_WIDTH) || DEFAULT_DAY_WIDTH;
      const sections = (grid && grid.sections || []).length
        ? grid.sections
        : Array.from({ length: 14 }, (_, index) => ({ section: index + 1, label: `${index + 1}` }));
      const columns = buildColumns(grid || {}, height, width);
      this.setData({
        sections,
        columns,
        dayTrackWidth: width * columns.length,
        gridWidth: TIME_AXIS_WIDTH + width * columns.length,
        scheduleHeight: height * sections.length,
      });
    },
  },

  methods: {
    onCourseTap(event) {
      this.triggerEvent("course", event.detail || {});
    },
  },
});
