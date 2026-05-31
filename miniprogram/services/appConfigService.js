const request = require("../utils/request");

const APP_CONFIG_CACHE_KEY = "FOSU_APP_CONFIG_CACHE";
const NOTICE_DISMISSED_KEY = "FOSU_NOTICE_DISMISSED";

function nowIso() {
  return new Date().toISOString();
}

function normalizeConfig(payload) {
  const data = payload && payload.data ? payload.data : payload;
  return Object.assign({
    appName: "佛课小表",
    currentSemester: "2025-2026-2",
    dataVersion: {},
    notices: [],
    news: [],
    disclaimer: "课表仅供参考，以任课教师及教务通知为准。",
  }, data || {});
}

function getCachedAppConfig() {
  try {
    const cached = wx.getStorageSync(APP_CONFIG_CACHE_KEY);
    if (cached && cached.config) {
      return cached.config;
    }
  } catch (error) {
    console.warn("读取公告配置缓存失败", error);
  }
  return null;
}

function cacheAppConfig(config) {
  try {
    wx.setStorageSync(APP_CONFIG_CACHE_KEY, {
      config,
      updatedAt: nowIso(),
    });
  } catch (error) {
    console.warn("写入公告配置缓存失败", error);
  }
}

function loadAppConfig(options) {
  const opt = Object.assign({ force: false }, options || {});
  const cached = getCachedAppConfig();
  if (cached && !opt.force) {
    request.get("/api/fosu/app-config", {}, { showLoading: false, silentError: true })
      .then((res) => {
        const config = normalizeConfig(res);
        cacheAppConfig(config);
        const app = getApp();
        if (app && app.globalData) {
          app.globalData.appConfig = config;
        }
      })
      .catch(() => {});
    return Promise.resolve(cached);
  }

  return request.get("/api/fosu/app-config", {}, { showLoading: false, silentError: true })
    .then((res) => {
      const config = normalizeConfig(res);
      cacheAppConfig(config);
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.appConfig = config;
      }
      return config;
    })
    .catch((error) => {
      if (cached) {
        return cached;
      }
      throw error;
    });
}

function getGlobalConfig() {
  const app = getApp();
  return (app && app.globalData && app.globalData.appConfig) || getCachedAppConfig() || normalizeConfig({});
}

function getPageNotices(config, pageName) {
  const data = config || getGlobalConfig();
  return (data.notices || []).filter((notice) => {
    return notice && (notice.targetPage === "all" || notice.targetPage === pageName);
  });
}

function getPrimaryNotice(config, pageName, displayModes) {
  const modes = Array.isArray(displayModes) ? displayModes : [displayModes];
  return getPageNotices(config, pageName).find((notice) => modes.includes(notice.displayMode));
}

function getDismissedMap() {
  try {
    return wx.getStorageSync(NOTICE_DISMISSED_KEY) || {};
  } catch (error) {
    return {};
  }
}

function getDismissKey(notice) {
  if (!notice) return "";
  return `${notice.id || notice.title}:${notice.version || ""}`;
}

function isNoticeDismissed(notice) {
  const key = getDismissKey(notice);
  if (!key) return false;
  return Boolean(getDismissedMap()[key]);
}

function dismissNotice(notice) {
  const key = getDismissKey(notice);
  if (!key) return;
  const map = getDismissedMap();
  map[key] = nowIso();
  wx.setStorageSync(NOTICE_DISMISSED_KEY, map);
}

function shouldShowNotice(notice) {
  if (!notice) return false;
  if (notice.closable === false) return true;
  return !isNoticeDismissed(notice);
}

function formatConfigTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getLatestDataUpdatedAt(config) {
  const version = (config || getGlobalConfig()).dataVersion || {};
  const values = [
    version.classScheduleUpdatedAt,
    version.teacherScheduleUpdatedAt,
    version.classroomScheduleUpdatedAt,
    version.courseScheduleUpdatedAt,
  ].filter(Boolean);
  values.sort((left, right) => String(right).localeCompare(String(left)));
  return values[0] || "";
}

module.exports = {
  APP_CONFIG_CACHE_KEY,
  NOTICE_DISMISSED_KEY,
  cacheAppConfig,
  dismissNotice,
  formatConfigTime,
  getCachedAppConfig,
  getGlobalConfig,
  getLatestDataUpdatedAt,
  getPageNotices,
  getPrimaryNotice,
  isNoticeDismissed,
  loadAppConfig,
  shouldShowNotice,
};
