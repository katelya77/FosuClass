const releaseService = require("../releaseService");
const { sanitizeToolResult } = require("./safetyGuard");
const {
  getCourseTimeRange,
  getCourseTimeStatus,
  getCourseWeekStatus,
  getCurrentSection: getCurrentSectionByTime,
  resolveCurrentTeachingWeek,
} = require("../../shared/courseWeekRules");
const recommendationService = require("./recommendationService");
const weatherService = require("./weatherService");
const campusMapService = require("./campusMapService");
const classroomSearch = require("./classroomSearch");
const knowledgeBaseService = require("./knowledgeBaseService");
const imageGenerationGateService = require("./imageGenerationGateService");
const agentProtocol = require("./agentProtocol");

const MAX_SECTION = 14;
const termRegistryService = require("../termRegistryService");

function getDefaultTerm() {
  const active = termRegistryService.getActiveTerm();
  if (active && active.term) return active.term;
  const activeRelease = releaseService.getActiveReleaseInfo && releaseService.getActiveReleaseInfo() || {};
  return activeRelease.term || activeRelease.semester || termRegistryService.LEGACY_CURRENT_TERM_CONFIG.term;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseLocalDateString(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNativeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDate(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
    return parseClientDate(value);
  }
  return parseLocalDateString(value) || parseNativeDate(value) || new Date();
}

function parseClientDate(context = {}, fallback) {
  const source = context && typeof context === "object" && !Array.isArray(context)
    ? context
    : { clientLocalTime: context };
  const localDate = parseLocalDateString(source.clientLocalTime);
  if (localDate) return localDate;
  const legacyDate = parseNativeDate(source.clientTime);
  if (legacyDate) return legacyDate;
  const timestampDate = parseNativeDate(source.clientTimestampMs);
  if (timestampDate) return timestampDate;
  return parseLocalDateString(fallback) || parseNativeDate(fallback) || new Date();
}

function formatDate(date) {
  const target = parseDate(date);
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function getWeekday(date) {
  const day = parseDate(date).getDay();
  return day === 0 ? 7 : day;
}

function getCurrentSection(date) {
  return getCurrentSectionByTime(date);
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function extractBuilding(message) {
  const text = normalizeText(message);
  const match = text.match(/\b([A-Z]\d{1,2})\b/i);
  if (match) return match[1].toUpperCase();
  const known = ["会通楼", "致用楼", "基础楼", "图书馆", "C7", "B8", "B5"];
  return known.find((item) => text.includes(item)) || "";
}

function parseChineseNumber(text, fallback) {
  const value = normalizeText(text);
  const map = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const digit = value.match(/\d+/);
  if (digit) return Number(digit[0]);
  const chinese = value.match(/[一两二三四五六]/);
  return chinese ? map[chinese[0]] : fallback;
}

function inferSections(message, clientTime) {
  const text = normalizeText(message);
  const currentDate = parseClientDate(
    clientTime && typeof clientTime === "object" ? clientTime : { clientLocalTime: clientTime },
    clientTime
  );
  const range = text.match(/(\d{1,2})\s*[-~～至到]\s*(\d{1,2})\s*节?/);
  if (range) return `${range[1]}-${range[2]}`;
  const single = text.match(/第?\s*(\d{1,2})\s*节/);
  if (single) return single[1];
  const minFreeSections = text.includes("连续") ? parseChineseNumber(text, 2) : 1;
  if (/现在|当前|马上/.test(text)) {
    const start = getCurrentSection(currentDate);
    const end = Math.min(MAX_SECTION, start + Math.max(1, minFreeSections) - 1);
    return `${start}-${end}`;
  }
  if (/下午/.test(text)) return "5-8";
  if (/今晚|晚上|夜间/.test(text)) {
    const start = /今晚|现在|当前/.test(text) ? Math.max(9, getCurrentSection(currentDate)) : 9;
    const end = Math.min(14, start + Math.max(1, minFreeSections) - 1);
    return `${start}-${Math.max(start, end)}`;
  }
  if (/上午|早上/.test(text)) return "1-4";
  if (/中午/.test(text)) return "4-5";
  return minFreeSections > 1 ? `1-${Math.min(MAX_SECTION, minFreeSections)}` : "1-2";
}

function inferTargetDate(message, context) {
  const date = parseClientDate(context, new Date());
  if (/明天|翌日/.test(message || "")) {
    date.setDate(date.getDate() + 1);
  }
  return formatDate(date);
}

function inferSearchType(message) {
  const text = normalizeText(message);
  if (/老师|教师|任课/.test(text)) return "teacher";
  if (/教室|课室|自习室/.test(text)) return "classroom";
  if (/课程|科目|查课/.test(text)) return "course";
  if (/班级|行政班|专业/.test(text)) return "class";
  return "teacher";
}

function stripIntentWords(message) {
  return normalizeText(message)
    .replace(/帮我|帮|我|请问|查询|查找|查一下|查|看看|看|找|占用|使用情况|课表|课程表|老师|教师|教室|课室|自习室|课程|安排|班级|行政班|专业|佛山大学|佛大|的/g, " ")
    .replace(/[？?，,。.!！]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasScheduleContext(context = {}) {
  const summary = context.currentScheduleSummary || {};
  return Boolean(summary.enabled && Array.isArray(summary.courses) && summary.courses.length);
}

function getMissingSlot(type) {
  const map = {
    teacher: { missing: "teacherName", type: "teacher", prompt: "你想查哪位老师？" },
    classroom: { missing: "classroomName", type: "classroom", prompt: "你想查哪间教室或哪栋楼？" },
    course: { missing: "courseName", type: "course", prompt: "你想查哪门课程？" },
    class: { missing: "className", type: "class", prompt: "你想查哪个班级或专业？" },
    scheduleContext: { missing: "scheduleContext", type: "schedule", prompt: "需要先提供课表摘要，才能推荐共同空闲时间。" },
  };
  return map[type] || map.teacher;
}

function needsClarification(type, q) {
  const keyword = normalizeText(q).replace(/\s+/g, "");
  if (!keyword) return true;
  if (type === "teacher") return keyword.length < 2;
  if (type === "classroom") return keyword.length < 2;
  if (type === "course") return keyword.length < 2;
  if (type === "class") return keyword.length < 2;
  return false;
}

function getPendingClarification(context = {}) {
  const pending = context.pendingClarification || {};
  if (!pending || typeof pending !== "object" || Array.isArray(pending)) return null;
  if (pending.intentName !== "search_school_index") return null;
  const type = ["teacher", "classroom", "course", "class"].includes(pending.type) ? pending.type : "";
  const missing = normalizeText(pending.missing);
  if (!type || !missing) return null;
  const expiresAt = Number(pending.expiresAt || 0);
  if (expiresAt && expiresAt < Date.now()) return null;
  return {
    intentName: "search_school_index",
    type,
    missing,
    createdAt: Number(pending.createdAt || 0) || 0,
    expiresAt: expiresAt || 0,
  };
}

function isCompleteNewTask(text) {
  const value = normalizeText(text);
  if (!value) return false;
  return /空教室|自习时间|推荐时间|今天|今日|明天|下一节|还有课|导入|XLS|excel|数据|诊断|缓存|校园查询|怎么用|FosuClass|佛课小表|校园服务管家/i.test(value);
}

function extractPendingQuery(message, type) {
  const text = normalizeText(message);
  if (!text) return "";
  const stripped = stripIntentWords(text);
  if (stripped) return stripped;
  const cleanupPatterns = {
    teacher: /老师|教师|任课|课表|查询|查|帮我|请|一下|的/g,
    classroom: /教室|课室|占用|使用情况|查询|查|帮我|请|一下|的/g,
    course: /课程|安排|查课|查询|查|帮我|请|一下|的/g,
    class: /班级|行政班|专业|课表|查询|查|帮我|请|一下|的/g,
  };
  return text.replace(cleanupPatterns[type] || /查询|查|帮我|请|一下|的/g, " ").replace(/\s+/g, " ").trim();
}

function resolvePendingClarificationIntent(message, context = {}) {
  const pending = getPendingClarification(context);
  if (!pending || isCompleteNewTask(message)) return null;
  const q = extractPendingQuery(message, pending.type);
  if (needsClarification(pending.type, q)) return null;
  return {
    name: "search_school_index",
    slots: {
      type: pending.type,
      q,
      filledFromPendingClarification: true,
      missing: pending.missing,
    },
  };
}

function parseChineseDuration(text, fallback) {
  const value = normalizeText(text);
  const digit = value.match(/\d+/);
  if (digit) return Number(digit[0]);
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const match = value.match(/[一二两三四五六]/);
  return match ? map[match[0]] : fallback;
}

function inferSearchTypeChinese(message) {
  const text = normalizeText(message);
  if (/老师|教师|任课/.test(text)) return "teacher";
  if (/教室|课室|自习室|楼栋|占用|使用情况/.test(text)) return "classroom";
  if (/课程|科目|查课|安排/.test(text)) return "course";
  if (/班级|行政班|专业/.test(text)) return "class";
  return "teacher";
}

function stripChineseIntentWords(message) {
  return normalizeText(message)
    .replace(/帮我|请|麻烦|查询|查找|查一下|查一查|查|找|看看|看|一下|佛山大学|佛大|的/g, " ")
    .replace(/老师|教师|任课|教室|课室|自习室|课程|科目|班级|行政班|专业|课表|课程表|安排|占用|使用情况/g, " ")
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveIntentChinese(message, context = {}) {
  const text = normalizeText(message);
  if (!text) return null;
  if (/如何使用校园查询|怎么使用|如何使用|你是谁|你能做什么|FosuClass|佛课小表|校园服务管家|项目知识|比赛|Release Pack|XLS-only/i.test(text)) {
    return { name: "project_qa", slots: {} };
  }
  if (/导入|XLS|excel|个人课表|账号|登录|密码/i.test(text)) {
    return { name: "explain_personal_import", slots: { mode: /XLS|excel/i.test(text) ? "xls" : "unknown" } };
  }
  if (/加载失败|数据失败|为什么.*数据|诊断|缓存|release|同步失败|打不开/.test(text)) {
    return { name: "diagnose_data_status", slots: {} };
  }
  if (/自习时间|推荐.*时间|共同空闲|组会|会议|一起自习/.test(text)) {
    if (!hasScheduleContext(context)) {
      return { name: "clarify_missing_slot", slots: { slot: getMissingSlot("scheduleContext") } };
    }
    return {
      name: "recommend_meeting_time",
      slots: {
        durationSections: /连续/.test(text) ? parseChineseDuration(text, 2) : 2,
        building: extractBuilding(text),
      },
    };
  }
  if (/空教室|空课室|找教室|可用教室|附近/.test(text)) {
    return {
      name: "search_empty_rooms",
      slots: {
        building: extractBuilding(text),
        minFreeSections: /连续/.test(text) ? parseChineseDuration(text, 2) : 1,
      },
    };
  }
  if (/今天|今日|明天|下一节|还有课|上什么课/.test(text)) {
    return { name: "get_today_courses", slots: {} };
  }
  if (/老师|教师|任课|教室|课室|课程|科目|查课|班级|行政班|专业|课表|课程表|占用|安排/.test(text)) {
    const type = inferSearchTypeChinese(text);
    const q = stripChineseIntentWords(text);
    if (needsClarification(type, q)) {
      return { name: "clarify_missing_slot", slots: { slot: getMissingSlot(type), type, q } };
    }
    return { name: "search_school_index", slots: { type, q } };
  }
  return null;
}

function isProjectQaMessage(text) {
  const value = normalizeText(text);
  if (!value) return false;
  return /你是谁|介绍一下自己|自我介绍|你叫什么|小佛是谁|你是什么助手|你能做什么|你可以做什么|如何使用校园查询|怎么使用|怎么同步新学期课表|新学期.*同步|为什么要\s*XLS\s*导入|FosuClass|佛课小表|小佛.*项目|了解当前项目|解释.*功能|比赛.*展示|校园服务管家架构|项目知识|Release Pack|XLS-only/i.test(value);
}

function isConversationalHelp(text) {
  const value = normalizeText(text).replace(/\s+/g, "");
  if (!value) return false;
  if (/今天|今日|明天|还有课|下一节|空教室|老师|教师|教室|课室|课程|班级|查课|课表|诊断|缓存|加载失败|数据失败/.test(value)) {
    return false;
  }
  return /你好|您好|嗨|哈喽|在吗|hello|hi|谢谢|感谢|辛苦了|帮我解释|怎么做|如何做|为什么|介绍一下|早上好|中午好|晚上好|随便聊|普通话/.test(value);
}

function inferCampusFromText(text) {
  const value = normalizeText(text);
  if (/河滨/.test(value)) return "河滨校区";
  if (/江湾/.test(value)) return "江湾校区";
  if (/仙溪/.test(value)) return "仙溪校区";
  return "仙溪校区";
}

function resolveModernChineseIntent(message, context = {}) {
  const text = normalizeText(message);
  if (!text) return null;
  const campus = inferCampusFromText(text);
  const hasWeather = /\u5929\u6c14|\u4e0b\u96e8|\u964d\u96e8|\u9ad8\u6e29|\u96f7\u66b4|\u5e26\u4f1e|\u51fa\u884c/.test(text);
  const hasEmptyRoom = /\u7a7a\u6559\u5ba4|\u81ea\u4e60|\u6ca1\u8bfe/.test(text);
  const hasTravel = /\u8def\u7ebf|\u4f4d\u7f6e|\u5bfc\u822a|\u5728\u54ea|\u600e\u4e48\u8d70/.test(text);
  const hasNextCourseLocation = /\u4e0b\u4e00\u8282|\u4e0b\u8282|\u63a5\u4e0b\u6765.*\u8bfe/.test(text) &&
    /\u5728\u54ea|\u54ea\u91cc|\u4f4d\u7f6e|\u6559\u5b66\u697c|\u5730\u56fe|\u600e\u4e48\u8d70/.test(text);
  const hasCampusMapQuery = /\u5730\u56fe|\u5730\u70b9|\u4f4d\u7f6e|\u5728\u54ea|\u54ea\u91cc|\u56fe\u4e66\u9986|\u996d\u5802|\u98df\u5802|\u5bbf\u820d|\u4f53\u80b2\u9986|\u6821\u95e8|\u533b\u9662|\u533b\u52a1|\u6559\u5b66\u697c|\u4e3b\u8981\u5730\u70b9|\b[A-Z]\d{1,2}\b/i.test(text);
  const hasCampusScope = /\u6c5f\u6e7e|\u4ed9\u6eaa|\u6cb3\u6ee8|\u6821\u533a|\u6821\u56ed|\b[A-Z]\d{1,2}\b/i.test(text);
  if (hasNextCourseLocation) {
    return { name: "next_course_location", slots: {} };
  }
  if (/\u751f\u56fe|\u56fe\u7247|\u6d77\u62a5|\u5206\u4eab\u56fe|\u914d\u56fe|\u5c55\u793a\u7d20\u6750|\u751f\u6210.*\u56fe/.test(text)) {
    return { name: "generate_image", slots: { scene: "competition_demo_asset" } };
  }
  if (hasWeather && (hasEmptyRoom || hasTravel || /\u660e\u5929|\u4e0b\u5348|\u540e\u5929|\u4e0b\u5468/.test(text))) {
    return {
      name: "campus_multi_step_advice",
      slots: {
        campus,
        date: inferTargetDate(text, context),
        sections: inferSections(text, context),
        building: extractBuilding(text),
      },
    };
  }
  if (hasWeather) {
    return { name: "get_campus_weather", slots: { campus } };
  }
  if (hasCampusMapQuery && hasCampusScope) {
    const classroom = (text.match(/[A-Z]\d{1,2}(?:[-\u680b\u697c]?\d{0,4})?/i) || [""])[0];
    if (classroom) return { name: "get_classroom_location", slots: { classroom } };
    return { name: "search_campus_place", slots: { q: text } };
  }
  if (hasTravel && /[A-Z]\d|\u6821\u533a|\u56fe\u4e66\u9986|\u996d\u5802|\u5bbf\u820d|\u6559\u5b66\u697c|\u6559\u5ba4/i.test(text)) {
    const classroom = (text.match(/[A-Z]\d{1,2}(?:[-\u680b\u697c]?\d{0,4})?/i) || [""])[0];
    if (classroom) return { name: "get_classroom_location", slots: { classroom } };
    return { name: "search_campus_place", slots: { q: stripChineseIntentWords(text) || text } };
  }
  if (/\u9690\u79c1|\u4f7f\u7528\u8bf4\u660e|\u6545\u969c|\u5c0f\u4f5b|\u4f5b\u8bfe\u5c0f\u8868|\u6821\u56ed\u670d\u52a1|\u5e2e\u52a9|\u8bf4\u660e/.test(text)) {
    return { name: "rag_search", slots: { q: text } };
  }
  if (/\u5b66\u6821|\u6821\u533a|\u6821\u56ed|\u901a\u77e5|\u670d\u52a1|\u6307\u5357|\u89c4\u5219|\u6821\u5386/.test(text)) {
    return { name: "rag_search", slots: { q: text } };
  }
  if (/生图|图片|海报|分享图|配图|展示素材|生成.*图/.test(text)) {
    return { name: "generate_image", slots: { scene: "competition_demo_asset" } };
  }
  if (/天气|下雨|降雨|高温|雷暴|带伞|出行/.test(text) && /空教室|自习|没课|明天|下午|路线|位置/.test(text)) {
    return {
      name: "campus_multi_step_advice",
      slots: {
        campus: inferCampusFromText(text),
        date: inferTargetDate(text, context),
        sections: inferSections(text, context),
        building: extractBuilding(text),
      },
    };
  }
  if (/天气|下雨|降雨|高温|雷暴|带伞|出行/.test(text)) {
    return {
      name: "get_campus_weather",
      slots: { campus: inferCampusFromText(text) },
    };
  }
  if (/在哪里|怎么走|路线|位置|导航/.test(text) && /C\d|B\d|A\d|校区|图书馆|饭堂|宿舍|教学楼|教室/i.test(text)) {
    const classroom = (text.match(/[ABC]\d{1,2}(?:[-栋楼]?\d{0,4})?/i) || [""])[0];
    if (classroom) return { name: "get_classroom_location", slots: { classroom } };
    return { name: "search_campus_place", slots: { q: stripChineseIntentWords(text) || text } };
  }
  if (/隐私|使用说明|故障|小佛|佛课小表|校园服务|帮助|说明/.test(text)) {
    return { name: "rag_search", slots: { q: text } };
  }
  if (/连续.*空教室|连着.*空教室|连堂.*空教室/.test(text)) {
    return {
      name: "search_continuous_empty_rooms",
      slots: {
        building: extractBuilding(text),
        minFreeSections: parseChineseDuration(text, 2),
      },
    };
  }
  if (/明天|明日/.test(text) && /课|课程|安排|课表/.test(text)) {
    return { name: "get_tomorrow_courses", slots: {} };
  }
  if (/下一节|下节课|马上.*课|接下来.*课/.test(text)) {
    return { name: "get_next_course", slots: {} };
  }
  if (/本周|这一周|整周|周课表/.test(text) && /课|课程|安排|课表/.test(text)) {
    return { name: "get_week_schedule", slots: {} };
  }
  if (/教学周|第几周|当前周|现在.*周/.test(text)) {
    return { name: "get_teaching_week", slots: {} };
  }
  if (/校历|学期日历|开学|放假|学期.*周/.test(text)) {
    return { name: "get_term_calendar", slots: {} };
  }
  if (/数据.*最新|数据状态|加载失败|暂时加载失败/.test(text)) {
    return { name: "diagnose_data_status", slots: {} };
  }
  if (/个人课表.*导入|怎么导入.*课表|XLS|Excel/i.test(text)) {
    return { name: "explain_personal_import", slots: { mode: /XLS|Excel/i.test(text) ? "xls" : "unknown" } };
  }
  return null;
}

function resolveIntent(message, context = {}) {
  const text = normalizeText(message);
  if (isProjectQaMessage(text)) {
    return { name: "project_qa", slots: {} };
  }
  const modernIntent = resolveModernChineseIntent(text, context);
  if (modernIntent) return modernIntent;
  const pendingIntent = resolvePendingClarificationIntent(text, context);
  if (pendingIntent) return pendingIntent;
  const chineseIntent = resolveIntentChinese(text, context);
  if (chineseIntent) return chineseIntent;
  if (/导入|XLS|excel|个人课表|账号|登录|密码/.test(text)) {
    return { name: "explain_personal_import", slots: { mode: /XLS|excel/i.test(text) ? "xls" : "unknown" } };
  }
  if (/加载失败|数据失败|为什么.*数据|诊断|缓存|release|同步失败|打不开/.test(text)) {
    return { name: "diagnose_data_status", slots: {} };
  }
  if (/组会|会议|共同空闲|一起自习|自习时间|推荐时间/.test(text)) {
    if (!hasScheduleContext(context)) {
      return { name: "clarify_missing_slot", slots: { slot: getMissingSlot("scheduleContext") } };
    }
    return {
      name: "recommend_meeting_time",
      slots: {
        durationSections: /连续/.test(text) ? parseChineseNumber(text, 2) : 2,
        building: extractBuilding(text),
      },
    };
  }
  if (/空教室|自习|空课室|找教室|可用教室|附近/.test(text)) {
    return {
      name: "search_empty_rooms",
      slots: {
        building: extractBuilding(text),
        minFreeSections: /连续/.test(text) ? parseChineseNumber(text, 2) : 1,
      },
    };
  }
  if (/今天|今日|明天|还有课|下一节|上什么课/.test(text) ||
    (/安排/.test(text) && !/老师|教师|教室|课室|课程|班级|行政班|专业/.test(text))) {
    return { name: "get_today_courses", slots: {} };
  }
  if (/老师|教师|教室|课程|班级|查课|课表/.test(text)) {
    const type = inferSearchType(text);
    const q = stripIntentWords(text);
    if (needsClarification(type, q)) {
      return { name: "clarify_missing_slot", slots: { slot: getMissingSlot(type), type, q } };
    }
    return { name: "search_school_index", slots: { type, q } };
  }
  if (isConversationalHelp(text)) {
    return { name: "conversational_help", slots: {} };
  }
  return { name: "conversational_help", slots: {} };
}

function courseAppliesToWeek(course, week) {
  return getCourseWeekStatus(course || {}, week).active === true;
}

function sectionText(course) {
  const start = Number(course.startSection || 0);
  const end = Number(course.endSection || start || 0);
  return start && end ? `第${start}-${end}节` : "节次待定";
}

function buildActionUrl(pathname, query = {}) {
  const params = Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`)
    .join("&");
  return `${pathname}${params ? `?${params}` : ""}`;
}

function getTodayCourses(input = {}, context = {}) {
  const summary = context.currentScheduleSummary || {};
  if (!summary.enabled || !Array.isArray(summary.courses) || !summary.courses.length) {
    const resolvedWeek = resolveCurrentTeachingWeek(context, input);
    return {
      success: true,
      needContext: true,
      currentWeek: resolvedWeek.currentWeek,
      weekUncertain: resolvedWeek.weekUncertain,
      inactiveFilteredCount: 0,
      uncertainWeekCoursesCount: 0,
      activeCourseCount: 0,
      courseCount: 0,
      courses: [],
      activeCourses: [],
      nextCourse: null,
      allFinished: false,
      currentSection: getCurrentSection(context.clientLocalTime || context.clientTime || new Date()),
      summary: "未收到当前课表摘要，需要先打开个人课表同步并导入个人课表。",
      actionUrl: "/pages/personal-sync/personal-sync",
    };
  }
  const date = input.date || inferTargetDate(input.message || "", context);
  const weekday = toNumber(input.weekday, getWeekday(date));
  const resolvedWeek = resolveCurrentTeachingWeek(context, Object.assign({}, input, { date }));
  const week = resolvedWeek.currentWeek;
  const now = parseClientDate(context, date);
  const currentSection = getCurrentSection(context.clientLocalTime || context.clientTime || date);
  let inactiveFilteredCount = 0;
  let uncertainWeekCoursesCount = 0;
  const activeCourses = summary.courses
    .filter((course) => Number(course.weekday) === weekday)
    .filter((course) => {
      const weekStatus = getCourseWeekStatus(course, week);
      if (weekStatus.uncertain || !weekStatus.hasWeekInfo) {
        uncertainWeekCoursesCount += 1;
        return false;
      }
      if (!weekStatus.active) {
        inactiveFilteredCount += 1;
        return false;
      }
      return true;
    })
    .sort((left, right) => Number(left.startSection || 0) - Number(right.startSection || 0))
    .map((course) => ({
      courseName: course.courseName || "未命名课程",
      teacherName: course.teacherName || "",
      classroom: course.classroom || course.roomName || "",
      weekday: course.weekday,
      startSection: course.startSection,
      endSection: course.endSection,
      sectionText: sectionText(course),
      timeText: getCourseTimeRange(course),
      status: getCourseTimeStatus(course, now),
      weekText: course.weekText || course.rawWeek || "",
      weeks: Array.isArray(course.weeks) ? course.weeks.slice(0, 40) : [],
      campus: course.campus || "",
    }));
  const nextCourse = activeCourses.find((course) => course.status === "ongoing" || course.status === "upcoming") || null;
  const allFinished = activeCourses.length > 0 && activeCourses.every((course) => course.status === "finished");
  return {
    success: true,
    needContext: false,
    date,
    weekday,
    currentWeek: week,
    week,
    weekUncertain: resolvedWeek.weekUncertain,
    inactiveFilteredCount,
    uncertainWeekCoursesCount,
    activeCourseCount: activeCourses.length,
    courseCount: activeCourses.length,
    courses: activeCourses,
    activeCourses,
    nextCourse,
    allFinished,
    currentSection,
    reminder: activeCourses.length
      ? (allFinished
        ? "今天课程已结束。"
        : `今天有 ${activeCourses.length} 门课，下一项是 ${nextCourse ? nextCourse.courseName : "课程安排"}。`)
      : "今天没有匹配到课程安排。",
    actionUrl: "/pages/today/today",
  };
}

function getTomorrowCourses(input = {}, context = {}) {
  const target = parseClientDate(context, new Date());
  target.setDate(target.getDate() + 1);
  const result = getTodayCourses(Object.assign({}, input, {
    date: formatDate(target),
    message: input.message || "明天课程",
  }), context);
  return Object.assign({}, result, {
    date: formatDate(target),
    label: "明天课程",
    reminder: result.needContext
      ? result.summary
      : (result.courseCount ? `明天有 ${result.courseCount} 门课。` : "明天没有匹配到课程安排。"),
  });
}

function getNextCourse(input = {}, context = {}) {
  const result = getTodayCourses(input, context);
  return Object.assign({}, result, {
    nextCourse: result.nextCourse || null,
    courses: result.nextCourse ? [result.nextCourse] : [],
    courseCount: result.nextCourse ? 1 : 0,
    activeCourseCount: result.nextCourse ? 1 : 0,
    summary: result.needContext
      ? result.summary
      : (result.nextCourse ? `下一节课是 ${result.nextCourse.courseName}。` : "今天没有后续课程。"),
  });
}

function getWeekSchedule(input = {}, context = {}) {
  const summary = context.currentScheduleSummary || {};
  const resolvedWeek = resolveCurrentTeachingWeek(context, input);
  const week = Number(input.week || resolvedWeek.currentWeek || 0) || 0;
  if (!summary.enabled || !Array.isArray(summary.courses) || !summary.courses.length) {
    return {
      success: true,
      needContext: true,
      currentWeek: week,
      weekUncertain: resolvedWeek.weekUncertain,
      days: [],
      courseCount: 0,
      summary: "未收到当前课表摘要，需要先打开个人课表同步并导入个人课表。",
      actionUrl: "/pages/personal-sync/personal-sync",
    };
  }
  const days = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const courses = summary.courses
      .filter((course) => Number(course.weekday) === weekday)
      .filter((course) => courseAppliesToWeek(course, week))
      .sort((left, right) => Number(left.startSection || 0) - Number(right.startSection || 0))
      .map((course) => ({
        courseName: course.courseName || "未命名课程",
        teacherName: course.teacherName || "",
        classroom: course.classroom || course.roomName || "",
        weekday,
        startSection: course.startSection,
        endSection: course.endSection,
        sectionText: sectionText(course),
        timeText: getCourseTimeRange(course),
        weekText: course.weekText || course.rawWeek || "",
      }));
    if (courses.length) days.push({ weekday, courses });
  }
  const courseCount = days.reduce((sum, day) => sum + day.courses.length, 0);
  return {
    success: true,
    needContext: false,
    currentWeek: week,
    week,
    weekUncertain: resolvedWeek.weekUncertain,
    days,
    courseCount,
    summary: courseCount ? `本周共有 ${courseCount} 节课程安排。` : "本周没有匹配到课程安排。",
    actionUrl: "/pages/today/today",
  };
}

function getTeachingWeek(input = {}, context = {}) {
  const resolved = resolveCurrentTeachingWeek(context, input);
  const active = termRegistryService.getActiveTerm && termRegistryService.getActiveTerm() || {};
  return {
    success: true,
    term: context.term || input.term || active.term || getDefaultTerm(),
    currentWeek: resolved.currentWeek,
    week: resolved.currentWeek,
    weekUncertain: resolved.weekUncertain,
    todayDate: formatDate(parseClientDate(context, input.date || new Date())),
    termStartDate: active.termStartDate || active.startDate || "",
    totalWeeks: active.totalWeeks || termRegistryService.LEGACY_CURRENT_TERM_CONFIG.totalWeeks,
    summary: resolved.weekUncertain ? "当前教学周暂不确定。" : `当前是第 ${resolved.currentWeek} 教学周。`,
  };
}

function getTermCalendar(input = {}, context = {}) {
  const active = termRegistryService.getActiveTerm && termRegistryService.getActiveTerm() || {};
  const term = input.term || context.term || active.term || getDefaultTerm();
  return {
    success: true,
    term,
    currentWeek: resolveCurrentTeachingWeek(context, input).currentWeek,
    termStartDate: active.termStartDate || active.startDate || "",
    totalWeeks: active.totalWeeks || termRegistryService.LEGACY_CURRENT_TERM_CONFIG.totalWeeks,
    summary: "已读取当前学期和教学周配置。",
  };
}

function searchContinuousEmptyRooms(input = {}, context = {}) {
  const message = input.message || "";
  const minFreeSections = Math.max(2, Number(input.minFreeSections || parseChineseDuration(message, 2)) || 2);
  const result = searchEmptyRooms(Object.assign({}, input, {
    minFreeSections,
    message: message || "连续空教室",
  }), context);
  return Object.assign({}, result, {
    minFreeSections,
    summary: result.success
      ? `连续 ${minFreeSections} 节可用教室共 ${result.total || (result.rooms || []).length || 0} 间。`
      : result.summary,
  });
}

function searchEmptyRooms(input = {}, context = {}) {
  const message = input.message || "";
  const date = input.date || inferTargetDate(message, context);
  const sections = input.sections || inferSections(message, context);
  const building = input.building || extractBuilding(message);
  const minFreeSections = Math.max(1, Number(input.minFreeSections || (/连续/.test(message) ? parseChineseNumber(message, 2) : 1)) || 1);
  const query = {
    term: input.term || context.term || getDefaultTerm(),
    releaseVersion: input.releaseVersion || context.releaseVersion || "",
    date,
    week: input.week || "",
    weekday: input.weekday || getWeekday(date),
    sections,
    building,
    minFreeSections,
    commonOnly: input.commonOnly === undefined ? "true" : input.commonOnly,
    excludeUnknown: input.excludeUnknown === undefined ? "true" : input.excludeUnknown,
  };
  const result = releaseService.queryEmptyClassrooms(query);
  const rooms = asArray(result.rooms).slice(0, 8);
  return Object.assign({}, result, {
    rooms,
    summary: result.success
      ? `${query.building || "全部楼栋"} ${query.sections} 共找到 ${result.total || rooms.length} 间可用教室`
      : "当前没有可用的空教室索引，请先检查 Release Pack。",
    updatedAt: result.updatedAt || "",
    actionUrl: buildActionUrl("/pages/empty-room/empty-room", query),
  });
}

function searchSchoolIndex(input = {}, context = {}) {
  const type = ["class", "teacher", "classroom", "course"].includes(input.type) ? input.type : "teacher";
  const query = normalizeText(input.q || input.message || "");
  const classroomQuery = type === "classroom" ? classroomSearch.parseClassroomQuery(query) : null;
  const result = releaseService.searchActiveIndex(type, query, {
    term: input.term || context.term || getDefaultTerm(),
    semester: input.term || context.term || getDefaultTerm(),
    releaseVersion: input.releaseVersion || context.releaseVersion || "",
    limit: type === "classroom" && classroomQuery && classroomQuery.queryType !== "text" ? 500 : (input.limit || 8),
  });
  const rawItems = asArray(result.items);
  const filteredItems = type === "classroom"
    ? classroomSearch.filterAndSortClassrooms(rawItems, classroomQuery)
    : rawItems;
  return {
    success: Boolean(result.success),
    type,
    q: query,
    term: result.term || result.semester || input.term || context.term || getDefaultTerm(),
    queryType: classroomQuery && classroomQuery.queryType || "",
    buildingCode: classroomQuery && classroomQuery.buildingCode || "",
    roomNumber: classroomQuery && classroomQuery.roomNumber || "",
    normalizedQuery: classroomQuery && classroomQuery.normalizedQuery || query,
    items: filteredItems.slice(0, Number(input.limit || 8) || 8),
    total: filteredItems.length,
    updatedAt: result.updatedAt || "",
    releaseVersion: result.releaseVersion || result.version || context.releaseVersion || "",
    actionUrl: buildActionUrl("/pages/school/school", { type, q: query }),
    code: result.code || result.reasonCode || "",
  };
}

function getScheduleDetail(input = {}, context = {}) {
  const type = ["class", "teacher", "classroom", "course"].includes(input.type) ? input.type : "";
  const id = normalizeText(input.id || "");
  if (!type || !id) {
    return { success: false, code: "DETAIL_TARGET_MISSING", courses: [], schedule: null };
  }
  const result = releaseService.readActiveSchedule(type, id, input.releaseVersion || context.releaseVersion || "");
  const courses = asArray(result.schedule && result.schedule.courses).map((course) => Object.assign({}, course, {
    sectionText: sectionText(course),
    timeText: getCourseTimeRange(course),
  }));
  return {
    success: Boolean(result.success),
    type,
    id,
    schedule: result.schedule || null,
    courses,
    updatedAt: result.updatedAt || "",
    releaseVersion: result.releaseVersion || result.version || context.releaseVersion || "",
    actionUrl: buildActionUrl("/pages/schedule-view/schedule-view", { type, id, releaseVersion: result.releaseVersion || context.releaseVersion || "" }),
    code: result.code || result.reasonCode || "",
  };
}

function diagnoseDataStatus(input = {}, context = {}) {
  const active = releaseService.getActiveReleaseInfo() || {};
  const releaseVersion = input.releaseVersion || context.releaseVersion || active.releaseVersion || active.version || "";
  const indexCounts = {};
  const cacheStatus = {};
  ["class", "teacher", "classroom", "course"].forEach((kind) => {
    const result = releaseService.readActiveIndex(kind, releaseVersion);
    indexCounts[kind] = Array.isArray(result.items) ? result.items.length : 0;
    cacheStatus[kind] = result.success ? (result.dataSource || "index") : (result.code || result.reasonCode || "INDEX_NOT_FOUND");
  });
  const releasePack = releaseVersion ? releaseService.getReleasePackQuickHealth(releaseVersion) : null;
  const emptyRoom = releaseService.readEmptyRoomIndex(releaseVersion);
  return {
    success: true,
    activeReleaseVersion: releaseVersion,
    term: active.term || active.semester || context.term || getDefaultTerm(),
    indexCounts,
    releasePackHealthy: Boolean(releasePack && releasePack.healthy),
    releasePack,
    cacheStatus: Object.assign({}, cacheStatus, {
      emptyRoom: emptyRoom.success ? (emptyRoom.dataSource || "empty-room-index") : (emptyRoom.code || emptyRoom.reasonCode || "EMPTY_ROOM_INDEX_NOT_FOUND"),
    }),
    suggestions: [
      releaseVersion ? "确认小程序端已切换到当前 Release Version。" : "当前没有 active release，请先在后台发布一版 Release Pack。",
      emptyRoom.success ? "空教室索引可用，可直接进入空教室页验证。" : "空教室索引缺失时，请重新构建 Release Pack。",
      "若网络慢，优先展示本地缓存，并在后台静默校验更新。",
    ],
  };
}

function getCampusWeather(input = {}) {
  return weatherService.getCampusWeather(input);
}

function getCourseWeatherAdvice(input = {}) {
  return weatherService.getCourseWeatherAdvice(input);
}

function searchCampusPlace(input = {}) {
  return campusMapService.searchCampusPlace(input);
}

function getCampusRoute(input = {}) {
  return campusMapService.getCampusRoute(input);
}

function getClassroomLocation(input = {}) {
  return campusMapService.getClassroomLocation(input);
}

function ragSearch(input = {}, context = {}) {
  return knowledgeBaseService.searchKnowledge(Object.assign({}, input, {
    environment: context.assistantEnvironment || context.runtimeMode || input.environment,
  }));
}

function generateImage(input = {}, context = {}) {
  return imageGenerationGateService.buildDisabledResult(context.runtimeMode || "public");
}

function explainPersonalImport(input = {}) {
  const mode = input.mode || "unknown";
  return {
    success: true,
    mode,
    title: "个人课表导入说明",
    steps: [
      "先打开个人课表同步主入口，再按页面提示选择合适的导入方式；系统和查询框都不接收学号、密码、Cookie 或 token。",
      "只有明确需要 XLS、表格或文件导入时，才进入 XLS 文件导入页签。",
      "从 100 网打印/导出的 XLS 课表会自动解析表头中的学期、班级、学院、打印日期和课程列。",
      "导入后写入本机当前课表缓存，系统仅在你开启摘要时读取课程名、教师、教室、星期、节次和教学周。",
      "新学期或新版课表重新导入即可刷新本地课程索引，今日安排、空闲时间推荐和后端工具链会自动使用最新课表摘要。",
    ],
    actionUrl: "/pages/personal-sync/personal-sync",
    xlsActionUrl: "/pages/personal-sync/personal-sync?tab=xls",
  };
}

function clarifyMissingSlot(input = {}) {
  const slot = input.slot || getMissingSlot(input.type || "teacher");
  return {
    success: true,
    needClarification: true,
    slot,
    actionUrl: buildActionUrl("/pages/school/school", slot.type && slot.type !== "schedule" ? { type: slot.type } : {}),
  };
}

function buildBusyMatrix(courses, week) {
  const busy = {};
  for (let weekday = 1; weekday <= 7; weekday += 1) busy[weekday] = new Set();
  asArray(courses).forEach((course) => {
    if (!courseAppliesToWeek(course, week)) return;
    const weekday = Number(course.weekday || 0);
    if (!busy[weekday]) return;
    const start = Number(course.startSection || 0);
    const end = Number(course.endSection || start);
    for (let section = start; section <= end; section += 1) {
      if (section >= 1 && section <= MAX_SECTION) busy[weekday].add(section);
    }
  });
  return busy;
}

function recommendMeetingTime(input = {}, context = {}) {
  const summary = context.currentScheduleSummary || {};
  const courses = asArray(input.participantsSchedules).flatMap((item) => asArray(item && item.courses))
    .concat(asArray(summary.courses));
  if (!courses.length) {
    return {
      success: true,
      needContext: true,
      candidates: [],
      summary: "需要参与者主动提供本地课表摘要后，才能计算共同空闲时间。",
      actionUrl: "/pages/personal-sync/personal-sync",
    };
  }
  const duration = Math.max(1, Math.min(4, Number(input.durationSections || 2) || 2));
  const week = Number(input.week || 0) || 0;
  const busy = buildBusyMatrix(courses, week);
  const candidates = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    let runStart = 0;
    let run = 0;
    for (let section = 1; section <= MAX_SECTION; section += 1) {
      if (!busy[weekday].has(section)) {
        if (!runStart) runStart = section;
        run += 1;
        if (run >= duration) {
          candidates.push({
            weekday,
            startSection: runStart,
            endSection: runStart + duration - 1,
            reason: `第${runStart}-${runStart + duration - 1}节共同空闲`,
          });
          break;
        }
      } else {
        runStart = 0;
        run = 0;
      }
    }
  }
  const first = candidates[0] || null;
  const emptyRoom = first ? searchEmptyRooms({
    message: input.message || "",
    weekday: first.weekday,
    sections: `${first.startSection}-${first.endSection}`,
    minFreeSections: duration,
    building: input.building || "",
  }, context) : null;
  return {
    success: true,
    needContext: false,
    durationSections: duration,
    candidates: candidates.slice(0, 5),
    firstCandidate: first,
    emptyRoomResult: emptyRoom,
    emptyRoomActionUrl: emptyRoom && emptyRoom.actionUrl || "/pages/empty-room/empty-room",
    summary: candidates.length ? `找到 ${candidates.length} 个候选共同空闲时段。` : "本周没有找到满足条件的共同空闲时段。",
  };
}

function recommendMeetingTimeV2(input = {}, context = {}) {
  return recommendationService.buildRecommendations(input, context, {
    queryEmptyRooms: searchEmptyRooms,
  });
}

function executeTool(name, input = {}, context = {}) {
  const tools = {
    get_today_courses: getTodayCourses,
    get_tomorrow_courses: getTomorrowCourses,
    get_next_course: getNextCourse,
    get_week_schedule: getWeekSchedule,
    get_teaching_week: getTeachingWeek,
    get_term_calendar: getTermCalendar,
    search_empty_rooms: searchEmptyRooms,
    search_continuous_empty_rooms: searchContinuousEmptyRooms,
    search_school_index: searchSchoolIndex,
    get_schedule_detail: getScheduleDetail,
    diagnose_data_status: diagnoseDataStatus,
    explain_personal_import: explainPersonalImport,
    recommend_meeting_time: recommendMeetingTimeV2,
    clarify_missing_slot: clarifyMissingSlot,
    get_campus_weather: getCampusWeather,
    get_course_weather_advice: getCourseWeatherAdvice,
    search_campus_place: searchCampusPlace,
    get_campus_route: getCampusRoute,
    get_classroom_location: getClassroomLocation,
    rag_search: ragSearch,
    generate_image: generateImage,
  };
  const tool = tools[name];
  if (!tool) {
    return { success: false, code: "TOOL_NOT_FOUND" };
  }
  try {
    const result = tool(Object.assign({}, input, { message: input.message || "" }), context);
    if (result && typeof result.then === "function") {
      return { success: false, code: "ASYNC_TOOL_REQUIRES_AGENT" };
    }
    return sanitizeToolResult(result);
  } catch (error) {
    return {
      success: false,
      code: error.code || "TOOL_FAILED",
      message: error.message || "工具调用失败",
    };
  }
}

async function executeToolAsync(name, input = {}, context = {}) {
  const tools = {
    get_today_courses: getTodayCourses,
    get_tomorrow_courses: getTomorrowCourses,
    get_next_course: getNextCourse,
    get_week_schedule: getWeekSchedule,
    get_teaching_week: getTeachingWeek,
    get_term_calendar: getTermCalendar,
    search_empty_rooms: searchEmptyRooms,
    search_continuous_empty_rooms: searchContinuousEmptyRooms,
    search_school_index: searchSchoolIndex,
    get_schedule_detail: getScheduleDetail,
    diagnose_data_status: diagnoseDataStatus,
    explain_personal_import: explainPersonalImport,
    recommend_meeting_time: recommendMeetingTimeV2,
    clarify_missing_slot: clarifyMissingSlot,
    get_campus_weather: getCampusWeather,
    get_course_weather_advice: getCourseWeatherAdvice,
    search_campus_place: searchCampusPlace,
    get_campus_route: getCampusRoute,
    get_classroom_location: getClassroomLocation,
    rag_search: ragSearch,
    generate_image: generateImage,
  };
  const tool = tools[name];
  if (!tool) return { success: false, code: "TOOL_NOT_FOUND" };
  try {
    return sanitizeToolResult(await tool(Object.assign({}, input, { message: input.message || "" }), context));
  } catch (error) {
    return {
      success: false,
      code: error.code || "TOOL_FAILED",
      message: error.message || "工具调用失败",
    };
  }
}

function getToolSummary(name, result) {
  if (!result || result.success === false) return result && (result.code || result.message) || "工具调用失败";
  if (name === "search_empty_rooms") return result.summary || `找到 ${result.total || 0} 间空教室`;
  if (name === "search_continuous_empty_rooms") return result.summary || `连续空教室 ${result.total || 0} 间`;
  if (name === "get_today_courses") return result.needContext ? "需要当前课表上下文" : `今日课程 ${result.courseCount || 0} 门`;
  if (name === "get_tomorrow_courses") return result.needContext ? "需要当前课表上下文" : `明日课程 ${result.courseCount || 0} 门`;
  if (name === "get_next_course") return result.nextCourse ? "已找到下一节课" : "没有后续课程";
  if (name === "get_week_schedule") return result.needContext ? "需要当前课表上下文" : `本周课程 ${result.courseCount || 0} 节`;
  if (name === "get_teaching_week") return result.summary || "已查询教学周";
  if (name === "get_term_calendar") return result.summary || "已查询校历";
  if (name === "search_school_index") return `${result.type || "index"} 命中 ${result.total || 0} 项`;
  if (name === "diagnose_data_status") return `Release ${result.activeReleaseVersion || "未发布"}`;
  if (name === "recommend_meeting_time") return result.summary || "已计算候选时间";
  if (name === "explain_personal_import") return "已返回导入指引";
  if (name === "clarify_missing_slot") return "缺少必要关键词";
  return "工具调用完成";
}

function makeToolCall(name, result, forcedStatus) {
  return {
    name,
    status: forcedStatus || (result && result.success === false ? "failed" : "success"),
    summary: getToolSummary(name, result),
    result,
  };
}

function getItemComparableName(item = {}, type) {
  if (type === "teacher") return item.teacherName || item.name || item.displayName || "";
  if (type === "classroom") return item.roomName || item.classroomName || item.name || item.displayName || "";
  if (type === "course") return item.courseName || item.name || item.displayName || "";
  if (type === "class") return item.className || item.name || item.displayName || "";
  return item.name || item.displayName || "";
}

function normalizeComparable(value) {
  return normalizeText(value).replace(/\s+/g, "").toLowerCase();
}

function isHighConfidenceIndexHit(result = {}) {
  const items = asArray(result.items);
  const q = normalizeComparable(result.q);
  if (!q || items.length !== 1) return false;
  const itemName = normalizeComparable(getItemComparableName(items[0], result.type));
  return itemName === q || q.length >= 2;
}

function buildPlanForIntent(intent, message, context = {}) {
  const slots = Object.assign({}, intent && intent.slots || {}, {
    message,
    term: context.term,
    releaseVersion: context.releaseVersion,
  });
  if (intent && intent.name === "campus_multi_step_advice") {
    return [
      agentProtocol.buildPlanStep("get_tomorrow_courses", slots, "读取明日个人课程"),
      agentProtocol.buildPlanStep("search_empty_rooms", slots, "查询空闲节次对应空教室"),
      agentProtocol.buildPlanStep("get_campus_weather", slots, "查询校区天气"),
      agentProtocol.buildPlanStep("search_campus_place", { q: slots.building || slots.campus || "C7", message }, "补充地点信息"),
    ];
  }
  if (intent && intent.name === "next_course_location") {
    return [
      agentProtocol.buildPlanStep("get_next_course", slots, "读取下一节课程"),
      agentProtocol.buildPlanStep("get_classroom_location", { message }, "查询教室楼栋位置"),
    ];
  }
  if (!intent || intent.name === "generic" || intent.name === "project_qa" || intent.name === "conversational_help") return [];
  if (intent.name === "clarify_missing_slot") {
    return [agentProtocol.buildPlanStep("clarify_missing_slot", slots, "补全缺失槽位")];
  }
  return [agentProtocol.buildPlanStep(intent.name, slots, "执行权威工具")];
}

function runToolsForIntent(intent, message, context) {
  if (!intent || intent.name === "generic" || intent.name === "project_qa" || intent.name === "conversational_help") return [];
  if (intent.name === "next_course_location") return runToolChainForIntent(intent, message, context);
  const input = Object.assign({}, intent.slots || {}, {
    message,
    term: context.term,
    releaseVersion: context.releaseVersion,
  });
  if (intent.name === "clarify_missing_slot") {
    const result = executeTool(intent.name, input, context);
    return [makeToolCall(intent.name, result, "skipped")];
  }
  const result = executeTool(intent.name, input, context);
  return [makeToolCall(intent.name, result)];
}

function runToolChainForIntent(intent, message, context) {
  if (!intent || intent.name === "generic" || intent.name === "project_qa" || intent.name === "conversational_help") return [];
  if (intent.name === "clarify_missing_slot") return runToolsForIntent(intent, message, context);

  const input = Object.assign({}, intent.slots || {}, {
    message,
    term: context.term,
    releaseVersion: context.releaseVersion,
  });
  const calls = [];
  if (intent.name === "campus_multi_step_advice") {
    buildPlanForIntent(intent, message, context).forEach((step) => {
      const result = executeTool(step.toolName, step.args, context);
      calls.push(makeToolCall(step.toolName, result));
    });
    return calls;
  }
  if (intent.name === "next_course_location") {
    const courseResult = executeTool("get_next_course", input, context);
    calls.push(makeToolCall("get_next_course", courseResult));
    const nextCourse = courseResult && (courseResult.nextCourse || asArray(courseResult.courses)[0]) || {};
    const classroom = nextCourse.classroom || nextCourse.roomName || input.classroom || "";
    if (classroom) {
      const locationResult = executeTool("get_classroom_location", { classroom, message }, context);
      calls.push(makeToolCall("get_classroom_location", locationResult));
    }
    return calls;
  }
  const firstResult = executeTool(intent.name, input, context);
  calls.push(makeToolCall(intent.name, firstResult));

  if (intent.name === "search_school_index" && firstResult && firstResult.success !== false && isHighConfidenceIndexHit(firstResult)) {
    const item = firstResult.items[0] || {};
    const detailId = item.id || item.scheduleId || item.teacherId || item.classroomId || item.courseId || item.classId || item.name || item.displayName || "";
    const detailResult = executeTool("get_schedule_detail", {
      type: firstResult.type,
      id: detailId,
      releaseVersion: firstResult.releaseVersion,
      term: firstResult.term || context.term,
      message,
    }, context);
    calls.push(makeToolCall("get_schedule_detail", detailResult));
  }

  if (intent.name === "search_empty_rooms" || intent.name === "search_continuous_empty_rooms") {
    const rooms = asArray(firstResult && firstResult.rooms);
    if (!firstResult || firstResult.success === false || rooms.length === 0 || Number(firstResult.total || rooms.length) === 0) {
      const diagnosis = executeTool("diagnose_data_status", input, context);
      calls.push(makeToolCall("diagnose_data_status", diagnosis));
    }
  }

  if (intent.name === "recommend_meeting_time" && firstResult && firstResult.emptyRoomResult) {
    calls.push(makeToolCall("search_empty_rooms", firstResult.emptyRoomResult));
  }

  return calls;
}

async function runToolChainForIntentAsync(intent, message, context) {
  if (!intent || intent.name === "generic" || intent.name === "project_qa" || intent.name === "conversational_help") return [];
  if (intent.name === "clarify_missing_slot") return runToolsForIntent(intent, message, context);

  const input = Object.assign({}, intent.slots || {}, {
    message,
    term: context.term,
    releaseVersion: context.releaseVersion,
  });
  const calls = [];
  if (intent.name === "campus_multi_step_advice") {
    const plan = buildPlanForIntent(intent, message, context);
    for (const step of plan) {
      const result = await executeToolAsync(step.toolName, step.args, context);
      calls.push(makeToolCall(step.toolName, result));
    }
    return calls;
  }
  if (intent.name === "next_course_location") {
    const courseResult = await executeToolAsync("get_next_course", input, context);
    calls.push(makeToolCall("get_next_course", courseResult));
    const nextCourse = courseResult && (courseResult.nextCourse || asArray(courseResult.courses)[0]) || {};
    const classroom = nextCourse.classroom || nextCourse.roomName || input.classroom || "";
    if (classroom) {
      const locationResult = await executeToolAsync("get_classroom_location", { classroom, message }, context);
      calls.push(makeToolCall("get_classroom_location", locationResult));
    }
    return calls;
  }

  const firstResult = await executeToolAsync(intent.name, input, context);
  calls.push(makeToolCall(intent.name, firstResult));

  if (intent.name === "search_school_index" && firstResult && firstResult.success !== false && isHighConfidenceIndexHit(firstResult)) {
    const item = firstResult.items[0] || {};
    const detailId = item.id || item.scheduleId || item.teacherId || item.classroomId || item.courseId || item.classId || item.name || item.displayName || "";
    const detailResult = await executeToolAsync("get_schedule_detail", {
      type: firstResult.type,
      id: detailId,
      releaseVersion: firstResult.releaseVersion,
      term: firstResult.term || context.term,
      message,
    }, context);
    calls.push(makeToolCall("get_schedule_detail", detailResult));
  }

  if (intent.name === "search_empty_rooms" || intent.name === "search_continuous_empty_rooms") {
    const rooms = asArray(firstResult && firstResult.rooms);
    if (!firstResult || firstResult.success === false || rooms.length === 0 || Number(firstResult.total || rooms.length) === 0) {
      const diagnosis = await executeToolAsync("diagnose_data_status", input, context);
      calls.push(makeToolCall("diagnose_data_status", diagnosis));
    }
  }

  if (intent.name === "recommend_meeting_time" && firstResult && firstResult.emptyRoomResult) {
    calls.push(makeToolCall("search_empty_rooms", firstResult.emptyRoomResult));
  }

  return calls;
}

module.exports = {
  executeTool,
  executeToolAsync,
  courseAppliesToWeek,
  getCurrentSection,
  getCourseTimeStatus,
  inferSections,
  inferTargetDate,
  parseClientDate,
  resolveIntent,
  buildPlanForIntent,
  runToolChainForIntent,
  runToolChainForIntentAsync,
  runToolsForIntent,
};
