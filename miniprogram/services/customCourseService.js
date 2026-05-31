const { colorForCourse } = require("../utils/color");

const CUSTOM_COURSE_DRAFT_KEY = "FOSU_CUSTOM_COURSE_DRAFT";
const CUSTOM_COURSE_KEY_PREFIX = "customCourses:";

function toText(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (maxLength && text.length > maxLength) {
    return text.slice(0, maxLength);
  }
  return text;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `custom_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function getCurrentTarget() {
  try {
    const { getCurrentScheduleTarget } = require("../utils/storage");
    return getCurrentScheduleTarget();
  } catch (error) {
    return null;
  }
}

function getScheduleTargetId(target) {
  const item = target || getCurrentTarget() || {};
  const parts = [
    item.type || "class",
    item.semester || "2025-2026-2",
    item.classId || item.scheduleKey || item.name || item.className || "default",
  ];
  return parts.map((part) => encodeURIComponent(String(part || ""))).join(":");
}

function getStorageKey(target) {
  return `${CUSTOM_COURSE_KEY_PREFIX}${getScheduleTargetId(target)}`;
}

function parseWeeksText(weekText) {
  const text = toText(weekText).replace(/\s+/g, "").replace(/周/g, "");
  if (!text) {
    return [];
  }
  const weeks = [];
  text.split(/[,，]/).forEach((part) => {
    if (!part) return;
    if (part.indexOf("-") >= 0) {
      const nums = part.split("-").map((item) => Number(item));
      const start = nums[0];
      const end = nums[1];
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
        for (let week = start; week <= end; week += 1) {
          weeks.push(week);
        }
      }
      return;
    }
    const single = Number(part);
    if (Number.isFinite(single)) {
      weeks.push(single);
    }
  });
  return Array.from(new Set(weeks)).sort((left, right) => left - right);
}

function buildWeekText(weeks) {
  const list = Array.from(new Set((weeks || []).map(Number).filter(Boolean))).sort((a, b) => a - b);
  if (!list.length) {
    return "";
  }
  const ranges = [];
  let start = list[0];
  let prev = list[0];
  for (let i = 1; i <= list.length; i += 1) {
    const current = list[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? String(start) : `${start}-${prev}`);
    start = current;
    prev = current;
  }
  return `${ranges.join(",")}周`;
}

function normalizeCustomCourse(raw, existing) {
  const source = raw || {};
  const base = existing || {};
  const startSection = Number(source.startSection || source.sections?.[0] || base.startSection || 1);
  const endSection = Number(source.endSection || source.sections?.[source.sections.length - 1] || base.endSection || startSection);
  const weekday = Math.min(7, Math.max(1, Number(source.weekday || source.weekDay || base.weekday || base.weekDay || 1)));
  const weekText = toText(source.weekText !== undefined ? source.weekText : base.weekText, 80);
  const weeks = Array.isArray(source.weeks) && source.weeks.length
    ? source.weeks.map(Number).filter(Boolean)
    : (parseWeeksText(weekText).length ? parseWeeksText(weekText) : (Array.isArray(base.weeks) ? base.weeks : []));
  const finalWeekText = weekText || buildWeekText(weeks);
  const now = nowIso();
  const courseName = toText(
    source.courseName !== undefined
      ? source.courseName
      : (source.displayCourseName || source.canonicalCourseName || base.courseName),
    80
  );
  if (!courseName) {
    const err = new Error("courseName is required");
    err.message = "请填写课程名";
    throw err;
  }
  if (!Number.isFinite(startSection) || !Number.isFinite(endSection) || startSection < 1 || endSection < startSection) {
    const err = new Error("invalid sections");
    err.message = "请填写有效节次";
    throw err;
  }
  return {
    id: base.id || source.id || makeId(),
    courseName,
    teacherName: toText(source.teacherName !== undefined ? source.teacherName : (source.displayTeacherName || source.canonicalTeacherName || base.teacherName), 80),
    classroom: toText(source.classroom !== undefined ? source.classroom : (source.displayClassroom || source.canonicalClassroom || base.classroom), 120),
    weekday,
    weekDay: weekday,
    sections: Array.isArray(source.sections) && source.sections.length
      ? source.sections.map(Number)
      : Array.from({ length: endSection - startSection + 1 }, (_, index) => startSection + index),
    startSection,
    endSection,
    weekText: finalWeekText,
    weeks,
    startWeek: weeks[0] || Number(source.startWeek || base.startWeek || 1),
    endWeek: weeks[weeks.length - 1] || Number(source.endWeek || base.endWeek || 20),
    color: toText(source.color !== undefined ? source.color : base.color, 32) || colorForCourse(courseName),
    note: toText(source.note !== undefined ? source.note : base.note, 500),
    remark: toText(source.note !== undefined ? source.note : base.note, 500),
    source: "custom",
    sourceType: "custom",
    custom: true,
    enabled: source.enabled === undefined ? (base.enabled !== false) : Boolean(source.enabled),
    createdAt: base.createdAt || now,
    updatedAt: now,
  };
}

function getCustomCourses(target) {
  try {
    const data = wx.getStorageSync(getStorageKey(target));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

function saveCustomCourses(courses, target) {
  const list = Array.isArray(courses) ? courses : [];
  wx.setStorageSync(getStorageKey(target), list);
  return list;
}

function getEnabledCustomCourses(target) {
  return getCustomCourses(target).filter((course) => course.enabled !== false);
}

function upsertCustomCourse(course, target) {
  const list = getCustomCourses(target);
  const index = list.findIndex((item) => item.id === course.id);
  const normalized = normalizeCustomCourse(course, index >= 0 ? list[index] : null);
  if (index >= 0) {
    list[index] = normalized;
  } else {
    list.unshift(normalized);
  }
  saveCustomCourses(list, target);
  return normalized;
}

function deleteCustomCourse(id, target) {
  const list = getCustomCourses(target).filter((item) => item.id !== id);
  saveCustomCourses(list, target);
  return list;
}

function toggleCustomCourse(id, enabled, target) {
  const list = getCustomCourses(target).map((item) => {
    if (item.id !== id) return item;
    return Object.assign({}, item, {
      enabled: Boolean(enabled),
      updatedAt: nowIso(),
    });
  });
  saveCustomCourses(list, target);
  return list;
}

function saveCustomCourseDraft(course) {
  const draft = normalizeCustomCourse(Object.assign({}, course || {}, {
    id: "",
    source: "custom",
    sourceType: "custom",
    enabled: true,
    note: course && (course.note || course.remark || ""),
  }));
  wx.setStorageSync(CUSTOM_COURSE_DRAFT_KEY, draft);
  return draft;
}

function takeCustomCourseDraft() {
  const draft = wx.getStorageSync(CUSTOM_COURSE_DRAFT_KEY);
  wx.removeStorageSync(CUSTOM_COURSE_DRAFT_KEY);
  return draft || null;
}

module.exports = {
  CUSTOM_COURSE_DRAFT_KEY,
  CUSTOM_COURSE_KEY_PREFIX,
  buildWeekText,
  deleteCustomCourse,
  getCustomCourses,
  getEnabledCustomCourses,
  getScheduleTargetId,
  getStorageKey,
  normalizeCustomCourse,
  parseWeeksText,
  saveCustomCourseDraft,
  saveCustomCourses,
  takeCustomCourseDraft,
  toggleCustomCourse,
  upsertCustomCourse,
};
