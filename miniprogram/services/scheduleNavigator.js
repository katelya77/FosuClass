/**
 * scheduleNavigator — 低层查询串工具（normalizeType/appendQuery）与 wx 跳转封装。
 * M3-T5 单源：schedule-view URL 构建唯一实现已收敛到 scheduleNavigationService
 * （消费契约生成物 NAVIGATION 常数）；本文件的 buildScheduleViewUrl 为委托壳，
 * 导出形态与入参语义不变，调用方（scheduleAssistantService 等）零改动。
 * 全校页 URL（buildSchoolUrl）唯一实现仍在本文件，路径同源消费 NAVIGATION.schoolPath。
 */
const { NAVIGATION } = require("../shared/schoolSearchContract.generated");

const TYPE_ALIASES = {
  room: "classroom",
  classroom: "classroom",
  class: "class",
  teacher: "teacher",
  course: "course",
};

function normalizeType(type) {
  return TYPE_ALIASES[String(type || "").trim()] || "class";
}

function appendQuery(base, params) {
  const query = Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join("&");
  return query ? `${base}?${query}` : base;
}

function buildSchoolUrl(params = {}) {
  const type = normalizeType(params.type || params.targetType);
  const keyword = params.keyword || params.name || params.targetName || "";
  return appendQuery(NAVIGATION.schoolPath, {
    type,
    keyword,
    q: keyword,
    term: params.term || params.semester || "",
    semester: params.semester || params.term || "",
    releaseVersion: params.releaseVersion || params.version || "",
    week: params.week || "",
    weekday: params.weekday || "",
  });
}

/**
 * 委托壳：schedule-view URL 唯一实现在 scheduleNavigationService.buildScheduleViewUrl
 * （消费契约 NAVIGATION.scheduleViewPath）。scheduleNavigationService 反向 require
 * 本文件的 normalizeType/appendQuery，故此处懒加载 require 以打破循环依赖。
 */
function buildScheduleViewUrl(params = {}) {
  return require("./scheduleNavigationService").buildScheduleViewUrl(params);
}

function navigateToSchedule(params = {}) {
  const url = params.view === "school" ? buildSchoolUrl(params) : buildScheduleViewUrl(params);
  if (typeof wx === "undefined") return url;
  if (url.indexOf(NAVIGATION.schoolPath) === 0) {
    try {
      wx.setStorageSync("FOSU_AI_PENDING_SCHOOL_QUERY", Object.assign({}, params, {
        type: normalizeType(params.type || params.targetType),
        keyword: params.keyword || params.name || params.targetName || "",
        q: params.keyword || params.name || params.targetName || "",
        fromAiAssistant: true,
        ts: Date.now(),
      }));
    } catch (error) {
      // switchTab still opens the page.
    }
    wx.switchTab({ url: NAVIGATION.schoolPath });
    return url;
  }
  wx.navigateTo({ url });
  return url;
}

module.exports = {
  appendQuery,
  buildScheduleViewUrl,
  buildSchoolUrl,
  navigateToSchedule,
  normalizeType,
};
