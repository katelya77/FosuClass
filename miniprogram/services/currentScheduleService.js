const releasePackService = require("./releasePackService");
const startupCoordinator = require("./startupCoordinator");
const appConfigService = require("./appConfigService");
const {
  getCurrentScheduleTarget,
  setCurrentScheduleTarget,
  addRecentSchedule,
  getScheduleDetailCacheKey,
} = require("../utils/storage");

const REFRESH_STATE_KEY = "FOSU_CURRENT_SCHEDULE_REFRESH_STATE";
const NOTICE_STATE_KEY = "FOSU_CURRENT_SCHEDULE_NOTICE_STATE";
const REFRESH_COOLDOWN_MS = 60 * 1000;
const SUCCESS_NOTICE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REFRESHABLE_TYPES = ["class", "teacher", "classroom", "course"];

const inflight = new Map();

function readStorage(key) {
  try {
    return wx.getStorageSync(key);
  } catch (error) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    // ignore storage quota or platform failures; last-known-good target remains usable.
  }
}

function removeStorage(key) {
  try {
    wx.removeStorageSync(key);
  } catch (error) {
    // ignore
  }
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function displayNameForType(type, source = {}) {
  if (type === "class") return source.className || source.name || source.displayTitle || source.title || "";
  if (type === "teacher") return source.teacherName || source.displayName || source.name || source.title || "";
  if (type === "classroom") return source.roomName || source.classroomName || source.displayName || source.name || source.title || "";
  if (type === "course") return source.courseName || source.displayCourseName || source.canonicalCourseName || source.displayName || source.name || source.title || "";
  return source.name || source.title || "";
}

function candidateIds(target = {}) {
  return [
    target.detailId,
    target.id,
    target.scheduleId,
    target.classId,
    target.teacherId,
    target.classroomId,
    target.courseId,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function itemDetailId(type, item = {}) {
  return String(
    item.detailId ||
    item.id ||
    item.scheduleId ||
    item.classId ||
    item.teacherId ||
    item.classroomId ||
    item.courseId ||
    displayNameForType(type, item)
  ).trim();
}

function normalizeActiveSnapshot(source = {}) {
  const data = source.activeSnapshot || source.manifest || source.pointer || source;
  const term = data.term || data.activeTerm || data.semester || data.termConfig && data.termConfig.term || "";
  const releaseVersion = data.releaseVersion || data.version || "";
  if (!term || !releaseVersion) return null;
  return {
    term,
    semester: term,
    releaseVersion,
    cacheEpoch: data.cacheEpoch || "",
    forceRefreshToken: data.forceRefreshToken || "",
    updatedAt: data.updatedAt || data.publishedAt || "",
    manifest: source.manifest || data.manifest || null,
    pointer: source.pointer || null,
  };
}

function getCachedActiveSnapshot() {
  const app = typeof getApp === "function" ? getApp() : null;
  const active = app && app.globalData && app.globalData.activeRelease;
  const normalized = normalizeActiveSnapshot(active || {});
  if (normalized) return normalized;

  const config = appConfigService.getGlobalConfig && appConfigService.getGlobalConfig() || {};
  const version = config.dataVersion || {};
  return normalizeActiveSnapshot({
    term: config.currentSemester || config.term || config.termConfig && config.termConfig.term || "",
    releaseVersion: config.releaseVersion || config.activeReleaseVersion || version.releaseVersion || "",
    cacheEpoch: config.cacheEpoch || version.cacheEpoch || "",
    forceRefreshToken: config.forceRefreshToken || version.forceRefreshToken || "",
    updatedAt: appConfigService.getLatestDataUpdatedAt ? appConfigService.getLatestDataUpdatedAt(config) : "",
  });
}

async function resolveActiveSnapshot(options = {}) {
  if (options.activeSnapshot) {
    const direct = normalizeActiveSnapshot(options.activeSnapshot);
    if (direct) return direct;
  }

  if (!options.forceNetwork) {
    const cached = getCachedActiveSnapshot();
    if (cached) return cached;
  }

  const pointer = await startupCoordinator.resolveRuntimePointer({
    timeout: options.pointerTimeout || 5000,
    retries: 0,
    forceNetwork: Boolean(options.forceNetwork || options.forcePointer),
  });
  const pointerSnapshot = normalizeActiveSnapshot(pointer || {});
  if (!pointerSnapshot) {
    const fallback = getCachedActiveSnapshot();
    if (fallback) return fallback;
    const error = new Error("ACTIVE_SNAPSHOT_UNAVAILABLE");
    error.code = "ACTIVE_SNAPSHOT_UNAVAILABLE";
    throw error;
  }

  const switched = await releasePackService.switchReleaseSafely({
    term: pointerSnapshot.term,
    releaseVersion: pointerSnapshot.releaseVersion,
    pointer,
    dedupe: true,
    forceNetwork: Boolean(options.forceNetwork && !pointer.fromStorage && !pointer.circuitOpen),
    skipWarmup: true,
    timeout: options.manifestTimeout || 6000,
    retries: 0,
    skipSession: true,
  }).catch(() => null);

  const manifest = switched && switched.manifest;
  const result = normalizeActiveSnapshot({
    term: switched && switched.term || pointerSnapshot.term,
    releaseVersion: switched && switched.releaseVersion || pointerSnapshot.releaseVersion,
    cacheEpoch: manifest && manifest.cacheEpoch || pointerSnapshot.cacheEpoch,
    forceRefreshToken: manifest && manifest.forceRefreshToken || pointerSnapshot.forceRefreshToken,
    updatedAt: manifest && manifest.updatedAt || pointerSnapshot.updatedAt,
    manifest,
    pointer,
  });

  if (result) return result;
  return pointerSnapshot;
}

function sameContentRelease(target, active) {
  if (!target || !active) return false;
  const targetTerm = target.term || target.semester || "";
  return targetTerm === active.term && String(target.releaseVersion || "") === String(active.releaseVersion || "");
}

function getRefreshStateKey(target, active) {
  return [
    target.type || "",
    target.detailId || target.id || target.classId || target.name || "",
    active.term || "",
    active.releaseVersion || "",
  ].join(":");
}

function shouldSkipCooldown(target, active, options = {}) {
  if (options.force) return false;
  const state = readStorage(REFRESH_STATE_KEY) || {};
  const key = getRefreshStateKey(target, active);
  return state.key === key && Date.now() - Number(state.checkedAt || 0) < REFRESH_COOLDOWN_MS;
}

function rememberRefreshState(target, active, status) {
  writeStorage(REFRESH_STATE_KEY, {
    key: getRefreshStateKey(target, active),
    type: target.type || "",
    id: target.detailId || target.id || target.classId || "",
    term: active.term || "",
    releaseVersion: active.releaseVersion || "",
    status,
    checkedAt: Date.now(),
  });
}

function shouldNotifyUpdated(active) {
  const state = readStorage(NOTICE_STATE_KEY) || {};
  const sameRelease = state.lastNotifiedTerm === active.term &&
    state.lastNotifiedReleaseVersion === active.releaseVersion;
  if (sameRelease && Date.now() - Number(state.lastNotifiedAt || 0) < SUCCESS_NOTICE_COOLDOWN_MS) {
    return false;
  }
  writeStorage(NOTICE_STATE_KEY, {
    lastNotifiedTerm: active.term,
    lastNotifiedReleaseVersion: active.releaseVersion,
    lastNotifiedAt: Date.now(),
  });
  return true;
}

function buildExactNameMatches(type, items, target) {
  const targetName = normalizeText(target.name || target.className || target.title || "");
  if (!targetName) return [];
  return (items || []).filter((item) => normalizeText(displayNameForType(type, item)) === targetName);
}

async function loadDetailByStableId(target, active, options = {}) {
  const ids = candidateIds(target);
  let lastError = null;
  for (const id of ids) {
    try {
      const detail = await releasePackService.loadDetail(target.type, id, {
        term: active.term,
        releaseVersion: active.releaseVersion,
      }, {
        forceNetwork: Boolean(options.forceNetwork),
        timeout: options.detailTimeout || 9000,
        retries: options.retries === undefined ? 1 : options.retries,
        skipSession: true,
      });
      return { detail, detailId: id, resolvedBy: "stable-id" };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  const error = new Error("DETAIL_ID_MISSING");
  error.code = "DETAIL_ID_MISSING";
  throw error;
}

async function loadDetailByExactName(target, active, options = {}) {
  const index = await releasePackService.loadIndex(target.type, {
    term: active.term,
    releaseVersion: active.releaseVersion,
  }, {
    forceNetwork: Boolean(options.forceNetwork),
    timeout: options.indexTimeout || 9000,
    retries: options.retries === undefined ? 1 : options.retries,
    skipSession: true,
  });
  const matches = buildExactNameMatches(target.type, index.items || [], target);
  if (matches.length > 1) {
    const error = new Error("CURRENT_SCHEDULE_AMBIGUOUS_MATCH");
    error.code = "CURRENT_SCHEDULE_AMBIGUOUS_MATCH";
    error.matches = matches.map((item) => ({
      id: itemDetailId(target.type, item),
      name: displayNameForType(target.type, item),
    }));
    throw error;
  }
  if (!matches.length) {
    const error = new Error("CURRENT_SCHEDULE_NOT_FOUND");
    error.code = "CURRENT_SCHEDULE_NOT_FOUND";
    throw error;
  }
  const item = matches[0];
  const id = itemDetailId(target.type, item);
  const detail = await releasePackService.loadDetail(target.type, id, {
    term: active.term,
    releaseVersion: active.releaseVersion,
  }, {
    forceNetwork: Boolean(options.forceNetwork),
    timeout: options.detailTimeout || 9000,
    retries: options.retries === undefined ? 1 : options.retries,
    skipSession: true,
  });
  return { detail, detailId: id, indexItem: item, resolvedBy: "exact-name" };
}

function validateDetail(target, active, loaded) {
  const payload = loaded && loaded.detail;
  const schedule = payload && (payload.schedule || payload.detail) || {};
  const courses = Array.isArray(schedule.courses) ? schedule.courses : [];
  const releaseVersion = payload && (payload.releaseVersion || payload.version) || "";
  const term = payload && (payload.term || payload.semester || schedule.term || schedule.semester) || "";
  if (releaseVersion !== active.releaseVersion) {
    const error = new Error("CURRENT_SCHEDULE_RELEASE_MISMATCH");
    error.code = "CURRENT_SCHEDULE_RELEASE_MISMATCH";
    throw error;
  }
  if (term && term !== active.term) {
    const error = new Error("CURRENT_SCHEDULE_TERM_MISMATCH");
    error.code = "CURRENT_SCHEDULE_TERM_MISMATCH";
    throw error;
  }
  if (!Array.isArray(schedule.courses)) {
    const error = new Error("CURRENT_SCHEDULE_INVALID_COURSES");
    error.code = "CURRENT_SCHEDULE_INVALID_COURSES";
    throw error;
  }
  const targetName = normalizeText(target.name || target.className || target.title || "");
  const scheduleName = normalizeText(displayNameForType(target.type, schedule));
  const stableIds = candidateIds(target).map(normalizeText);
  const loadedIds = candidateIds(Object.assign({}, schedule, {
    id: payload && payload.id || schedule.id,
    detailId: loaded.detailId || schedule.detailId,
  })).map(normalizeText);
  const idMatches = stableIds.length && loadedIds.some((id) => stableIds.includes(id));
  const nameMatches = targetName && scheduleName && targetName === scheduleName;
  if (!idMatches && !nameMatches) {
    const error = new Error("CURRENT_SCHEDULE_IDENTITY_MISMATCH");
    error.code = "CURRENT_SCHEDULE_IDENTITY_MISMATCH";
    throw error;
  }
  return { schedule, courses, releaseVersion, term: term || active.term };
}

function cleanupOldDetailCache(target, oldReleaseVersion, active) {
  if (!oldReleaseVersion || oldReleaseVersion === active.releaseVersion) return;
  candidateIds(target).forEach((id) => {
    removeStorage(getScheduleDetailCacheKey(active.term, oldReleaseVersion, target.type, id));
    if (target.term && target.term !== active.term) {
      removeStorage(getScheduleDetailCacheKey(target.term, oldReleaseVersion, target.type, id));
    }
  });
}

function buildUpdatedTarget(target, active, loaded, validated) {
  const schedule = validated.schedule || {};
  const nowText = new Date().toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const detailId = loaded.detailId || schedule.detailId || schedule.id || target.detailId || target.id || target.classId || "";
  const name = displayNameForType(target.type, schedule) || target.name || "";
  return Object.assign({}, target, schedule, {
    type: target.type,
    id: schedule.id || target.id || detailId,
    detailId,
    scheduleId: schedule.scheduleId || target.scheduleId || detailId,
    classId: schedule.classId || target.classId || (target.type === "class" ? detailId : ""),
    name,
    className: target.type === "class" ? (schedule.className || name) : (schedule.className || target.className || ""),
    term: active.term,
    semester: active.term,
    displayType: schedule.displayType || target.displayType || "",
    isAggregated: Boolean(schedule.isAggregated || target.isAggregated),
    releaseVersion: active.releaseVersion,
    version: active.releaseVersion,
    updatedAt: schedule.updatedAt || active.updatedAt || target.updatedAt || "",
    updateTime: nowText,
    courses: validated.courses,
    source: "release-pack",
  });
}

async function refreshCurrentSchedule(options = {}) {
  const target = getCurrentScheduleTarget();
  if (!target) {
    return { success: false, status: "NO_TARGET", message: "NO_TARGET" };
  }
  if (!REFRESHABLE_TYPES.includes(target.type)) {
    return {
      success: true,
      status: (target.type === "personal-xls" || target.type === "personal-apaas") ? "PROTECTED_PERSONAL_XLS" : "SKIPPED_UNSUPPORTED_TYPE",
      target,
    };
  }

  let active;
  try {
    active = await resolveActiveSnapshot(options);
  } catch (error) {
    return { success: false, status: "ACTIVE_UNAVAILABLE", target, error };
  }

  const normalizedTargetTerm = target.term || target.semester || active.term || "";
  const targetWithTerm = normalizedTargetTerm === target.term ? target : Object.assign({}, target, {
    term: normalizedTargetTerm,
    semester: normalizedTargetTerm,
  });

  if (sameContentRelease(targetWithTerm, active)) {
    if (targetWithTerm !== target) {
      setCurrentScheduleTarget(targetWithTerm);
    }
    rememberRefreshState(targetWithTerm, active, "UNCHANGED");
    return { success: true, status: "UNCHANGED", target: targetWithTerm, activeSnapshot: active };
  }

  if (shouldSkipCooldown(targetWithTerm, active, options)) {
    return { success: true, status: "COOLDOWN", target: targetWithTerm, activeSnapshot: active };
  }

  const oldReleaseVersion = targetWithTerm.releaseVersion || "";
  try {
    let loaded;
    try {
      loaded = await loadDetailByStableId(targetWithTerm, active, options);
    } catch (stableError) {
      loaded = await loadDetailByExactName(targetWithTerm, active, options);
    }
    const validated = validateDetail(targetWithTerm, active, loaded);
    const nextTarget = buildUpdatedTarget(targetWithTerm, active, loaded, validated);
    if (!setCurrentScheduleTarget(nextTarget)) {
      const error = new Error("CURRENT_SCHEDULE_SAVE_FAILED");
      error.code = "CURRENT_SCHEDULE_SAVE_FAILED";
      throw error;
    }
    addRecentSchedule(nextTarget);
    cleanupOldDetailCache(targetWithTerm, oldReleaseVersion, active);
    rememberRefreshState(nextTarget, active, "UPDATED");
    return {
      success: true,
      status: "UPDATED",
      target: nextTarget,
      activeSnapshot: active,
      shouldNotify: options.notify === true ? shouldNotifyUpdated(active) : false,
    };
  } catch (error) {
    rememberRefreshState(targetWithTerm, active, error && error.code || "FAILED");
    return {
      success: false,
      status: error && error.code === "CURRENT_SCHEDULE_AMBIGUOUS_MATCH" ? "AMBIGUOUS" : "FAILED",
      target: targetWithTerm,
      activeSnapshot: active,
      error,
      matches: error && error.matches || [],
    };
  }
}

function ensureCurrentScheduleFresh(options = {}) {
  const target = getCurrentScheduleTarget();
  const active = normalizeActiveSnapshot(options.activeSnapshot || {}) || getCachedActiveSnapshot();
  const key = [
    target && (target.type || ""),
    target && (target.detailId || target.id || target.classId || target.name || ""),
    active && active.term || options.term || "",
    active && active.releaseVersion || options.releaseVersion || "",
    options.force ? "force" : "normal",
  ].join(":");

  if (!options.force && inflight.has(key)) {
    return inflight.get(key);
  }

  const task = refreshCurrentSchedule(options)
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, task);
  return task;
}

function __resetForTest() {
  inflight.clear();
}

module.exports = {
  REFRESH_STATE_KEY,
  NOTICE_STATE_KEY,
  REFRESHABLE_TYPES,
  ensureCurrentScheduleFresh,
  resolveActiveSnapshot,
  __resetForTest,
};
