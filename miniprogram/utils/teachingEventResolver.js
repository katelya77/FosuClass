const { isCourseInWeek } = require("./week");
const { toRenderableCourse } = require("./courseNormalizer");

function normalizeText(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[\u3000\s]+/g, "")
    .trim()
    .toLowerCase();
}

function displayText(value) {
  return String(value == null ? "" : value).trim();
}

function uniqueTexts(values) {
  const seen = new Set();
  const result = [];
  (values || []).forEach((value) => {
    const text = displayText(value);
    const key = normalizeText(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result;
}

function numberValue(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getCourseName(course) {
  return displayText(course.displayCourseName || course.canonicalCourseName || course.courseName || course.name || course.title);
}

function getTeacherName(course) {
  return displayText(course.displayTeacherName || course.canonicalTeacherName || course.teacherName || course.teacher);
}

function getClassroom(course) {
  return displayText(course.displayClassroom || course.canonicalClassroom || course.classroom || course.roomName || course.location);
}

function getClassNames(course, context) {
  const values = [];
  if (Array.isArray(course.audienceClasses)) values.push.apply(values, course.audienceClasses);
  if (Array.isArray(course.classes)) values.push.apply(values, course.classes);
  if (Array.isArray(course.classNames)) values.push.apply(values, course.classNames);
  values.push(course.className, course.majorName, context && context.targetType === "class" ? context.targetName : "");
  return uniqueTexts(values);
}

function getWeeksKey(course) {
  if (Array.isArray(course.weeks) && course.weeks.length) {
    return course.weeks.slice().map(Number).filter(Number.isFinite).sort((a, b) => a - b).join(",");
  }
  if (course.weekMask !== undefined && course.weekMask !== null) return String(course.weekMask);
  return displayText(course.weekText || `${course.startWeek || ""}-${course.endWeek || ""}`);
}

function sectionsOverlap(left, right) {
  return Number(left.startSection) <= Number(right.endSection) && Number(right.startSection) <= Number(left.endSection);
}

function strictDuplicateKey(course, context) {
  const classKey = getClassNames(course, context).map(normalizeText).join(",");
  return [
    normalizeText(getCourseName(course)),
    normalizeText(getTeacherName(course)),
    normalizeText(getClassroom(course)),
    classKey,
    course.weekday,
    course.startSection,
    course.endSection,
    getWeeksKey(course),
    course.source || course.sourceType || "",
  ].join("|");
}

function sessionGroupKey(course) {
  return [
    normalizeText(getCourseName(course)),
    course.weekday,
    course.startSection,
    course.endSection,
    getWeeksKey(course),
  ].join("|");
}

function eventId(prefix, parts) {
  return `${prefix}-${parts.join("-")}`.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, "-").slice(0, 120);
}

function buildEventFromGroup(group, context, index) {
  const targetType = context.targetType || "class";
  const base = group[0] || {};
  const teachers = uniqueTexts(group.map(getTeacherName));
  const classrooms = uniqueTexts(group.map(getClassroom));
  const audienceClasses = uniqueTexts(group.reduce((values, course) => {
    values.push.apply(values, getClassNames(course, context));
    return values;
  }, []));
  const courseName = getCourseName(base);
  const sameRoom = classrooms.length <= 1;
  const sameTeacher = teachers.length <= 1;
  let eventKind = "single";
  let badgeText = "";
  let subText = "";

  if (group.length > 1) {
    if (targetType === "teacher") {
      if (sameRoom) {
        eventKind = "shared-session";
        badgeText = audienceClasses.length > 1 ? `${audienceClasses.length}个班同堂` : `${group.length}条记录同堂`;
      } else {
        eventKind = "ambiguous";
        badgeText = `${classrooms.length}个地点待核对`;
      }
    } else if (targetType === "class") {
      if (!sameTeacher || !sameRoom) {
        eventKind = "parallel-group";
        badgeText = `${group.length}个教学分组`;
        subText = "按个人选课结果为准";
      } else {
        eventKind = "shared-session";
        badgeText = audienceClasses.length > 1 ? `${audienceClasses.length}个班同堂` : "同堂";
      }
    } else if (targetType === "classroom") {
      eventKind = "shared-session";
      badgeText = audienceClasses.length > 1 ? `${audienceClasses.length}个班同堂` : `${group.length}条同堂记录`;
    } else if (targetType === "course") {
      eventKind = "parallel-group";
      badgeText = `${group.length}个教学分组`;
      subText = "按教学班安排为准";
    } else if (targetType === "personal" || targetType === "student") {
      eventKind = "shared-session";
      badgeText = group.length > 1 ? `${group.length}条来源已合并` : "";
    }
  }

  const displayTeacherName = teachers.length > 1 ? "多个教师" : (teachers[0] || "");
  const displayClassroom = classrooms.length > 1 ? "多个地点" : (classrooms[0] || "");
  const nextEventId = eventId("event", [targetType, base.weekday, base.startSection, base.endSection, normalizeText(courseName), index]);
  return Object.assign({}, base, {
    id: eventKind === "single" ? (base.id || nextEventId) : nextEventId,
    eventId: nextEventId,
    eventKind,
    courseName,
    displayCourseName: courseName,
    canonicalCourseName: courseName,
    teacherName: displayTeacherName,
    displayTeacherName,
    canonicalTeacherName: displayTeacherName,
    classroom: displayClassroom,
    displayClassroom,
    canonicalClassroom: displayClassroom,
    teachers,
    classrooms,
    audienceClasses,
    variants: group,
    groupedItems: group,
    groupedCount: group.length,
    rawRecordCount: group.length,
    badgeText,
    subText,
    isGrouped: eventKind === "parallel-group",
    isTeachingEvent: true,
    isTrueConflict: false,
  });
}

function connectedConflictGroups(events) {
  const groups = [];
  const visited = new Set();
  events.forEach((event, index) => {
    if (visited.has(index)) return;
    const queue = [index];
    const group = [];
    visited.add(index);
    while (queue.length) {
      const currentIndex = queue.shift();
      const current = events[currentIndex];
      group.push(current);
      events.forEach((candidate, candidateIndex) => {
        if (visited.has(candidateIndex)) return;
        if (Number(candidate.weekday) !== Number(current.weekday)) return;
        if (!sectionsOverlap(current, candidate)) return;
        if (normalizeText(current.courseName) === normalizeText(candidate.courseName)) return;
        visited.add(candidateIndex);
        queue.push(candidateIndex);
      });
    }
    groups.push(group);
  });
  return groups.filter((group) => group.length > 1);
}

function shouldDetectTrueConflict(targetType) {
  return targetType !== "course";
}

function buildTrueConflictEvent(group, context, index) {
  const sorted = group.slice().sort((left, right) => {
    if (left.startSection !== right.startSection) return left.startSection - right.startSection;
    return String(left.courseName || "").localeCompare(String(right.courseName || ""));
  });
  const base = sorted[0];
  const startSection = Math.min.apply(null, sorted.map((item) => Number(item.startSection)));
  const endSection = Math.max.apply(null, sorted.map((item) => Number(item.endSection)));
  const conflictCourses = sorted.map((event) => ({
    eventId: event.eventId,
    courseName: event.courseName,
    displayCourseName: event.displayCourseName || event.courseName,
    teacherName: event.displayTeacherName || event.teacherName || "",
    classroom: event.displayClassroom || event.classroom || "",
    startSection: event.startSection,
    endSection: event.endSection,
    weekText: event.weekText || "",
    variants: event.variants || [],
  }));
  return Object.assign({}, base, {
    id: eventId("conflict", [context.targetType || "class", base.weekday, startSection, endSection, index]),
    eventId: eventId("conflict", [context.targetType || "class", base.weekday, startSection, endSection, index]),
    eventKind: "true-conflict",
    isTrueConflict: true,
    courseName: base.courseName,
    displayCourseName: base.courseName,
    startSection,
    endSection,
    badgeText: `冲突 · ${sorted.length}门`,
    subText: "点击查看冲突课程",
    conflictEvents: conflictCourses,
    variants: sorted.reduce((items, event) => items.concat(event.variants || [event]), []),
    rawRecordCount: sorted.reduce((count, event) => count + Number(event.rawRecordCount || 1), 0),
    activeConflictLabel: "",
    inactiveConflictLabel: "",
    lane: 0,
    laneCount: 1,
  });
}

function normalizeInputCourse(course, context, index) {
  const normalized = toRenderableCourse(Object.assign({}, course || {}));
  normalized.weekday = numberValue(normalized.weekday, numberValue(normalized.dayOfWeek, null));
  normalized.startSection = numberValue(normalized.startSection, null);
  normalized.endSection = numberValue(normalized.endSection, normalized.startSection);
  normalized.active = isCourseInWeek(normalized, context.selectedWeek);
  normalized.targetType = context.targetType || normalized.targetType || "";
  normalized._resolverIndex = index;
  return normalized;
}

function resolveTeachingEvents(input = {}) {
  const context = Object.assign({
    courses: [],
    targetType: "class",
    targetId: "",
    targetName: "",
    selectedWeek: 1,
    semester: "",
  }, input || {});

  const normalizedCourses = (context.courses || [])
    .map((course, index) => normalizeInputCourse(course, context, index))
    .filter((course) => course.weekday && course.startSection && course.endSection && getCourseName(course));

  const strictSeen = new Set();
  const uniqueCourses = [];
  normalizedCourses.forEach((course) => {
    const key = strictDuplicateKey(course, context);
    if (strictSeen.has(key)) return;
    strictSeen.add(key);
    uniqueCourses.push(course);
  });

  const groups = new Map();
  uniqueCourses.forEach((course) => {
    const key = sessionGroupKey(course);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(course);
  });

  const baseEvents = Array.from(groups.values()).map((group, index) => buildEventFromGroup(group, context, index));
  const activeEvents = baseEvents.filter((event) => event.active);
  const conflictGroups = shouldDetectTrueConflict(context.targetType)
    ? connectedConflictGroups(activeEvents)
    : [];
  const conflictEventIds = new Set();
  const trueConflictEvents = conflictGroups.map((group, index) => {
    group.forEach((event) => conflictEventIds.add(event.eventId));
    return buildTrueConflictEvent(group, context, index);
  });

  const events = baseEvents
    .filter((event) => !conflictEventIds.has(event.eventId))
    .concat(trueConflictEvents)
    .sort((left, right) => {
      if (Number(left.weekday) !== Number(right.weekday)) return Number(left.weekday) - Number(right.weekday);
      if (Number(left.startSection) !== Number(right.startSection)) return Number(left.startSection) - Number(right.startSection);
      return String(left.eventId || "").localeCompare(String(right.eventId || ""));
    });

  const mergedSessionGroups = events.filter((event) => event.eventKind === "shared-session");
  const parallelGroups = events.filter((event) => event.eventKind === "parallel-group");

  return {
    events,
    trueConflictGroups: trueConflictEvents,
    mergedSessionGroups,
    parallelGroups,
    debugStats: {
      rawCount: (context.courses || []).length,
      normalizedCount: normalizedCourses.length,
      strictDuplicateCount: normalizedCourses.length - uniqueCourses.length,
      eventCount: events.length,
      trueConflictCount: trueConflictEvents.length,
      parallelGroupCount: parallelGroups.length,
      mergedSessionCount: mergedSessionGroups.length,
    },
  };
}

module.exports = {
  normalizeText,
  resolveTeachingEvents,
  sectionsOverlap,
};
