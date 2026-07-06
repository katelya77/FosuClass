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
  return appendQuery("/pages/school/school", {
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

function buildScheduleViewUrl(params = {}) {
  const type = normalizeType(params.type || params.targetType);
  const name = params.name || params.keyword || params.targetName || "";
  const id = params.id || params.detailId || params.scheduleId || name;
  return appendQuery("/pages/schedule-view/schedule-view", {
    type,
    id,
    name,
    term: params.term || params.semester || "",
    semester: params.semester || params.term || "",
    releaseVersion: params.releaseVersion || params.version || "",
    displayType: params.displayType || "",
    isAggregated: params.isAggregated ? "1" : "",
    week: params.week || "",
    weekday: params.weekday || "",
  });
}

function navigateToSchedule(params = {}) {
  const url = params.view === "school" ? buildSchoolUrl(params) : buildScheduleViewUrl(params);
  if (typeof wx === "undefined") return url;
  if (url.indexOf("/pages/school/school") === 0) {
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
    wx.switchTab({ url: "/pages/school/school" });
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
