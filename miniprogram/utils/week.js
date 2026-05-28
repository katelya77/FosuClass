const DEFAULT_SEMESTER_ID = "2025-2026-2";
const DEFAULT_SEMESTER_TEXT = "2025-2026学年第二学期";
const TERM_START_DATE = "2026-03-09";
const TOTAL_WEEKS = 20;
const WEEK_START = "monday";
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function pad(number) {
  return number < 10 ? `0${number}` : `${number}`;
}

function parseDate(dateText) {
  if (dateText instanceof Date) {
    return new Date(dateText.getFullYear(), dateText.getMonth(), dateText.getDate());
  }
  const parts = dateText.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatMonthDay(date) {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function formatDateLabel(date) {
  const target = parseDate(date);
  return `${target.getMonth() + 1}月${target.getDate()}日`;
}

function formatFullDateLabel(date) {
  const target = parseDate(date);
  return `${target.getFullYear()}年${target.getMonth() + 1}月${target.getDate()}日`;
}

function formatWeekRange(startDate, endDate) {
  return `${formatDateLabel(startDate)}-${formatDateLabel(endDate)}`;
}

function clampWeek(week) {
  const number = Number(week) || 1;
  return Math.max(1, Math.min(TOTAL_WEEKS, number));
}

function getTeachingWeekByDate(date, calendarWeeks) {
  const target = parseDate(date || new Date());
  const weeks = Array.isArray(calendarWeeks) ? calendarWeeks : [];
  const matched = weeks.find((item) => {
    return target >= parseDate(item.startDate) && target <= parseDate(item.endDate);
  });
  if (matched) {
    return Object.assign({}, matched, {
      weekNo: Number(matched.weekNo || matched.week),
      notes: matched.notes || matched.note || "",
    });
  }

  const start = parseDate(TERM_START_DATE);
  const diffDays = Math.floor((target.getTime() - start.getTime()) / 86400000);
  const weekNo = clampWeek(Math.floor(diffDays / 7) + 1);
  return getWeekRangeByWeekNo(weekNo, weeks);
}

function getWeekRangeByWeekNo(weekNo, calendarWeeks) {
  const targetWeek = clampWeek(weekNo);
  const weeks = Array.isArray(calendarWeeks) ? calendarWeeks : [];
  const matched = weeks.find((item) => Number(item.weekNo || item.week) === targetWeek);
  if (matched) {
    return Object.assign({}, matched, {
      weekNo: Number(matched.weekNo || matched.week),
      notes: matched.notes || matched.note || "",
      rangeText: formatWeekRange(matched.startDate, matched.endDate),
    });
  }

  const start = parseDate(TERM_START_DATE);
  start.setDate(start.getDate() + (targetWeek - 1) * 7);
  const end = new Date(start.getTime());
  end.setDate(start.getDate() + 6);
  return {
    semester: DEFAULT_SEMESTER_ID,
    weekNo: targetWeek,
    startDate: formatDate(start),
    endDate: formatDate(end),
    notes: "",
    rangeText: formatWeekRange(start, end),
  };
}

function getCurrentTeachingWeek(date, calendarWeeks) {
  return getTeachingWeekByDate(date || new Date(), calendarWeeks).weekNo;
}

function getTodayWeekday(date) {
  const day = (date || new Date()).getDay();
  return day === 0 ? 7 : day;
}

function getWeekdayLabel(value) {
  const weekday = value instanceof Date || typeof value === "string" ? getTodayWeekday(parseDate(value)) : value;
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

function getWeekDateRange(week) {
  const rangeInfo = getWeekRangeByWeekNo(week);
  const start = parseDate(rangeInfo.startDate);
  const end = parseDate(rangeInfo.endDate);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
    shortText: `${formatMonthDay(start)}-${formatMonthDay(end)}`,
    rangeText: formatWeekRange(start, end),
  };
}

function getTodayTeachingInfo(date, calendarWeeks) {
  const target = parseDate(date || new Date());
  const weekInfo = getTeachingWeekByDate(target, calendarWeeks);
  return Object.assign({}, weekInfo, {
    date: formatDate(target),
    dateLabel: formatDateLabel(target),
    fullDateLabel: formatFullDateLabel(target),
    weekday: getTodayWeekday(target),
    weekdayLabel: getWeekdayLabel(target),
    rangeText: formatWeekRange(weekInfo.startDate, weekInfo.endDate),
    weekLabel: `第${weekInfo.weekNo}周`,
  });
}

function isCourseInWeek(course, week) {
  const currentWeek = clampWeek(week);
  const weeks = Array.isArray(course.weeks) ? course.weeks : [];
  if (weeks.length && weeks.indexOf(currentWeek) === -1) {
    return false;
  }
  if (!weeks.length && (currentWeek < course.startWeek || currentWeek > course.endWeek)) {
    return false;
  }
  if (course.weekType === "odd" && currentWeek % 2 === 0) {
    return false;
  }
  if (course.weekType === "even" && currentWeek % 2 !== 0) {
    return false;
  }
  return true;
}

module.exports = {
  DEFAULT_SEMESTER_ID,
  DEFAULT_SEMESTER_TEXT,
  TERM_START_DATE,
  TOTAL_WEEKS,
  WEEK_START,
  WEEKDAY_LABELS,
  clampWeek,
  formatDate,
  formatDateLabel,
  formatFullDateLabel,
  formatWeekRange,
  getCurrentTeachingWeek,
  getTeachingWeekByDate,
  getTodayTeachingInfo,
  getTodayWeekday,
  getWeekRangeByWeekNo,
  getWeekDateRange,
  getWeekdayLabel,
  getVisibleWeekdays,
  isCourseInWeek,
};
