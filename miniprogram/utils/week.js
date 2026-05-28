const TERM_START_DATE = "2026-03-09";
const TOTAL_WEEKS = 20;
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function pad(number) {
  return number < 10 ? `0${number}` : `${number}`;
}

function parseDate(dateText) {
  const parts = dateText.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatMonthDay(date) {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function clampWeek(week) {
  const number = Number(week) || 1;
  return Math.max(1, Math.min(TOTAL_WEEKS, number));
}

function getCurrentTeachingWeek(date) {
  const target = date || new Date();
  const start = parseDate(TERM_START_DATE);
  const diffDays = Math.floor((target.getTime() - start.getTime()) / 86400000);
  return clampWeek(Math.floor(diffDays / 7) + 1);
}

function getTodayWeekday(date) {
  const day = (date || new Date()).getDay();
  return day === 0 ? 7 : day;
}

function getWeekdayLabel(weekday) {
  return WEEKDAY_LABELS[weekday - 1] || "";
}

function getVisibleWeekdays(showWeekend) {
  const max = showWeekend ? 7 : 5;
  const days = [];
  const today = getTodayWeekday();
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
  const start = parseDate(TERM_START_DATE);
  start.setDate(start.getDate() + (clampWeek(week) - 1) * 7);
  const end = new Date(start.getTime());
  end.setDate(start.getDate() + 6);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
    shortText: `${formatMonthDay(start)}-${formatMonthDay(end)}`,
  };
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
  TERM_START_DATE,
  TOTAL_WEEKS,
  WEEKDAY_LABELS,
  clampWeek,
  formatDate,
  getCurrentTeachingWeek,
  getTodayWeekday,
  getWeekDateRange,
  getWeekdayLabel,
  getVisibleWeekdays,
  isCourseInWeek,
};
