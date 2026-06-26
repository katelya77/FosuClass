const TIME_AXIS_WIDTH = 64;
const DEFAULT_DAY_WIDTH = 120;
const DEFAULT_SECTION_HEIGHT = 72;
const PREVIEW_THEMES = [
  { background: "#e8f5ee", border: "#84c7a3", text: "#174b36" },
  { background: "#eef4ff", border: "#93b9f5", text: "#1d4f8f" },
  { background: "#fff3e6", border: "#f2b36c", text: "#7a3f10" },
  { background: "#f2efff", border: "#afa0ea", text: "#43327f" },
  { background: "#eaf8fb", border: "#80c9d6", text: "#155668" },
  { background: "#fff0f4", border: "#e99aa9", text: "#7f2437" },
  { background: "#f3f6e8", border: "#b7c971", text: "#46591f" },
  { background: "#f0f5f4", border: "#9bbdb6", text: "#244a43" },
];

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

function hashText(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function themeForCell(cell) {
  if (cell.selected === false) {
    return { background: "#eef2f6", border: "#cbd5e1", text: "#64748b" };
  }
  const key = cell.normalizedCourseName || cell.displayCourseName || cell.courseName || "";
  const theme = PREVIEW_THEMES[hashText(key) % PREVIEW_THEMES.length];
  if (cell.conflict) {
    return { background: "#fff1f2", border: "#f199a8", text: "#8c1d35" };
  }
  return theme;
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
        const theme = themeForCell(cell);
        const weekText = cell.displayWeekText || cell.weekText || "";
        const subText = [cell.teacherName, weekText].filter(Boolean).join(" · ");
        return Object.assign({}, cell, {
          id: cell.id || cell.arrangementId,
          startSection,
          endSection,
          sections,
          previewGrid: true,
          color: theme.background,
          textColor: theme.text,
          active: cell.selected !== false,
          badgeText: decisionBadge(cell.importDecision, cell.conflict, cell.selected),
          eventKind: cell.conflict ? "true-conflict" : "",
          classroom: cell.roomName || cell.classroom || "",
          weekText,
          subText,
          cardStyle: [
            `top:${top}rpx`,
            `height:${height}rpx`,
            `background:${theme.background}`,
            `border:1rpx solid ${theme.border}`,
            `color:${theme.text}`,
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
