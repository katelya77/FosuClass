const safetyGuard = require("../safetyGuard");
const { COURSE_TIMES } = require("../../../shared/courseWeekRules");

const COURSE_START_TIMES = Object.freeze(COURSE_TIMES.reduce((output, item) => {
  output[item.section] = item.start;
  return output;
}, {}));
const COURSE_END_TIMES = Object.freeze(COURSE_TIMES.reduce((output, item) => {
  output[item.section] = item.end;
  return output;
}, {}));

function timeMinutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function formatCourseDuration(minutes) {
  const value = Math.max(0, Math.round(Number(minutes || 0) || 0));
  if (!value) return "以课表为准";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return [hours ? `${hours}小时` : "", rest ? `${rest}分钟` : ""].filter(Boolean).join("");
}

function clampLead(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(180, Math.max(5, Math.round(number)));
}

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatDate(parts) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function addDays(dateText, days) {
  const parts = parseDate(dateText);
  if (!parts) return "";
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0), 12));
  return formatDate({ year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() });
}

function weekdayForDate(dateText) {
  const parts = parseDate(dateText);
  if (!parts) return 0;
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
  return day === 0 ? 7 : day;
}

function shanghaiIso(dateText, timeText) {
  const date = parseDate(dateText);
  const time = String(timeText || "").match(/^(\d{2}):(\d{2})$/);
  if (!date || !time) return "";
  const utc = Date.UTC(date.year, date.month - 1, date.day, Number(time[1]) - 8, Number(time[2]), 0, 0);
  return new Date(utc).toISOString();
}

function activeInWeek(course, week) {
  const weeks = Array.isArray(course.weeks)
    ? course.weeks.map(Number).filter((item) => Number.isFinite(item))
    : [];
  if (!weeks.length) {
    const start = Number(course.startWeek || 0);
    const end = Number(course.endWeek || 0);
    if (start && end) return week >= start && week <= end;
    return true;
  }
  return weeks.includes(Number(week));
}

function sanitizeCourseTemplate(course) {
  const source = course && typeof course === "object" ? course : {};
  const startSection = Number(source.startSection || source.sectionStart || 0) || 0;
  const endSection = Number(source.endSection || source.sectionEnd || startSection || 0) || startSection;
  const weekday = Number(source.weekday || source.weekDay || 0) || 0;
  if (!weekday || weekday < 1 || weekday > 7 || !COURSE_START_TIMES[startSection]) return null;
  return {
    courseName: safetyGuard.redactSensitiveText(source.courseName || source.name || "未命名课程").slice(0, 60),
    teacherName: safetyGuard.redactSensitiveText(source.teacherName || source.teacher || "").slice(0, 40),
    classroom: safetyGuard.redactSensitiveText(source.classroom || source.roomName || "").slice(0, 60),
    campus: ["仙溪校区", "江湾校区"].includes(source.campus) ? source.campus : "",
    weekday,
    startSection,
    endSection,
    weeks: Array.isArray(source.weeks)
      ? source.weeks.slice(0, 40).map(Number).filter((item) => Number.isFinite(item) && item >= 1 && item <= 30)
      : [],
    startWeek: Number(source.startWeek || 0) || 0,
    endWeek: Number(source.endWeek || 0) || 0,
  };
}

function teachingWeekForOffset(baseWeek, baseWeekday, offset) {
  return Number(baseWeek || 0) + Math.floor((Number(baseWeekday || 1) - 1 + offset) / 7);
}

function teachingWeekForDate(dateText, termStartDate, totalWeeks) {
  const date = parseDate(dateText);
  const start = parseDate(termStartDate);
  if (!date || !start) return 0;
  const dateMs = Date.UTC(date.year, date.month - 1, date.day, 12);
  const startMs = Date.UTC(start.year, start.month - 1, start.day, 12);
  const dayOffset = Math.floor((dateMs - startMs) / 86400000);
  if (dayOffset < 0) return 0;
  const week = Math.floor(dayOffset / 7) + 1;
  const limit = Math.max(0, Number(totalWeeks || 0) || 0);
  return limit && week > limit ? 0 : week;
}

function occurrenceForCourse(course, dateText, week, leadMinutes) {
  const startTime = COURSE_START_TIMES[course.startSection];
  const endTime = COURSE_END_TIMES[course.endSection] || COURSE_END_TIMES[course.startSection] || "";
  const durationMinutes = Math.max(0, timeMinutes(endTime) - timeMinutes(startTime));
  const startsAt = shanghaiIso(dateText, startTime);
  if (!startsAt) return null;
  return {
    courseName: course.courseName,
    teacherName: course.teacherName,
    classroom: course.classroom,
    campus: course.campus,
    weekday: course.weekday,
    startSection: course.startSection,
    endSection: course.endSection,
    date: dateText,
    teachingWeek: week,
    startTime,
    endTime,
    durationMinutes,
    durationText: formatCourseDuration(durationMinutes),
    startsAt,
    triggerAt: new Date(Date.parse(startsAt) - leadMinutes * 60000).toISOString(),
    pagePath: "pages/today/today",
  };
}

function computeNextOccurrence(input = {}) {
  const courses = (Array.isArray(input.courseTemplates) ? input.courseTemplates : [])
    .map(sanitizeCourseTemplate).filter(Boolean);
  const referenceDate = String(input.referenceDate || "");
  const referenceWeekday = Number(input.referenceWeekday || weekdayForDate(referenceDate)) || 1;
  const referenceTeachingWeek = Number(input.referenceTeachingWeek || 0) || 0;
  const leadMinutes = clampLead(input.leadMinutes, 20);
  const afterMs = Number.isFinite(Number(input.afterMs))
    ? Number(input.afterMs)
    : Date.parse(shanghaiIso(referenceDate, "00:00"));
  const targetDate = String(input.targetDate || "");
  const termStartDate = String(input.termStartDate || "");
  const totalWeeks = Math.max(0, Number(input.totalWeeks || 0) || 0);
  const candidates = [];

  for (let offset = 0; offset <= 370; offset += 1) {
    const date = addDays(referenceDate, offset);
    if (!date || (targetDate && date !== targetDate)) continue;
    const weekday = weekdayForDate(date);
    const teachingWeek = termStartDate
      ? teachingWeekForDate(date, termStartDate, totalWeeks)
      : teachingWeekForOffset(referenceTeachingWeek, referenceWeekday, offset);
    if (teachingWeek < 1) continue;
    courses.forEach((course) => {
      if (course.weekday !== weekday || !activeInWeek(course, teachingWeek)) return;
      const occurrence = occurrenceForCourse(course, date, teachingWeek, leadMinutes);
      if (!occurrence || Date.parse(occurrence.triggerAt) <= afterMs) return;
      candidates.push(occurrence);
    });
    if (targetDate || candidates.length) break;
  }
  candidates.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const courseIndex = Math.max(1, Number(input.courseIndex || 1) || 1);
  return candidates[courseIndex - 1] || null;
}

function parseLeadMinutes(message, fallback) {
  const text = String(message || "");
  if (/半(?:个)?小时/.test(text)) return 30;
  const hour = text.match(/提前\s*(\d+(?:\.\d+)?)\s*(?:个)?小时/);
  if (hour) return clampLead(Number(hour[1]) * 60, fallback);
  const minutes = text.match(/(?:上课前|提前)\s*(\d{1,3})\s*分钟/);
  return minutes ? clampLead(minutes[1], fallback) : fallback;
}

function parseWeekday(message) {
  const match = String(message || "").match(/(?:周|星期)([一二三四五六日天])/);
  return match ? ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[match[1]] || 0) : 0;
}

function planCourseReminder(message, context = {}) {
  const text = safetyGuard.redactSensitiveText(String(message || "")).trim();
  if (!text || !/(提醒|通知)/.test(text)) {
    return { success: false, code: "REMINDER_INTENT_NOT_FOUND", requiresConfirmation: false };
  }
  if (/(取消|删除|关闭).*(提醒|通知)/.test(text)) {
    return {
      success: true,
      operation: "delete",
      filter: {
        weekday: parseWeekday(text),
        period: /下午/.test(text) ? "afternoon" : (/上午/.test(text) ? "morning" : (/晚上/.test(text) ? "evening" : "")),
      },
      requiresConfirmation: true,
      timezone: "Asia/Shanghai",
    };
  }

  const preferences = context.userPreferences && typeof context.userPreferences === "object"
    ? context.userPreferences
    : {};
  const leadMinutes = parseLeadMinutes(text, clampLead(preferences.defaultReminderLeadMinutes, 20));
  const summary = context.currentScheduleSummary && typeof context.currentScheduleSummary === "object"
    ? context.currentScheduleSummary
    : {};
  const courseTemplates = (Array.isArray(summary.courses) ? summary.courses : [])
    .slice(0, 60).map(sanitizeCourseTemplate).filter(Boolean);
  const referenceDate = String(context.todayDate || "");
  const referenceWeekday = Number(context.todayWeekday || weekdayForDate(referenceDate)) || 1;
  const referenceTeachingWeek = Number(context.currentTeachingWeek || 0) || 0;
  const termStartDate = String(context.termStartDate || "").slice(0, 10);
  const totalWeeks = Math.max(0, Number(context.totalWeeks || 0) || 0);
  const weekStart = context.weekStart === "sunday" ? "sunday" : "monday";
  const roomChange = /(?:只有|仅).*(?:换|变更|变化).*教室|教室(?:换|变更|变化).*才/.test(text);
  let scope = roomChange ? "room_change" : "all_courses";
  let targetDate = "";
  let courseIndex = 1;
  if (/明天/.test(text)) {
    scope = "date_course";
    targetDate = addDays(referenceDate, 1);
    const indexMatch = text.match(/第\s*([一二三四五六七八九十\d]+)\s*节/);
    if (indexMatch) {
      const chinese = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      courseIndex = Number(indexMatch[1]) || chinese[indexMatch[1]] || 1;
    }
  }
  if (!roomChange && !courseTemplates.length) {
    return {
      success: false,
      code: "SCHEDULE_REQUIRED",
      needContext: true,
      requiresConfirmation: false,
      actionUrl: "/pages/personal-sync/personal-sync",
    };
  }

  const nextOccurrence = roomChange ? null : computeNextOccurrence({
    courseTemplates,
    referenceDate,
    referenceWeekday,
    referenceTeachingWeek,
    termStartDate,
    totalWeeks,
    weekStart,
    targetDate,
    courseIndex,
    leadMinutes,
    afterMs: Number(context.clientTimestampMs) || Date.parse(shanghaiIso(referenceDate, "00:00")),
  });
  if (!roomChange && !nextOccurrence) {
    return { success: false, code: "NO_MATCHING_COURSE", requiresConfirmation: false };
  }
  return {
    success: true,
    operation: "create",
    scope,
    leadMinutes,
    targetDate,
    courseIndex,
    eventDriven: roomChange,
    recurrence: roomChange ? "event" : (scope === "date_course" ? "once" : "weekly"),
    timezone: "Asia/Shanghai",
    scheduleFingerprint: String(summary.fingerprint || "").slice(0, 80),
    referenceDate,
    referenceWeekday,
    referenceTeachingWeek,
    termStartDate,
    totalWeeks,
    weekStart,
    courseTemplates,
    nextOccurrence,
    nextTriggerAt: nextOccurrence && nextOccurrence.triggerAt || "",
    requiresConfirmation: true,
  };
}

module.exports = {
  COURSE_END_TIMES,
  COURSE_START_TIMES,
  addDays,
  clampLead,
  computeNextOccurrence,
  formatCourseDuration,
  parseLeadMinutes,
  parseWeekday,
  planCourseReminder,
  sanitizeCourseTemplate,
  shanghaiIso,
  teachingWeekForDate,
  weekdayForDate,
};
