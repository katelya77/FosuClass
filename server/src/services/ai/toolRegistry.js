const releaseService = require("../releaseService");
const { sanitizeToolResult } = require("./safetyGuard");
const {
  getCourseTimeRange,
  getCourseTimeStatus,
  getCourseWeekStatus,
  getCurrentSection: getCurrentSectionByTime,
  resolveCurrentTeachingWeek,
} = require("../../shared/courseWeekRules");

const MAX_SECTION = 14;
const DEFAULT_TERM = "2025-2026-2";

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
  const match = text.match(/\b([ABC]\d{1,2})\b/i);
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

function isProjectQaMessage(text) {
  const value = normalizeText(text);
  if (!value) return false;
  return /你是谁|你能做什么|这个小程序怎么用|怎么使用|怎么同步新学期课表|新学期.*同步|为什么要\s*XLS\s*导入|FosuClass|佛课小表|小佛.*项目|了解当前项目|解释.*功能|比赛.*展示|AI\s*管家架构|AI管家架构|项目知识|Release Pack|XLS-only/i.test(value);
}

function isConversationalHelp(text) {
  const value = normalizeText(text).replace(/\s+/g, "");
  if (!value) return false;
  if (/今天|今日|明天|还有课|下一节|空教室|老师|教师|教室|课室|课程|班级|查课|课表|诊断|缓存|加载失败|数据失败/.test(value)) {
    return false;
  }
  return /你好|您好|嗨|hello|hi|谢谢|感谢|帮我解释|怎么做|如何做|为什么|介绍一下/.test(value);
}

function resolveIntent(message, context = {}) {
  const text = normalizeText(message);
  if (isProjectQaMessage(text)) {
    return { name: "project_qa", slots: {} };
  }
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
      summary: "未收到当前课表摘要，需要先绑定班级课表或导入 XLS 个人课表。",
      actionUrl: "/pages/personal-sync/personal-sync?tab=xls",
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

function searchEmptyRooms(input = {}, context = {}) {
  const message = input.message || "";
  const date = input.date || inferTargetDate(message, context);
  const sections = input.sections || inferSections(message, context);
  const building = input.building || extractBuilding(message);
  const minFreeSections = Math.max(1, Number(input.minFreeSections || (/连续/.test(message) ? parseChineseNumber(message, 2) : 1)) || 1);
  const query = {
    term: input.term || context.term || DEFAULT_TERM,
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
  const result = releaseService.searchActiveIndex(type, query, {
    term: input.term || context.term || DEFAULT_TERM,
    semester: input.term || context.term || DEFAULT_TERM,
    releaseVersion: input.releaseVersion || context.releaseVersion || "",
    limit: input.limit || 8,
  });
  return {
    success: Boolean(result.success),
    type,
    q: query,
    items: asArray(result.items).slice(0, Number(input.limit || 8) || 8),
    total: Number(result.total || asArray(result.items).length) || 0,
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
  const courses = asArray(result.schedule && result.schedule.courses);
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
    term: active.term || active.semester || context.term || DEFAULT_TERM,
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

function explainPersonalImport(input = {}) {
  const mode = input.mode || "unknown";
  return {
    success: true,
    mode,
    title: "个人课表 XLS 导入说明",
    steps: [
      "只保留 XLS 文件导入方案，AI 和小程序聊天框都不接收学号、密码、Cookie 或 token。",
      "从 100 网打印/导出的 XLS 课表会自动解析表头中的学期、班级、学院、打印日期和课程列。",
      "导入后写入本机当前课表缓存，AI 仅在你开启摘要时读取课程名、教师、教室、星期、节次和教学周。",
      "新学期或新版课表重新导入即可刷新本地课程索引，今日安排、空闲时间推荐和后端工具链会自动使用最新课表摘要。",
    ],
    actionUrl: "/pages/personal-sync/personal-sync?tab=xls",
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
      actionUrl: "/pages/personal-sync/personal-sync?tab=xls",
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

function executeTool(name, input = {}, context = {}) {
  const tools = {
    get_today_courses: getTodayCourses,
    search_empty_rooms: searchEmptyRooms,
    search_school_index: searchSchoolIndex,
    get_schedule_detail: getScheduleDetail,
    diagnose_data_status: diagnoseDataStatus,
    explain_personal_import: explainPersonalImport,
    recommend_meeting_time: recommendMeetingTime,
    clarify_missing_slot: clarifyMissingSlot,
  };
  const tool = tools[name];
  if (!tool) {
    return { success: false, code: "TOOL_NOT_FOUND" };
  }
  try {
    return sanitizeToolResult(tool(Object.assign({}, input, { message: input.message || "" }), context));
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
  if (name === "get_today_courses") return result.needContext ? "需要当前课表上下文" : `今日课程 ${result.courseCount || 0} 门`;
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

function runToolsForIntent(intent, message, context) {
  if (!intent || intent.name === "generic" || intent.name === "project_qa" || intent.name === "conversational_help") return [];
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

  if (intent.name === "search_empty_rooms") {
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

module.exports = {
  executeTool,
  courseAppliesToWeek,
  getCurrentSection,
  getCourseTimeStatus,
  inferSections,
  inferTargetDate,
  parseClientDate,
  resolveIntent,
  runToolChainForIntent,
  runToolsForIntent,
};
