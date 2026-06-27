const TIME_AXIS_WIDTH = 64;
const DEFAULT_DAY_WIDTH = 120;
const DEFAULT_SECTION_HEIGHT = 72;
const {
  courseColorTokenForCourse,
  courseSemanticColorToken,
} = require("../../utils/color");

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

function themeForCell(cell) {
  if (cell.selected === false) {
    return courseSemanticColorToken("muted");
  }
  const key = cell.normalizedCourseName || cell.displayCourseName || cell.courseName || "";
  if (cell.conflict) {
    return courseSemanticColorToken("conflict");
  }
  return courseColorTokenForCourse(key);
}

function buildDefaultDays() {
  return Array.from({ length: 5 }, (_, index) => ({
    weekday: index + 1,
    label: `周${"一二三四五六日"[index]}`,
  }));
}

function isCellActiveInGridWeek(cell, gridWeek) {
  if (cell && typeof cell.activeInPreviewWeek === "boolean") {
    return cell.activeInPreviewWeek;
  }
  const targetWeek = Number(gridWeek);
  if (!Number.isInteger(targetWeek) || targetWeek <= 0) {
    return cell && cell.activeInPreviewWeek !== false;
  }
  const weeks = toNumberList(cell && cell.weeks);
  if (!weeks.length) return true;
  return weeks.indexOf(targetWeek) >= 0;
}

function getPreviewLayerPriority(cell, gridWeek) {
  let priority = 0;
  if (isCellActiveInGridWeek(cell, gridWeek)) priority += 20;
  if (cell && cell.selected !== false) priority += 10;
  if (cell && cell.importDecision === "auto_include") priority += 4;
  if (cell && cell.importDecision === "needs_confirm") priority += 2;
  if (cell && cell.conflict) priority += 1;
  return priority;
}

function sortPreviewCellsForRender(cells, gridWeek) {
  return (cells || []).slice().sort((left, right) => {
    const leftPriority = getPreviewLayerPriority(left, gridWeek);
    const rightPriority = getPreviewLayerPriority(right, gridWeek);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftStart = Number(left.startSection || 99);
    const rightStart = Number(right.startSection || 99);
    if (leftStart !== rightStart) return leftStart - rightStart;
    const leftEnd = Number(left.endSection || leftStart);
    const rightEnd = Number(right.endSection || rightStart);
    if (leftEnd !== rightEnd) return leftEnd - rightEnd;
    return String(left.id || left.arrangementId || left.courseName || "")
      .localeCompare(String(right.id || right.arrangementId || right.courseName || ""));
  });
}

function buildColumns(grid, sectionHeight, dayColumnWidth) {
  const days = (grid && grid.days || []).length ? grid.days : buildDefaultDays();
  const cells = grid && Array.isArray(grid.cells) ? grid.cells : [];
  return days.map((day) => {
    const gridWeek = grid && grid.week;
    const courses = sortPreviewCellsForRender(cells
      .filter((cell) => Number(cell.weekday) === Number(day.weekday)), gridWeek)
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
        const zIndex = 10 + getPreviewLayerPriority(cell, gridWeek);
        return Object.assign({}, cell, {
          id: cell.id || cell.arrangementId,
          startSection,
          endSection,
          sections,
          previewGrid: true,
          color: theme.background,
          textColor: theme.text,
          metaTextColor: theme.metaText,
          roomTextColor: theme.roomText,
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
            `--course-text:${theme.text}`,
            `--course-meta-text:${theme.metaText || theme.text}`,
            `--course-room-text:${theme.roomText || "#f1c40f"}`,
            `z-index:${zIndex}`,
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
