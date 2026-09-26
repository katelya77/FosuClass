const { buildWeekRule } = require("../utils/courseWeekRules");
const { toRenderableCourse } = require("../utils/courseNormalizer");
const { buildWeekText, getScheduleTargetId } = require("./customCourseService");

const STORAGE_PREFIX = "courseOverrides:v1:";
const EDIT_DRAFT_KEY = "FOSU_COURSE_OVERRIDE_EDIT_DRAFT";

function text(value) {
  return String(value == null ? "" : value).trim();
}

function courseName(course) {
  return text(course.displayCourseName || course.canonicalCourseName || course.courseName || course.name);
}

function signature(course) {
  const source = course || {};
  const display = toRenderableCourse(source);
  return [
    courseName(display),
    Number(source.weekday || source.weekDay || 0),
    Number(source.startSection || 0),
    Number(source.endSection || 0),
    text(source.weekText || (Array.isArray(source.weeks) ? source.weeks.join(",") : "")),
  ].join("|");
}

function sourceId(course) {
  return text(course && (course.arrangementId || course.id || course.courseId));
}

function getStorageKey(target) {
  return `${STORAGE_PREFIX}${getScheduleTargetId(target)}`;
}

function getOverrides(target) {
  try {
    const stored = wx.getStorageSync(getStorageKey(target));
    return Array.isArray(stored) ? stored.filter((item) => item && item.signature && item.changes) : [];
  } catch (error) {
    return [];
  }
}

function getSourceEntries(baseCourses) {
  const list = Array.isArray(baseCourses) ? baseCourses : [];
  const signatures = {};
  return list.map((course, index) => {
    const key = signature(course);
    const occurrence = signatures[key] || 0;
    signatures[key] = occurrence + 1;
    return { course, index, sourceId: sourceId(course), signature: key, occurrence };
  });
}

function findSourceEntry(baseCourses, candidate) {
  const entries = getSourceEntries(baseCourses);
  const id = sourceId(candidate);
  if (id) {
    const matched = entries.filter((entry) => entry.sourceId === id);
    if (matched.length === 1) return matched[0];
  }
  const key = signature(candidate);
  const matched = entries.filter((entry) => entry.signature === key);
  return matched.length === 1 ? matched[0] : null;
}

function matchOverride(entries, entry, overrides) {
  const idMatches = entry.sourceId
    ? entries.filter((item) => item.sourceId === entry.sourceId)
    : [];
  const signatureMatches = entries.filter((item) => item.signature === entry.signature);
  return overrides.find((item) => item.sourceId && idMatches.length === 1 && item.sourceId === entry.sourceId) ||
    (signatureMatches.length === 1
      ? overrides.find((item) => item.signature === entry.signature)
      : null);
}

function applyChanges(course, changes, overrideId) {
  const result = Object.assign({}, course, changes, {
    personalized: true,
    courseOverrideId: overrideId,
    courseOverrideSourceId: sourceId(course),
    courseOverrideSignature: signature(course),
  });
  if (Object.prototype.hasOwnProperty.call(changes, "courseName")) {
    result.displayCourseName = changes.courseName;
    result.canonicalCourseName = changes.courseName;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "teacherName")) {
    result.displayTeacherName = changes.teacherName;
    result.canonicalTeacherName = changes.teacherName;
    result.teacher = changes.teacherName;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "classroom")) {
    result.displayClassroom = changes.classroom;
    result.canonicalClassroom = changes.classroom;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "note")) {
    result.remark = changes.note;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "startSection") ||
      Object.prototype.hasOwnProperty.call(changes, "endSection")) {
    result.sections = Array.from({ length: result.endSection - result.startSection + 1 }, (_, index) => result.startSection + index);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "weekText")) {
    const rule = buildWeekRule({ weekText: changes.weekText });
    result.weeks = rule.weeks;
    result.weekType = "all";
    result.startWeek = rule.weeks[0];
    result.endWeek = rule.weeks[rule.weeks.length - 1];
  }
  return result;
}

function applyCourseOverrides(baseCourses, target) {
  const entries = getSourceEntries(baseCourses);
  const overrides = getOverrides(target);
  return entries.map((entry) => {
    const override = matchOverride(entries, entry, overrides);
    return override ? applyChanges(entry.course, override.changes, override.id) : entry.course;
  });
}

function getEditableValues(course) {
  const source = course || {};
  return {
    courseName: courseName(source),
    teacherName: text(source.displayTeacherName || source.canonicalTeacherName || source.teacherName),
    classroom: text(source.displayClassroom || source.canonicalClassroom || source.classroom),
    weekday: Number(source.weekday || source.weekDay || 1),
    startSection: Number(source.startSection || 1),
    endSection: Number(source.endSection || 1),
    weekText: text(source.weekText || buildWeekText(source.weeks)),
    note: text(source.note || source.remark),
  };
}

function getSourceEditableValues(course) {
  return getEditableValues(toRenderableCourse(course || {}));
}

function saveCourseOverride(sourceCourse, values, baseCourses, target) {
  const entry = findSourceEntry(baseCourses, sourceCourse);
  if (!entry) throw new Error("原课程已更新，请重新选择课程");
  const input = getEditableValues(values);
  if (!input.courseName) throw new Error("请填写课程名");
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) throw new Error("请选择有效星期");
  if (!Number.isInteger(input.startSection) || !Number.isInteger(input.endSection) ||
      input.startSection < 1 || input.endSection > 14 || input.endSection < input.startSection) {
    throw new Error("请选择有效节次");
  }
  const weekRule = buildWeekRule({ weekText: input.weekText });
  if (!weekRule.weeks.length) throw new Error("请填写有效周次，如 1-16周");
  const original = getSourceEditableValues(entry.course);
  const changes = {};
  Object.keys(input).forEach((key) => {
    if (input[key] !== original[key]) changes[key] = input[key];
  });
  const overrides = getOverrides(target);
  const current = matchOverride(getSourceEntries(baseCourses), entry, overrides);
  const next = current ? overrides.filter((item) => item.id !== current.id) : overrides;
  if (Object.keys(changes).length) {
    next.push({
      id: current && current.id || `override_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      sourceId: entry.sourceId,
      signature: entry.signature,
      changes,
      updatedAt: new Date().toISOString(),
    });
  }
  wx.setStorageSync(getStorageKey(target), next);
  return Object.keys(changes).length > 0;
}

function restoreCourseOverride(sourceCourse, baseCourses, target) {
  const entry = findSourceEntry(baseCourses, sourceCourse);
  if (!entry) throw new Error("原课程已更新，请重新选择课程");
  const overrides = getOverrides(target);
  const current = matchOverride(getSourceEntries(baseCourses), entry, overrides);
  if (!current) return false;
  wx.setStorageSync(getStorageKey(target), overrides.filter((item) => item.id !== current.id));
  return true;
}

function saveEditDraft(course) {
  wx.setStorageSync(EDIT_DRAFT_KEY, {
    sourceId: text(course && course.courseOverrideSourceId) || sourceId(course),
    signature: text(course && course.courseOverrideSignature) || signature(course),
  });
}

function takeEditDraft() {
  const draft = wx.getStorageSync(EDIT_DRAFT_KEY);
  wx.removeStorageSync(EDIT_DRAFT_KEY);
  return draft || null;
}

module.exports = {
  applyCourseOverrides,
  findSourceEntry,
  getEditableValues,
  getSourceEditableValues,
  getOverrides,
  getSourceEntries,
  restoreCourseOverride,
  saveCourseOverride,
  saveEditDraft,
  takeEditDraft,
};
