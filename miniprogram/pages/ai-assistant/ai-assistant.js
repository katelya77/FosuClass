const aiAssistantService = require("../../services/aiAssistantService");
const aiVoiceInputService = require("../../services/aiVoiceInputService");
const cloudbaseConfig = require("../../config/cloudbase");
const demoData = require("./demo-data");
const { courseTimes } = require("../../data/courseTimes");

const PRIVACY_TIP_KEY = "FOSU_AI_PRIVACY_TIP_CONFIRMED";
const TASK_PANEL_CACHE_KEY = "FOSU_AI_TASK_PANEL_GROUPS_CACHE";
const TASK_PANEL_CACHE_VERSION = "2026-06-ui-svg-v1";
const TASK_PANEL_DEBOUNCE_MS = 180;
const TASK_ACTION_DEBOUNCE_MS = 180;
const SEND_DEDUPE_MS = 420;
const PRIVACY_SUMMARY_TEXT = "仅发送课程名、教师、教室、星期、节次、教学周；不发送学号、姓名、密码或原始文件。";
const MAX_MESSAGE_COUNT = 20;
const PERSONAL_SYNC_XLS_URL = "/pages/personal-sync/personal-sync?tab=xls";
const ICON_BASE = "/assets/icons/ai-tasks";
const ICONS = {
  today: `${ICON_BASE}/today.svg`,
  room: `${ICON_BASE}/room.svg`,
  teacher: `${ICON_BASE}/teacher.svg`,
  xls: `${ICON_BASE}/xls.svg`,
  classroom: `${ICON_BASE}/classroom.svg`,
  course: `${ICON_BASE}/course.svg`,
  study: `${ICON_BASE}/study.svg`,
  diagnosis: `${ICON_BASE}/diagnosis.svg`,
  app: `${ICON_BASE}/app.svg`,
  term: `${ICON_BASE}/term.svg`,
};
const QUICK_ACTIONS = [
  { id: "today", iconPath: ICONS.today, label: "今日课表", message: "今天还有课吗？", className: "today" },
  { id: "emptyRoom", iconPath: ICONS.room, label: "空教室", message: "现在有空教室吗？", className: "room" },
  { id: "teacher", iconPath: ICONS.teacher, label: "查老师", draft: "查某某老师课表", className: "teacher" },
  { id: "xls", iconPath: ICONS.xls, label: "导入 XLS", url: PERSONAL_SYNC_XLS_URL, className: "xls" },
];

const WELCOME_EXAMPLES = [
  "C7 附近现在有空教室吗？",
  "今天还有课吗？",
  "这个小程序怎么用？",
];

const TASK_PANEL_GROUPS = [
  {
    title: "常用校园任务",
    items: [
      { iconPath: ICONS.room, label: "找空教室", desc: "按当前时间找可用教室", message: "现在有空教室吗？" },
      { iconPath: ICONS.teacher, label: "查老师课表", desc: "输入老师姓名后查询", draft: "查某某老师课表", requiresKeyword: true },
      { iconPath: ICONS.classroom, label: "查教室占用", desc: "输入教室或楼栋", draft: "查 C7-203 教室", requiresKeyword: true },
      { iconPath: ICONS.course, label: "查课程安排", desc: "输入课程关键词", draft: "查高等数学课程", requiresKeyword: true },
    ],
  },
  {
    title: "个人课表",
    items: [
      { iconPath: ICONS.today, label: "今日安排", desc: "基于当前课表摘要", message: "今天还有课吗？" },
      { iconPath: ICONS.study, label: "自习时间推荐", desc: "需要开启课表摘要", message: "帮我推荐连续 2 节自习时间" },
      { iconPath: ICONS.xls, label: "XLS 导入指引", desc: "安全导入个人课表", url: PERSONAL_SYNC_XLS_URL, fallbackMessage: "怎么导入个人课表？" },
    ],
  },
  {
    title: "项目与诊断",
    items: [
      { iconPath: ICONS.diagnosis, label: "数据诊断", desc: "检查索引和缓存状态", message: "为什么数据加载失败？" },
      { iconPath: ICONS.app, label: "这个小程序怎么用", desc: "了解 FosuClass 功能入口", message: "这个小程序怎么用？" },
      { iconPath: ICONS.term, label: "新学期同步说明", desc: "了解 XLS-only 同步方式", message: "新学期怎么同步个人课表？" },
    ],
  },
];

const CAPABILITY_GUIDE_GROUPS = [
  {
    title: "我的课表",
    items: ["今天有什么课", "明天有什么课", "下一节课", "本周课表", "两节课之间有多久"],
  },
  {
    title: "全校查询",
    items: ["查老师课表", "查班级课表", "查教室占用", "查课程安排"],
  },
  {
    title: "空教室与时间",
    items: ["现在有空教室吗", "找连续两节空教室", "推荐共同空闲时间"],
  },
  {
    title: "校园地图",
    items: ["C7 在哪里", "查看仙溪南区地图", "江湾校区主要地点", "下一节课的教学楼位置"],
  },
  {
    title: "天气和出行",
    items: ["仙溪校区今天会下雨吗", "下一节课需要带伞吗"],
  },
  {
    title: "数据与使用帮助",
    items: ["当前是第几教学周", "数据更新到什么时候", "如何导入个人课表", "加载失败怎么办"],
  },
];

const TABBAR_PENDING_QUERY = {
  "/pages/school/school": "FOSU_AI_PENDING_SCHOOL_QUERY",
  "/pages/today/today": "FOSU_AI_PENDING_TODAY_QUERY",
};

const PROVIDER_LABELS = {
  "cloudbase-hunyuan": "已核验课表数据",
  hunyuan: "已核验课表数据",
  "tencent-hunyuan": "已核验课表数据",
  mock: "已使用本地规则",
  deepseek: "已核验课表数据",
  coze: "已核验课表数据",
  unknown: "正在整理结果",
};

const SAFETY_MODE_LABELS = {
  "tool-grounded": "工具验证",
  fallback: "降级模式",
  "fallback-mock": "已降级",
};

const TOOL_LABELS = {
  search_empty_rooms: "空教室",
  get_today_courses: "今日课表",
  get_campus_weather: "天气",
  get_course_weather_advice: "天气建议",
  search_campus_place: "校园地图",
  get_campus_route: "校园地图",
  get_classroom_location: "校园地图",
  search_school_index: "全校索引",
  get_schedule_detail: "课表详情",
  diagnose_data_status: "数据诊断",
  explain_personal_import: "导入指引",
  recommend_meeting_time: "时间推荐",
  clarify_missing_slot: "追问",
  safety_guard: "安全拦截",
};

const CARD_TYPE_LABELS = {
  empty_room: "空教室",
  schedule: "课表",
  teacher: "教师",
  course: "课程",
  weather: "天气",
  diagnosis: "诊断",
  guide: "指引",
  reminder: "提醒",
  generic: "结果",
};

const CARD_TITLE_FALLBACKS = {
  empty_room: "空教室推荐",
  schedule: "今日课程",
  teacher: "教师查询",
  course: "课程查询",
  weather: "校区天气",
  diagnosis: "数据诊断",
  guide: "使用指引",
  reminder: "时间推荐",
  generic: "结果",
};

const ACTION_LABEL_FALLBACKS = {
  navigate: "查看详情",
  retry: "重新尝试",
  copy: "复制",
  bind: "前往设置",
  noop: "查看",
};

const ALLOWED_ACTION_TYPES = ["navigate", "copy", "retry", "bind", "noop"];
const INVALID_DISPLAY_TEXT = new Set(["[object Object]", "undefined", "null", "NaN"]);

function cloneTaskPanelGroups() {
  const groups = JSON.parse(JSON.stringify(TASK_PANEL_GROUPS));
  if (groups[2]) {
    groups[2].title = "使用与数据";
    if (Array.isArray(groups[2].items)) {
      groups[2].items = groups[2].items.map((item) => {
        if (item.iconPath === ICONS.diagnosis) {
          return Object.assign({}, item, {
            label: "数据是否最新",
            desc: "查看课表数据是否可用",
            message: "课表数据是否最新？",
          });
        }
        if (item.iconPath === ICONS.app) {
          return Object.assign({}, item, {
            label: "怎么使用",
            desc: "查看查课、空教室和导入方法",
            message: "这个小程序怎么用？",
          });
        }
        if (item.iconPath === ICONS.term) {
          return Object.assign({}, item, {
            label: "个人课表导入",
            desc: "了解 XLS 导入方式",
            message: "怎么导入个人课表？",
          });
        }
        return item;
      });
    }
  }
  return groups;
}

function readTaskPanelGroupsCache() {
  try {
    const cached = wx.getStorageSync(TASK_PANEL_CACHE_KEY);
    if (!cached || cached.version !== TASK_PANEL_CACHE_VERSION || !Array.isArray(cached.groups)) return null;
    return cached.groups;
  } catch (error) {
    return null;
  }
}

function writeTaskPanelGroupsCache(groups) {
  try {
    wx.setStorageSync(TASK_PANEL_CACHE_KEY, {
      version: TASK_PANEL_CACHE_VERSION,
      savedAt: Date.now(),
      groups,
    });
  } catch (error) {
    // 静态任务缓存失败不影响页面使用。
  }
}

function createDebounced(fn, wait) {
  let timer = null;
  return function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  };
}

function timeText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function decodeQuery(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (error) {
    return String(value || "");
  }
}

function primitiveDisplayText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function safeText(value, maxLength, fallback) {
  let text = primitiveDisplayText(value);
  if (!text && value && typeof value === "object" && !Array.isArray(value)) {
    ["text", "label", "title", "value"].some((key) => {
      const candidate = primitiveDisplayText(value[key]);
      if (!candidate) return false;
      text = candidate;
      return true;
    });
  }
  if (!text) text = primitiveDisplayText(fallback);
  text = aiAssistantService.redactSensitiveText(text).trim();
  if (!text || INVALID_DISPLAY_TEXT.has(text)) {
    text = aiAssistantService.redactSensitiveText(primitiveDisplayText(fallback)).trim();
  }
  if (!text || INVALID_DISPLAY_TEXT.has(text)) return "";
  const limit = Number(maxLength || 0);
  return limit > 0 ? text.slice(0, limit) : text;
}

function getSectionTime(section) {
  const target = Number(section);
  return courseTimes.find((item) => Number(item.section) === target) || null;
}

function inferSectionPair(source) {
  const item = source || {};
  let start = Number(item.startSection || item.sectionStart || 0) || 0;
  let end = Number(item.endSection || item.sectionEnd || start || 0) || 0;
  if ((!start || !end) && Array.isArray(item.sections) && item.sections.length) {
    const sections = item.sections.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    start = sections[0] || start;
    end = sections[sections.length - 1] || end || start;
  }
  if ((!start || !end) && (item.sectionText || item.value || item.subtitle)) {
    const match = String(item.sectionText || item.value || item.subtitle || "").match(/第?\s*(\d{1,2})\s*(?:[-~～至到]\s*(\d{1,2}))?\s*节/);
    if (match) {
      start = Number(match[1]);
      end = Number(match[2] || match[1]);
    }
  }
  return start && end ? { start, end } : null;
}

function inferSectionText(source) {
  const direct = safeText(source && source.sectionText, 40);
  if (direct) return direct;
  const pair = inferSectionPair(source);
  if (!pair) return "";
  return pair.start === pair.end ? `第${pair.start}节` : `第${pair.start}-${pair.end}节`;
}

function inferCourseTimeRange(source) {
  const direct = safeText(source && (source.timeRange || source.timeText), 40);
  if (/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(direct)) return direct;
  const pair = inferSectionPair(source);
  if (!pair) return "";
  const start = getSectionTime(pair.start);
  const end = getSectionTime(pair.end);
  return start && end ? `${start.start}-${end.end}` : "";
}

function mapProviderLabel(provider) {
  const normalized = String(provider || "unknown").toLowerCase();
  if (normalized.indexOf("mock") >= 0 || normalized.indexOf("local") >= 0) return "已使用本地规则";
  if (normalized && normalized !== "unknown") return "已核验课表数据";
  return "正在整理结果";
}

function mapSafetyModeLabel(mode) {
  const normalized = String(mode || "tool-grounded").toLowerCase();
  if (SAFETY_MODE_LABELS[normalized]) return SAFETY_MODE_LABELS[normalized];
  if (normalized.indexOf("fallback") >= 0) return "降级模式";
  if (normalized.indexOf("tool") >= 0 || normalized.indexOf("grounded") >= 0) return "工具验证";
  return "安全模式";
}

function mapToolName(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized === "search_school_index") return "正在查询全校课程";
  if (TOOL_LABELS[normalized]) return TOOL_LABELS[normalized];
  if (/查询|课程|教室|课表|教学周|导入|数据/.test(String(name || ""))) return String(name || "");
  return "校园工具";
}

function mapCardTypeLabel(type) {
  return CARD_TYPE_LABELS[String(type || "generic").toLowerCase()] || "结果";
}

function inferEvidenceLabel(source = {}) {
  const names = (Array.isArray(source.toolCalls) ? source.toolCalls : [])
    .map((item) => String(item && (item.name || item.tool || item.type) || "").toLowerCase());
  const cardTypes = (Array.isArray(source.cards) ? source.cards : [])
    .map((item) => String(item && item.type || "").toLowerCase());
  const text = names.concat(cardTypes).join("|");
  if (/weather|天气/.test(text)) return "已获取天气数据";
  if (/campus|map|route|location|地图|地点|位置/.test(text)) return "已查询校园地图";
  if (/empty|空教室/.test(text)) return "已核验教室占用";
  if (/guide|import|rag|help|说明|帮助|指引|知识/.test(text)) return "使用说明";
  if (/school|schedule|today|tomorrow|week|term|teacher|course|classroom|detail|课表|课程|教师|教室|教学周|校历|查询全校/.test(text)) {
    return "已核验课表数据";
  }
  const intent = source.metrics && source.metrics.intentName || "";
  if (/weather/.test(String(intent).toLowerCase())) return "已获取天气数据";
  return "";
}

function statusText(status) {
  const normalized = String(status || "").toLowerCase();
  if (["success", "ok", "done"].includes(normalized)) return "完成";
  if (["failed", "error"].includes(normalized)) return "失败";
  if (normalized === "skipped") return "跳过";
  if (normalized === "running") return "调用中";
  return "已调用";
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (["failed", "error"].includes(normalized)) return "failed";
  if (normalized === "skipped") return "skipped";
  if (normalized === "running") return "running";
  return "success";
}

function typeClass(type) {
  return String(type || "generic").toLowerCase().replace(/_/g, "-").replace(/[^a-z0-9-]/g, "") || "generic";
}

function normalizeSafety(safety) {
  const source = safety || {};
  const provider = source.resolvedProvider || source.provider || source.lastProvider || source.providerName || "unknown";
  const desiredProvider = source.desiredProvider || source.provider || provider;
  const mode = source.mode || source.safetyMode || "tool-grounded";
  const fallbackReason = safeText(source.fallbackReason || "", 80);
  const providerDecisionReason = "";
  const externalUsed = source.externalProviderUsed === true;
  const providerLabel = fallbackReason ? "已使用本地规则" : (externalUsed ? "已核验课表数据" : "已核验课表数据");
  let text = "已核验课表数据";
  if (fallbackReason) {
    text = "已使用本地规则";
  } else if (externalUsed) {
    text = "正在整理结果";
  }
  return {
    provider,
    resolvedProvider: provider,
    desiredProvider,
    mode,
    externalProviderUsed: externalUsed,
    fallbackReason,
    providerDecisionReason,
    providerLabel,
    modeLabel: mapSafetyModeLabel(mode),
    text,
    pendingClarification: source.pendingClarification || null,
    clearPendingClarification: source.clearPendingClarification === true,
  };
}

function normalizeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;
  const latencyMs = Number(metrics.latencyMs);
  return {
    latencyMs: Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : 0,
    intentName: metrics.intentName || "",
    externalProviderUsed: metrics.externalProviderUsed === true,
  };
}

function normalizeToolCall(tool, index) {
  const source = tool || {};
  const label = mapToolName(source.name || source.tool || source.type || "");
  const stateText = statusText(source.status);
  return {
    key: `${label}-${stateText}-${index}`,
    displayName: label,
    displayStatus: stateText,
    displayText: `已核验：${label}`,
    statusClass: statusClass(source.status),
  };
}

function normalizeTaskStep(step, index) {
  const source = step || {};
  const label = safeText(source.label || source.name || "", 48, `步骤 ${index + 1}`);
  const status = safeText(source.status || "done", 16);
  return {
    key: safeText(source.key || source.name || `task-${index}`, 48, `task-${index}`),
    displayName: label,
    displayStatus: status,
    displayText: label,
    statusClass: status === "failed" ? "failed" : (status === "running" ? "running" : "success"),
  };
}

function buildEvidenceText(evidence, evidenceLabel) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return "";
  const parts = [];
  if (evidence.term) parts.push(`学期 ${safeText(evidence.term, 32)}`);
  if (evidence.currentWeek) parts.push(`教学周 ${safeText(evidence.currentWeek, 16)}`);
  if (evidence.checkedAt) {
    const checkedTime = safeText(String(evidence.checkedAt).slice(11, 16), 8);
    if (checkedTime) parts.push(`检查 ${checkedTime}`);
  }
  const label = safeText(evidenceLabel || "", 32);
  if (label) parts.unshift(label);
  else if (evidence.verified || evidence.toolCount) parts.push("已核验课表数据");
  return parts.length ? parts.join(" · ") : "";
}

function normalizeWeatherPayload(source) {
  const weather = source && typeof source.weather === "object" && !Array.isArray(source.weather)
    ? source.weather
    : {};
  const timeline = Array.isArray(weather.next6Hours) ? weather.next6Hours : [];
  const status = safeText(weather.weatherText || weather.status || source.subtitle || "", 24);
  const iconClass = /雨|雷|降水/.test(status)
    ? "rain"
    : (/云|阴/.test(status) ? "cloud" : "sun");
  return {
    campus: safeText(weather.campus || source.title || "校区天气", 32),
    weatherText: status || "天气待确认",
    updatedLabel: safeText(weather.updatedLabel || weather.updatedAt || "", 32),
    cachedText: weather.cached ? "使用最近数据" : "实时天气",
    temperatureC: safeText(weather.temperatureC, 12),
    apparentTemperatureC: safeText(weather.apparentTemperatureC, 12),
    highC: safeText(weather.highC, 12),
    lowC: safeText(weather.lowC, 12),
    humidity: safeText(weather.humidity, 12),
    windSpeedKmh: safeText(weather.windSpeedKmh, 12),
    precipitationMm: safeText(weather.precipitationMm, 12),
    rainProbabilityMax24h: safeText(weather.rainProbabilityMax24h, 12),
    advice: safeText(weather.advice || weather.travelAdvice || "", 90),
    next6Hours: timeline.slice(0, 6).map((item, index) => ({
      key: `${item.time || index}-${index}`,
      time: safeText(item.time || "", 12),
      temperatureC: safeText(item.temperatureC, 12),
      rainProbability: safeText(item.rainProbability, 12),
    })),
    iconClass,
  };
}

function normalizeCardItem(item, index, cardType) {
  const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const subtitle = safeText(source.subtitle || source.desc || source.detail || "", 140);
  let displaySubtitle = String(cardType || "") === "empty_room"
    ? subtitle.replace(/(?:\s*·\s*)?容量未知/g, "").replace(/^\s*·\s*|\s*·\s*$/g, "")
    : subtitle;
  const courseLike = ["schedule", "teacher", "course", "reminder", "generic"].indexOf(String(cardType || "")) >= 0;
  const section = courseLike ? inferSectionText(source) : "";
  const timeRange = courseLike ? inferCourseTimeRange(source) : "";
  let value = safeText(source.value || source.time || source.status || "", 60);
  const valueLooksLikeSection = /第?\s*\d{1,2}\s*(?:[-~～至到]\s*\d{1,2})?\s*节/.test(value);
  if (timeRange && (!value || valueLooksLikeSection)) {
    value = timeRange;
  }
  if (timeRange && section && displaySubtitle.indexOf(section) < 0) {
    displaySubtitle = [section, displaySubtitle].filter(Boolean).join(" · ");
  }
  const normalized = {
    key: `${safeText(source.title || source.name || "item", 60, "item")}-${index}`,
    title: safeText(source.title || source.name || "", 80),
    subtitle: safeText(displaySubtitle, 140),
    value,
  };
  return normalized.title || normalized.subtitle || normalized.value ? normalized : null;
}

function normalizeCardAction(action, index) {
  const source = action && typeof action === "object" && !Array.isArray(action) ? action : {};
  const rawType = safeText(source.type || "noop", 20, "noop").toLowerCase();
  const type = ALLOWED_ACTION_TYPES.indexOf(rawType) >= 0 ? rawType : "noop";
  const label = safeText(source.label, 30, ACTION_LABEL_FALLBACKS[type] || ACTION_LABEL_FALLBACKS.noop) ||
    ACTION_LABEL_FALLBACKS[type] ||
    ACTION_LABEL_FALLBACKS.noop;
  return {
    label,
    type,
    url: safeText(source.url || "", 240),
    payload: source.payload && typeof source.payload === "object" && !Array.isArray(source.payload) ? source.payload : {},
    originalIndex: index,
  };
}

function isInactiveScheduleItem(item) {
  const source = item || {};
  const status = String(source.status || source.weekStatus || source.activeStatus || source.weekReason || "").toLowerCase();
  return source.active === false ||
    source.isActive === false ||
    source.weekActive === false ||
    source.inactive === true ||
    source.uncertain === true ||
    source.weekUncertain === true ||
    /inactive|not-active|uncertain|missing-week|非本周|不在本周|周次不确定/.test(status);
}

function extractInactiveFilteredCount(card) {
  const source = card || {};
  const metrics = source.metrics && typeof source.metrics === "object" && !Array.isArray(source.metrics) ? source.metrics : {};
  const direct = Number(source.inactiveFilteredCount || metrics.inactiveFilteredCount || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const badges = Array.isArray(source.badges) ? source.badges : [];
  for (const badge of badges) {
    const match = String(badge || "").match(/(?:过滤|filtered)[^\d]*(\d+)/i);
    if (match) return Number(match[1]) || 0;
  }
  return 0;
}

function cardKey(messageId, card, index) {
  return `${messageId}:${index}:${safeText(card && (card.title || card.type) || "card", 40)}`;
}

function normalizeCard(card, messageId, index, expandedCards) {
  const source = card && typeof card === "object" && !Array.isArray(card) ? card : {};
  const type = safeText(source.type || "generic", 30, "generic").toLowerCase() || "generic";
  const rawTitle = safeText(source.title || "", 80);
  const subtitle = safeText(source.subtitle || "", 140);
  const scheduleLike = type === "schedule" || /今日|课程|课表|today|schedule/i.test(rawTitle);
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const filteredRawItems = scheduleLike ? rawItems.filter((item) => !isInactiveScheduleItem(item)) : rawItems;
  const items = filteredRawItems
    .map((item, itemIndex) => normalizeCardItem(item, itemIndex, type))
    .filter(Boolean);
  const rawActions = Array.isArray(source.actions) ? source.actions : [];
  const seenActions = {};
  const actions = rawActions.map(normalizeCardAction)
    .filter((action) => action && action.label && action.type !== "noop")
    .filter((action) => {
      const key = `${action.type}|${action.url}|${action.label}`;
      if (seenActions[key]) return false;
      seenActions[key] = true;
      return true;
    })
    .slice(0, 3)
    .map((action, actionIndex) => Object.assign({}, action, { originalIndex: actionIndex }));
  const badges = Array.isArray(source.badges)
    ? source.badges.map((item) => safeText(item, 36)).filter(Boolean).slice(0, 2)
    : [];
  const weatherPayload = type === "weather" ? normalizeWeatherPayload(source) : null;
  const hasDisplayContent = rawTitle || subtitle || badges.length || items.length || actions.length || weatherPayload;
  if (!hasDisplayContent) return null;

  const key = cardKey(messageId, source, index);
  const expanded = Boolean(expandedCards && expandedCards[key]);
  const visibleLimit = expanded ? 12 : 5;
  const visibleItems = items.slice(0, visibleLimit);
  const inactiveFilteredCount = Math.max(extractInactiveFilteredCount(source), rawItems.length - filteredRawItems.length);
  const filteredHint = inactiveFilteredCount > 0 ? `已过滤 ${inactiveFilteredCount} 门非本周课程` : "";
  const title = scheduleLike && source.allFinished === true
    ? "今日课程已结束"
    : (rawTitle || CARD_TITLE_FALLBACKS[type] || CARD_TITLE_FALLBACKS.generic);
  const primaryActions = actions.slice(0, 1);
  const secondaryActions = actions.slice(1, 3);
  const errorClass = source.variant === "error" || /服务暂时不可用|服务暂不可用/.test(title) ? "card-error" : "";
  return Object.assign({}, source, {
    key,
    title: safeText(title, 80, CARD_TITLE_FALLBACKS[type] || CARD_TITLE_FALLBACKS.generic),
    subtitle,
    badges,
    items,
    actions,
    typeLabel: mapCardTypeLabel(type),
    typeClass: typeClass(type),
    weather: weatherPayload,
    weatherIconClass: weatherPayload && weatherPayload.iconClass || "",
    visibleItems,
    hiddenItemCount: Math.max(0, items.length - visibleItems.length),
    overflowText: expanded ? "收起" : `展开 ${items.length - visibleItems.length} 条`,
    overflowExpanded: expanded,
    primaryActions,
    secondaryActions,
    actionLayoutClass: primaryActions.length === 1 ? "one-action" : "",
    errorClass,
    filteredHint,
  });
}

function normalizeMessageForDisplay(message, expandedCards, previousMessage) {
  const source = message || {};
  const id = source.id || `m-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const evidenceLabel = inferEvidenceLabel(source);
  const normalizedSafety = source.safety ? normalizeSafety(source.safety) : null;
  const displaySafety = normalizedSafety ? Object.assign(normalizedSafety, {
    text: evidenceLabel || normalizedSafety.text,
  }) : null;
  const metrics = normalizeMetrics(source.metrics);
  const role = source.role === "user" ? "user" : "assistant";
  const displayTaskSteps = Array.isArray(source.taskSteps)
    ? source.taskSteps.slice(0, 6).map(normalizeTaskStep)
    : [];
  const displayToolCalls = displayTaskSteps.length
    ? displayTaskSteps
    : (Array.isArray(source.toolCalls) ? source.toolCalls.slice(0, 4).map(normalizeToolCall) : []);
  return Object.assign({}, source, {
    id,
    role,
    content: safeText(source.content || "", 1200),
    cards: Array.isArray(source.cards) ? source.cards : [],
    displayCards: Array.isArray(source.cards)
      ? source.cards.slice(0, 5).map((card, index) => normalizeCard(card, id, index, expandedCards)).filter(Boolean)
      : [],
    suggestions: Array.isArray(source.suggestions) ? source.suggestions.slice(0, 6).map((item) => safeText(item, 60)).filter(Boolean) : [],
    toolCalls: Array.isArray(source.toolCalls) ? source.toolCalls : [],
    taskSteps: Array.isArray(source.taskSteps) ? source.taskSteps : [],
    evidence: source.evidence || null,
    evidenceText: buildEvidenceText(source.evidence, evidenceLabel),
    displayToolCalls,
    safety: source.safety || null,
    displaySafety,
    metrics,
    metricsText: metrics ? `耗时 ${metrics.latencyMs} ms` : "",
    showAvatar: role === "assistant" && (!previousMessage || previousMessage.role === "user"),
    timeText: source.timeText || timeText(),
  });
}

function normalizeMessagesForDisplay(messages, expandedCards) {
  if (!Array.isArray(messages)) return [];
  return messages.map((item, index) => normalizeMessageForDisplay(item, expandedCards, messages[index - 1]));
}

function trimMessages(messages) {
  return Array.isArray(messages) ? messages.slice(-MAX_MESSAGE_COUNT) : [];
}

function makeMessage(role, content, patch) {
  return Object.assign({
    id: `${role}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    role,
    content,
    cards: [],
    suggestions: [],
    toolCalls: [],
    safety: null,
    timeText: timeText(),
  }, patch || {});
}

function parseActionUrl(url) {
  const target = String(url || "");
  const parts = target.split("?");
  const path = parts[0] || "";
  const queryText = parts.slice(1).join("?");
  const query = {};
  if (queryText) {
    queryText.split("&").forEach((pair) => {
      if (!pair) return;
      const kv = pair.split("=");
      const key = decodeQuery(kv[0] || "");
      if (!key) return;
      query[key] = decodeQuery(kv.slice(1).join("=") || "");
    });
  }
  return { path, query, raw: target };
}

function buildPrivacyState(allowed, expanded, firstTipVisible) {
  const enabled = allowed === true;
  return {
    allowPersonalContext: enabled,
    privacyStatusText: enabled ? "仅发送脱敏课表摘要" : "默认不发送课表摘要",
    privacyCompactClass: enabled ? "enabled" : "disabled",
    privacyActionText: enabled ? "已允许" : "已关闭",
    composerNote: enabled ? "摘要开启：仅发送脱敏课表摘要" : "摘要关闭：默认不发送个人课表摘要",
    privacyActionLabel: firstTipVisible ? "知道了" : (expanded ? "收起" : "说明"),
  };
}

function resolveProviderState(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    const safety = message && (message.displaySafety || (message.safety && normalizeSafety(message.safety)));
    if (safety) {
      return {
        providerLabel: safety.providerLabel,
        providerModeLabel: safety.modeLabel,
        lastProvider: safety.provider,
        lastExternalProviderUsed: safety.externalProviderUsed === true,
        lastFallbackReason: safety.fallbackReason || "",
      };
    }
  }
  return {
    providerLabel: "已核验课表数据",
    providerModeLabel: "工具验证",
    lastProvider: "unknown",
    lastExternalProviderUsed: false,
    lastFallbackReason: "",
  };
}

function buildHeaderSubtitle(state) {
  const source = state || {};
  if (source.lastFallbackReason) {
    return "已使用本地规则";
  }
  if (source.lastExternalProviderUsed) {
    return "正在整理结果";
  }
  if (source.allowPersonalContext === true) {
    return "已核验课表数据 · 已开启课表摘要";
  }
  return "已核验课表数据";
}

Page({
  data: {
    quickActions: QUICK_ACTIONS,
    welcomeExamples: WELCOME_EXAMPLES,
    capabilityGuideGroups: CAPABILITY_GUIDE_GROUPS,
    taskPanelGroups: [],
    taskPanelReady: false,
    taskPanelLoading: false,
    messages: [],
    expandedCards: {},
    inputValue: "",
    inputFocus: false,
    sending: false,
    sendingStatusText: "正在调用校园工具并生成卡片",
    showTaskPanel: false,
    showCapabilityGuide: false,
    showHeaderMenu: false,
    showPrivacySheet: false,
    slowRequest: false,
    showPrivacyTip: false,
    privacyExpanded: false,
    privacyText: PRIVACY_SUMMARY_TEXT,
    privacyStatusText: "课表摘要默认关闭",
    privacyCompactClass: "disabled",
    privacyActionText: "摘要关闭",
    privacyActionLabel: "说明",
    allowPersonalContext: false,
    providerLabel: "AI",
    providerModeLabel: "工具验证",
    lastExternalProviderUsed: false,
    lastFallbackReason: "",
    lastProvider: "unknown",
    headerSubtitle: "已核验课表数据",
    historyTrimNotice: false,
    hasHeroLogo: true,
    demoMode: "",
    scrollTop: 0,
    composerNote: "默认不发送个人课表摘要",
    voiceInputVisible: false,
    voiceRecording: false,
    voiceRecognizing: false,
    voiceStatusText: "",
  },

  onLoad(options) {
    this._aiPageUnloaded = false;
    this._activeAiRequestId = "";
    this._lastSubmitAt = 0;
    this._lastSubmitText = "";
    this._isComposing = false;
    this._recorderManager = null;
    this.debouncedOpenTaskPanel = createDebounced(() => this.openTaskPanelNow(), TASK_PANEL_DEBOUNCE_MS);
    this.debouncedSendTaskMessage = createDebounced((message, sendOptions) => {
      this.sendMessage(message, sendOptions);
    }, TASK_ACTION_DEBOUNCE_MS);
    const showPrivacyTip = wx.getStorageSync(PRIVACY_TIP_KEY) !== true;
    const allowPersonalContext = aiAssistantService.isPersonalContextAllowed();
    const demoMode = demoData.normalizeDemoMode(options && options.demo);
    const sourceMessages = demoMode ? demoData.getDemoMessages(demoMode) : aiAssistantService.getAiHistory();
    const messages = normalizeMessagesForDisplay(trimMessages(sourceMessages), this.data.expandedCards);
    const providerState = resolveProviderState(messages);
    const privacyState = buildPrivacyState(allowPersonalContext, false, showPrivacyTip);
    const nextState = Object.assign({
      messages,
      showPrivacyTip,
      privacyExpanded: false,
      showPrivacySheet: false,
      demoMode,
    }, privacyState, providerState);
    nextState.headerSubtitle = buildHeaderSubtitle(nextState);

    this.setData(Object.assign(nextState, { scrollTop: Date.now() }));
    this.initVoiceInput();

    const question = decodeQuery(options && (options.q || options.question || ""));
    if (!demoMode && question) {
      setTimeout(() => this.sendMessage(question), 260);
    }
  },

  onShow() {
    this._aiPageUnloaded = false;
    const privacyState = buildPrivacyState(
      aiAssistantService.isPersonalContextAllowed(),
      this.data.privacyExpanded,
      this.data.showPrivacyTip
    );
    const nextState = Object.assign({}, privacyState, resolveProviderState(this.data.messages));
    nextState.headerSubtitle = buildHeaderSubtitle(Object.assign({}, this.data, nextState));
    this.setData(nextState);
  },

  onUnload() {
    this._aiPageUnloaded = true;
    this._activeAiRequestId = "";
  },

  onInput(event) {
    this.setData({ inputValue: event.detail.value });
  },

  onCompositionStart() {
    this._isComposing = true;
  },

  onCompositionEnd() {
    this._isComposing = false;
  },

  onComposerConfirm(event) {
    if (this._isComposing) return;
    const value = event && event.detail && event.detail.value;
    this.sendMessage(value == null ? this.data.inputValue : value, { source: "confirm" });
  },

  onInsertNewline() {
    if (this.data.sending) return;
    const current = String(this.data.inputValue || "");
    this.setData({
      inputValue: `${current}\n`,
      inputFocus: true,
    });
  },

  initVoiceInput() {
    const visible = aiVoiceInputService.isVoiceInputAvailable(cloudbaseConfig, typeof wx !== "undefined" ? wx : null);
    this.setData({
      voiceInputVisible: visible,
      voiceStatusText: visible ? "" : "",
    });
    if (!visible || typeof wx === "undefined" || typeof wx.getRecorderManager !== "function") return;
    const recorder = wx.getRecorderManager();
    this._recorderManager = recorder;
    recorder.onStart && recorder.onStart(() => {
      this.setData({ voiceRecording: true, voiceRecognizing: false, voiceStatusText: "正在录音" });
    });
    recorder.onStop && recorder.onStop((res) => this.handleVoiceRecordStop(res));
    recorder.onError && recorder.onError(() => {
      this.setData({ voiceRecording: false, voiceRecognizing: false, voiceStatusText: "识别失败" });
      wx.showToast({ title: "录音失败", icon: "none" });
    });
  },

  ensureRecordPermission() {
    return new Promise((resolve) => {
      wx.authorize({
        scope: "scope.record",
        success: () => resolve(true),
        fail: () => {
          wx.showModal({
            title: "需要录音权限",
            content: "语音只用于本次转文字，识别完成后会删除临时文件。",
            confirmText: "打开设置",
            cancelText: "取消",
            success: (res) => {
              if (!res.confirm) return resolve(false);
              wx.openSetting({
                success: (setting) => resolve(Boolean(setting.authSetting && setting.authSetting["scope.record"])),
                fail: () => resolve(false),
              });
            },
            fail: () => resolve(false),
          });
        },
      });
    });
  },

  onVoiceTap() {
    if (!this.data.voiceInputVisible) {
      wx.showToast({ title: "当前环境暂不支持语音识别", icon: "none" });
      return;
    }
    if (this.data.sending || this.data.voiceRecognizing) return;
    if (this.data.voiceRecording) {
      this.stopVoiceRecording();
      return;
    }
    this.startVoiceRecording();
  },

  startVoiceRecording() {
    if (this.data.voiceRecording || this.data.sending) return;
    this.ensureRecordPermission().then((allowed) => {
      if (!allowed || !this._recorderManager) return;
      this.setData({ voiceStatusText: "正在录音" });
      this._voiceRecordStartedAt = Date.now();
      this._recorderManager.start({
        duration: Number(cloudbaseConfig.AI_VOICE_MAX_DURATION_MS || 15000) || 15000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3",
      });
    });
  },

  stopVoiceRecording() {
    if (!this._recorderManager || !this.data.voiceRecording) return;
    this._recorderManager.stop();
  },

  cancelVoiceRecording() {
    if (this._recorderManager && this.data.voiceRecording) {
      this._voiceCancelled = true;
      this._recorderManager.stop();
    }
    this.setData({ voiceRecording: false, voiceRecognizing: false, voiceStatusText: "" });
  },

  handleVoiceRecordStop(res) {
    if (this._voiceCancelled) {
      this._voiceCancelled = false;
      return;
    }
    const durationMs = Number(res && res.duration || 0) || Math.max(0, Date.now() - Number(this._voiceRecordStartedAt || Date.now()));
    this.setData({ voiceRecording: false });
    if (durationMs < aiVoiceInputService.MIN_DURATION_MS) {
      this.setData({ voiceRecognizing: false, voiceStatusText: "录音时间太短" });
      wx.showToast({ title: "录音时间太短", icon: "none" });
      return;
    }
    this.setData({ voiceRecognizing: true, voiceStatusText: "正在识别" });
    aiVoiceInputService.transcribeRecording({
      tempFilePath: res && res.tempFilePath,
      durationMs,
      fileSize: res && res.fileSize,
      format: "mp3",
    }).then((result) => {
      const text = String(result && result.text || "").trim();
      if (!text) throw new Error("EMPTY_VOICE_TEXT");
      this.setData({
        inputValue: text,
        inputFocus: true,
        voiceRecognizing: false,
        voiceStatusText: "识别完成",
      });
    }).catch(() => {
      this.setData({ voiceRecognizing: false, voiceStatusText: "识别失败" });
      wx.showToast({ title: "识别失败，可继续文字输入", icon: "none" });
    });
  },

  queueTaskMessage(message, options) {
    if (!message) return;
    if (this.debouncedSendTaskMessage) {
      this.debouncedSendTaskMessage(message, options || {});
      return;
    }
    this.sendMessage(message, options);
  },

  onQuickAction(event) {
    const actionId = event.currentTarget.dataset.actionId;
    const action = QUICK_ACTIONS.find((item) => item.id === actionId);
    if (!action) return;
    if (action.id === "teacher") {
      this.setData({
        inputValue: action.draft,
        inputFocus: true,
      });
      return;
    }
    if (action.url) {
      this.navigateByUrl(action.url);
      return;
    }
    this.queueTaskMessage(action.message || action.label);
  },

  onWelcomeExampleTap(event) {
    const question = event.currentTarget.dataset.question;
    if (question) this.queueTaskMessage(question);
  },

  onTaskPanelItemTap(event) {
    const groupIndex = Number(event.currentTarget.dataset.groupIndex);
    const taskIndex = Number(event.currentTarget.dataset.taskIndex);
    const group = this.data.taskPanelGroups[groupIndex] || {};
    const task = Array.isArray(group.items) ? group.items[taskIndex] : null;
    if (!task) return;
    if (task.requiresKeyword) {
      this.setData({
        inputValue: task.draft || task.label,
        inputFocus: true,
        showTaskPanel: false,
      });
      wx.showToast({ title: "请替换关键词后发送", icon: "none" });
      return;
    }
    if (task.url) {
      this.setData({ showTaskPanel: false });
      this.navigateByUrl(task.url);
      return;
    }
    this.setData({ showTaskPanel: false });
    this.queueTaskMessage(task.message || task.fallbackMessage || task.label);
  },

  onSuggestionTap(event) {
    const suggestion = event.currentTarget.dataset.suggestion;
    if (suggestion) this.queueTaskMessage(suggestion);
  },

  onSubmit() {
    this.sendMessage(this.data.inputValue);
  },

  setMessages(nextMessages, patch, options) {
    const trimmed = Array.isArray(nextMessages) && nextMessages.length > MAX_MESSAGE_COUNT;
    const sourceMessages = trimMessages(nextMessages);
    const messages = normalizeMessagesForDisplay(sourceMessages, this.data.expandedCards);
    const providerState = resolveProviderState(messages);
    const nextState = Object.assign({
      messages,
      scrollTop: Date.now(),
      historyTrimNotice: this.data.historyTrimNotice || trimmed,
    }, providerState, patch || {});
    nextState.headerSubtitle = buildHeaderSubtitle(Object.assign({}, this.data, nextState));
    this.setData(nextState);
    if (options && options.save) {
      aiAssistantService.saveAiHistory(messages);
    }
  },

  sendMessage(rawText, options) {
    const message = String(rawText || "").trim();
    if (!message || this.data.sending) return;
    const sendOptions = options || {};
    const isRetrySend = Number.isFinite(Number(sendOptions.retryAssistantIndex));
    const now = Date.now();
    if (!isRetrySend && this._lastSubmitText === message && now - Number(this._lastSubmitAt || 0) < SEND_DEDUPE_MS) return;
    this._lastSubmitText = message;
    this._lastSubmitAt = now;

    const requestId = `ai-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    this._activeAiRequestId = requestId;
    let baseMessages = (this.data.messages || []).slice();
    let appendUserMessage = true;
    if (isRetrySend) {
      const retryIndex = Number(sendOptions.retryAssistantIndex);
      const retryMessage = baseMessages[retryIndex];
      if (retryMessage && retryMessage.role === "assistant") {
        const previous = baseMessages[retryIndex - 1];
        baseMessages.splice(retryIndex, 1);
        appendUserMessage = !(previous && previous.role === "user" && previous.content === message);
      }
    } else {
      const lastIndex = baseMessages.length - 1;
      const lastMessage = baseMessages[lastIndex];
      const previous = baseMessages[lastIndex - 1];
      const lastCard = lastMessage && Array.isArray(lastMessage.cards) ? lastMessage.cards[0] : null;
      if (
        lastMessage &&
        lastMessage.role === "assistant" &&
        lastCard &&
        lastCard.variant === "error" &&
        previous &&
        previous.role === "user" &&
        previous.content === message
      ) {
        baseMessages.pop();
        appendUserMessage = false;
      }
    }

    const userMessage = appendUserMessage ? makeMessage("user", message) : null;
    const nextMessages = appendUserMessage ? baseMessages.concat(userMessage) : baseMessages;
    this.setMessages(nextMessages, {
      inputValue: "",
      inputFocus: false,
      sending: true,
      slowRequest: false,
      sendingStatusText: "正在理解问题",
    }, { save: !this.data.demoMode });

    if (this.data.demoMode) {
      setTimeout(() => {
        const response = demoData.getDemoResponse(this.data.demoMode, message);
        const assistantMessage = makeMessage("assistant", response.answer || "我已经整理好演示结果。", {
          cards: Array.isArray(response.cards) ? response.cards : [],
          suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
          toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
          taskSteps: Array.isArray(response.taskSteps) ? response.taskSteps : [],
          evidence: response.evidence || null,
          safety: response.safety || null,
          metrics: response.metrics || null,
        });
        this.setMessages(nextMessages.concat(assistantMessage), {
          sending: false,
          slowRequest: false,
        }, { save: false });
      }, 160);
      return;
    }

    const isRequestActive = () => !this._aiPageUnloaded && this._activeAiRequestId === requestId;
    const slowTimer = setTimeout(() => {
      if (!isRequestActive()) return;
      this.setData({ slowRequest: true });
    }, 7000);

    let streamAssistantId = "";
    let streamContent = "";
    let streamTimer = null;
    let lastStreamFlushAt = 0;
    const clearStreamTimer = () => {
      if (streamTimer) {
        clearTimeout(streamTimer);
        streamTimer = null;
      }
    };
    const flushStream = (force) => {
      if (!isRequestActive()) return;
      if (!streamContent) return;
      const elapsed = Date.now() - lastStreamFlushAt;
      if (!force && elapsed < 80) {
        if (!streamTimer) {
          streamTimer = setTimeout(() => {
            streamTimer = null;
            flushStream(true);
          }, 80 - elapsed);
        }
        return;
      }
      clearStreamTimer();
      lastStreamFlushAt = Date.now();
      if (!streamAssistantId) streamAssistantId = `assistant-stream-${lastStreamFlushAt}`;
      const current = (this.data.messages || []).slice();
      const existingIndex = current.findIndex((item) => item.id === streamAssistantId);
      const streamingMessage = makeMessage("assistant", streamContent, {
        id: streamAssistantId,
        cards: [],
        suggestions: [],
        toolCalls: [],
        safety: {
          provider: "public",
          resolvedProvider: "public",
          externalProviderUsed: false,
          mode: "tool-grounded",
        },
      });
      if (existingIndex >= 0) {
        current[existingIndex] = Object.assign({}, current[existingIndex], streamingMessage, {
          timeText: current[existingIndex].timeText || streamingMessage.timeText,
        });
      } else {
        current.push(streamingMessage);
      }
      this.setMessages(current, {}, { save: false });
    };
    const callbacks = {
      onStatus: (status) => {
        if (!isRequestActive()) return;
        const text = status && status.text || "";
        if (text) this.setData({ sendingStatusText: text });
      },
      onDelta: (delta, fullText) => {
        if (!isRequestActive()) return;
        streamContent = fullText || `${streamContent}${delta || ""}`;
        flushStream(false);
      },
    };

    aiAssistantService.chat(message, aiAssistantService.buildClientContext(), { callbacks })
      .then((response) => {
        if (!isRequestActive()) return;
        flushStream(true);
        const safety = response && response.safety || {};
        if (safety.pendingClarification) {
          aiAssistantService.setPendingClarification(safety.pendingClarification);
        } else if (safety.clearPendingClarification || response && response.metrics && response.metrics.intentName !== "clarify_missing_slot") {
          aiAssistantService.clearPendingClarification();
        }
        const assistantMessage = makeMessage("assistant", response.answer || "我已经整理好结果。", {
          cards: Array.isArray(response.cards) ? response.cards : [],
          suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
          toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
          taskSteps: Array.isArray(response.taskSteps) ? response.taskSteps : [],
          evidence: response.evidence || null,
          safety,
          metrics: response.metrics || null,
        });
        let finalMessages = (this.data.messages || []).slice();
        if (streamAssistantId) {
          const existingIndex = finalMessages.findIndex((item) => item.id === streamAssistantId);
          if (existingIndex >= 0) {
            finalMessages.splice(existingIndex, 1, assistantMessage);
          } else {
            finalMessages.push(assistantMessage);
          }
        } else {
          finalMessages.push(assistantMessage);
        }
        this.setMessages(finalMessages, {
          sending: false,
          slowRequest: false,
          sendingStatusText: "正在调用校园工具并生成卡片",
        }, { save: true });
      })
      .catch((error) => {
        if (!isRequestActive()) return;
        flushStream(true);
        const assistantMessage = makeMessage("assistant", "", {
          cards: [{
            type: "generic",
            variant: "error",
            title: "服务暂时不可用，已保留你的问题。",
            subtitle: "可以重试，或先使用全校查询/空教室页面。",
            badges: [],
            items: [],
            actions: [
              { label: "重试", type: "retry", url: "", payload: { message } },
              { label: "打开全校查询", type: "navigate", url: "/pages/school/school", payload: {} },
              { label: "打开空教室", type: "navigate", url: "/pages/empty-room/empty-room", payload: {} },
            ],
          }],
          suggestions: [],
          safety: { provider: "mock", mode: "fallback" },
        });
        let finalMessages = (this.data.messages || []).slice();
        if (streamAssistantId) {
          const existingIndex = finalMessages.findIndex((item) => item.id === streamAssistantId);
          if (existingIndex >= 0) {
            finalMessages.splice(existingIndex, 1, assistantMessage);
          } else {
            finalMessages.push(assistantMessage);
          }
        } else {
          finalMessages.push(assistantMessage);
        }
        this.setMessages(finalMessages, {
          sending: false,
          slowRequest: false,
          sendingStatusText: "正在调用校园工具并生成卡片",
        }, { save: true });
      })
      .finally(() => {
        clearTimeout(slowTimer);
        clearStreamTimer();
        if (this._activeAiRequestId === requestId) {
          this._activeAiRequestId = "";
        }
      });
  },

  dismissPrivacyTip() {
    wx.setStorageSync(PRIVACY_TIP_KEY, true);
    const privacyState = buildPrivacyState(this.data.allowPersonalContext, false, false);
    const nextState = Object.assign({
      showPrivacyTip: false,
      privacyExpanded: false,
      showPrivacySheet: false,
    }, privacyState);
    nextState.headerSubtitle = buildHeaderSubtitle(Object.assign({}, this.data, nextState));
    this.setData(nextState);
  },

  togglePrivacyTip() {
    const expanded = !this.data.showPrivacySheet;
    const privacyState = buildPrivacyState(this.data.allowPersonalContext, expanded, this.data.showPrivacyTip);
    this.setData(Object.assign({
      privacyExpanded: expanded,
      showPrivacySheet: expanded,
      showTaskPanel: false,
      showCapabilityGuide: false,
      showHeaderMenu: false,
    }, privacyState));
  },

  openPrivacySheet() {
    const privacyState = buildPrivacyState(this.data.allowPersonalContext, true, this.data.showPrivacyTip);
    this.setData(Object.assign({
      privacyExpanded: true,
      showPrivacySheet: true,
      showTaskPanel: false,
      showCapabilityGuide: false,
      showHeaderMenu: false,
    }, privacyState));
  },

  closePrivacySheet() {
    const privacyState = buildPrivacyState(this.data.allowPersonalContext, false, false);
    this.setData(Object.assign({
      privacyExpanded: false,
      showPrivacySheet: false,
      showPrivacyTip: false,
    }, privacyState));
  },

  openTaskPanel() {
    if (this.debouncedOpenTaskPanel) {
      this.debouncedOpenTaskPanel();
      return;
    }
    this.openTaskPanelNow();
  },

  openTaskPanelNow() {
    const cachedGroups = readTaskPanelGroupsCache();
    this.setData({
      showTaskPanel: true,
      showPrivacySheet: false,
      showCapabilityGuide: false,
      showHeaderMenu: false,
      privacyExpanded: false,
      taskPanelReady: Boolean(cachedGroups),
      taskPanelLoading: !cachedGroups,
      taskPanelGroups: cachedGroups || this.data.taskPanelGroups,
    });
    if (cachedGroups) return;

    setTimeout(() => {
      if (!this.data.showTaskPanel) return;
      const groups = cloneTaskPanelGroups();
      writeTaskPanelGroupsCache(groups);
      this.setData({
        taskPanelGroups: groups,
        taskPanelReady: true,
        taskPanelLoading: false,
      });
    }, 32);
  },

  closeTaskPanel() {
    this.setData({ showTaskPanel: false });
  },

  openCapabilityGuide() {
    this.setData({
      showCapabilityGuide: true,
      showTaskPanel: false,
      showPrivacySheet: false,
      showHeaderMenu: false,
      privacyExpanded: false,
    });
  },

  closeCapabilityGuide() {
    this.setData({ showCapabilityGuide: false });
  },

  openHeaderMenu() {
    this.setData({
      showHeaderMenu: true,
      showCapabilityGuide: false,
      showTaskPanel: false,
      showPrivacySheet: false,
      privacyExpanded: false,
    });
  },

  closeHeaderMenu() {
    this.setData({ showHeaderMenu: false });
  },

  onCapabilityExampleTap(event) {
    const text = event.currentTarget.dataset.text;
    if (!text) return;
    this.setData({
      inputValue: text,
      inputFocus: true,
      showCapabilityGuide: false,
    });
  },

  openCampusMapFromGuide() {
    this.setData({ showCapabilityGuide: false });
    this.navigateByUrl("/pages/campus-map/campus-map");
  },

  closeSheets() {
    this.setData({
      showTaskPanel: false,
      showCapabilityGuide: false,
      showPrivacySheet: false,
      showHeaderMenu: false,
      privacyExpanded: false,
    });
  },

  applyPersonalContextAllowed(allowed) {
    aiAssistantService.setPersonalContextAllowed(allowed);
    const privacyState = buildPrivacyState(allowed, this.data.privacyExpanded, this.data.showPrivacyTip);
    const nextState = Object.assign({}, privacyState);
    nextState.headerSubtitle = buildHeaderSubtitle(Object.assign({}, this.data, nextState));
    this.setData(nextState);
    wx.showToast({ title: allowed ? "已开启摘要" : "已关闭摘要", icon: "none" });
  },

  onPersonalContextToggle(event) {
    const allowed = event.detail.value === true;
    if (!allowed) {
      this.applyPersonalContextAllowed(false);
      return;
    }
    wx.showModal({
      title: "允许分析本机课表摘要？",
      content: PRIVACY_SUMMARY_TEXT,
      confirmText: "允许",
      cancelText: "取消",
      success: (res) => {
        if (res.confirm) {
          this.applyPersonalContextAllowed(true);
          return;
        }
        this.applyPersonalContextAllowed(false);
      },
      fail: () => this.applyPersonalContextAllowed(false),
    });
  },

  onHeroLogoError() {
    if (this.data.hasHeroLogo) this.setData({ hasHeroLogo: false });
  },

  clearHistory() {
    this.setData({ showHeaderMenu: false });
    wx.showModal({
      title: "清空对话",
      content: "仅清空本机保存的最近 AI 对话，不影响课表数据。",
      confirmText: "清空",
      success: (res) => {
        if (!res.confirm) return;
        aiAssistantService.clearAiHistory();
        aiAssistantService.clearPendingClarification();
        this.setMessages([], { historyTrimNotice: false }, { save: false });
      },
    });
  },

  onCardOverflow(event) {
    const key = event.currentTarget.dataset.cardKey;
    if (!key) return;
    const expandedCards = Object.assign({}, this.data.expandedCards);
    expandedCards[key] = !expandedCards[key];
    const messages = normalizeMessagesForDisplay(this.data.messages, expandedCards);
    this.setData({
      expandedCards,
      messages,
      scrollTop: Date.now(),
    });
  },

  onCardAction(event) {
    const messageIndex = Number(event.currentTarget.dataset.messageIndex);
    const cardIndex = Number(event.currentTarget.dataset.cardIndex);
    const actionIndex = Number(event.currentTarget.dataset.actionIndex);
    const message = this.data.messages[messageIndex] || {};
    const card = (message.displayCards || [])[cardIndex] || {};
    const action = (card.actions || [])[actionIndex] || {};
    const type = action.type || "noop";

    if (type === "retry") {
      this.sendMessage(action.payload && action.payload.message || this.findLastUserMessage(), {
        retryAssistantIndex: messageIndex,
      });
      return;
    }
    if (type === "copy") {
      wx.setClipboardData({ data: action.payload && action.payload.text || action.url || card.title || "" });
      return;
    }
    if ((type === "navigate" || type === "bind") && action.url) {
      this.navigateByUrl(action.url);
    }
  },

  findLastUserMessage() {
    const list = this.data.messages || [];
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (list[index].role === "user") return list[index].content;
    }
    return "";
  },

  navigateByUrl(url) {
    const parsed = parseActionUrl(url);
    if (!parsed.path) return;
    const storageKey = TABBAR_PENDING_QUERY[parsed.path];
    if (storageKey) {
      if (parsed.query && Object.keys(parsed.query).length) {
        try {
          wx.setStorageSync(storageKey, Object.assign({}, parsed.query, { fromAiAssistant: true, ts: Date.now() }));
        } catch (error) {
          // switchTab still opens the target page.
        }
      }
      wx.switchTab({ url: parsed.path });
      return;
    }
    wx.navigateTo({
      url: parsed.raw,
      fail: () => wx.showToast({ title: "暂时无法打开该页面", icon: "none" }),
    });
  },
});

if (typeof module !== "undefined") {
  module.exports = {
    normalizeCard,
    normalizeCardItem,
    normalizeMessagesForDisplay,
  };
}
