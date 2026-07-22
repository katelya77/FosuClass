const safetyGuard = require("./safetyGuard");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value, max) {
  return safetyGuard.redactSensitiveText(String(value == null ? "" : value)).trim().slice(0, max || 80);
}

function normalizeCourse(course) {
  const source = course && typeof course === "object" ? course : {};
  const startSection = Math.max(0, Math.min(14, Number(source.startSection || source.sectionStart || 0) || 0));
  const endSection = Math.max(startSection, Math.min(14, Number(source.endSection || source.sectionEnd || startSection || 0) || startSection));
  return {
    courseName: safeText(source.courseName || source.name || "未命名课程", 60),
    teacherName: safeText(source.teacherName || source.teacher || "", 40),
    classroom: safeText(source.classroom || source.roomName || source.classroomName || "", 60),
    campus: safeText(source.campus || "", 24),
    weekday: Math.max(0, Math.min(7, Number(source.weekday || source.weekDay || 0) || 0)),
    startSection,
    endSection,
    weeks: Array.from(new Set(asArray(source.weeks).map(Number).filter(Number.isFinite))).sort((a, b) => a - b).slice(0, 40),
    weekText: safeText(source.weekText || source.rawWeek || "", 80),
  };
}

function courseKey(course) {
  const item = normalizeCourse(course);
  return [item.courseName, item.teacherName, item.classroom, item.weekday, item.startSection, item.endSection, item.weeks.join(",")].join("|").toLowerCase();
}

function buildingOf(classroom) {
  const match = safeText(classroom, 60).match(/\b([A-Z]\d{1,2})\b/i);
  return match ? match[1].toUpperCase() : "";
}

function weeksOverlap(left, right) {
  const a = asArray(left.weeks);
  const b = asArray(right.weeks);
  if (!a.length || !b.length) return true;
  const set = new Set(a);
  return b.some((week) => set.has(week));
}

function inspectScheduleConflicts(input = {}) {
  const summary = input.currentScheduleSummary || input.schedule || {};
  const courses = asArray(summary.courses).map(normalizeCourse);
  if (!summary.enabled || !courses.length) {
    return {
      success: true,
      needContext: true,
      duplicateCourses: [],
      timeConflicts: [],
      missingClassrooms: [],
      abnormalWeeks: [],
      rushedTransfers: [],
      summary: "没有可核验的个人课表摘要，请先导入课表。",
      actionUrl: "/pages/personal-sync/personal-sync",
    };
  }

  const groups = new Map();
  courses.forEach((course) => {
    const key = courseKey(course);
    const group = groups.get(key) || [];
    group.push(course);
    groups.set(key, group);
  });
  const duplicateCourses = Array.from(groups.values()).filter((items) => items.length > 1).map((items) => ({
    courseName: items[0].courseName,
    weekday: items[0].weekday,
    startSection: items[0].startSection,
    endSection: items[0].endSection,
    count: items.length,
  }));
  const uniqueCourses = Array.from(groups.values()).map((items) => items[0]);

  const timeConflicts = [];
  for (let leftIndex = 0; leftIndex < uniqueCourses.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < uniqueCourses.length; rightIndex += 1) {
      const left = uniqueCourses[leftIndex];
      const right = uniqueCourses[rightIndex];
      if (!left.weekday || left.weekday !== right.weekday || !weeksOverlap(left, right)) continue;
      if (left.startSection <= right.endSection && right.startSection <= left.endSection) {
        timeConflicts.push({
          weekday: left.weekday,
          startSection: Math.max(left.startSection, right.startSection),
          endSection: Math.min(left.endSection, right.endSection),
          courseNames: [left.courseName, right.courseName],
          classrooms: [left.classroom, right.classroom].filter(Boolean),
        });
      }
    }
  }

  const missingClassrooms = courses.filter((course) => !course.classroom).map((course) => ({
    courseName: course.courseName,
    weekday: course.weekday,
    startSection: course.startSection,
    endSection: course.endSection,
  }));
  const totalWeeks = Math.max(1, Number(input.totalWeeks || 22) || 22);
  const abnormalWeeks = courses.filter((course) => course.weeks.some((week) => week < 1 || week > totalWeeks)).map((course) => ({
    courseName: course.courseName,
    invalidWeeks: course.weeks.filter((week) => week < 1 || week > totalWeeks),
    totalWeeks,
  }));

  const rushedTransfers = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const day = uniqueCourses.filter((course) => course.weekday === weekday)
      .sort((left, right) => left.startSection - right.startSection || left.endSection - right.endSection);
    for (let index = 0; index < day.length - 1; index += 1) {
      const from = day[index];
      const to = day[index + 1];
      const fromBuilding = buildingOf(from.classroom);
      const toBuilding = buildingOf(to.classroom);
      if (!fromBuilding || !toBuilding || fromBuilding === toBuilding || !weeksOverlap(from, to)) continue;
      if (to.startSection <= from.endSection + 1) {
        rushedTransfers.push({
          weekday,
          fromCourse: from.courseName,
          toCourse: to.courseName,
          fromBuilding,
          toBuilding,
          gapSections: Math.max(0, to.startSection - from.endSection - 1),
          preciseRouteAvailable: false,
        });
      }
    }
  }

  const issueCount = duplicateCourses.length + timeConflicts.length + missingClassrooms.length + abnormalWeeks.length + rushedTransfers.length;
  return {
    success: true,
    needContext: false,
    duplicateCourses,
    timeConflicts,
    missingClassrooms,
    abnormalWeeks,
    rushedTransfers,
    issueCount,
    summary: issueCount
      ? `发现 ${timeConflicts.length} 处时间冲突、${duplicateCourses.length} 组重复课程和 ${rushedTransfers.length} 处连续赶课风险。`
      : "本周课表未发现重复、时间冲突或连续赶课风险。",
    actionUrl: "/pages/personal-sync/personal-sync",
  };
}

function changedFields(previous, current) {
  const fields = [];
  if (previous.teacherName !== current.teacherName) fields.push("teacherName");
  if (previous.classroom !== current.classroom || previous.campus !== current.campus) fields.push("classroom");
  if (previous.weekday !== current.weekday || previous.startSection !== current.startSection || previous.endSection !== current.endSection) fields.push("time");
  if (previous.weeks.join(",") !== current.weeks.join(",") || previous.weekText !== current.weekText) fields.push("weeks");
  return fields;
}

function detectScheduleChanges(input = {}) {
  const currentSummary = input.currentScheduleSummary || input.current || {};
  const baselineSummary = input.baselineScheduleSummary || input.previousScheduleSummary || input.baseline || {};
  const current = asArray(currentSummary.courses).map(normalizeCourse);
  const baseline = asArray(baselineSummary.courses).map(normalizeCourse);
  if (!currentSummary.enabled || !current.length) {
    return { success: true, needContext: true, baselineRequired: false, changed: false, changes: [], summary: "没有当前个人课表摘要。", actionUrl: "/pages/personal-sync/personal-sync" };
  }
  if (!baselineSummary.enabled || !baseline.length) {
    return { success: true, needContext: false, baselineRequired: true, changed: false, changes: [], summary: "尚无上一版个人课表摘要，已建立本机对比基线。" };
  }

  const usedCurrent = new Set();
  const changes = [];
  baseline.forEach((previous) => {
    let matchIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    current.forEach((candidate, index) => {
      if (usedCurrent.has(index) || candidate.courseName !== previous.courseName) return;
      const fields = changedFields(previous, candidate);
      if (fields.length < bestScore) {
        bestScore = fields.length;
        matchIndex = index;
      }
    });
    if (matchIndex < 0) {
      changes.push({ type: "removed", courseName: previous.courseName, before: previous, after: null, fields: [] });
      return;
    }
    usedCurrent.add(matchIndex);
    const after = current[matchIndex];
    const fields = changedFields(previous, after);
    if (fields.length) changes.push({ type: "modified", courseName: previous.courseName, before: previous, after, fields });
  });
  current.forEach((course, index) => {
    if (!usedCurrent.has(index)) changes.push({ type: "added", courseName: course.courseName, before: null, after: course, fields: [] });
  });

  return {
    success: true,
    needContext: false,
    baselineRequired: false,
    changed: changes.length > 0,
    currentFingerprint: safeText(currentSummary.fingerprint || "", 80),
    baselineFingerprint: safeText(baselineSummary.fingerprint || "", 80),
    changes: changes.slice(0, 40),
    summary: changes.length ? `检测到 ${changes.length} 项课表变化，请核对后决定是否重新导入。` : "个人课表与上一版摘要一致。",
    actionUrl: "/pages/personal-sync/personal-sync",
  };
}

function subtractMinutes(timeText, minutes) {
  const match = safeText(timeText, 20).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const total = Number(match[1]) * 60 + Number(match[2]) - Number(minutes || 0);
  const normalized = (total + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function buildDepartureAdvice(input = {}) {
  const course = normalizeCourse(input.course || {});
  const sourceCourse = input.course || {};
  const timeText = safeText(sourceCourse.startTime || sourceCourse.timeText || "", 32);
  const startTime = (timeText.match(/\d{1,2}:\d{2}/) || [""])[0];
  if (!course.courseName || course.courseName === "未命名课程" || !startTime) {
    return { success: false, code: "COURSE_TIME_REQUIRED", summary: "缺少可核验的课程开始时间，无法计算出发建议。" };
  }
  const walkingBufferMinutes = Math.max(5, Math.min(90, Number(input.walkingBufferMinutes || 20) || 20));
  const weather = input.weather && typeof input.weather === "object" ? input.weather : {};
  const rainProbability = Number(weather.rainProbabilityMax24h || weather.rainProbability || 0) || 0;
  const weatherBufferMinutes = weather.success !== false && (rainProbability >= 50 || /雨|雷/.test(String(weather.weatherText || ""))) ? 10 : 0;
  const totalBufferMinutes = walkingBufferMinutes + weatherBufferMinutes;
  return {
    success: true,
    courseName: course.courseName,
    classroom: course.classroom,
    campus: course.campus,
    date: safeText(sourceCourse.date || input.date || "", 10),
    startTime,
    from: safeText(input.from || "当前位置", 40),
    departureTime: subtractMinutes(startTime, totalBufferMinutes),
    walkingBufferMinutes,
    weatherBufferMinutes,
    totalBufferMinutes,
    preciseRouteAvailable: false,
    assumptions: [
      `当前校园地图没有精确步行路线，按 ${walkingBufferMinutes} 分钟通用课前缓冲估算（非精确路线时长）。`,
      weatherBufferMinutes ? "天气数据显示有降雨风险，额外预留 10 分钟。" : "未因天气额外增加缓冲。",
    ],
    summary: `建议 ${subtractMinutes(startTime, totalBufferMinutes)} 左右出发，${startTime} 前到达 ${course.classroom || "上课地点"}。`,
    actionUrl: "/packageMaps/pages/campus-map/campus-map",
  };
}

module.exports = {
  buildDepartureAdvice,
  buildingOf,
  courseKey,
  detectScheduleChanges,
  inspectScheduleConflicts,
  normalizeCourse,
  subtractMinutes,
  weeksOverlap,
};
