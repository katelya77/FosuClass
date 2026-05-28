const STORAGE_KEY = "FOSU_CLASS_SETTINGS";

const defaultSettings = {
  className: "25动物医学6",
  semester: "2025-2026学年第二学期",
  currentWeek: 12,
  hideInactiveCourses: false,
  showWeekend: true,
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

module.exports = {
  STORAGE_KEY,
  defaultSettings,
  clearAppCache,
  getSettings,
  resetSettings,
  saveSettings,
};
