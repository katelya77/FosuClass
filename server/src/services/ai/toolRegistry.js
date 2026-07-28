const releaseService = require("../releaseService");
const schoolSearchContractService = require("../schoolSearchContractService");
const { DECISION: SCHOOL_SEARCH_DECISION } = require("../../shared/schoolSearchContract.generated");
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
const capabilityManifestService = require("./capabilityManifestService");
const generatedPayloadContract = require("./generatedPayloadContract");
const { planCourseReminder } = require("./reminders/courseReminderPlanner");
const { defaultCourseReminderService } = require("./reminders/courseReminderService");
const { resolvePrincipal } = require("./conversation/conversationPrincipalService");
const { defaultUserPreferenceService } = require("./conversation/userPreferenceService");
const scheduleAnalysisService = require("./scheduleAnalysisService");
const goalParser = require("./planner/goalParser");
const followUpResolver = require("./planner/followUpResolver");
const classAliasResolver = require("./classAliasResolver");

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
  const text = String(message || "");
  const offsetInfo = followUpResolver.parseDateOffset(text);
  const offset = offsetInfo && Number.isFinite(offsetInfo.dateOffset)
    ? offsetInfo.dateOffset
    : (/明天|翌日|明日/.test(text) ? 1 : 0);
  if (offset) date.setDate(date.getDate() + offset);
  return formatDate(date);
}

function buildWeatherSlots(message, context = {}) {
  const campus = inferCampusFromText(message);
  const offsetInfo = followUpResolver.parseDateOffset(message);
  const slots = { campus };
  if (offsetInfo) {
    slots.dateOffset = offsetInfo.dateOffset;
    slots.dateHint = offsetInfo.dateHint;
    slots.dayOffset = offsetInfo.dateOffset;
  }
  // Absolute date for tools that still expect YYYY-MM-DD
  slots.date = inferTargetDate(message, context);
  return slots;
}

function inferSearchType(message) {
  const text = normalizeText(message);
  if (/老师|教师|任课/.test(text)) return "teacher";
  if (/教室|课室|自习室/.test(text)) return "classroom";
  if (/课程|科目|查课/.test(text) && !/班/.test(text)) return "course";
  // “25动医6班课表” must be class, not default teacher.
  if (/班级|行政班|专业|\d\s*[\u3400-\u9fff]{0,8}班|[\u3400-\u9fff]+\d+\s*班/.test(text) || (/班/.test(text) && !/老师|教师|教室/.test(text))) {
    return "class";
  }
  // “24动医1的课表”：年级+专业简称+班号（无“班”字）也识别为班级课表
  if (/课表/.test(text) && /\d{2,4}\s*[\u3400-\u9fff]{1,8}\s*\d{1,2}\s*班?/.test(text)) return "class";
  // 无法识别不默认 teacher，返回空串走 clarify
  return "";
}

function stripIntentWords(message) {
  return normalizeText(message)
    .replace(/帮我|帮|我|请问|查询|查找|查一下|查|看看|看|找|占用|使用情况|课表|课程表|老师|教师|教室|课室|自习室|课程|安排|班级|行政班|专业|佛山大学|佛大|的/g, " ")
    .replace(/[？?，,。.!！]/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

/** 「陈芳老师的课表」→ 姓名「陈芳」；禁止整串精确匹配失败 */
function stripPersonHonorifics(name) {
  return normalizeText(name)
    .replace(/\s+/g, "")
    .replace(/(?:的)?(?:课表|课程表)$/g, "")
    .replace(/(?:老师|教师|任课老师|教授|讲师|导师)+$/g, "")
    .replace(/^(?:老师|教师)/, "")
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
  // 类型无法识别时不再默认 teacher，而是澄清查询类型
  return map[type] || { missing: "searchType", type: "", prompt: "你想查老师、教室、课程，还是班级课表？" };
}

function needsClarification(type, q) {
  // 类型无法识别时必须澄清，禁止落入默认 teacher 搜索
  if (!type) return true;
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
  if (stripped) {
    return type === "teacher" ? (stripPersonHonorifics(stripped) || stripped) : stripped;
  }
  const cleanupPatterns = {
    teacher: /老师|教师|任课|课表|查询|查|帮我|请|一下|的/g,
    classroom: /教室|课室|占用|使用情况|查询|查|帮我|请|一下|的/g,
    course: /课程|安排|查课|查询|查|帮我|请|一下|的/g,
    class: /班级|行政班|专业|课表|查询|查|帮我|请|一下|的/g,
  };
  const cleaned = text.replace(cleanupPatterns[type] || /查询|查|帮我|请|一下|的/g, " ").replace(/\s+/g, " ").trim();
  return type === "teacher" ? (stripPersonHonorifics(cleaned) || cleaned) : cleaned;
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
  if (/课程|科目|查课|安排/.test(text) && !/班/.test(text)) return "course";
  if (/班级|行政班|专业|\d\s*[\u3400-\u9fff]{0,8}班|[\u3400-\u9fff]+\d+\s*班/.test(text) || (/班/.test(text) && !/老师|教师|教室/.test(text))) {
    return "class";
  }
  // “24动医1的课表”：年级+专业简称+班号（无“班”字）也识别为班级课表
  if (/课表/.test(text) && /\d{2,4}\s*[\u3400-\u9fff]{1,8}\s*\d{1,2}\s*班?/.test(text)) return "class";
  // 无法识别时不再默认 teacher：返回空串，让上层走 clarify（避免把操作类/模糊查询误路由成教师搜索）
  return "";
}

function stripChineseIntentWords(message) {
  return normalizeText(message)
    .replace(/帮我|请|麻烦|查询|查找|查一下|查一查|查|找|看看|看|一下|佛山大学|佛大|的/g, " ")
    .replace(/老师|教师|任课|教室|课室|自习室|课程|科目|班级|行政班|专业|课表|课程表|安排|占用|使用情况/g, " ")
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/\s+/g, "")
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
  // 连续自习 / 共同空闲时间：优先于泛化“教室”索引查询
  if (/自习时间|推荐.*时间|共同空闲|组会|会议|一起自习|连续自习|自习.*[两二三四五六]节|适合.*自习|自习.*时间|找.*自习/.test(text)) {
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
  if (/连续.*空教室|连着.*空教室|连堂.*空教室/.test(text)) {
    return {
      name: "search_continuous_empty_rooms",
      slots: {
        building: extractBuilding(text),
        minFreeSections: parseChineseDuration(text, 2),
      },
    };
  }
  if (/空教室|空课室|找教室|可用教室|附近|找.*教室.*自习|自习.*教室/.test(text)) {
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
  // 排除自习/空教室场景，避免“教室”关键词抢占为全校索引查询
  if (/老师|教师|任课|教室|课室|课程|科目|查课|班级|行政班|专业|课表|课程表|占用|安排/.test(text) &&
    !/自习|空教室|空课室|可用教室|共同空闲/.test(text)) {
    const type = inferSearchTypeChinese(text);
    const q = stripChineseIntentWords(text);
    if (needsClarification(type, q)) {
      return { name: "clarify_missing_slot", slots: { slot: getMissingSlot(type), type, q } };
    }
    return { name: "search_school_index", slots: { type, q } };
  }
  return null;
}

/**
 * open_schedule 目标构建：
 * “打开24动物医学1班的课表” → entityType=class → search class index → get_schedule_detail
 * 实体类型一旦锁定（lockedEntityType），后续 plan/replan/cache 不得改写。
 * 多候选 → 澄清卡；禁止静默猜 teacher。
 */
function buildOpenScheduleIntent(goal, context = {}) {
  const entity = normalizeText(goal.entity || "");
  let entityType = String(goal.entityType || "").trim();
  if (!entityType && entity) {
    entityType = goalParser.inferEntityType(entity) || "";
  }
  // 无实体：澄清
  if (!entity && !goal.deictic) {
    return {
      name: "clarify_missing_slot",
      slots: {
        slot: { missing: "entity", type: "", prompt: "想打开谁的课表？可以说班级、老师、教室或课程名称。" },
        goalAction: "open_schedule",
      },
    };
  }
  // 指代：沿用上下文 lastTarget
  if (!entity && goal.deictic) {
    const wm = (context && context.workingMemory) || {};
    const slots = (context && (context.contextSlots || context.slots)) || {};
    const lastType = wm.lastTargetType || slots.lastTargetType || "";
    const lastName = wm.lastTargetName || slots.lastTargetName || "";
    const lastId = wm.lastTargetId || slots.lastTargetId || "";
    if (lastType && lastId) {
      return {
        name: "get_schedule_detail",
        slots: {
          type: lastType,
          id: lastId,
          q: lastName,
          lockedEntityType: lastType,
          goalAction: "open_schedule",
          explicitCommand: goal.explicitCommand === true,
        },
      };
    }
    if (lastType && lastName) {
      return {
        name: "search_school_index",
        slots: {
          type: lastType,
          q: lastName,
          lockedEntityType: lastType,
          goalAction: "open_schedule",
          explicitCommand: goal.explicitCommand === true,
        },
      };
    }
    return {
      name: "clarify_missing_slot",
      slots: {
        slot: { missing: "entity", type: "", prompt: "刚才没有可打开的课表目标。请告诉我班级、老师、教室或课程名。" },
        goalAction: "open_schedule",
      },
    };
  }

  // 班级：别名解析 → 唯一则 search+detail 链，多候选澄清，零匹配澄清
  if (entityType === "class" || (!entityType && /班|\d{2}[\u3400-\u9fff]{2,}/.test(entity))) {
    const index = releaseService.readActiveIndex("class") || {};
    const items = Array.isArray(index.items) ? index.items : (Array.isArray(index) ? index : []);
    const resolution = classAliasResolver.resolveClass(entity, items);
    if (resolution.status === "unique" && resolution.match) {
      const m = resolution.match;
      const canonical = String(m.name || m.className || entity);
      return {
        name: "search_school_index",
        slots: {
          type: "class",
          q: canonical,
          preferredId: String(m.id || m.detailId || ""),
          lockedEntityType: "class",
          goalAction: "open_schedule",
          explicitCommand: goal.explicitCommand === true,
        },
      };
    }
    if (resolution.status === "ambiguous") {
      const candidates = (resolution.candidates || []).slice(0, 5).map((c) => ({
        detailId: String(c.id || c.detailId || ""),
        name: String(c.name || c.className || ""),
        term: c.semester || "",
        type: "class",
      }));
      return {
        name: "clarify_missing_slot",
        slots: {
          slot: { missing: "className", type: "class", prompt: "找到多个候选班级，你想打开哪一个的课表？" },
          type: "class",
          q: entity,
          goalAction: "open_schedule",
          lockedEntityType: "class",
          candidates,
        },
      };
    }
    // not_found for class-looking entity: still try search with locked type, never fall to teacher
    return {
      name: "search_school_index",
      slots: {
        type: "class",
        q: entity,
        lockedEntityType: "class",
        goalAction: "open_schedule",
        explicitCommand: goal.explicitCommand === true,
      },
    };
  }

  // 教师 / 教室 / 课程
  const allowed = ["teacher", "classroom", "course"];
  const type = allowed.includes(entityType) ? entityType : "";
  if (!type) {
    // 无法判定类型：澄清，禁止默认 teacher
    return {
      name: "clarify_missing_slot",
      slots: {
        slot: {
          missing: "entityType",
          type: "",
          prompt: `「${entity}」是班级、老师、教室还是课程？请补充一下，例如「打开${entity}班的课表」或「打开${entity}老师的课表」。`,
        },
        q: entity,
        goalAction: "open_schedule",
      },
    };
  }
  const q = type === "teacher" ? (stripPersonHonorifics(entity) || entity) : entity;
  return {
    name: "search_school_index",
    slots: {
      type,
      q,
      lockedEntityType: type,
      goalAction: "open_schedule",
      explicitCommand: goal.explicitCommand === true,
    },
  };
}

/**
 * set_current_schedule 目标构建：
 * - 显式实体（“24动医1”）→ 全校班级索引 + 别名字典解析
 * - 指代（“把刚刚查到的班级设为我的课表”）→ workingMemory/contextSlots 的 lastTarget
 * - 唯一匹配 → set_current_schedule intent（slots 带 detailId/name/term/releaseVersion）
 * - 多候选 → clarify_missing_slot 带候选列表，禁止静默猜测
 * - 零匹配 → clarify_missing_slot 提示换说法
 */
function buildSetCurrentScheduleIntent(goal, context = {}) {
  let entity = normalizeText(goal.entity || "");
  if (!entity && goal.deictic) {
    const wm = (context && context.workingMemory) || {};
    const slots = (context && (context.contextSlots || context.slots)) || {};
    const lastType = wm.lastTargetType || slots.lastTargetType || "";
    const lastName = wm.lastTargetName || slots.lastTargetName || "";
    if (lastType === "class" && lastName) entity = lastName;
  }
  if (!entity) {
    return {
      name: "clarify_missing_slot",
      slots: {
        slot: { missing: "className", type: "class", prompt: "想把哪个班级设为首页课表？告诉我班级名称，比如 24动医1。" },
        type: "class",
        q: "",
        goalAction: "set_current_schedule",
      },
    };
  }
  if (goal.entityType && goal.entityType !== "class") {
    return {
      name: "clarify_missing_slot",
      slots: {
        slot: { missing: "className", type: "class", prompt: "目前只支持把班级课表设为首页。想设置哪个班级？" },
        type: "class",
        q: "",
        goalAction: "set_current_schedule",
      },
    };
  }
  const index = releaseService.readActiveIndex("class") || {};
  const items = Array.isArray(index.items) ? index.items : (Array.isArray(index) ? index : []);
  const resolution = classAliasResolver.resolveClass(entity, items);
  if (resolution.status === "unique" && resolution.match) {
    const m = resolution.match;
    return {
      name: "set_current_schedule",
      slots: {
        detailId: String(m.id || m.detailId || ""),
        name: String(m.name || m.className || entity),
        term: m.semester || context.term || "",
        releaseVersion: m.releaseVersion || context.releaseVersion || "",
        explicitCommand: goal.explicitCommand === true,
      },
    };
  }
  if (resolution.status === "ambiguous") {
    const candidates = (resolution.candidates || []).slice(0, 5).map((c) => ({
      detailId: String(c.id || c.detailId || ""),
      name: String(c.name || c.className || ""),
      term: c.semester || "",
    }));
    return {
      name: "clarify_missing_slot",
      slots: {
        slot: { missing: "className", type: "class", prompt: "找到多个候选班级，你想设置哪一个？" },
        type: "class",
        q: entity,
        goalAction: "set_current_schedule",
        candidates,
      },
    };
  }
  return {
    name: "clarify_missing_slot",
    slots: {
      slot: { missing: "className", type: "class", prompt: `没有找到「${entity}」对应的班级。可以说完整班级名，比如 24动物医学1班。` },
      type: "class",
      q: entity,
      goalAction: "set_current_schedule",
    },
  };
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
  // Preference-style default lead time is personal memory, not a write to reminder rules.
  if (/(?:设置|设定|改成|改为|调整)?\s*(?:默认)?\s*(?:提醒时间|上课提醒|课程提醒)/.test(text)
    || /默认\s*(?:提前|上课前)\s*\d{1,3}\s*分钟/.test(text)
    || /(?:提醒我|提醒时间)\s*(?:改成|改为|设置成|设为)?\s*(?:提前)?\s*\d{1,3}\s*分钟/.test(text)) {
    if (!/(?:以后上课|每节课|教室变化|创建提醒|取消|删除|关闭|暂停|启用|查看提醒|管理提醒)/.test(text)) {
      const leadMatch = text.match(/(?:提前|上课前)\s*(\d{1,3})\s*分钟/)
        || text.match(/(\d{1,3})\s*分钟/);
      const slots = {};
      if (leadMatch) slots.defaultReminderLeadMinutes = Math.min(180, Math.max(5, Number(leadMatch[1]) || 20));
      return { name: "update_user_preference", slots };
    }
  }
  if (/(?:提醒|通知)/.test(text)) {
    let operation = "create";
    if (/(?:取消|删除|关闭).*(?:提醒|通知)/.test(text)) operation = "delete";
    else if (/(?:查看|管理|列出|有哪些|多少个).*(?:提醒|通知)|(?:提醒|通知)(?:列表|管理)/.test(text)) operation = "list";
    else if (/(?:暂停|启用|恢复|修改|调整).*(?:提醒|通知)/.test(text)) operation = "update";
    return { name: "manage_course_reminders", slots: { operation } };
  }
  const campus = inferCampusFromText(text);
  const hasWeather = /\u5929\u6c14|\u4e0b\u96e8|\u964d\u96e8|\u9ad8\u6e29|\u96f7\u66b4|\u5e26\u4f1e|\u51fa\u884c/.test(text);
  const hasEmptyRoom = /\u7a7a\u6559\u5ba4|\u81ea\u4e60|\u6ca1\u8bfe/.test(text);
  const hasTravel = /\u8def\u7ebf|\u4f4d\u7f6e|\u5bfc\u822a|\u5728\u54ea|\u600e\u4e48\u8d70/.test(text);
  const hasNextCourseLocation = /\u4e0b\u4e00\u8282|\u4e0b\u8282|\u63a5\u4e0b\u6765.*\u8bfe/.test(text) &&
    /\u5728\u54ea|\u54ea\u91cc|\u4f4d\u7f6e|\u6559\u5b66\u697c|\u5730\u56fe|\u600e\u4e48\u8d70/.test(text);
  const hasCampusMapQuery = /\u5730\u56fe|\u5730\u70b9|\u4f4d\u7f6e|\u5728\u54ea|\u54ea\u91cc|\u56fe\u4e66\u9986|\u996d\u5802|\u98df\u5802|\u5bbf\u820d|\u4f53\u80b2\u9986|\u6821\u95e8|\u533b\u9662|\u533b\u52a1|\u6559\u5b66\u697c|\u4e3b\u8981\u5730\u70b9|\b[A-Z]\d{1,2}\b/i.test(text);
  const hasCampusScope = /\u6c5f\u6e7e|\u4ed9\u6eaa|\u6cb3\u6ee8|\u6821\u533a|\u6821\u56ed|\b[A-Z]\d{1,2}\b/i.test(text);
  const wantsDeparture = /(?:几点|什么时候|何时).*(?:出发|走)|(?:出发|走).*(?:几点|什么时候|何时)|该出发|出发建议/.test(text);
  if (wantsDeparture && /下一节|下节|明天|上课|课程|宿舍/.test(text)) {
    const fromMatch = text.match(/从\s*([^，。！？?]{1,16}?)(?:出发|走)/);
    return {
      name: "course_action_advice",
      slots: {
        from: fromMatch ? fromMatch[1] : (/宿舍/.test(text) ? "宿舍" : "当前位置"),
        campus,
        dateHint: /明天/.test(text) ? "tomorrow" : "today",
        wantsWeather: hasWeather,
      },
    };
  }
  if (/时间冲突|课程冲突|重复课程|连续赶课|课表异常|缺失教室|检查.*课表/.test(text)) {
    return { name: "inspect_schedule_health", slots: {} };
  }
  if (/课表.*(?:变化|变更|改动)|(?:变化|变更|改动).*课表|换教室|教师变化|周次异常/.test(text)) {
    return { name: "detect_schedule_changes", slots: {} };
  }
  if (/两节课中间|课程中间|课间.*(?:一小时|空档)|空档.*(?:空教室|自习)|规划.*(?:上课|课程).*(?:自习|空教室)/.test(text)) {
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
  if (hasNextCourseLocation) {
    return { name: "next_course_location", slots: {} };
  }
  if (/\u751f\u56fe|\u56fe\u7247|\u6d77\u62a5|\u5206\u4eab\u56fe|\u914d\u56fe|\u5c55\u793a\u7d20\u6750|\u751f\u6210.*\u56fe/.test(text)) {
    return { name: "generate_image", slots: { scene: "competition_demo_asset" } };
  }
  // Pure weather (incl. 后天/明天 + campus) must NOT become multi_step.
  // Multi-step only when weather is combined with empty-room or travel tasks.
  if (hasWeather && (hasEmptyRoom || hasTravel)) {
    return {
      name: "campus_multi_step_advice",
      slots: {
        campus,
        date: inferTargetDate(text, context),
        dateOffset: (followUpResolver.parseDateOffset(text) || {}).dateOffset,
        sections: inferSections(text, context),
        building: extractBuilding(text),
        wantsWeather: true,
      },
    };
  }
  if (hasWeather) {
    return { name: "get_campus_weather", slots: buildWeatherSlots(text, context) };
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
  // 连续自习/共同空闲时间推荐：优先于“连续空教室”与泛化教室搜索
  if (/自习时间|推荐.*时间|共同空闲|组会|会议|一起自习|连续自习|自习.*[两二三四五六]节|适合.*自习|自习.*时间|找.*自习/.test(text)) {
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
  if (/连续.*空教室|连着.*空教室|连堂.*空教室/.test(text)) {
    return {
      name: "search_continuous_empty_rooms",
      slots: {
        building: extractBuilding(text),
        minFreeSections: parseChineseDuration(text, 2),
      },
    };
  }
  if (/空教室|空课室|找教室|可用教室|自习/.test(text)) {
    return {
      name: "search_empty_rooms",
      slots: {
        building: extractBuilding(text),
        minFreeSections: /连续/.test(text) ? parseChineseDuration(text, 2) : 1,
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

/**
 * Multi-turn follow-ups (“那周三呢 / 下午呢 / 换成第17周 / 换成江湾 / 不是A，是B …”)
 * are resolved by the single implementation: planner/followUpResolver.resolve
 * (M4-T2). The legacy week/period parser that used to live here was retired;
 * this adapter only folds legacy context shapes (conversationSlots/lastIntent)
 * into the working-state input the resolver consumes.
 */
function resolveUnifiedFollowUpIntent(message, context = {}) {
  const workingMemory = context.conversationWorkingState && typeof context.conversationWorkingState === "object"
    ? context.conversationWorkingState
    : (context.workingMemory && typeof context.workingMemory === "object" ? context.workingMemory : {});
  const conversationSlots = context.conversationSlots && typeof context.conversationSlots === "object"
    ? context.conversationSlots
    : {};
  const workingState = Object.assign({}, workingMemory);
  // Legacy parity: conversationSlots/lastIntent only fill gaps the working
  // memory does not already cover.
  if (!workingState.activeGoal && !workingState.currentGoal) {
    workingState.activeGoal = String(conversationSlots.lastIntent || context.lastIntent || "");
  }
  if (!workingState.lastEntity && !workingState.lastResolvedEntity
    && !workingState.className && !workingState.teacherName) {
    const slotClass = String(conversationSlots.className || "").replace(/\s+/g, "");
    const slotTeacher = String(conversationSlots.teacherName || "").replace(/\s+/g, "");
    const slotTarget = String(conversationSlots.lastTargetName || conversationSlots.q || "").replace(/\s+/g, "");
    if (slotClass || slotTeacher || slotTarget) {
      workingState.lastEntity = slotClass || slotTeacher || slotTarget;
      workingState.lastEntityType = slotClass || /班/.test(slotTarget)
        ? "class"
        : (slotTeacher || conversationSlots.lastTargetType === "teacher"
          ? "teacher"
          : (conversationSlots.lastTargetType || "class"));
    }
  }
  if (workingState.teachingWeek == null) {
    const week = Number(conversationSlots.lastWeek || conversationSlots.week);
    if (Number.isFinite(week) && week >= 1) workingState.teachingWeek = week;
  }
  if (workingState.weekday == null) {
    const weekday = Number(conversationSlots.lastWeekday || conversationSlots.weekday);
    if (Number.isFinite(weekday) && weekday >= 1) workingState.weekday = weekday;
  }
  const resolution = followUpResolver.resolve({
    message,
    workingState,
    pendingClarification: context.pendingClarification || null,
  });
  return resolution && resolution.resolvedIntent ? resolution.resolvedIntent : null;
}

function resolveIntent(message, context = {}) {
  const text = normalizeText(message);
  if (isProjectQaMessage(text)) {
    return { name: "project_qa", slots: {} };
  }
  // Goal-first：操作类意图优先于查询类——“将24动医1的课表设为当前首页课表”
  // 必须解析成 set_current_schedule，而不是落入全校查询兜底（断点1修复）
  // “打开24动物医学1班的课表” → open_schedule + entityType=class（禁止误判 teacher）
  const goal = goalParser.parseGoal(text, context);
  if (goal && goal.goal === "set_current_schedule") {
    return buildSetCurrentScheduleIntent(goal, context);
  }
  if (goal && goal.goal === "open_schedule") {
    return buildOpenScheduleIntent(goal, context);
  }
  const pendingIntent = resolvePendingClarificationIntent(text, context);
  if (pendingIntent) return pendingIntent;
  // Unified follow-up (single implementation: planner/followUpResolver.resolve)
  // before modern multi-step & RAG. Covers constraint switches, pending slot
  // fills, corrections, anaphora and week/period modifiers.
  const followUpIntent = resolveUnifiedFollowUpIntent(text, context);
  if (followUpIntent) return followUpIntent;
  const modernIntent = resolveModernChineseIntent(text, context);
  if (modernIntent) return modernIntent;
  const chineseIntent = resolveIntentChinese(text, context);
  if (chineseIntent) return chineseIntent;
  if (/导入|XLS|excel|个人课表|账号|登录|密码/.test(text)) {
    return { name: "explain_personal_import", slots: { mode: /XLS|excel/i.test(text) ? "xls" : "unknown" } };
  }
  if (/加载失败|数据失败|为什么.*数据|诊断|缓存|release|同步失败|打不开/.test(text)) {
    return { name: "diagnose_data_status", slots: {} };
  }
  if (/组会|会议|共同空闲|一起自习|自习时间|推荐时间|连续自习|自习.*[两二三四五六]节|适合.*自习|自习.*时间|找.*自习/.test(text)) {
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
      : "当前没有可用的空教室索引，请先检查课表数据是否已发布或稍后重试。",
    updatedAt: result.updatedAt || "",
    actionUrl: buildActionUrl("/pages/empty-room/empty-room", query),
  });
}

function searchSchoolIndex(input = {}, context = {}) {
  // lockedEntityType 优先：一旦实体类型确认，禁止回落默认 teacher
  const locked = ["class", "teacher", "classroom", "course"].includes(input.lockedEntityType)
    ? input.lockedEntityType
    : "";
  const type = locked
    || (["class", "teacher", "classroom", "course"].includes(input.type) ? input.type : "teacher");
  let query = normalizeText(input.q || input.message || "");
  // 教师：剥离「老师/教师」称谓，避免精确姓名把「陈芳老师」当成姓名
  if (type === "teacher") {
    query = stripPersonHonorifics(query) || query;
  }
  const preferredId = normalizeText(input.preferredId || input.detailId || "");
  const classroomQuery = type === "classroom" ? classroomSearch.parseClassroomQuery(query) : null;
  // M3-T3：数据层切换到 school-search.v1 统一契约服务（进程内调用）。过滤谓词、
  // 教师精确命中隔离、唯一/多候选决策由 schoolSearchContractService 唯一实现，
  // 工具内不再重复；列表上限默认消费生成物 DECISION.candidateListMax。
  // 保留本层职责：lockedEntityType、教师称谓剥离、classroom NL 解析与排序、preferredId 权威命中。
  const listCap = Number(input.limit || SCHOOL_SEARCH_DECISION.candidateListMax) || SCHOOL_SEARCH_DECISION.candidateListMax;
  const result = schoolSearchContractService.search({
    type,
    q: query,
    term: input.term || context.term || getDefaultTerm(),
    releaseVersion: input.releaseVersion || context.releaseVersion || "",
    collegeCode: input.collegeCode || "",
    collegeName: input.collegeName || "",
    titleCode: input.titleCode || "",
    limit: type === "classroom" && classroomQuery && classroomQuery.queryType !== "text" ? 500 : listCap,
  }, {
    offline: input.offline === true || context.offline === true,
    // 测试注入通道（同 releaseService.searchActiveIndex 的 _items 约定）：不进入契约字段与响应
    _items: Array.isArray(input._items) ? input._items : undefined,
  });
  let rawItems = asArray(result.items);
  // preferredId：别名解析后的权威 detailId，强制唯一命中
  if (preferredId) {
    const byId = rawItems.find((item) => String(item.id || item.detailId || "") === preferredId);
    if (byId) {
      rawItems = [byId];
    } else {
      const index = releaseService.readActiveIndex(type, input.releaseVersion || context.releaseVersion || "") || {};
      const all = Array.isArray(index.items) ? index.items : [];
      const hit = all.find((item) => String(item.id || item.detailId || "") === preferredId);
      if (hit) rawItems = [hit];
    }
  }
  const filteredItems = type === "classroom"
    ? classroomSearch.filterAndSortClassrooms(rawItems, classroomQuery)
    : rawItems;
  return {
    success: Boolean(result.success !== false || filteredItems.length > 0),
    type,
    q: query,
    lockedEntityType: locked || type,
    goalAction: input.goalAction || "",
    preferredId: preferredId || "",
    term: result.term || result.semester || input.term || context.term || getDefaultTerm(),
    queryType: classroomQuery && classroomQuery.queryType || "",
    buildingCode: classroomQuery && classroomQuery.buildingCode || "",
    roomNumber: classroomQuery && classroomQuery.roomNumber || "",
    normalizedQuery: classroomQuery && classroomQuery.normalizedQuery || query,
    items: filteredItems.slice(0, listCap),
    total: filteredItems.length,
    updatedAt: result.updatedAt || "",
    releaseVersion: result.releaseVersion || result.version || context.releaseVersion || "",
    actionUrl: buildActionUrl("/pages/school/school", { type, q: query }),
    code: result.code || result.reasonCode || "",
    // M3-T3 追加字段（不改既有字段语义）：契约版本与唯一/多候选/无结果决策透传
    contractVersion: result.contractVersion || "",
    decision: result.decision || null,
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

function resolveReminderPrincipal(context = {}) {
  return resolvePrincipal({
    serverSession: context.serverSession || null,
    runtimeMode: context.runtimeMode || context.assistantEnvironment || "public",
  });
}

function createCourseReminder(input = {}, context = {}) {
  const principal = resolveReminderPrincipal(context);
  if (!principal.authenticated) {
    return {
      success: false,
      code: "PRINCIPAL_REQUIRED",
      requiresConfirmation: false,
      summary: "需要有效小程序会话后才能创建提醒。",
    };
  }
  const plan = planCourseReminder(input.message || "", context);
  if (plan.success !== true) return plan;
  return Object.assign({}, plan, {
    canConfirm: true,
    writeExecuted: false,
    summary: plan.scope === "room_change"
      ? "已生成仅在教室变化时提醒的待确认计划。"
      : `已生成提前 ${plan.leadMinutes} 分钟的待确认提醒计划。`,
  });
}

function listCourseReminders(input = {}, context = {}) {
  const principal = resolveReminderPrincipal(context);
  return defaultCourseReminderService.list({ principal });
}

function deleteCourseReminder(input = {}, context = {}) {
  const principal = resolveReminderPrincipal(context);
  const parsed = planCourseReminder(input.message || "取消提醒", context);
  const listed = defaultCourseReminderService.list({ principal });
  const filter = parsed && parsed.filter || {};
  const matches = asArray(listed.items).filter((item) => {
    const occurrence = item.nextOccurrence || {};
    if (filter.weekday && Number(occurrence.weekday || 0) !== Number(filter.weekday)) return false;
    if (filter.period) {
      const section = Number(occurrence.startSection || 0);
      if (filter.period === "morning" && section > 5) return false;
      if (filter.period === "afternoon" && (section < 6 || section > 10)) return false;
      if (filter.period === "evening" && section < 11) return false;
    }
    return true;
  });
  return {
    success: true,
    operation: "delete",
    filter,
    matches,
    requiresConfirmation: matches.length === 1,
    writeExecuted: false,
    summary: matches.length === 1
      ? "已找到 1 个匹配提醒，删除前需要确认。"
      : (matches.length ? `找到 ${matches.length} 个匹配提醒，请在提醒面板逐项确认。` : "没有找到匹配的提醒。"),
  };
}

function updateCourseReminder(input = {}, context = {}) {
  const principal = resolveReminderPrincipal(context);
  const listed = defaultCourseReminderService.list({ principal });
  const reminderId = normalizeText(input.reminderId);
  const reminder = asArray(listed.items).find((item) => item.id === reminderId) || null;
  return {
    success: Boolean(reminder),
    code: reminder ? "" : "REMINDER_NOT_FOUND",
    operation: "update",
    reminder,
    patch: {
      status: ["enabled", "paused"].includes(input.status) ? input.status : undefined,
      leadMinutes: input.leadMinutes === undefined ? undefined : Number(input.leadMinutes),
    },
    requiresConfirmation: Boolean(reminder),
    writeExecuted: false,
    summary: reminder ? "已生成提醒修改计划，执行前需要确认。" : "未找到要修改的提醒。",
  };
}

function updateUserPreference(input = {}, context = {}) {
  const message = normalizeText(input.message);
  const reminderPref = /(?:设置|设定|改成|改为|调整)?\s*(?:默认)?\s*(?:提醒时间|上课提醒|课程提醒)/.test(message)
    || /默认\s*(?:提前|上课前)\s*\d{1,3}\s*分钟/.test(message)
    || input.defaultReminderLeadMinutes !== undefined;
  if (!/(?:记住|记一下|以后叫我|以后称呼我)/.test(message) && !reminderPref) {
    return {
      success: false,
      code: "EXPLICIT_USER_COMMAND_REQUIRED",
      writeExecuted: false,
      summary: "只有用户明确要求记住时才能更新长期偏好。",
    };
  }
  const values = {};
  if (input.preferredName !== undefined) values.preferredName = input.preferredName;
  if (input.campus !== undefined) values.campus = input.campus;
  let lead = input.defaultReminderLeadMinutes;
  if (lead === undefined && message) {
    const leadMatch = message.match(/(?:提前|上课前)\s*(\d{1,3})\s*分钟/)
      || message.match(/(?:提醒时间|上课提醒|课程提醒|默认提醒).*?(\d{1,3})\s*分钟/)
      || message.match(/(\d{1,3})\s*分钟(?:后)?(?:提醒|上课前提醒)/);
    if (leadMatch) lead = Number(leadMatch[1]);
    else if (reminderPref && !/\d{1,3}\s*分钟/.test(message)) lead = 20;
  }
  if (lead !== undefined) {
    const n = Number(lead);
    if (Number.isFinite(n)) values.defaultReminderLeadMinutes = Math.min(180, Math.max(5, Math.round(n)));
  }
  if (!Object.keys(values).length) {
    return { success: false, code: "PREFERENCE_INVALID", writeExecuted: false, summary: "没有可更新的偏好。" };
  }
  const principal = resolveReminderPrincipal(context);
  const saved = defaultUserPreferenceService.upsert({
    principal,
    memoryMode: context.memoryMode || "local_only",
    explicit: true,
    values,
  });
  return {
    success: true,
    persisted: saved.persisted === true,
    memoryMode: saved.memoryMode || context.memoryMode || "local_only",
    updatedKeys: Object.keys(values),
    writeExecuted: true,
    summary: saved.persisted === true ? "用户明确偏好已安全保存。" : "偏好已返回客户端，仅保存在本机。",
  };
}

function getCourseRoute(input = {}, context = {}) {
  const message = normalizeText(input.message);
  const scheduleResult = /明天/.test(message) || input.dateHint === "tomorrow"
    ? getTomorrowCourses(input, context)
    : getNextCourse(input, context);
  if (scheduleResult.needContext) return scheduleResult;
  const course = scheduleResult.nextCourse || asArray(scheduleResult.courses)[0] || null;
  if (!course) {
    return { success: false, code: "NO_MATCHING_COURSE", summary: "没有找到匹配的后续课程。" };
  }
  const fromMatch = message.match(/从\s*([^，。！？?]{1,16}?)(?:出发|走)/);
  const from = input.from || (fromMatch ? fromMatch[1] : (/宿舍/.test(message) ? "宿舍" : "当前位置"));
  const classroom = course.classroom || course.roomName || "";
  const location = classroom ? campusMapService.getClassroomLocation({ classroom }) : null;
  const advice = scheduleAnalysisService.buildDepartureAdvice({
    course: Object.assign({}, course, { date: scheduleResult.date }),
    from,
    date: scheduleResult.date,
    walkingBufferMinutes: input.walkingBufferMinutes || context.userPreferences && context.userPreferences.walkingBufferMinutes || 20,
  });
  if (!advice.success) return advice;
  return Object.assign({}, advice, {
    locationEvidence: location,
    sourceId: location && location.sourceId || "campus-map:v2",
    actionUrl: location && location.items && location.items[0] && location.items[0].actionUrl
      || "/packageMaps/pages/campus-map/campus-map",
  });
}

function inspectScheduleConflicts(input = {}, context = {}) {
  return scheduleAnalysisService.inspectScheduleConflicts({
    currentScheduleSummary: context.currentScheduleSummary,
    totalWeeks: input.totalWeeks || context.totalWeeks || 22,
    currentTeachingWeek: input.week || context.currentTeachingWeek,
  });
}

function detectScheduleChanges(input = {}, context = {}) {
  return scheduleAnalysisService.detectScheduleChanges({
    currentScheduleSummary: context.currentScheduleSummary,
    baselineScheduleSummary: context.scheduleChangeBaseline || context.previousScheduleSummary,
  });
}

function navigateMiniprogramPage(input = {}) {
  const url = normalizeText(input.url);
  if (!generatedPayloadContract.isAllowedNavigationUrl(url)) {
    return { success: false, code: "NAVIGATION_URL_NOT_ALLOWED", summary: "页面入口未通过白名单校验。" };
  }
  return { success: true, url, actionUrl: url, summary: "页面入口已通过白名单校验。" };
}

/**
 * Hybrid RAG entry — always goes through KnowledgeRetriever (rule + BM25 + optional vector).
 * Async; callers must use executeToolAsync (Agent Kernel does).
 */
async function ragSearch(input = {}, context = {}) {
  const environment = context.assistantEnvironment || context.runtimeMode || input.environment || "public";
  const query = String(input.q || input.query || input.message || "").trim();
  try {
    const { retrieveKnowledge } = require("./retrieval/knowledgeRetriever");
    const result = await retrieveKnowledge({
      query,
      q: query,
      environment,
      runtimeMode: environment,
      campus: input.campus || (context && context.campus) || "",
      category: input.category || "",
      rewrittenQuery: input.rewrittenQuery || "",
    });
    const hits = (result && result.hits) || [];
    const vectorUsed = result && result.vectorUsed === true;
    const lexicalFallback = !vectorUsed;
    if (!result || result.noAnswer || !hits.length) {
      return {
        success: true,
        query: result && result.query || query,
        rewrittenQuery: result && result.rewrittenQuery || query,
        hits: [],
        confidence: result && result.confidence || 0,
        citations: result && result.citations || [],
        noAnswer: true,
        reason: result && result.reason || "NO_RELIABLE_HIT",
        summary: "暂未找到可靠的公开知识依据，请换个说法或查看使用说明。",
        hybrid: true,
        vectorUsed,
        lexicalFallback,
        lexicalCount: result && result.lexicalCount || 0,
        vectorIndex: result && result.vectorIndex || null,
        documents: [],
        total: 0,
      };
    }
    return {
      success: true,
      query: result.query || query,
      rewrittenQuery: result.rewrittenQuery || query,
      hits,
      confidence: result.confidence || 0,
      citations: result.citations || [],
      noAnswer: false,
      reason: result.reason || "OK",
      summary: hits[0] && (hits[0].excerpt || hits[0].title) || "已检索到相关说明。",
      hybrid: true,
      vectorUsed,
      lexicalFallback,
      lexicalCount: result.lexicalCount || 0,
      vectorIndex: result.vectorIndex || null,
      documents: hits,
      total: hits.length,
    };
  } catch (error) {
    // Hard degrade to legacy KB search (lexical/rule only)
    try {
      const legacy = knowledgeBaseService.searchKnowledge(Object.assign({}, input, {
        environment,
        query,
        q: query,
      }));
      return Object.assign({}, legacy, {
        success: legacy && legacy.success !== false,
        hybrid: true,
        vectorUsed: false,
        lexicalFallback: true,
        reason: "RETRIEVER_FALLBACK",
      });
    } catch (legacyError) {
      return {
        success: false,
        code: error.code || "RAG_FAILED",
        message: "知识检索暂时不可用",
        hybrid: true,
        vectorUsed: false,
        lexicalFallback: true,
      };
    }
  }
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

const TOOL_HANDLERS = Object.freeze({
  get_today_courses: getTodayCourses,
  get_today_schedule: getTodayCourses,
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
  get_course_route: getCourseRoute,
  inspect_schedule_conflicts: inspectScheduleConflicts,
  detect_schedule_changes: detectScheduleChanges,
  navigate_miniprogram_page: navigateMiniprogramPage,
  create_course_reminder: createCourseReminder,
  update_course_reminder: updateCourseReminder,
  delete_course_reminder: deleteCourseReminder,
  list_course_reminders: listCourseReminders,
  update_user_preference: updateUserPreference,
  rag_search: ragSearch,
  generate_image: generateImage,
  set_current_schedule: setCurrentSchedule,
});

/**
 * set_current_schedule：服务端不执行写入——校验目标真实存在于当前索引后，
 * 返回 actionRequired=setCurrentSchedule 与目标描述，由客户端 Action 执行器
 * 完成真实切换并回传 Receipt（无 success Receipt 不得声称成功）。
 */
function setCurrentSchedule(input = {}, context = {}) {
  const detailId = normalizeText(input.detailId || "");
  const name = normalizeText(input.name || "");
  if (!detailId || !name) {
    return { success: false, code: "SCHEDULE_TARGET_MISSING", summary: "缺少课表目标信息" };
  }
  const index = releaseService.readActiveIndex("class") || {};
  const items = Array.isArray(index.items) ? index.items : (Array.isArray(index) ? index : []);
  const found = items.find((item) => String(item.id || item.detailId || "") === detailId);
  if (!found) {
    return { success: false, code: "SCHEDULE_TARGET_NOT_FOUND", summary: "目标班级不在当前课表索引中" };
  }
  return {
    success: true,
    actionRequired: "setCurrentSchedule",
    explicitCommand: input.explicitCommand === true,
    target: {
      type: "class",
      detailId,
      name: String(found.name || found.className || name),
      term: found.semester || input.term || context.term || "",
      releaseVersion: index.releaseVersion || input.releaseVersion || context.releaseVersion || "",
    },
    summary: `已确认目标班级：${found.name || found.className || name}`,
  };
}

function listToolNames() {
  return Object.keys(TOOL_HANDLERS);
}

function executeTool(name, input = {}, context = {}) {
  const tool = TOOL_HANDLERS[name];
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
  const tool = TOOL_HANDLERS[name];
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
  if (name === "get_today_schedule") return result.needContext ? "需要当前课表上下文" : `今日课程 ${result.courseCount || 0} 门`;
  if (name === "get_tomorrow_courses") return result.needContext ? "需要当前课表上下文" : `明日课程 ${result.courseCount || 0} 门`;
  if (name === "get_next_course") return result.nextCourse ? "已找到下一节课" : "没有后续课程";
  if (name === "get_week_schedule") return result.needContext ? "需要当前课表上下文" : `本周课程 ${result.courseCount || 0} 节`;
  if (name === "get_teaching_week") return result.summary || "已查询教学周";
  if (name === "get_term_calendar") return result.summary || "已查询校历";
  if (name === "search_school_index") return `${result.type || "index"} 命中 ${result.total || 0} 项`;
  if (name === "diagnose_data_status") return `Release ${result.activeReleaseVersion || "未发布"}`;
  if (name === "recommend_meeting_time") return result.summary || "已计算候选时间";
  if (name === "create_course_reminder") return result.summary || "已生成待确认提醒计划";
  if (name === "update_course_reminder") return result.summary || "已生成待确认提醒修改";
  if (name === "delete_course_reminder") return result.summary || "已生成待确认提醒删除";
  if (name === "list_course_reminders") return `课程提醒 ${asArray(result.items).length} 个`;
  if (name === "get_course_route") return result.summary || "已生成出发建议";
  if (name === "inspect_schedule_conflicts") return result.summary || "已检查课表冲突";
  if (name === "detect_schedule_changes") return result.summary || "已检测课表变化";
  if (name === "navigate_miniprogram_page") return result.summary || "已校验页面入口";
  if (name === "explain_personal_import") return "已返回导入指引";
  if (name === "clarify_missing_slot") return "缺少必要关键词";
  if (name === "set_current_schedule") return result.summary || "已确认课表目标";
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
  if (items.length !== 1) return false;
  // 权威 preferredId 命中：直接信任唯一候选
  if (result.preferredId && String(items[0].id || items[0].detailId || "") === String(result.preferredId)) {
    return true;
  }
  const q = normalizeComparable(result.q);
  if (!q) return false;
  const itemName = normalizeComparable(getItemComparableName(items[0], result.type));
  return itemName === q || q.length >= 2;
}

// 执行层硬性要求已认证 Principal 的工具（createCourseReminder 的 PRINCIPAL_REQUIRED
// 与 courseReminderService / userPreferenceService 的 assertPrincipal）。
// 计划期仅在调用方显式携带 context.principal 时按此收窄；未携带时维持
// 执行层鉴权语义（登录/确认 UX 由工具结果驱动），不在这里推断缺省身份。
const PRINCIPAL_REQUIRED_TOOLS = new Set([
  "create_course_reminder",
  "update_course_reminder",
  "delete_course_reminder",
  "list_course_reminders",
  "update_user_preference",
]);

/**
 * M6-T1：意图→工具映射单源化。规划候选工具集 = Intent ∩ Skill ∩ Runtime ∩ Principal ∩ Environment，
 * 五因子全部求交集（只收不放的收窄语义），不以并集放宽：
 * - Intent：capability manifest 的 intent.allowedTools（唯一映射权威源，manifest 本体只读）；
 * - Skill：manifest 中 intent.skill 指向 skill 的 allowedTools；
 * - Runtime：TOOL_HANDLERS 内真实注册可执行；
 * - Principal：context.principal 显式存在且未认证时，剔除执行需认证 Principal 的工具；
 * - Environment：context.runtimeMode 对应的工具 runtimeModes 政策（缺省 public，最严口径）。
 * 交集为空返回 []，调用方按空计划回退（与原实现对 generic/无工具意图的空计划语义一致）。
 */
function resolveManifestAllowedTools(intent, context = {}) {
  const manifestIntent = capabilityManifestService.getIntent(intent && intent.name);
  if (!manifestIntent || !Array.isArray(manifestIntent.allowedTools) || !manifestIntent.allowedTools.length) {
    return [];
  }
  const manifestSkill = capabilityManifestService.getManifest().skills[manifestIntent.skill];
  const skillTools = new Set((manifestSkill && Array.isArray(manifestSkill.allowedTools)) ? manifestSkill.allowedTools : []);
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(
    context.runtimeMode || context.assistantEnvironment || "public"
  );
  const principal = context.principal && typeof context.principal === "object" ? context.principal : null;
  const principalRestricted = Boolean(principal) && principal.authenticated !== true;
  return manifestIntent.allowedTools
    .map((toolName) => String(toolName))
    .filter((toolName) => {
      if (!skillTools.has(toolName)) return false;
      if (!Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, toolName)) return false;
      if (!capabilityManifestService.isToolAllowedForRuntime(toolName, runtimeMode)) return false;
      if (principalRestricted && PRINCIPAL_REQUIRED_TOOLS.has(toolName)) return false;
      return true;
    });
}

function buildPlanForIntent(intent, message, context = {}) {
  const slots = Object.assign({}, intent && intent.slots || {}, {
    message,
    term: context.term,
    releaseVersion: context.releaseVersion,
  });
  // 候选工具集唯一来源：capability manifest 五因子交集；以下分支只做
  // 消息/槽位驱动的步骤编排，任何步骤都不会超出该交集。
  const allowed = resolveManifestAllowedTools(intent, context);
  if (!allowed.length) return [];
  const has = (toolName) => allowed.includes(toolName);
  const intentName = intent && intent.name || "";

  if (intentName === "campus_multi_step_advice") {
    const preferTomorrow = /明天|明日/.test(message);
    const scheduleTool = (preferTomorrow
      ? ["get_tomorrow_courses", "get_today_courses"]
      : ["get_today_courses", "get_tomorrow_courses"]).find(has);
    const steps = [];
    if (scheduleTool) {
      steps.push(agentProtocol.buildPlanStep(scheduleTool, slots, scheduleTool === "get_tomorrow_courses" ? "读取明日个人课程" : "读取今日个人课程"));
    }
    if (has("search_empty_rooms")) {
      steps.push(agentProtocol.buildPlanStep("search_empty_rooms", slots, "查询空闲节次对应空教室"));
    }
    if (has("get_campus_weather") && /天气|下雨|降雨|带伞|高温|雷暴/.test(message)) {
      steps.push(agentProtocol.buildPlanStep("get_campus_weather", slots, "查询校区天气"));
    }
    if (has("search_campus_place") && (/附近|位置|地点|路线|哪里/.test(message) || slots.building)) {
      steps.push(agentProtocol.buildPlanStep("search_campus_place", { q: slots.building || slots.campus || "C7", message }, "补充地点信息"));
    }
    return steps;
  }
  if (intentName === "next_course_location") {
    const steps = [];
    if (has("get_next_course")) {
      steps.push(agentProtocol.buildPlanStep("get_next_course", slots, "读取下一节课程"));
    }
    if (has("get_classroom_location")) {
      steps.push(agentProtocol.buildPlanStep("get_classroom_location", { message }, "查询教室楼栋位置"));
    }
    return steps;
  }
  if (intentName === "update_user_preference") {
    return has("update_user_preference")
      ? [agentProtocol.buildPlanStep("update_user_preference", Object.assign({}, slots, { message }), "更新用户提醒/称呼偏好")]
      : [];
  }
  if (intentName === "manage_course_reminders") {
    // 槽位 operation 在 manifest 允许集内分派具体提醒工具；目标工具被交集剔除时不做替代放大。
    const operation = intent.slots && intent.slots.operation || "create";
    const toolName = operation === "list"
      ? "list_course_reminders"
      : (operation === "delete" ? "delete_course_reminder"
        : (operation === "update" ? "update_course_reminder" : "create_course_reminder"));
    return has(toolName)
      ? [agentProtocol.buildPlanStep(toolName, slots, operation === "list" ? "读取课程提醒" : "生成待确认提醒操作")]
      : [];
  }
  if (intentName === "course_action_advice") {
    const tomorrow = intent.slots && intent.slots.dateHint === "tomorrow" || /明天/.test(message);
    const courseTool = (tomorrow
      ? ["get_tomorrow_courses", "get_next_course"]
      : ["get_next_course", "get_tomorrow_courses"]).find(has);
    const steps = [];
    if (courseTool) {
      steps.push(agentProtocol.buildPlanStep(courseTool, slots, courseTool === "get_tomorrow_courses" ? "读取明日课程" : "读取下一节课程"));
    }
    if (has("get_course_route")) {
      steps.push(agentProtocol.buildPlanStep("get_course_route", slots, "定位课程并计算带假设的出发缓冲"));
    }
    if (has("get_course_weather_advice") && (intent.slots && intent.slots.wantsWeather || /天气|下雨|降雨|带伞/.test(message))) {
      steps.push(agentProtocol.buildPlanStep("get_course_weather_advice", slots, "查询校区天气并调整出发建议"));
    }
    if (has("navigate_miniprogram_page")) {
      steps.push(agentProtocol.buildPlanStep("navigate_miniprogram_page", {
        url: "/packageMaps/pages/campus-map/campus-map",
      }, "校验校园地图入口"));
    }
    return steps;
  }
  if (intentName === "inspect_schedule_health") {
    return has("inspect_schedule_conflicts")
      ? [agentProtocol.buildPlanStep("inspect_schedule_conflicts", slots, "检查课表冲突与异常")]
      : [];
  }
  if (intentName === "detect_schedule_changes") {
    return has("detect_schedule_changes")
      ? [agentProtocol.buildPlanStep("detect_schedule_changes", slots, "对比受控个人课表摘要")]
      : [];
  }
  if (intentName === "clarify_missing_slot") {
    return has("clarify_missing_slot")
      ? [agentProtocol.buildPlanStep("clarify_missing_slot", slots, "补全缺失槽位")]
      : [];
  }
  // 单工具意图：取交集首个工具（manifest allowedTools 以主工具在前排序）。
  return [agentProtocol.buildPlanStep(allowed[0], slots, "执行权威工具")];
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
  listToolNames,
  parseClientDate,
  resolveIntent,
  buildPlanForIntent,
  runToolChainForIntent,
  runToolChainForIntentAsync,
  runToolsForIntent,
  goalParser,
  classAliasResolver,
  buildSetCurrentScheduleIntent,
  buildOpenScheduleIntent,
  isHighConfidenceIndexHit,
  stripPersonHonorifics,
};
