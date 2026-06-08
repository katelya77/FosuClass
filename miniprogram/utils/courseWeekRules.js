const DEFAULT_TOTAL_WEEKS = 20;
const MAX_SECTION = 14;

const COURSE_TIMES = [
  { section: 1, start: "08:00", end: "08:40" },
  { section: 2, start: "08:45", end: "09:25" },
  { section: 3, start: "09:40", end: "10:20" },
  { section: 4, start: "10:25", end: "11:05" },
  { section: 5, start: "11:10", end: "11:50" },
  { section: 6, start: "13:30", end: "14:10" },
  { section: 7, start: "14:15", end: "14:55" },
  { section: 8, start: "15:10", end: "15:50" },
  { section: 9, start: "15:55", end: "16:35" },
  { section: 10, start: "16:40", end: "17:20" },
  { section: 11, start: "18:30", end: "19:10" },
  { section: 12, start: "19:15", end: "19:55" },
  { section: 13, start: "20:05", end: "20:45" },
  { section: 14, start: "20:50", end: "21:30" },
];

function pad(value) {
  return String(value).padStart(2, "0");
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function clampWeek(week, totalWeeks) {
  const max = Math.max(1, Number(totalWeeks || DEFAULT_TOTAL_WEEKS) || DEFAULT_TOTAL_WEEKS);
  const value = Number(week);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function parseDateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseLocalDateTime(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
    if (!Number.isNaN(date.getTime())) return date;
  }
  const native = new Date(text);
  return Number.isNaN(native.getTime()) ? null : native;
}

function formatDate(date) {
  const target = parseDateOnly(date) || new Date();
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function getWeekday(date) {
  const target = parseLocalDateTime(date) || new Date();
  const day = target.getDay();
  return day === 0 ? 7 : day;
}

function normalizeFullWidthDigits(text) {
  return String(text || "").replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
}

function normalizeWeekText(text) {
  return normalizeFullWidthDigits(text)
    .replace(/[，、；;]/g, ",")
    .replace(/[~～—–－至到]/g, "-")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "")
    .trim();
}

function uniqueSortedNumbers(values) {
  const seen = new Set();
  const result = [];
  (values || []).forEach((value) => {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 1 && num <= 60 && !seen.has(num)) {
      seen.add(num);
      result.push(num);
    }
  });
  return result.sort((left, right) => left - right);
}

function detectWeekTypeFromText(text) {
  const value = String(text || "").toLowerCase();
  if (/单周|[\(（]单[\)）]?|odd|single/.test(value)) return "odd";
  if (/双周|[\(（]双[\)）]?|even|double/.test(value)) return "even";
  if (/(^|[^a-z])odd([^a-z]|$)/.test(value)) return "odd";
  if (/(^|[^a-z])even([^a-z]|$)/.test(value)) return "even";
  return "";
}

function normalizeWeekType(course, text) {
  const raw = String(
    (course && (course.weekType || course.oddEven || course.weekParity || course.parity)) ||
    detectWeekTypeFromText(text) ||
    ""
  ).toLowerCase();
  if (/odd|single|单/.test(raw)) return "odd";
  if (/even|double|双/.test(raw)) return "even";
  return "all";
}

function applyWeekType(weeks, weekType) {
  const type = weekType || "all";
  return uniqueSortedNumbers(weeks).filter((week) => {
    if (type === "odd") return week % 2 === 1;
    if (type === "even") return week % 2 === 0;
    return true;
  });
}

function expandRange(start, end) {
  const first = Number(start);
  const last = Number(end);
  if (!Number.isFinite(first)) return [];
  const low = Number.isFinite(last) ? Math.min(first, last) : first;
  const high = Number.isFinite(last) ? Math.max(first, last) : first;
  const values = [];
  for (let week = low; week <= high; week += 1) values.push(week);
  return values;
}

function parseWeeksFromText(text) {
  const normalized = normalizeWeekText(text);
  if (!normalized) return [];
  const numericText = normalized
    .replace(/第/g, "")
    .replace(/周/g, "")
    .replace(/\((?:单|双|odd|even|single|double)\)/gi, "")
    .replace(/单|双|odd|even|single|double/gi, "");
  const tokens = numericText.match(/\d+(?:-\d+)?/g) || [];
  const weeks = [];
  tokens.forEach((token) => {
    const parts = token.split("-");
    if (parts.length === 2) {
      weeks.push(...expandRange(parts[0], parts[1]));
      return;
    }
    weeks.push(Number(token));
  });
  return uniqueSortedNumbers(weeks);
}

function getWeekTextCandidates(course) {
  const source = course || {};
  return [
    typeof source.weeks === "string" ? source.weeks : "",
    source.weekText,
    source.rawWeek,
    source.rawWeeks,
    source.weeksText,
    source.weekRange,
  ].filter((value) => typeof value === "string" && value.trim());
}

function parseWeekRangeValue(value) {
  if (Array.isArray(value) && value.length >= 2) {
    return expandRange(value[0], value[1]);
  }
  if (value && typeof value === "object") {
    const start = value.startWeek || value.start || value.from;
    const end = value.endWeek || value.end || value.to;
    return expandRange(start, end);
  }
  return [];
}

function buildWeekRule(course) {
  const source = course || {};
  const explicitWeeks = Array.isArray(source.weeks)
    ? uniqueSortedNumbers(source.weeks)
    : [];
  if (explicitWeeks.length) {
    const weekType = normalizeWeekType(source, "");
    return {
      hasWeekInfo: true,
      uncertain: false,
      weeks: applyWeekType(explicitWeeks, weekType),
      weekType,
      source: "weeks",
    };
  }

  const textCandidates = getWeekTextCandidates(source);
  for (const text of textCandidates) {
    const weeks = parseWeeksFromText(text);
    if (weeks.length) {
      const weekType = normalizeWeekType(source, text);
      return {
        hasWeekInfo: true,
        uncertain: false,
        weeks: applyWeekType(weeks, weekType),
        weekType,
        source: "text",
      };
    }
  }

  const rangeWeeks = parseWeekRangeValue(source.weekRange);
  if (rangeWeeks.length) {
    const weekType = normalizeWeekType(source, "");
    return {
      hasWeekInfo: true,
      uncertain: false,
      weeks: applyWeekType(rangeWeeks, weekType),
      weekType,
      source: "weekRange",
    };
  }

  const start = toFiniteNumber(source.startWeek);
  const end = toFiniteNumber(source.endWeek);
  if (Number.isFinite(start) || Number.isFinite(end)) {
    const first = Number.isFinite(start) ? start : end;
    const last = Number.isFinite(end) ? end : start;
    const weekType = normalizeWeekType(source, "");
    return {
      hasWeekInfo: true,
      uncertain: false,
      weeks: applyWeekType(expandRange(first, last), weekType),
      weekType,
      source: "startEnd",
    };
  }

  return {
    hasWeekInfo: false,
    uncertain: true,
    weeks: [],
    weekType: "all",
    source: "missing",
  };
}

function getCourseWeekStatus(course, week) {
  const currentWeek = Number(week);
  if (!Number.isFinite(currentWeek) || currentWeek < 1) {
    return {
      active: false,
      uncertain: true,
      hasWeekInfo: false,
      reason: "invalid-week",
      weeks: [],
    };
  }
  const rule = buildWeekRule(course);
  if (!rule.hasWeekInfo || rule.uncertain) {
    return Object.assign({}, rule, {
      active: false,
      reason: "missing-week-info",
    });
  }
  const active = rule.weeks.includes(Math.floor(currentWeek));
  return Object.assign({}, rule, {
    active,
    reason: active ? "active" : "inactive-week",
  });
}

function isCourseActiveInWeek(course, week) {
  return getCourseWeekStatus(course, week).active === true;
}

function parseTimeMinutes(value) {
  const parts = String(value || "").split(":").map(Number);
  if (!Number.isFinite(parts[0])) return NaN;
  return parts[0] * 60 + (Number.isFinite(parts[1]) ? parts[1] : 0);
}

function minutesOfDate(value) {
  const target = parseLocalDateTime(value) || new Date();
  return target.getHours() * 60 + target.getMinutes();
}

function getSectionTime(section) {
  const target = Number(section);
  return COURSE_TIMES.find((item) => Number(item.section) === target) || null;
}

function getCourseTimeRange(course) {
  const start = getSectionTime(course && course.startSection);
  const end = getSectionTime(course && course.endSection);
  return start && end ? `${start.start}-${end.end}` : "";
}

function getCourseTimeStatus(course, now) {
  const start = getSectionTime(course && course.startSection);
  const end = getSectionTime(course && course.endSection);
  if (!start || !end) return "upcoming";
  const current = minutesOfDate(now || new Date());
  const startMinutes = parseTimeMinutes(start.start);
  const endMinutes = parseTimeMinutes(end.end);
  if (current < startMinutes) return "upcoming";
  if (current > endMinutes) return "finished";
  return "ongoing";
}

function getCurrentSection(now) {
  const current = minutesOfDate(now || new Date());
  let section = 1;
  COURSE_TIMES.forEach((item) => {
    if (current >= parseTimeMinutes(item.start)) {
      section = Number(item.section);
    }
  });
  return Math.max(1, Math.min(MAX_SECTION, section));
}

function getTeachingWeekFromTermStart(date, termStartDate, totalWeeks) {
  const target = parseDateOnly(date);
  const start = parseDateOnly(termStartDate);
  if (!target || !start) return 0;
  const diffDays = Math.floor((target.getTime() - start.getTime()) / 86400000);
  return clampWeek(Math.floor(diffDays / 7) + 1, totalWeeks);
}

function resolveCurrentTeachingWeek(context = {}, input = {}) {
  const totalWeeks = Number(context.totalWeeks || input.totalWeeks || DEFAULT_TOTAL_WEEKS) || DEFAULT_TOTAL_WEEKS;
  const candidates = [
    input.week,
    context.currentTeachingWeek,
    context.todayTeachingInfo && context.todayTeachingInfo.weekNo,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 1) {
      return {
        currentWeek: clampWeek(value, totalWeeks),
        weekUncertain: false,
        source: candidate === input.week ? "input.week" : "context",
      };
    }
  }

  const date = parseLocalDateTime(input.date || context.clientLocalTime || context.clientTime || context.todayDate || new Date());
  const termStartDate = context.termStartDate || input.termStartDate || "";
  const calculated = getTeachingWeekFromTermStart(date || new Date(), termStartDate, totalWeeks);
  if (calculated >= 1) {
    return {
      currentWeek: calculated,
      weekUncertain: false,
      source: "termStartDate",
    };
  }
  return {
    currentWeek: 1,
    weekUncertain: true,
    source: "fallback",
  };
}

module.exports = {
  COURSE_TIMES,
  DEFAULT_TOTAL_WEEKS,
  MAX_SECTION,
  buildWeekRule,
  clampWeek,
  formatDate,
  getCourseTimeRange,
  getCourseTimeStatus,
  getCourseWeekStatus,
  getCurrentSection,
  getTeachingWeekFromTermStart,
  getWeekday,
  isCourseActiveInWeek,
  normalizeWeekText,
  parseDateOnly,
  parseLocalDateTime,
  parseWeeksFromText,
  resolveCurrentTeachingWeek,
};
