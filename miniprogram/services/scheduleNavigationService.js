/**
 * Shared Schedule Navigation — class / teacher / classroom / course.
 * Reuses /pages/schedule-view/schedule-view; never passes full courses via URL.
 * Used by school page and 小佛助手 Action Bus (navigate whitelist).
 */
const scheduleNavigator = require("./scheduleNavigator");

const TYPE_LABELS = Object.freeze({
  class: "班级课表",
  teacher: "教师课表",
  classroom: "教室课表",
  course: "课程课表",
  room: "教室课表",
});

function normalizeType(type) {
  return scheduleNavigator.normalizeType(type);
}

function openLabelForType(type) {
  const t = normalizeType(type);
  return `打开${TYPE_LABELS[t] || "课表"}`;
}

/**
 * Build schedule-view URL params (no courses array).
 * @returns {{ type:string, id:string, name:string, term:string, releaseVersion:string, displayType?:string, isAggregated?:string }}
 */
function buildScheduleViewParams(input = {}) {
  const type = normalizeType(input.type || input.targetType);
  const id = String(input.id || input.detailId || input.scheduleId || "").trim();
  const name = String(input.name || input.keyword || input.targetName || input.teacherName || input.className || input.roomName || input.courseName || "").trim();
  const term = String(input.term || input.semester || "").trim();
  const releaseVersion = String(input.releaseVersion || input.version || input.scheduleVersion || "").trim();
  return {
    type,
    id: id || name,
    name,
    term,
    semester: term,
    releaseVersion,
    displayType: input.displayType ? String(input.displayType) : "",
    isAggregated: input.isAggregated ? "1" : "",
  };
}

function buildScheduleViewUrl(input = {}) {
  return scheduleNavigator.buildScheduleViewUrl(buildScheduleViewParams(input));
}

/**
 * School page fallback with pending query when detailId is missing.
 */
function buildSchoolPendingParams(input = {}) {
  const type = normalizeType(input.type || input.targetType);
  const keyword = String(input.keyword || input.name || input.targetName || "").trim();
  return {
    type,
    keyword,
    q: keyword,
    term: input.term || input.semester || "",
    semester: input.semester || input.term || "",
    releaseVersion: input.releaseVersion || input.version || "",
    collegeCode: input.collegeCode || "",
    collegeName: input.collegeName || "",
    fromAiAssistant: true,
  };
}

/**
 * Resolve navigation for a search/result item.
 * @returns {{ mode:'schedule-view'|'school', url:string, label:string, params:object, reasonCode?:string }}
 */
function resolveScheduleNavigation(input = {}) {
  const type = normalizeType(input.type || input.targetType);
  const detailId = String(input.id || input.detailId || input.scheduleId || "").trim();
  const name = String(input.name || input.keyword || input.targetName || "").trim();
  const releaseVersion = String(input.releaseVersion || input.version || "").trim();
  const label = openLabelForType(type);

  if (detailId && (releaseVersion || input.allowMissingReleaseVersion)) {
    const params = buildScheduleViewParams(Object.assign({}, input, { id: detailId, name, type }));
    return {
      mode: "schedule-view",
      url: scheduleNavigator.buildScheduleViewUrl(params),
      label,
      params,
    };
  }

  // detailId missing → degrade to school page with pending query
  const pending = buildSchoolPendingParams(Object.assign({}, input, { type, name, keyword: name }));
  return {
    mode: "school",
    url: scheduleNavigator.buildSchoolUrl(pending),
    label: "打开全校查询",
    params: pending,
    reasonCode: detailId ? "RELEASE_VERSION_MISSING" : "DETAIL_ID_MISSING",
  };
}

/**
 * Action Bus navigate command for unique exact result.
 */
function buildOpenScheduleAction(input = {}) {
  const resolved = resolveScheduleNavigation(input);
  if (resolved.mode === "schedule-view") {
    return {
      command: "navigate",
      type: "navigate",
      label: resolved.label,
      input: {
        url: "/pages/schedule-view/schedule-view",
        params: {
          type: resolved.params.type,
          id: resolved.params.id,
          name: resolved.params.name,
          term: resolved.params.term,
          releaseVersion: resolved.params.releaseVersion,
        },
      },
      url: resolved.url,
    };
  }
  return {
    command: "navigate",
    type: "navigate",
    label: resolved.label,
    input: {
      url: "/pages/school/school",
      params: resolved.params,
    },
    url: resolved.url,
    reasonCode: resolved.reasonCode,
  };
}

/**
 * Multi-candidate row action (each row clickable with detailId).
 */
function buildCandidateRowAction(item = {}, type, meta = {}) {
  return buildOpenScheduleAction(Object.assign({}, meta, item, {
    type,
    id: item.id || item.detailId,
    detailId: item.detailId || item.id,
    name: item.name || item.teacherName || item.className || item.roomName || item.courseName,
  }));
}

/**
 * Navigate via wx when available; returns url always (testable without wx).
 */
function navigateToResolved(resolved) {
  if (!resolved || !resolved.url) return "";
  if (typeof wx === "undefined") return resolved.url;
  if (resolved.mode === "school") {
    try {
      wx.setStorageSync("FOSU_AI_PENDING_SCHOOL_QUERY", Object.assign({}, resolved.params, {
        ts: Date.now(),
      }));
    } catch (e) { /* switchTab still opens */ }
    wx.switchTab({ url: "/pages/school/school" });
    return resolved.url;
  }
  wx.navigateTo({ url: resolved.url });
  return resolved.url;
}

function navigateOpenSchedule(input = {}) {
  const resolved = resolveScheduleNavigation(input);
  return navigateToResolved(resolved);
}

module.exports = {
  TYPE_LABELS,
  normalizeType,
  openLabelForType,
  buildScheduleViewParams,
  buildScheduleViewUrl,
  buildSchoolPendingParams,
  resolveScheduleNavigation,
  buildOpenScheduleAction,
  buildCandidateRowAction,
  navigateToResolved,
  navigateOpenSchedule,
};
