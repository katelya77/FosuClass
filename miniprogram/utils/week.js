const DEFAULT_SEMESTER_ID = "";
const DEFAULT_SEMESTER_TEXT = "";
const TERM_START_DATE = "";
const TOTAL_WEEKS = 19;
const WEEK_START = "monday";
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const { isCourseActiveInWeek } = require("./courseWeekRules");

const FALLBACK_TERM_CONFIG = {
  term: DEFAULT_SEMESTER_ID,
  semesterText: DEFAULT_SEMESTER_TEXT,
  termStartDate: TERM_START_DATE,
  totalWeeks: TOTAL_WEEKS,
  weekStart: WEEK_START,
  updatedAt: "",
  source: "fallback",
  releaseVersion: "",
};

let runtimeTermConfig = Object.assign({}, FALLBACK_TERM_CONFIG);

function normalizeTermConfig(config) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const totalWeeks = Number(source.totalWeeks || source.weeks || source.weekCount || FALLBACK_TERM_CONFIG.totalWeeks);
  return Object.assign({}, FALLBACK_TERM_CONFIG, {
    term: source.term || source.semester || source.currentSemester || FALLBACK_TERM_CONFIG.term,
    semesterText: source.semesterText || source.termText || source.label || FALLBACK_TERM_CONFIG.semesterText,
    termStartDate: source.termStartDate || source.startDate || source.termStart || FALLBACK_TERM_CONFIG.termStartDate,
    totalWeeks: Number.isFinite(totalWeeks) && totalWeeks > 0 ? Math.floor(totalWeeks) : FALLBACK_TERM_CONFIG.totalWeeks,
    weekStart: source.weekStart || FALLBACK_TERM_CONFIG.weekStart,
    updatedAt: source.updatedAt || "",
    source: source.source || FALLBACK_TERM_CONFIG.source,
    releaseVersion: source.releaseVersion || source.version || "",
  });
}

function setRuntimeTermConfig(config) {
  runtimeTermConfig = normalizeTermConfig(config);
  return getRuntimeTermConfig();
}

function getRuntimeTermConfig() {
  return Object.assign({}, runtimeTermConfig);
}

function resetRuntimeTermConfig() {
  runtimeTermConfig = Object.assign({}, FALLBACK_TERM_CONFIG);
  return getRuntimeTermConfig();
}

function resolveTermConfig(config) {
  return normalizeTermConfig(config || runtimeTermConfig);
}

function shouldUseRuntimeTermConfig(config) {
  const termConfig = resolveTermConfig(config);
  return termConfig.source !== "fallback" ||
    termConfig.termStartDate !== TERM_START_DATE ||
    termConfig.totalWeeks !== TOTAL_WEEKS ||
    termConfig.term !== DEFAULT_SEMESTER_ID;
}

function pad(number) {
  return number < 10 ? `0${number}` : `${number}`;
}

function parseLocalDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseDate(value) {
  return parseLocalDate(value);
}

function isValidDate(value) {
  return parseLocalDate(value) !== null;
}

function addLocalDays(value, offset) {
  const date = parseLocalDate(value);
  if (!date) return null;
  date.setDate(date.getDate() + Number(offset || 0));
  return date;
}

function formatDate(date) {
  const target = parseLocalDate(date);
  if (!target) return "";
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function formatMonthDay(date) {
  const target = parseLocalDate(date);
  if (!target) return "";
  return `${pad(target.getMonth() + 1)}/${pad(target.getDate())}`;
}

function formatDateLabel(date) {
  const target = parseLocalDate(date);
  if (!target) return "";
  return `${target.getMonth() + 1}月${target.getDate()}日`;
}

function formatFullDateLabel(date) {
  const target = parseLocalDate(date);
  if (!target) return "";
  return `${target.getFullYear()}年${target.getMonth() + 1}月${target.getDate()}日`;
}

function formatWeekRange(startDate, endDate) {
  const start = formatDateLabel(startDate);
  const end = formatDateLabel(endDate);
  return start && end ? `${start}-${end}` : "";
}

function clampWeek(week, termConfig) {
  const config = resolveTermConfig(termConfig);
  const number = Number(week) || 1;
  return Math.max(1, Math.min(config.totalWeeks || TOTAL_WEEKS, number));
}

function getTeachingWeekByDate(date, calendarWeeks, termConfig) {
  const target = parseLocalDate(date || new Date());
  const config = resolveTermConfig(termConfig);
  if (!target) {
    return {
      term: config.term,
      semester: config.term,
      termPhase: "unknown",
      isInTerm: false,
      rawWeekNo: null,
      weekNo: 1,
      startDate: "",
      endDate: "",
      notes: "",
      rangeText: "",
    };
  }
  const weeks = Array.isArray(calendarWeeks) ? calendarWeeks : [];
  const matched = weeks.find((item) => {
    const startDate = parseLocalDate(item.startDate);
    const endDate = parseLocalDate(item.endDate);
    return startDate && endDate && target >= startDate && target <= endDate;
  });
  if (matched) {
    const matchedWeekNo = Number(matched.weekNo || matched.week);
    return Object.assign({}, matched, {
      weekNo: matchedWeekNo,
      rawWeekNo: matched.rawWeekNo == null ? matchedWeekNo : Number(matched.rawWeekNo),
      termPhase: matched.termPhase || "in-term",
      isInTerm: matched.isInTerm !== false && (matched.termPhase || "in-term") === "in-term",
      semester: matched.semester || config.term,
      term: matched.term || matched.semester || config.term,
      notes: matched.notes || matched.note || "",
    });
  }

  if (!config.termStartDate) {
    return {
      term: config.term,
      semester: config.term,
      termPhase: "unknown",
      isInTerm: false,
      rawWeekNo: null,
      weekNo: 1,
      startDate: "",
      endDate: "",
      notes: "",
      rangeText: "",
    };
  }

  const start = parseLocalDate(config.termStartDate);
  if (!start) {
    return {
      term: config.term,
      semester: config.term,
      termPhase: "unknown",
      isInTerm: false,
      rawWeekNo: null,
      weekNo: 1,
      startDate: "",
      endDate: "",
      notes: "",
      rangeText: "",
    };
  }
  const diffDays = Math.floor((target.getTime() - start.getTime()) / 86400000);
  const rawWeekNo = Math.floor(diffDays / 7) + 1;
  const weekNo = clampWeek(rawWeekNo, config);
  const range = getWeekRangeByWeekNo(weekNo, [], config);
  let termPhase = "in-term";
  if (rawWeekNo <= 0) termPhase = "before-term";
  if (rawWeekNo > (config.totalWeeks || TOTAL_WEEKS)) termPhase = "after-term";
  return Object.assign({}, range, {
    term: config.term,
    termPhase,
    isInTerm: termPhase === "in-term",
    rawWeekNo,
    weekNo,
  });
}

function getWeekRangeByWeekNo(weekNo, calendarWeeks, termConfig) {
  const config = resolveTermConfig(termConfig);
  const targetWeek = clampWeek(weekNo, config);
  const weeks = Array.isArray(calendarWeeks) ? calendarWeeks : [];
  const matched = weeks.find((item) => Number(item.weekNo || item.week) === targetWeek);
  if (matched) {
    return Object.assign({}, matched, {
      weekNo: Number(matched.weekNo || matched.week),
      semester: matched.semester || config.term,
      notes: matched.notes || matched.note || "",
      rangeText: formatWeekRange(matched.startDate, matched.endDate),
    });
  }

  if (!config.termStartDate) {
    return {
      semester: config.term,
      weekNo: targetWeek,
      startDate: "",
      endDate: "",
      notes: "",
      rangeText: "",
    };
  }

  const start = addLocalDays(config.termStartDate, (targetWeek - 1) * 7);
  const end = addLocalDays(start, 6);
  if (!start || !end) {
    return {
      semester: config.term,
      weekNo: targetWeek,
      startDate: "",
      endDate: "",
      notes: "",
      rangeText: "",
    };
  }
  return {
    semester: config.term,
    weekNo: targetWeek,
    startDate: formatDate(start),
    endDate: formatDate(end),
    notes: "",
    rangeText: formatWeekRange(start, end),
  };
}

function getCurrentTeachingWeek(date, calendarWeeks, termConfig) {
  return getTeachingWeekByDate(date || new Date(), calendarWeeks, termConfig).weekNo;
}

function getTodayWeekday(date) {
  const target = parseLocalDate(date || new Date());
  if (!target) return 0;
  const day = target.getDay();
  return day === 0 ? 7 : day;
}

function getWeekdayLabel(value) {
  const weekday = value instanceof Date || typeof value === "string" ? getTodayWeekday(value) : value;
  return WEEKDAY_LABELS[weekday - 1] || "";
}

function getVisibleWeekdays(showWeekend, date) {
  const max = showWeekend ? 7 : 5;
  const days = [];
  const today = getTodayWeekday(date || new Date());
  for (let weekday = 1; weekday <= max; weekday += 1) {
    days.push({
      weekday,
      label: getWeekdayLabel(weekday),
      isToday: weekday === today,
    });
  }
  return days;
}

function getWeekDateRange(week, termConfig) {
  const rangeInfo = getWeekRangeByWeekNo(week, [], termConfig);
  const start = parseLocalDate(rangeInfo.startDate);
  const end = parseLocalDate(rangeInfo.endDate);
  return {
    startDate: start ? formatDate(start) : "",
    endDate: end ? formatDate(end) : "",
    shortText: start && end ? `${formatMonthDay(start)}-${formatMonthDay(end)}` : "",
    rangeText: formatWeekRange(start, end),
  };
}

function getTodayTeachingInfo(date, calendarWeeks, termConfig) {
  const target = parseLocalDate(date || new Date());
  const config = resolveTermConfig(termConfig);
  if (!target) {
    return {
      term: config.term,
      semesterText: config.semesterText,
      termStartDate: config.termStartDate,
      totalWeeks: config.totalWeeks,
      termPhase: "unknown",
      isInTerm: false,
      rawWeekNo: null,
      weekNo: 1,
      date: "",
      dateLabel: "",
      fullDateLabel: "",
      weekday: 0,
      weekdayLabel: "",
      rangeText: "",
      weekLabel: "第1周",
      startDate: "",
      endDate: "",
    };
  }
  const weekInfo = getTeachingWeekByDate(target, calendarWeeks, config);
  return Object.assign({}, weekInfo, {
    date: formatDate(target),
    dateLabel: formatDateLabel(target),
    fullDateLabel: formatFullDateLabel(target),
    weekday: getTodayWeekday(target),
    weekdayLabel: getWeekdayLabel(target),
    rangeText: weekInfo.startDate && weekInfo.endDate ? formatWeekRange(weekInfo.startDate, weekInfo.endDate) : "",
    weekLabel: `第${weekInfo.weekNo}周`,
    term: config.term,
    semesterText: config.semesterText,
    termStartDate: config.termStartDate,
    totalWeeks: config.totalWeeks,
  });
}

function getTermCalendarWeeks(termConfig) {
  const config = resolveTermConfig(termConfig);
  const weeks = [];
  for (let weekNo = 1; weekNo <= config.totalWeeks; weekNo += 1) {
    weeks.push(getWeekRangeByWeekNo(weekNo, [], config));
  }
  return weeks;
}

function isCourseInWeek(course, week, termInfo) {
  if (termInfo && termInfo.isInTerm === false) return false;
  const currentWeek = clampWeek(week, termInfo);
  return isCourseActiveInWeek(course || {}, currentWeek);
}

module.exports = {
  DEFAULT_SEMESTER_ID,
  DEFAULT_SEMESTER_TEXT,
  TERM_START_DATE,
  TOTAL_WEEKS,
  WEEK_START,
  WEEKDAY_LABELS,
  FALLBACK_TERM_CONFIG,
  addLocalDays,
  clampWeek,
  formatDate,
  formatDateLabel,
  formatFullDateLabel,
  formatWeekRange,
  getCurrentTeachingWeek,
  getRuntimeTermConfig,
  getTermCalendarWeeks,
  getTeachingWeekByDate,
  getTodayTeachingInfo,
  getTodayWeekday,
  getWeekRangeByWeekNo,
  getWeekDateRange,
  getWeekdayLabel,
  getVisibleWeekdays,
  isCourseInWeek,
  isValidDate,
  parseLocalDate,
  resetRuntimeTermConfig,
  resolveTermConfig,
  setRuntimeTermConfig,
};
