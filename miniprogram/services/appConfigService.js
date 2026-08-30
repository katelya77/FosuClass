const request = require("../utils/request");
const { resolveSelectedTerm, sanitizeClientTerms } = require("../shared/termVisibility.generated");

const APP_CONFIG_CACHE_KEY = "FOSU_APP_CONFIG_CACHE";
const NOTICE_DISMISSED_KEY = "FOSU_NOTICE_DISMISSED";

function normalizeDailyKnowledge(payload) {
  if (!payload || typeof payload !== "object") return null;
  const title = String(payload.title || "每日小知识").trim().slice(0, 60);
  const content = String(payload.content || "").trim().slice(0, 500);
  if (!content) return null;
  const type = ["info", "warning", "success"].indexOf(payload.type) >= 0 ? payload.type : "info";
  const category = ["mind", "fraud", "campus"].indexOf(payload.category) >= 0
    ? payload.category
    : (type === "warning" ? "fraud" : (type === "success" ? "mind" : "campus"));
  const categoryLabels = { fraud: "防诈提醒", mind: "心理关怀", campus: "校园日签" };
  const categoryMarks = { fraud: "盾", mind: "心", campus: "校" };
  const dateText = String(payload.date || "");
  const dateMatch = dateText.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return Object.assign({}, payload, {
    title,
    content,
    type,
    category,
    categoryLabel: categoryLabels[category],
    categoryMark: categoryMarks[category],
    dateLabel: dateMatch ? (Number(dateMatch[1]) + "月" + Number(dateMatch[2]) + "日") : "今日",
  });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeConfig(payload) {
  const data = payload && payload.data ? payload.data : payload;
  const config = Object.assign({
    appName: "佛课小表",
    currentSemester: "",
    termConfig: null,
    availableTerms: [],
    dataVersion: {},
    notices: [],
    dailyKnowledge: null,
    urgentNotice: null,
    banners: [],
    news: [],
    appConfig: {},
    disclaimer: "课表仅供参考，以任课教师及教务通知为准。",
  }, data || {});
  if (!config.dataVersion || typeof config.dataVersion !== "object") config.dataVersion = {};
  if (config.termConfig && typeof config.termConfig !== "object") config.termConfig = null;
  if (!Array.isArray(config.availableTerms)) config.availableTerms = [];
  const rawCurrentRecord = config.availableTerms.find((item) => item && item.status === "current");
  const activeTerm = config.termConfig && config.termConfig.term
    || rawCurrentRecord && rawCurrentRecord.term
    || config.currentSemester
    || "";
  const authoritativeTerms = config.availableTerms.filter((item) => item && item.term &&
    item.term === activeTerm && item.status === "current" && item.dataAvailable === true && item.releaseVersion);
  config.availableTerms = sanitizeClientTerms(config.availableTerms, authoritativeTerms);
  const currentRecord = config.availableTerms.find((item) => item.status === "current");
  const canonicalActiveTerm = config.termConfig && config.termConfig.term || currentRecord && currentRecord.term || activeTerm;
  if (config.availableTerms.length > 0) {
    const selection = resolveSelectedTerm(config.currentSemester, config.availableTerms, canonicalActiveTerm);
    config.currentSemester = selection.term;
    if (selection.changed) config.termFallbackReason = selection.reason;
  } else if (!config.currentSemester && config.termConfig && config.termConfig.term) {
    config.currentSemester = config.termConfig.term;
  }
  if (!Array.isArray(config.notices)) config.notices = [];
  config.dailyKnowledge = normalizeDailyKnowledge(config.dailyKnowledge);
  if (!Array.isArray(config.banners)) config.banners = [];
  if (!Array.isArray(config.news)) config.news = [];
  if (config.urgentNotice === undefined) config.urgentNotice = null;
  if (!config.appConfig || typeof config.appConfig !== "object") config.appConfig = {};
  return config;
}

function getCachedAppConfig() {
  try {
    const cached = wx.getStorageSync(APP_CONFIG_CACHE_KEY);
    if (cached && cached.config) {
      return normalizeConfig(cached.config);
    }
  } catch (error) {
    console.warn("读取公告配置缓存失败", error);
  }
  return null;
}

function cacheAppConfig(config) {
  try {
    const normalized = normalizeConfig(config);
    wx.setStorageSync(APP_CONFIG_CACHE_KEY, {
      config: normalized,
      updatedAt: nowIso(),
    });
    return normalized;
  } catch (error) {
    console.warn("写入公告配置缓存失败", error);
    return normalizeConfig(config);
  }
}

let freshConfigFetched = false;
let appConfigInflight = null;

function loadAppConfig(options) {
  const opt = Object.assign({ force: false, network: true }, options || {});
  const cached = getCachedAppConfig();

  if (opt.network === false) {
    return Promise.resolve(cached || normalizeConfig({}));
  }

  // 如果在当前 Session 中已经网络加载过，且不需要 force，则直接返回本地缓存
  if (cached && !opt.force && freshConfigFetched) {
    return Promise.resolve(cached);
  }

  // 拼接时间戳 ts 避免 CDN/客户端 HTTP 缓存
  if (appConfigInflight && opt.dedupe !== false && !opt.force) {
    return appConfigInflight;
  }

  const url = "/api/fosu/app-config";
  appConfigInflight = request.get(url, {}, {
    showLoading: false,
    silentError: true,
    timeout: opt.timeout || 15000,
    retries: opt.retries === undefined ? 1 : opt.retries,
    skipSession: opt.skipSession === true,
  })
    .then((res) => {
      const config = normalizeConfig(res);
      cacheAppConfig(config);
      freshConfigFetched = true; // 置为已成功获取最新网络配置
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.appConfig = config;
      }
      return config;
    })
    .catch((error) => {
      if (!opt.silent) {
        console.warn("⚠️ [appConfigService] 网络请求 app-config 失败", error);
      }
      if (cached) {
        return cached;
      }
      throw error;
    })
    .finally(() => {
      appConfigInflight = null;
    });
  return appConfigInflight;
}

function getGlobalConfig() {
  const app = getApp();
  return normalizeConfig((app && app.globalData && app.globalData.appConfig) || getCachedAppConfig() || {});
}

function getPageNotices(config, pageName) {
  const data = normalizeConfig(config || getGlobalConfig());
  const notices = Array.isArray(data.notices) ? data.notices : [];
  return notices.filter((notice) => {
    return notice && (notice.targetPage === "all" || notice.targetPage === pageName);
  });
}

function getPrimaryNotice(config, pageName, displayModes) {
  const modes = Array.isArray(displayModes) ? displayModes : [displayModes];
  return getPageNotices(config, pageName).find((notice) => {
    return modes.includes(notice.displayMode) && shouldShowNotice(notice);
  });
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
  normalizeDailyKnowledge,
  normalizeConfig,
  shouldShowNotice,
};
