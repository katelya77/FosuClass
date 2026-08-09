const scheduleIntentParser = require("./scheduleIntentParser");
const ragRetriever = require("./ragRetriever");
const agentCapabilityCompat = require("../shared/agentCapabilityCompat.generated");

// This module is the Offline Fallback / V1 Compatibility Router. Online
// semantic decisions belong exclusively to the server Agent Kernel.

const INTENTS = {
  SCHEDULE_QUERY: "schedule_query",
  PERSONAL_SCHEDULE: "personal_schedule",
  SCHEDULE_STATUS: "schedule_status",
  WEATHER: "weather",
  SCHOOL_KNOWLEDGE: "school_knowledge",
  NAVIGATION: "navigation",
  APP_NAVIGATION: "app_navigation",
  HELP: "help",
  QUICK_ACTION: "quick_action",
  SMALLTALK: "smalltalk",
  AMBIGUOUS: "ambiguous",
};

const PERSONAL_SYNC_URL = "/pages/personal-sync/personal-sync";
const PERSONAL_SYNC_XLS_URL = "/pages/personal-sync/personal-sync?tab=xls";

function safeText(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.slice(0, maxLength || 200);
}

function compactText(value) {
  return safeText(value, 600)
    .replace(/[，。！？；：、\s]+/g, "")
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

function isWeatherQuery(message) {
  const value = compactText(message);
  if (!value) return false;
  return /(天气|下雨|降雨|雨|带伞|伞|温度|气温|热不热|冷不冷|风大|风力|湿度|空气|适合跑步|跑步|出行|晒不晒|闷不闷)/.test(value);
}

function resolveWeatherEntities(message, clientContext = {}) {
  const value = compactText(message);
  const preferences = clientContext.userPreferences || {};
  let campus = preferences.campus || "";
  if (/江湾/.test(value)) campus = "江湾校区";
  else if (/河滨/.test(value)) campus = "河滨校区";
  else if (/南海/.test(value)) campus = "南海区";
  else if (/佛山/.test(value) && !/佛山大学|佛大/.test(value)) campus = "佛山";
  else if (/仙溪|佛大|佛山大学/.test(value)) campus = "仙溪校区";
  if (!campus) campus = "仙溪校区";

  const needsPersonalSchedule = /(下一节|下节|接下来).*(课)?.*(带伞|伞|天气|下雨|雨)|带伞.*(下一节|下节|课)/.test(value);
  const dateHint = /明天|明日/.test(value)
    ? "tomorrow"
    : (/后天/.test(value) ? "day_after_tomorrow" : "today");
  const topic = /跑步/.test(value)
    ? "running"
    : (/(带伞|伞|下雨|雨|降雨)/.test(value)
      ? "rain"
      : (/(热|冷|温度|气温)/.test(value) ? "temperature" : "weather"));
  return {
    campus,
    location: campus,
    dateHint,
    topic,
    needsPersonalSchedule,
  };
}

function hasPersonalScheduleContext(clientContext = {}) {
  const summary = clientContext.currentScheduleSummary || {};
  return summary.enabled === true &&
    Array.isArray(summary.courses) &&
    summary.courses.length > 0;
}

function getContextSlots(clientContext = {}) {
  return clientContext.contextSlots ||
    clientContext.conversation && clientContext.conversation.contextSlots ||
    {};
}

function baseRoute(intent, patch = {}) {
  const route = Object.assign({
    intent,
    canonicalIntent: agentCapabilityCompat.toCanonicalIntent(intent),
    confidence: 0.5,
    entities: {},
    missingFields: [],
    shouldUseRag: false,
    shouldUseScheduleTool: false,
    shouldUsePersonalScheduleTool: false,
    shouldUseWeatherTool: false,
    cardType: "",
    replyChannel: "chat",
    reason: "",
  }, patch || {});
  route.canonicalIntent = agentCapabilityCompat.toCanonicalIntent(route.canonicalIntent || route.intent);
  return route;
}

function isScheduleStatusQuery(message) {
  const value = compactText(message);
  if (!value) return false;
  if (/^(数据来源说明|知识来源说明)$/.test(value)) return false;
  return scheduleIntentParser.isScheduleStatusText(value) ||
    /(当前|现在).*(第几|第多少|几).*(教学周|周次)|教学周.*(第几|当前|现在)/.test(value) ||
    /^(课表|全校课表|课程数据|教务数据)?(数据)?(是否)?(最新|准不准|准确吗|可靠吗|状态如何)$/.test(value) ||
    /(课表|全校课表|课程数据|教务数据|数据).*(最新|更新|准不准|准确|可靠|状态|来源|版本|缓存|同步|什么时候)/.test(value) ||
    /(当前|现在).*(学期|版本).*(数据|课表)/.test(value);
}

function isPersonalScheduleQuery(message) {
  const value = compactText(message);
  if (!value) return false;
  return /^(今天|今日|明天|明日|后天|本周|这周|下一节|下节).*(有什么课|还有课|课表|安排|在哪里|上什么|第几节|要上课)|^(今天|明天|本周|下一节课|下节课)$/.test(value) ||
    /(我的|个人).*(课表|课程|安排)/.test(value);
}

function isHelpQuery(message) {
  const value = compactText(message);
  if (!value) return false;
  return scheduleIntentParser.isScheduleHelpText(value) ||
    /^(怎么|如何|怎样).*(导入|同步|上传).*(个人课表|课表|xls)|导入个人课表/.test(value) ||
    /^(xls|excel|表格|文件).*(导入|同步).*(怎么用|如何用|使用|帮助|教程|说明)|^(xls导入|xls文件导入|excel导入|表格导入|文件导入)(怎么用|如何用|使用说明|帮助|教程)?$/.test(value) ||
    /^(可以查询什么|你能做什么|你可以做什么|能做什么|能查什么|我能查什么|小佛可以查询什么|小佛可以做什么|小序可以查询什么|小序可以做什么)$/.test(value) ||
    /^(这个|这款|小程序|app|应用).*(怎么用|如何用|怎么使用|使用方法|使用说明)$/.test(value) ||
    /^(如何问得更准确|怎么问得更准确|问法建议|数据来源说明)$/.test(value) ||
    /^(怎么用|如何使用|如何使用校园查询|校园查询怎么用|使用帮助|帮助|功能|功能说明|功能介绍)$/.test(value) ||
    /(小佛助手浮窗|小佛浮窗|浮窗).*(开启|关闭|打开|隐藏|怎么用|如何用|设置)|^(开启|关闭|打开|隐藏)(小佛助手浮窗|小佛浮窗|小序浮窗|小序助手浮窗)$/.test(value) ||
    /^(怎么|如何|怎样).*(查课表|查全校课表|查班级|查老师|查教师|查教室|查课程)/.test(value);
}

function isExplicitAppNavigation(message) {
  const value = compactText(message);
  if (!value) return null;
  const mappings = [
    { pattern: /^(打开|跳转到|进入|去|切到)(全校课表|查课|课表系统)$/, target: "school_schedule", label: "全校课表", url: "/pages/school/school" },
    { pattern: /^(打开|跳转到|进入|去|切到)(校园地图|地图)$/, target: "campus_map", label: "校园地图", url: "/packageMaps/pages/campus-map/campus-map" },
    { pattern: /^(打开|跳转到|进入|去|切到)(空教室|找空教室)$/, target: "empty_room", label: "空教室", url: "/pages/empty-room/empty-room" },
    { pattern: /^(打开|跳转到|进入|去|切到)?(xls导入|xls文件导入|excel导入|表格导入|文件导入|表格导入入口|文件导入入口)$/, target: "personal_import_xls", label: "XLS 文件导入", url: PERSONAL_SYNC_XLS_URL },
    { pattern: /^(打开|跳转到|进入|去|切到)(个人课表同步|个人课表导入|个人课表导入入口|导入课表|导入入口|同步入口|个人课表)$/, target: "personal_sync", label: "个人课表同步", url: PERSONAL_SYNC_URL },
  ];
  return mappings.find((item) => item.pattern.test(value)) || null;
}

function isIdentityOrPersonaQuery(message) {
  const value = compactText(message);
  if (!value) return false;
  if (/(课表|空教室|教室|老师|教师|天气|导入|同步|班级|课程)/.test(value)) return false;
  return /(你是谁|你是什么|介绍一下自己|介绍下自己|自我介绍|你叫什么|小佛是谁|你是小佛吗|小序是谁|你是小序吗|你是什么助手)/.test(value);
}

function isPlainSmalltalk(message) {
  const value = compactText(message);
  if (!value) return false;
  if (isIdentityOrPersonaQuery(message)) return true;
  return /^(你好|您好|嗨|哈喽|在吗|谢谢|感谢|辛苦了|随便问一句普通话|随便聊聊|普通话|讲个笑话|早上好|中午好|晚上好|hello|hi)([\W_]*|$)/i.test(value);
}

function scheduleEntities(parsed) {
  return {
    targetType: parsed.targetType || "",
    targetName: parsed.targetName || "",
    rawTargetName: parsed.rawTargetName || "",
    week: parsed.week || null,
    weekday: parsed.weekday || null,
    inherited: parsed.inherited === true,
  };
}

function routeMessage(message, clientContext = {}) {
  const query = safeText(message, 600);
  const contextSlots = getContextSlots(clientContext);

  if (isWeatherQuery(query)) {
    const entities = resolveWeatherEntities(query, clientContext);
    return baseRoute(INTENTS.WEATHER, {
      confidence: 0.95,
      entities,
      shouldUseWeatherTool: true,
      shouldUsePersonalScheduleTool: entities.needsPersonalSchedule && hasPersonalScheduleContext(clientContext),
      cardType: "weather_card",
      reason: "matched weather wording before RAG",
    });
  }

  if (isScheduleStatusQuery(query)) {
    return baseRoute(INTENTS.SCHEDULE_STATUS, {
      confidence: 0.96,
      cardType: "schedule_status",
      reason: "matched schedule data/status wording",
    });
  }

  if (isHelpQuery(query)) {
    return baseRoute(INTENTS.HELP, {
      confidence: 0.92,
      cardType: "help",
      reason: "matched help/usage wording",
    });
  }

  const appNavigation = isExplicitAppNavigation(query);
  if (appNavigation) {
    return baseRoute(INTENTS.APP_NAVIGATION, {
      confidence: 0.9,
      entities: {
        target: appNavigation.target,
        label: appNavigation.label,
        url: appNavigation.url,
      },
      cardType: "navigation",
      reason: "matched local app navigation",
    });
  }

  const parsed = scheduleIntentParser.parseScheduleIntent(query, contextSlots, clientContext);
  if (parsed && parsed.isScheduleIntent) {
    const entities = scheduleEntities(parsed);
    const hasTarget = Boolean(entities.targetType && entities.targetName);
    const hasPersonal = hasPersonalScheduleContext(clientContext);
    if (!hasTarget && isPersonalScheduleQuery(query)) {
      return baseRoute(INTENTS.PERSONAL_SCHEDULE, {
        confidence: hasPersonal ? 0.9 : 0.78,
        entities,
        missingFields: hasPersonal ? [] : ["personalScheduleOrScheduleTarget"],
        shouldUsePersonalScheduleTool: hasPersonal,
        shouldUseScheduleTool: false,
        cardType: hasPersonal ? "personal_schedule" : "personal_schedule",
        parsedScheduleIntent: parsed,
        reason: hasPersonal ? "personal schedule wording with local summary" : "personal schedule wording without imported schedule",
      });
    }
    const missingFields = hasTarget || hasPersonal ? [] : ["scheduleTarget"];
    return baseRoute(INTENTS.SCHEDULE_QUERY, {
      confidence: hasTarget ? 0.93 : 0.72,
      entities,
      missingFields,
      shouldUseScheduleTool: hasTarget,
      shouldUsePersonalScheduleTool: !hasTarget && hasPersonal,
      cardType: hasTarget ? "schedule_result" : "clarification",
      parsedScheduleIntent: parsed,
      reason: hasTarget ? "deterministic schedule parser resolved target" : "schedule wording without query target",
    });
  }

  if (isPersonalScheduleQuery(query)) {
    const hasPersonal = hasPersonalScheduleContext(clientContext);
    return baseRoute(INTENTS.PERSONAL_SCHEDULE, {
      confidence: hasPersonal ? 0.88 : 0.76,
      missingFields: hasPersonal ? [] : ["personalScheduleOrScheduleTarget"],
      shouldUsePersonalScheduleTool: hasPersonal,
      shouldUseScheduleTool: false,
      cardType: "personal_schedule",
      reason: hasPersonal ? "personal schedule wording with local summary" : "personal schedule wording without imported schedule",
    });
  }

  if (ragRetriever.isNavigationQuery(query)) {
    return baseRoute(INTENTS.NAVIGATION, {
      confidence: 0.86,
      shouldUseRag: true,
      cardType: "navigation",
      reason: "matched campus entry/navigation wording",
    });
  }

  if (ragRetriever.isCampusKnowledgeQuery(query)) {
    return baseRoute(INTENTS.SCHOOL_KNOWLEDGE, {
      confidence: 0.82,
      shouldUseRag: true,
      cardType: "school_knowledge",
      reason: "matched campus knowledge scope",
    });
  }

  if (isPlainSmalltalk(query)) {
    return baseRoute(INTENTS.SMALLTALK, {
      confidence: 0.7,
      reason: "plain smalltalk",
    });
  }

  return baseRoute(INTENTS.SMALLTALK, {
    confidence: 0.56,
    reason: "no campus/tool intent matched",
  });
}

module.exports = {
  INTENTS,
  hasPersonalScheduleContext,
  isHelpQuery,
  isIdentityOrPersonaQuery,
  isPersonalScheduleQuery,
  isPlainSmalltalk,
  isScheduleStatusQuery,
  isWeatherQuery,
  resolveWeatherEntities,
  routeMessage,
  toCanonicalIntent: agentCapabilityCompat.toCanonicalIntent,
};
