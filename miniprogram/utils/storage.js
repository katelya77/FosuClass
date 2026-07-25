const STORAGE_KEY = "FOSU_CLASS_SETTINGS";
const BOOTSTRAP_CACHE_KEY = "FOSU_BOOTSTRAP_CACHE";
const SCHOOL_CACHE_SCHEMA_VERSION = 8;
/** Bumped when teacher college filter / index semantics change; invalidates stale client caches. */
const TEACHER_INDEX_SCHEMA_VERSION = 4;
/** Teacher Index Schema v3+ on pack; client cache key v4 clears poisoned full-index caches. */
const TEACHER_INDEX_SCHEMA_V3 = 3;
const SCHOOL_INDEX_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const PERSONAL_SCHEDULE_CACHE_KEY = "FOSU_PERSONAL_SCHEDULE_CACHE";
const PERSONAL_SCHEDULE_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY = "FOSU_ACTIVE_SNAPSHOT";
const SCHOOL_FILTER_CACHE_KEY = "FOSU_SCHOOL_FILTER_CACHE";
const CURRENT_SCHEDULE_TARGET_KEY = "FOSU_CURRENT_SCHEDULE_TARGET";
const RECENT_SCHEDULES_KEY = "FOSU_RECENT_SCHEDULES";
const CURRENT_SCHEDULE_TARGET_SCHEMA_VERSION = 2;
const DEFAULT_TERM = "";
let currentScheduleTargetMemory = null;

const defaultSettings = {
  className: "",
  semesterId: DEFAULT_TERM,
  semester: "",
  currentWeek: 12,
  manualWeekOverride: false,
  hideInactiveCourses: false,
  showWeekend: false,
  showHistoricalGrades: false,
  enableTodayStartupReminder: true,
};

function getSettings() {
  try {
    const saved = wx.getStorageSync(STORAGE_KEY);
    return Object.assign({}, defaultSettings, saved || {});
  } catch (error) {
    return Object.assign({}, defaultSettings);
  }
}

function saveSettings(patch) {
  const next = Object.assign({}, getSettings(), patch || {});
  wx.setStorageSync(STORAGE_KEY, next);
  return next;
}

function resetSettings() {
  wx.setStorageSync(STORAGE_KEY, defaultSettings);
  return Object.assign({}, defaultSettings);
}

function clearAppCache() {
  wx.removeStorageSync(STORAGE_KEY);
  return Object.assign({}, defaultSettings);
}

function clearDataCaches() {
  wx.removeStorageSync(BOOTSTRAP_CACHE_KEY);
  wx.removeStorageSync("FOSU_CATALOG_CACHE");
  wx.removeStorageSync("FOSU_SCHEDULE_CACHE");
  wx.removeStorageSync("FOSU_CLASS_SCHEDULE_CACHE");
}

function clearLocalSelection() {
  wx.removeStorageSync(CURRENT_SCHEDULE_TARGET_KEY);
  wx.removeStorageSync(SCHOOL_FILTER_CACHE_KEY);
  wx.removeStorageSync(PERSONAL_SCHEDULE_CACHE_KEY);
  currentScheduleTargetMemory = null;
}

function getActiveTermFallback() {
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    const globalData = app && app.globalData || {};
    const active = globalData.activeRelease || {};
    const manifest = active.manifest || {};
    const appConfig = globalData.appConfig || {};
    const appTermConfig = appConfig.termConfig || {};
    const activeSnapshot = wx.getStorageSync(SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY) || {};
    return active.term ||
      active.activeTerm ||
      manifest.term ||
      manifest.semester ||
      appConfig.currentSemester ||
      appConfig.term ||
      appTermConfig.term ||
      activeSnapshot.term ||
      activeSnapshot.semester ||
      DEFAULT_TERM;
  } catch (error) {
    return DEFAULT_TERM;
  }
}

function resolveTargetTerm(target) {
  const source = target || {};
  const metadata = source.metadata || {};
  return source.term ||
    source.semester ||
    source.currentSemester ||
    metadata.term ||
    metadata.semester ||
    getActiveTermFallback() ||
    DEFAULT_TERM;
}

function normalizeStoredScheduleTarget(target) {
  if (!target) return null;
  const type = target.type || "class";
  const name = target.name || target.className || target.title || target.displayTitle || "";
  if (!name || !type) return null;
  const term = resolveTargetTerm(target);
  const detailId = target.detailId || target.id || target.scheduleId || target.classId || "";
  return Object.assign({}, target, {
    schemaVersion: CURRENT_SCHEDULE_TARGET_SCHEMA_VERSION,
    type,
    id: target.id || detailId || "",
    detailId,
    name,
    term,
    semester: term,
    displayType: target.displayType || "",
    isAggregated: Boolean(target.isAggregated),
    releaseVersion: target.releaseVersion || target.version || "",
    updatedAt: target.updatedAt || "",
    updateTime: target.updateTime || "",
    courses: Array.isArray(target.courses) ? target.courses : [],
    source: target.source || target.dataSource || target.type || "local",
  });
}

function writePersonalScheduleCache(target) {
  const normalized = normalizeStoredScheduleTarget(target);
  if (!normalized || (normalized.type !== "personal-xls" && normalized.type !== "personal-apaas")) return false;
  try {
    wx.setStorageSync(PERSONAL_SCHEDULE_CACHE_KEY, {
      savedAt: Date.now(),
      target: normalized,
    });
    return true;
  } catch (error) {
    return false;
  }
}

function readPersonalScheduleCache() {
  try {
    const cached = wx.getStorageSync(PERSONAL_SCHEDULE_CACHE_KEY);
    if (!cached || Date.now() - Number(cached.savedAt || 0) > PERSONAL_SCHEDULE_CACHE_TTL) return null;
    return normalizeStoredScheduleTarget(cached.target);
  } catch (error) {
    return null;
  }
}

function getCurrentScheduleTarget() {
  try {
    if (currentScheduleTargetMemory && currentScheduleTargetMemory.name && currentScheduleTargetMemory.type) {
      return currentScheduleTargetMemory;
    }
    const rawTarget = wx.getStorageSync(CURRENT_SCHEDULE_TARGET_KEY);
    const target = normalizeStoredScheduleTarget(rawTarget);
    if (target) {
      if (!rawTarget || rawTarget.schemaVersion !== CURRENT_SCHEDULE_TARGET_SCHEMA_VERSION || rawTarget.term !== target.term || rawTarget.releaseVersion !== target.releaseVersion) {
        wx.setStorageSync(CURRENT_SCHEDULE_TARGET_KEY, target);
      }
      currentScheduleTargetMemory = target;
      return target;
    }
    const personalCache = readPersonalScheduleCache();
    if (personalCache) {
      currentScheduleTargetMemory = personalCache;
      wx.setStorageSync(CURRENT_SCHEDULE_TARGET_KEY, personalCache);
      return personalCache;
    }
  } catch (error) {
    console.error("getCurrentScheduleTarget error", error);
  }
  return null;
}

function setCurrentScheduleTarget(target) {
  const normalizedTarget = normalizeStoredScheduleTarget(target);
  if (normalizedTarget) {
    const term = normalizedTarget.term || normalizedTarget.semester || DEFAULT_TERM;
    wx.setStorageSync(CURRENT_SCHEDULE_TARGET_KEY, normalizedTarget);
    currentScheduleTargetMemory = normalizedTarget;
    writePersonalScheduleCache(normalizedTarget);
    wx.setStorageSync("hasInitializedSchedule", true);
    wx.setStorageSync("currentScheduleId", normalizedTarget.detailId || normalizedTarget.classId || normalizedTarget.name || "");
    wx.setStorageSync("currentScheduleName", normalizedTarget.name || "");
    wx.setStorageSync("currentScheduleSource", normalizedTarget.type || "class");
    saveSettings({
      className: normalizedTarget.name,
      semester: term,
      semesterId: term,
      classId: normalizedTarget.classId || normalizedTarget.detailId || "",
    });
    return true;
  }
  return false;
}

function clearCurrentScheduleTarget() {
  wx.removeStorageSync(CURRENT_SCHEDULE_TARGET_KEY);
  wx.removeStorageSync(PERSONAL_SCHEDULE_CACHE_KEY);
  wx.removeStorageSync("hasInitializedSchedule");
  wx.removeStorageSync("currentScheduleId");
  wx.removeStorageSync("currentScheduleName");
  wx.removeStorageSync("currentScheduleSource");
  currentScheduleTargetMemory = null;
  saveSettings({
    className: "",
    classId: "",
  });
}

function isScheduleInitialized() {
  try {
    const initialized = wx.getStorageSync("hasInitializedSchedule") === true;
    const target = getCurrentScheduleTarget();
    return Boolean(initialized && target);
  } catch (error) {
    return false;
  }
}

function validateCurrentScheduleTarget(bootstrapData) {
  const target = getCurrentScheduleTarget();
  if (!target) {
    return false;
  }
  if (target.type === "personal-login" || target.type === "personal") {
    return Array.isArray(target.courses);
  }
  // 宽容校验：只要含有 courses 数组即视为结构合法
  return Array.isArray(target.courses);
}

/**
 * 获取最近查看课表列表
 * NOTE: 这里的容错处理可避免本地缓存旧格式或 null 导致前台渲染崩溃
 * @returns {Array} 课表历史数组
 */
function getRecentSchedules() {
  try {
    const recent = wx.getStorageSync(RECENT_SCHEDULES_KEY);
    return Array.isArray(recent) ? recent : [];
  } catch (error) {
    console.error("getRecentSchedules error", error);
    return [];
  }
}

/**
 * 批量设置最近查看课表列表
 * NOTE: 限制最大存储上限为 10 条，避免本地 storage 占用过多资源
 * @param {Array} list 目标记录列表
 * @returns {Array} 保存后的记录列表
 */
function setRecentSchedules(list) {
  try {
    const next = Array.isArray(list) ? list.slice(0, 10) : [];
    wx.setStorageSync(RECENT_SCHEDULES_KEY, next);
    return next;
  } catch (error) {
    console.error("setRecentSchedules error", error);
    return [];
  }
}

/**
 * 生成课表记录的唯一 Key
 * NOTE: 组合课表关键属性作唯一 Key，能兼容多种类型的课表（行政班、教师、教室等），即使没有 ID 也能精准去重
 * @param {Object} item 课表记录
 * @returns {string} 唯一标识符
 */
function getScheduleUniqueKey(item) {
  if (!item) return "";
  if (item.scheduleKey) return item.scheduleKey;
  if (item.id) return String(item.id);
  if (item.scheduleId) return String(item.scheduleId);
  
  const semester = item.semester || "";
  const type = item.type || "class";
  const collegeCode = item.collegeCode || "";
  const grade = item.grade || "";
  const majorCode = item.majorCode || "";
  const className = item.className || item.name || "";
  const name = item.name || "";
  
  return `${semester}-${type}-${collegeCode}-${grade}-${majorCode}-${className}-${name}`;
}

/**
 * 添加一条最近查看记录到最前
 * NOTE: 自动完成唯一 Key 校验去重，补充必要的属性以防前台展示出现 undefined
 * @param {Object} item 待添加的课表信息
 * @returns {Array} 更新后的最近查看列表
 */
function addRecentSchedule(item) {
  if (!item) return getRecentSchedules();
  
  const list = getRecentSchedules();
  const key = getScheduleUniqueKey(item);
  if (!key) return list;

  const courseCount = Array.isArray(item.courses) ? item.courses.length : (item.courseCount || 0);
  
  const record = {
    scheduleKey: key,
    id: item.id || item.scheduleId || "",
    scheduleId: item.scheduleId || item.id || "",
    type: item.type || "class",
    title: item.title || item.displayTitle || item.className || item.name || "班级课表",
    className: item.className || item.displayTitle || item.name || "",
    name: item.name || item.className || "",
    collegeName: item.collegeName || "",
    collegeCode: item.collegeCode || "",
    grade: item.grade || "",
    majorName: item.majorName || "",
    majorCode: item.majorCode || "",
    semester: item.semester || "",
    courseCount: courseCount,
    updatedAt: item.updatedAtText || item.updatedAt || "",
    viewedAt: new Date().toISOString(),
    courses: Array.isArray(item.courses) ? item.courses : [],
    schedule: item.schedule || item,
    releaseVersion: item.releaseVersion || item.scheduleVersion || "",
  };

  const next = [record]
    .concat(list.filter((old) => getScheduleUniqueKey(old) !== key))
    .slice(0, 10);
    
  return setRecentSchedules(next);
}

/**
 * 根据 Key 或 ID 删除单条历史记录
 * NOTE: 不论是旧的 scheduleKey 还是 ID 格式均做匹配，提高容错率
 * @param {string} keyOrId 记录标识
 * @returns {Array} 更新后的历史记录列表
 */
function removeRecentSchedule(keyOrId) {
  if (!keyOrId) return getRecentSchedules();
  const list = getRecentSchedules();
  const next = list.filter((old) => {
    const key = getScheduleUniqueKey(old);
    return key !== keyOrId && old.id !== keyOrId && old.scheduleId !== keyOrId;
  });
  return setRecentSchedules(next);
}

/**
 * 清空所有最近查看历史
 * @returns {Array} 空数组
 */
function clearRecentSchedules() {
  try {
    wx.removeStorageSync(RECENT_SCHEDULES_KEY);
  } catch (error) {
    console.error("clearRecentSchedules error", error);
  }
  return [];
}

function stableParamHash(params = {}) {
  const ignoredKeys = new Set(["term", "semester", "releaseVersion", "version", "type"]);
  const normalized = {};
  Object.keys(params || {})
    .filter((key) => !ignoredKeys.has(key) && params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .forEach((key) => {
      normalized[key] = String(params[key]);
    });

  const text = JSON.stringify(normalized);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getSchoolIndexCacheKey(term, releaseVersion, type, params = {}) {
  const safeTerm = encodeURIComponent(String(term || "unknown"));
  const safeVersion = encodeURIComponent(String(releaseVersion || "unknown"));
  const safeType = encodeURIComponent(String(type || "unknown"));
  const teacherSchema = String(type || "") === "teacher"
    ? `:tidx${TEACHER_INDEX_SCHEMA_VERSION}`
    : "";
  // Include teacherIndexSchemaVersion in key so college-filter upgrades invalidate old results.
  const hashParams = String(type || "") === "teacher"
    ? Object.assign({}, params || {}, { teacherIndexSchemaVersion: TEACHER_INDEX_SCHEMA_VERSION })
    : params;
  return `school:v${SCHOOL_CACHE_SCHEMA_VERSION}:index:${safeTerm}:${safeVersion}:${safeType}${teacherSchema}:${stableParamHash(hashParams)}`;
}

function getSchoolFilterCacheKey(term, releaseVersion) {
  const safeTerm = encodeURIComponent(String(term || "unknown"));
  const safeVersion = encodeURIComponent(String(releaseVersion || "unknown"));
  return `school:v${SCHOOL_CACHE_SCHEMA_VERSION}:filters:${safeTerm}:${safeVersion}`;
}

function getScheduleDetailCacheKey(term, releaseVersion, type, id) {
  const safeTerm = encodeURIComponent(String(term || "unknown"));
  const safeVersion = encodeURIComponent(String(releaseVersion || "unknown"));
  const safeType = encodeURIComponent(String(type || "unknown"));
  const safeId = encodeURIComponent(String(id || "unknown"));
  return `school:v${SCHOOL_CACHE_SCHEMA_VERSION}:detail:${safeTerm}:${safeVersion}:${safeType}:${safeId}`;
}

function getSchoolCatalogCacheKey(term, releaseVersion) {
  const safeTerm = encodeURIComponent(String(term || "unknown"));
  const safeVersion = encodeURIComponent(String(releaseVersion || "unknown"));
  return `school:v${SCHOOL_CACHE_SCHEMA_VERSION}:catalog:${safeTerm}:${safeVersion}`;
}

function readSameVersionIndexCache(term, releaseVersion, type, params = {}) {
  try {
    const key = getSchoolIndexCacheKey(term, releaseVersion, type, params);
    const cached = wx.getStorageSync(key);
    if (!cached) return null;
    if (Date.now() - cached.savedAt > SCHOOL_INDEX_CACHE_TTL) return null;
    const data = cached.data || null;
    if (!data) return null;
    return Object.assign({}, data, {
      fromStorage: true,
      cacheFastPath: true,
    });
  } catch (error) {
    return null;
  }
}

function writeSameVersionIndexCache(term, releaseVersion, type, data, params = {}) {
  try {
    const key = getSchoolIndexCacheKey(term, releaseVersion, type, params);
    wx.setStorageSync(key, {
      savedAt: Date.now(),
      data,
    });
  } catch (error) {
    // ignore
  }
}

/**
 * Drop legacy teacher index caches (v2/v6 keys and any school:v* without tidx3).
 * Safe to call on app launch / after schema bump.
 */
function clearLegacyTeacherIndexCaches() {
  try {
    const info = wx.getStorageInfoSync();
    const keys = info.keys || [];
    keys.forEach((key) => {
      const isSchoolTeacherIndex =
        key.startsWith("school:v") && key.includes(":index:") && key.includes("teacher");
      const isLegacyTeacher =
        isSchoolTeacherIndex &&
        (key.includes(":tidx1") ||
          key.includes(":tidx2") ||
          key.includes(":tidx3") ||
          key.includes("school:v5:") ||
          key.includes("school:v6:") ||
          key.includes("school:v7:") ||
          !key.includes(`:tidx${TEACHER_INDEX_SCHEMA_VERSION}`));
      const isFosuLegacyIndex =
        (key.startsWith("fosu:v5:index:") ||
          key.startsWith("fosu:v6:index:") ||
          key.startsWith("fosu:v7:index:")) &&
        key.includes("teacher");
      if (isLegacyTeacher || isFosuLegacyIndex) {
        wx.removeStorageSync(key);
      }
    });
  } catch (e) {
    // ignore storage race
  }
}

function clearAllSchoolCaches() {
  try {
    const info = wx.getStorageInfoSync();
    const keys = info.keys || [];
    keys.forEach((key) => {
      if (
        key.startsWith("school:") ||
        key.startsWith("fosu:v") ||
        key.startsWith("FOSU_SCHOOL_") ||
        key.startsWith("FOSU_SCHOOL_FILTER") ||
        key === "FOSU_LOCAL_RELEASE_KEY" ||
        key === SCHOOL_FILTER_CACHE_KEY ||
        key === "school_search_index" ||
        key === "school_filter_options" ||
        key === "school_class_list" ||
        key === "school_teacher_list" ||
        key === "school_classroom_list" ||
        key === "school_course_list" ||
        key === "school_schedule_detail" ||
        key === "schedule_detail_cache" ||
        key === "all_school_cache" ||
        key === "classSchedules" ||
        key === "teachers" ||
        key === "classrooms" ||
        key === "courses"
      ) {
        wx.removeStorageSync(key);
        console.log("🧹 [Storage] 已清理全校缓存键:", key);
      }
    });
  } catch (e) {
    console.error("clearAllSchoolCaches error", e);
  }
}

module.exports = {
  BOOTSTRAP_CACHE_KEY,
  CURRENT_SCHEDULE_TARGET_KEY,
  CURRENT_SCHEDULE_TARGET_SCHEMA_VERSION,
  PERSONAL_SCHEDULE_CACHE_KEY,
  RECENT_SCHEDULES_KEY,
  SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY,
  SCHOOL_CACHE_SCHEMA_VERSION,
  TEACHER_INDEX_SCHEMA_VERSION,
  TEACHER_INDEX_SCHEMA_V3,
  clearLegacyTeacherIndexCaches,
  SCHOOL_INDEX_CACHE_TTL,
  SCHOOL_FILTER_CACHE_KEY,
  STORAGE_KEY,
  defaultSettings,
  clearAppCache,
  clearDataCaches,
  clearLocalSelection,
  getSettings,
  resetSettings,
  saveSettings,
  getCurrentScheduleTarget,
  setCurrentScheduleTarget,
  clearCurrentScheduleTarget,
  isScheduleInitialized,
  validateCurrentScheduleTarget,
  getRecentSchedules,
  setRecentSchedules,
  addRecentSchedule,
  removeRecentSchedule,
  clearRecentSchedules,
  clearAllSchoolCaches,
  getSchoolIndexCacheKey,
  getSchoolFilterCacheKey,
  getSchoolCatalogCacheKey,
  getScheduleDetailCacheKey,
  readSameVersionIndexCache,
  writeSameVersionIndexCache,
  readPersonalScheduleCache,
  writePersonalScheduleCache,
};
