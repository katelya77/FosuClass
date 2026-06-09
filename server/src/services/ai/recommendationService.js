const {
  COURSE_TIMES,
  MAX_SECTION,
  clampWeek,
  getCourseWeekStatus,
  getTeachingWeekFromTermStart,
  getWeekday,
  parseDateOnly,
  parseLocalDateTime,
} = require("../../shared/courseWeekRules");

const WEEKDAY_TEXT = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const MS_PER_DAY = 86400000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  const target = parseDateOnly(date) || new Date();
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function cloneDateOnly(date) {
  const target = parseDateOnly(date) || new Date();
  return new Date(target.getFullYear(), target.getMonth(), target.getDate());
}

function addDays(date, days) {
  const target = cloneDateOnly(date);
  target.setDate(target.getDate() + Number(days || 0));
  return target;
}

function getMonday(date) {
  const target = cloneDateOnly(date);
  const weekday = getWeekday(target);
  target.setDate(target.getDate() - (weekday - 1));
  return target;
}

function diffDays(left, right) {
  return Math.floor((cloneDateOnly(left).getTime() - cloneDateOnly(right).getTime()) / MS_PER_DAY);
}

function diffCalendarWeeks(date, baseDate) {
  return Math.floor((getMonday(date).getTime() - getMonday(baseDate).getTime()) / (MS_PER_DAY * 7));
}

function getSectionTime(section) {
  return COURSE_TIMES.find((item) => Number(item.section) === Number(section)) || null;
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

function formatDateText(date) {
  const target = cloneDateOnly(date);
  const weekday = getWeekday(target);
  return `${target.getMonth() + 1}月${target.getDate()}日 ${WEEKDAY_TEXT[weekday] || ""}`.trim();
}

function formatSectionText(startSection, endSection) {
  return `第${startSection}-${endSection}节`;
}

function formatTimeText(startSection, endSection) {
  const start = getSectionTime(startSection);
  const end = getSectionTime(endSection);
  return start && end ? `${start.start}-${end.end}` : "";
}

function toPositiveInt(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(max || number, Math.floor(number));
}

function hasEveningPreference(input = {}) {
  return /晚上|今晚|夜间|晚间/.test(String(input.message || input.preference || ""));
}

function hasScheduleContext(input = {}, context = {}) {
  const summary = context.currentScheduleSummary || {};
  const participantCourses = asArray(input.participantsSchedules)
    .flatMap((item) => asArray(item && item.courses));
  return Boolean(summary.enabled && asArray(summary.courses).length) || participantCourses.length > 0;
}

function collectCourses(input = {}, context = {}) {
  const summary = context.currentScheduleSummary || {};
  return asArray(input.participantsSchedules)
    .flatMap((item) => asArray(item && item.courses))
    .concat(asArray(summary.courses));
}

function resolveWeekForDate(date, input = {}, context = {}, baseDate) {
  const totalWeeks = toPositiveInt(context.totalWeeks || input.totalWeeks, 20, 60);
  const weekDelta = diffCalendarWeeks(date, baseDate || date);
  const candidates = [
    { value: input.week, source: "input.week" },
    { value: context.currentTeachingWeek, source: "context.currentTeachingWeek" },
    { value: context.todayTeachingInfo && context.todayTeachingInfo.weekNo, source: "context.todayTeachingInfo.weekNo" },
  ];
  for (const candidate of candidates) {
    const value = Number(candidate.value);
    if (Number.isFinite(value) && value >= 1) {
      return {
        teachingWeek: clampWeek(value + weekDelta, totalWeeks),
        weekUncertain: false,
        weekSource: candidate.source,
      };
    }
  }
  const termStartDate = context.termStartDate ||
    input.termStartDate ||
    context.todayTeachingInfo && context.todayTeachingInfo.termStartDate ||
    "";
  const calculated = getTeachingWeekFromTermStart(date, termStartDate, totalWeeks);
  if (calculated >= 1) {
    return {
      teachingWeek: calculated,
      weekUncertain: false,
      weekSource: "termStartDate",
    };
  }
  return {
    teachingWeek: 1,
    weekUncertain: true,
    weekSource: "fallback",
  };
}

function resolveRecommendationDateRange(input = {}, context = {}) {
  const now = parseLocalDateTime(context.clientLocalTime || context.clientTime || context.todayDate || new Date()) || new Date();
  const today = cloneDateOnly(now);
  const explicitDate = input.date ? cloneDateOnly(input.date) : null;
  if (explicitDate) {
    return {
      now,
      ranges: [{
        scope: diffDays(explicitDate, today) >= 7 ? "next_week" : "specified",
        dates: [explicitDate],
      }],
    };
  }
  const weekday = getWeekday(today);
  const currentWeekDates = [];
  for (let offset = 0; offset <= 7 - weekday; offset += 1) {
    currentWeekDates.push(addDays(today, offset));
  }
  const nextWeekStart = addDays(getMonday(today), 7);
  const nextWeekDates = [];
  for (let offset = 0; offset < 7; offset += 1) {
    nextWeekDates.push(addDays(nextWeekStart, offset));
  }
  return {
    now,
    ranges: [
      { scope: "current_week", dates: currentWeekDates },
      { scope: "next_week", dates: nextWeekDates },
    ],
  };
}

function buildBusyMatrixForDate(courses, date, teachingWeek) {
  const weekday = getWeekday(date);
  const busySections = new Set();
  const activeCourses = [];
  let inactiveFilteredCount = 0;
  let uncertainWeekCoursesCount = 0;
  asArray(courses).forEach((course) => {
    if (Number(course && course.weekday) !== weekday) return;
    const weekStatus = getCourseWeekStatus(course, teachingWeek);
    if (weekStatus.uncertain || !weekStatus.hasWeekInfo) {
      uncertainWeekCoursesCount += 1;
      return;
    }
    if (!weekStatus.active) {
      inactiveFilteredCount += 1;
      return;
    }
    const explicitSections = asArray(course.sections)
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item >= 1 && item <= MAX_SECTION);
    const start = Number(course.startSection || explicitSections[0] || 0);
    const end = Number(course.endSection || explicitSections[explicitSections.length - 1] || start || 0);
    const sections = explicitSections.length
      ? explicitSections
      : Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
    sections.forEach((section) => {
      if (section >= 1 && section <= MAX_SECTION) busySections.add(section);
    });
    activeCourses.push(course);
  });
  return {
    weekday,
    teachingWeek,
    busySections,
    activeCourses,
    inactiveFilteredCount,
    uncertainWeekCoursesCount,
  };
}

function isToday(date, now) {
  return formatDate(date) === formatDate(now);
}

function isSectionStartInFuture(section, now) {
  const sectionTime = getSectionTime(section);
  if (!sectionTime) return false;
  return parseTimeMinutes(sectionTime.start) > minutesOfDate(now);
}

function findContinuousFreeSlots(matrix, options = {}) {
  const duration = toPositiveInt(options.durationSections, 2, 6);
  const date = cloneDateOnly(options.date);
  const now = options.now || new Date();
  const today = isToday(date, now);
  const candidates = [];
  for (let startSection = 1; startSection <= MAX_SECTION - duration + 1; startSection += 1) {
    const endSection = startSection + duration - 1;
    if (today && !isSectionStartInFuture(startSection, now)) continue;
    let free = true;
    for (let section = startSection; section <= endSection; section += 1) {
      if (matrix.busySections.has(section)) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    candidates.push({
      date: formatDate(date),
      dateText: formatDateText(date),
      weekday: matrix.weekday,
      teachingWeek: matrix.teachingWeek,
      startSection,
      endSection,
      sectionText: formatSectionText(startSection, endSection),
      timeText: formatTimeText(startSection, endSection),
      durationSections: duration,
      isToday: today,
      isPast: false,
      score: 0,
      roomCount: 0,
      recommendedRooms: [],
      emptyRoomVerified: false,
      emptyRoomEvidenceText: "尚未核验教室",
      scope: options.scope || "current_week",
      weekUncertain: options.weekUncertain === true,
    });
  }
  return candidates;
}

function rankStudyCandidates(candidates, input = {}, context = {}) {
  const now = parseLocalDateTime(context.clientLocalTime || context.clientTime || new Date()) || new Date();
  const today = cloneDateOnly(now);
  const evening = hasEveningPreference(input);
  const building = String(input.building || "").trim().toLowerCase();
  return asArray(candidates)
    .map((candidate) => {
      const daysAhead = Math.max(0, diffDays(candidate.date, today));
      let score = 1000 - daysAhead * 70;
      if (candidate.scope === "current_week") score += 60;
      if (candidate.weekday >= 1 && candidate.weekday <= 5) score += 20;
      if (candidate.startSection <= 8) score += evening ? -20 : 45;
      if (candidate.startSection >= 11) score += evening ? 45 : -30;
      if (candidate.startSection >= 1 && candidate.startSection <= 4) score += evening ? -8 : 12;
      if (building && candidate.recommendedRooms.some((room) => {
        const text = `${room.roomName || ""} ${room.building || ""}`.toLowerCase();
        return text.includes(building);
      })) {
        score += 80;
      }
      if (candidate.emptyRoomVerified) score += Math.min(60, Number(candidate.roomCount || 0));
      if (candidate.roomCount <= 0 && candidate.emptyRoomVerified) score -= 35;
      return Object.assign({}, candidate, { score });
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const dateDiff = String(left.date).localeCompare(String(right.date));
      if (dateDiff !== 0) return dateDiff;
      return Number(left.startSection) - Number(right.startSection);
    });
}

function buildEmptyRoomQuery(candidate, input = {}, context = {}) {
  return {
    message: input.message || "",
    term: input.term || context.term || "",
    releaseVersion: input.releaseVersion || context.releaseVersion || "",
    date: candidate.date,
    week: candidate.teachingWeek,
    weekday: candidate.weekday,
    sections: `${candidate.startSection}-${candidate.endSection}`,
    minFreeSections: candidate.durationSections,
    building: input.building || "",
    commonOnly: input.commonOnly === undefined ? "true" : input.commonOnly,
    excludeUnknown: input.excludeUnknown === undefined ? "true" : input.excludeUnknown,
  };
}

function attachEmptyRoomEvidence(candidates, input = {}, context = {}, deps = {}) {
  const queryEmptyRooms = typeof deps.queryEmptyRooms === "function" ? deps.queryEmptyRooms : null;
  if (!queryEmptyRooms) {
    return asArray(candidates).map((candidate) => Object.assign({}, candidate, {
      emptyRoomVerified: false,
      emptyRoomEvidenceText: "尚未核验教室",
      roomCount: 0,
      recommendedRooms: [],
    }));
  }
  return asArray(candidates).map((candidate) => {
    const query = buildEmptyRoomQuery(candidate, input, context);
    try {
      const result = queryEmptyRooms(query, context) || {};
      if (result.success === false) {
        return Object.assign({}, candidate, {
          emptyRoomVerified: false,
          emptyRoomEvidenceText: "尚未核验教室",
          emptyRoomResult: result,
          emptyRoomActionUrl: result.actionUrl || "",
          roomCount: 0,
          recommendedRooms: [],
        });
      }
      const rooms = asArray(result.rooms);
      return Object.assign({}, candidate, {
        emptyRoomVerified: true,
        emptyRoomEvidenceText: rooms.length
          ? `空教室索引显示有 ${Number(result.total || rooms.length) || rooms.length} 间候选`
          : "空教室索引暂未找到匹配教室",
        emptyRoomResult: result,
        emptyRoomActionUrl: result.actionUrl || "",
        roomCount: Number(result.total || rooms.length) || 0,
        recommendedRooms: rooms.slice(0, 3).map((room) => ({
          roomName: room.roomName || "",
          building: room.building || room.buildingName || "",
          campus: room.campus || "",
          value: room.freeText || "",
        })),
      });
    } catch (error) {
      return Object.assign({}, candidate, {
        emptyRoomVerified: false,
        emptyRoomEvidenceText: "尚未核验教室",
        roomCount: 0,
        recommendedRooms: [],
      });
    }
  });
}

function formatRecommendationSummary(result = {}) {
  if (result.needContext) {
    return "需要先开启课表摘要或导入 XLS 个人课表，我才能从你的真实课程空档里推荐自习时间。";
  }
  const candidates = asArray(result.candidates);
  if (!candidates.length) {
    return result.weekUncertain
      ? "暂时没有找到满足连续时长的未来空档，且当前教学周不够确定。请确认学期配置后再试。"
      : "本周剩余时间没有找到满足条件的未来空档，已尝试下一教学周后仍无合适候选。";
  }
  const best = candidates[0];
  const weekText = best.weekUncertain ? "教学周待确认" : `第${best.teachingWeek}教学周`;
  const prefix = best.scope === "next_week" ? "本周剩余时间没有合适候选。下周最近适合" : "最近适合";
  const roomText = best.emptyRoomVerified
    ? (best.roomCount > 0
      ? `${best.emptyRoomEvidenceText}，可优先查看 ${best.recommendedRooms[0] && best.recommendedRooms[0].roomName || "空教室列表"}。`
      : "空教室索引暂未找到匹配教室，可换楼栋或节次再试。")
    : "尚未核验教室，请进入空教室页确认。";
  return `${prefix}连续自习 ${best.durationSections} 节的是 ${best.dateText}${best.sectionText}（${weekText}，${best.timeText}）。${roomText}`;
}

function buildRecommendations(input = {}, context = {}, deps = {}) {
  if (!hasScheduleContext(input, context)) {
    return {
      success: true,
      needContext: true,
      durationSections: toPositiveInt(input.durationSections, 2, 6),
      candidates: [],
      weekUncertain: false,
      summary: formatRecommendationSummary({ needContext: true }),
      actionUrl: "/pages/personal-sync/personal-sync?tab=xls",
    };
  }

  const duration = toPositiveInt(input.durationSections, 2, 6);
  const courses = collectCourses(input, context);
  const rangeInfo = resolveRecommendationDateRange(input, context);
  let weekUncertain = false;
  let inactiveFilteredCount = 0;
  let uncertainWeekCoursesCount = 0;
  let chosenScope = "current_week";
  let candidates = [];

  for (const range of rangeInfo.ranges) {
    const rangeCandidates = [];
    range.dates.forEach((date) => {
      const weekInfo = resolveWeekForDate(date, input, context, rangeInfo.now);
      weekUncertain = weekUncertain || weekInfo.weekUncertain;
      const matrix = buildBusyMatrixForDate(courses, date, weekInfo.teachingWeek);
      inactiveFilteredCount += matrix.inactiveFilteredCount;
      uncertainWeekCoursesCount += matrix.uncertainWeekCoursesCount;
      rangeCandidates.push(...findContinuousFreeSlots(matrix, {
        date,
        now: rangeInfo.now,
        durationSections: duration,
        scope: range.scope,
        weekUncertain: weekInfo.weekUncertain,
      }));
    });
    const preRanked = rankStudyCandidates(rangeCandidates, input, context).slice(0, 8);
    const withEvidence = attachEmptyRoomEvidence(preRanked, input, context, deps);
    const ranked = rankStudyCandidates(withEvidence, input, context);
    if (ranked.length) {
      chosenScope = range.scope;
      candidates = ranked;
      break;
    }
  }

  const output = {
    success: true,
    needContext: false,
    durationSections: duration,
    candidates: candidates.slice(0, 5),
    firstCandidate: candidates[0] || null,
    weekUncertain,
    inactiveFilteredCount,
    uncertainWeekCoursesCount,
    scope: chosenScope,
    emptyRoomResult: candidates[0] && candidates[0].emptyRoomResult || null,
    emptyRoomActionUrl: candidates[0] && candidates[0].emptyRoomActionUrl || "/pages/empty-room/empty-room",
  };
  output.summary = formatRecommendationSummary(output);
  return output;
}

module.exports = {
  attachEmptyRoomEvidence,
  buildBusyMatrixForDate,
  buildRecommendations,
  findContinuousFreeSlots,
  formatRecommendationSummary,
  rankStudyCandidates,
  resolveRecommendationDateRange,
  resolveWeekForDate,
};
