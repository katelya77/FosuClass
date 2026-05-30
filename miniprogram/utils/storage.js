const STORAGE_KEY = "FOSU_CLASS_SETTINGS";
const BOOTSTRAP_CACHE_KEY = "FOSU_BOOTSTRAP_CACHE";
const SCHOOL_FILTER_CACHE_KEY = "FOSU_SCHOOL_FILTER_CACHE";
const CURRENT_SCHEDULE_TARGET_KEY = "FOSU_CURRENT_SCHEDULE_TARGET";
const RECENT_SCHEDULES_KEY = "FOSU_RECENT_SCHEDULES";

const defaultSettings = {
  className: "",
  semesterId: "2025-2026-2",
  semester: "2025-2026学年第二学期",
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
}

function getCurrentScheduleTarget() {
  try {
    const target = wx.getStorageSync(CURRENT_SCHEDULE_TARGET_KEY);
    if (target && target.name && target.type) {
      return target;
    }
  } catch (error) {
    console.error("getCurrentScheduleTarget error", error);
  }
  return null;
}

function setCurrentScheduleTarget(target) {
  if (target && target.name) {
    wx.setStorageSync(CURRENT_SCHEDULE_TARGET_KEY, target);
    wx.setStorageSync("hasInitializedSchedule", true);
    wx.setStorageSync("currentScheduleId", target.classId || target.name || "");
    wx.setStorageSync("currentScheduleName", target.name || "");
    wx.setStorageSync("currentScheduleSource", target.type || "class");
    saveSettings({
      className: target.name,
      semester: target.semester || "2025-2026-2",
      classId: target.classId || "",
    });
    return true;
  }
  return false;
}

function clearCurrentScheduleTarget() {
  wx.removeStorageSync(CURRENT_SCHEDULE_TARGET_KEY);
  wx.removeStorageSync("hasInitializedSchedule");
  wx.removeStorageSync("currentScheduleId");
  wx.removeStorageSync("currentScheduleName");
  wx.removeStorageSync("currentScheduleSource");
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

module.exports = {
  BOOTSTRAP_CACHE_KEY,
  CURRENT_SCHEDULE_TARGET_KEY,
  RECENT_SCHEDULES_KEY,
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
};

