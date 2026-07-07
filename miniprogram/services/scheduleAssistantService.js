const releasePackService = require("./releasePackService");
const scheduleIntentParser = require("./scheduleIntentParser");
const scheduleAliasMap = require("./scheduleAliasMap");
const scheduleNavigator = require("./scheduleNavigator");
const contextManager = require("./xiaofuContextManager");
const { normalizeCourse } = require("../utils/course");
const { isCourseInWeek } = require("../utils/week");

const UNKNOWN_CLASS_ALIAS_MESSAGE = "暂时无法确认该缩写对应的完整班级，请输入完整专业班级名称后再查。";

function safeText(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.slice(0, maxLength || 200);
}

function getConversationContextSlots(clientContext) {
  const source = clientContext || {};
  return source.contextSlots ||
    source.conversation && source.conversation.contextSlots ||
    {};
}

function normalizeScheduleType(type) {
  const value = String(type || "").trim();
  if (value === "room") return "classroom";
  if (value === "classroom") return "classroom";
  if (value === "teacher") return "teacher";
  if (value === "course") return "course";
  return "class";
}

function getContextType(type) {
  return normalizeScheduleType(type) === "classroom" ? "room" : normalizeScheduleType(type);
}

function getTypeTitle(type) {
  switch (normalizeScheduleType(type)) {
    case "teacher": return "教师课表";
    case "classroom": return "教室课表";
    case "course": return "课程课表";
    case "class":
    default:
      return "班级课表";
  }
}

function getTypeLabel(type) {
  switch (normalizeScheduleType(type)) {
    case "teacher": return "教师";
    case "classroom": return "教室";
    case "course": return "课程";
    case "class":
    default:
      return "班级";
  }
}

function getItemDisplayName(type, item) {
  const source = item || {};
  const keysByType = {
    class: ["className", "name", "displayName", "title", "rawName", "searchableName"],
    teacher: ["teacherName", "displayTeacherName", "canonicalTeacherName", "name", "displayName", "title"],
    classroom: ["roomName", "classroomName", "displayName", "name", "title", "rawName"],
    course: ["courseName", "displayCourseName", "canonicalCourseName", "name", "displayName", "title"],
  };
  const keys = keysByType[normalizeScheduleType(type)] || keysByType.class;
  for (let index = 0; index < keys.length; index += 1) {
    const value = safeText(source[keys[index]], 120);
    if (value) return value;
  }
  return safeText(source.id || source.detailId, 120);
}

function getItemDetailId(item) {
  const source = item || {};
  return safeText(source.detailId || source.id || source.classId || source.teacherId || source.classroomId || source.roomId || source.courseId, 160);
}

function getComparableNames(type, item) {
  const source = item || {};
  return [
    getItemDisplayName(type, item),
    source.id,
    source.detailId,
    source.name,
    source.displayName,
    source.title,
    source.className,
    source.teacherName,
    source.roomName,
    source.classroomName,
    source.courseName,
    source.displayCourseName,
    source.canonicalCourseName,
  ].map((value) => safeText(value, 120)).filter(Boolean);
}

function pickBestItem(type, items, keyword) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { status: "not_found", candidates: [] };
  const q = scheduleAliasMap.normalizeSearchText(keyword);
  const exact = list.filter((item) => getComparableNames(type, item).some((name) => scheduleAliasMap.normalizeSearchText(name) === q));
  if (exact.length === 1) return { status: "matched", item: exact[0], candidates: exact };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact.slice(0, 6) };
  if (list.length === 1) return { status: "matched", item: list[0], candidates: list };
  return { status: "ambiguous", candidates: list.slice(0, 6) };
}

function resolveReleaseParams(clientContext) {
  const source = clientContext || {};
  let term = source.term || source.selectedTerm || source.activeTerm || releasePackService.DEFAULT_TERM || "";
  let releaseVersion = source.releaseVersion || source.version || "";
  const localActive = releasePackService.getLocalActiveRelease(term || releasePackService.DEFAULT_TERM);
  if (localActive) {
    term = term || localActive.term || "";
    releaseVersion = releaseVersion || localActive.releaseVersion || "";
  }
  return {
    term,
    releaseVersion,
  };
}

function loadIndex(type, releaseParams) {
  return releasePackService.loadIndex(type, {
    term: releaseParams.term,
    releaseVersion: releaseParams.releaseVersion,
  }, {
    forceNetwork: false,
    timeout: 8000,
    retries: 0,
  });
}

function searchIndex(type, keyword, releaseParams) {
  return releasePackService.searchIndex(type, {
    q: keyword,
    keyword,
    term: releaseParams.term,
    releaseVersion: releaseParams.releaseVersion,
    limit: 8,
  }, {
    forceNetwork: false,
    timeout: 8000,
    retries: 0,
  });
}

function loadDetail(type, item, name, releaseParams) {
  const detailId = getItemDetailId(item) || name;
  if (type === "classroom") {
    return releasePackService.resolveClassroomDetail(name, {
      term: releaseParams.term,
      releaseVersion: releaseParams.releaseVersion,
      detailId,
    }, {
      forceNetwork: false,
      timeout: 8000,
      retries: 0,
    });
  }
  return releasePackService.loadDetail(type, detailId, {
    term: releaseParams.term,
    releaseVersion: releaseParams.releaseVersion,
  }, {
    forceNetwork: false,
    timeout: 8000,
    retries: 0,
  });
}

function extractCourses(detailPayload) {
  const source = detailPayload || {};
  const schedule = source.detail || source.schedule || source;
  if (Array.isArray(schedule.courses)) return schedule.courses;
  if (Array.isArray(source.courses)) return source.courses;
  if (Array.isArray(schedule.items)) return schedule.items;
  return [];
}

function normalizeCourseSafe(course) {
  try {
    return normalizeCourse(course || {});
  } catch (error) {
    return Object.assign({}, course || {}, {
      courseName: safeText(course && (course.courseName || course.name), 80),
      teacherName: safeText(course && (course.teacherName || course.teacher), 80),
      classroom: safeText(course && (course.classroom || course.roomName || course.classroomName), 80),
      weekday: Number(course && (course.weekday || course.weekDay)) || 0,
      startSection: Number(course && (course.startSection || course.sectionStart)) || 0,
      endSection: Number(course && (course.endSection || course.sectionEnd || course.startSection || course.sectionStart)) || 0,
    });
  }
}

function getWeekday(course) {
  return Number(course && (course.weekday || course.weekDay)) || 0;
}

function isActiveInWeek(course, week) {
  const targetWeek = Number(week);
  if (!Number.isFinite(targetWeek) || targetWeek <= 0) return true;
  try {
    return isCourseInWeek(course || {}, targetWeek);
  } catch (error) {
    const weeks = course && course.weeks;
    if (Array.isArray(weeks)) return weeks.map(Number).indexOf(targetWeek) >= 0;
    const start = Number(course && course.startWeek);
    const end = Number(course && course.endWeek);
    if (Number.isFinite(start) && Number.isFinite(end)) return targetWeek >= start && targetWeek <= end;
    return true;
  }
}

function filterCourses(courses, parsed) {
  const week = Number(parsed && parsed.week);
  const weekday = Number(parsed && parsed.weekday);
  return (Array.isArray(courses) ? courses : [])
    .map(normalizeCourseSafe)
    .filter((course) => isActiveInWeek(course, week))
    .filter((course) => !Number.isFinite(weekday) || weekday <= 0 || getWeekday(course) === weekday)
    .sort((left, right) => {
      const leftDay = getWeekday(left);
      const rightDay = getWeekday(right);
      if (leftDay !== rightDay) return leftDay - rightDay;
      const leftSection = Number(left.startSection || 0);
      const rightSection = Number(right.startSection || 0);
      if (leftSection !== rightSection) return leftSection - rightSection;
      return safeText(left.courseName).localeCompare(safeText(right.courseName));
    });
}

function sectionText(course) {
  const start = Number(course && course.startSection);
  const end = Number(course && course.endSection) || start;
  if (!Number.isFinite(start) || start <= 0) return "";
  return start === end ? `第${start}节` : `第${start}-${end}节`;
}

function courseName(course) {
  return safeText(course && (course.displayCourseName || course.canonicalCourseName || course.courseName || course.name), 80);
}

function courseTeacher(course) {
  return safeText(course && (course.displayTeacherName || course.canonicalTeacherName || course.teacherName || course.teacher), 80);
}

function courseRoom(course) {
  return safeText(course && (course.displayClassroom || course.canonicalClassroom || course.classroom || course.roomName || course.classroomName), 80);
}

function courseWeekText(course) {
  return safeText(course && (course.weekText || course.weeksText || course.rawWeek || course.rawWeeks), 80);
}

function buildCourseItem(course) {
  const weekdayLabel = scheduleIntentParser.getWeekdayLabel(getWeekday(course));
  const title = [weekdayLabel, sectionText(course), courseName(course)].filter(Boolean).join(" ");
  const subtitle = [
    courseTeacher(course),
    courseRoom(course),
    courseWeekText(course),
  ].filter(Boolean).join(" / ");
  return {
    title: title || courseName(course) || "课程",
    subtitle,
    value: sectionText(course),
  };
}

function buildCandidateResponse(parsed, candidates, releaseParams, reason) {
  const type = normalizeScheduleType(parsed.targetType);
  const items = (Array.isArray(candidates) ? candidates : []).slice(0, 6).map((item) => ({
    title: getItemDisplayName(type, item),
    subtitle: [getTypeLabel(type), item.collegeName || item.majorName || item.campus || ""].filter(Boolean).join(" / "),
    value: Number(item.courseCount || 0) ? `${Number(item.courseCount)}门课` : "",
  }));
  const keyword = parsed.targetName || parsed.rawTargetName || "";
  return {
    answer: reason === "ambiguous"
      ? `找到多个可能的${getTypeLabel(type)}，请点候选项或补充更完整的名称。`
      : `暂未在全校课表索引中找到“${keyword}”，不会编造不存在的课表对象。`,
    cards: [
      {
        type: reason === "ambiguous" ? "clarification" : "not_found",
        title: reason === "ambiguous" ? "请选择课表对象" : "未找到课表对象",
        subtitle: keyword,
        badges: [getTypeLabel(type), reason === "ambiguous" ? "多候选" : "未命中"],
        items,
        actions: reason === "ambiguous" ? [] : [
          {
            label: "打开全校课表筛选",
            type: "navigate",
            url: scheduleNavigator.buildSchoolUrl({
              type,
              keyword,
              term: releaseParams.term,
              releaseVersion: releaseParams.releaseVersion,
              week: parsed.week,
              weekday: parsed.weekday,
            }),
          },
        ],
      },
    ],
    suggestions: items.slice(0, 3).map((item) => `查看${item.title}课表`),
    toolCalls: [{ name: "search_school_schedule_local", status: reason === "ambiguous" ? "success" : "not_found" }],
    evidence: {
      verified: false,
      term: releaseParams.term,
      releaseVersion: releaseParams.releaseVersion,
      checkedAt: new Date().toISOString(),
    },
    safety: {
      provider: "local-schedule",
      resolvedProvider: "local-schedule",
      externalProviderUsed: false,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "school_schedule_query",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: items.length,
    },
  };
}

function buildUnknownAliasResponse(parsed) {
  return {
    answer: UNKNOWN_CLASS_ALIAS_MESSAGE,
    cards: [
      {
        type: "clarification",
        variant: "error",
        title: "班级缩写无法确认",
        subtitle: parsed.rawTargetName || parsed.targetName || "",
        badges: ["班级", "需要完整名称"],
        items: [
          {
            title: "示例",
            subtitle: "请填写完整年级、专业和班级名称",
            value: "",
          },
        ],
        actions: [],
      },
    ],
    suggestions: ["查班级本周课表", "输入完整班级名称"],
    toolCalls: [{ name: "search_school_schedule_local", status: "not_found" }],
    evidence: {
      verified: false,
      checkedAt: new Date().toISOString(),
    },
    safety: {
      provider: "local-schedule",
      resolvedProvider: "local-schedule",
      externalProviderUsed: false,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "school_schedule_query",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: 0,
    },
  };
}

function buildClarificationResponse(parsed) {
  const type = parsed && parsed.targetType ? normalizeScheduleType(parsed.targetType) : "";
  const textByType = {
    class: {
      answer: "我理解你想查班级课表，还需要补充班级名称。",
      title: "需要补充班级",
      subtitle: "请输入完整班级名称",
      itemTitle: "班级名称",
      itemSubtitle: "建议包含年级、专业和班级号",
      suggestions: ["输入班级名称", "查教师课表", "查教室明天是否有课"],
    },
    teacher: {
      answer: "我理解你想查教师课表，还需要补充教师姓名。",
      title: "需要补充教师",
      subtitle: "请输入教师姓名",
      itemTitle: "教师姓名",
      itemSubtitle: "输入任课教师姓名后再查",
      suggestions: ["输入教师姓名", "查班级本周课表", "查课程安排"],
    },
    classroom: {
      answer: "我理解你想查教室占用，还需要补充教室或楼栋。",
      title: "需要补充教室",
      subtitle: "请输入校区、楼栋或教室号",
      itemTitle: "教室或楼栋",
      itemSubtitle: "例如输入楼栋和教室号会更准确",
      suggestions: ["输入教室号", "查班级本周课表", "查教师课表"],
    },
    course: {
      answer: "我理解你想查课程安排，还需要补充课程名称。",
      title: "需要补充课程",
      subtitle: "请输入课程名称",
      itemTitle: "课程名称",
      itemSubtitle: "输入完整课程名会更准确",
      suggestions: ["输入课程名称", "查教师课表", "查班级本周课表"],
    },
  };
  const text = textByType[type] || {
    answer: "我理解你想查课表，但还缺少查询对象。你想查哪个班级、老师、教室或课程？",
    title: "需要补充课表对象",
    subtitle: "支持班级、教师、教室、课程",
    itemTitle: "查询对象",
    itemSubtitle: "选择班级、教师、教室或课程后再查",
    suggestions: ["查班级本周课表", "查教师课表", "查教室明天是否有课"],
  };
  return {
    answer: text.answer,
    cards: [
      {
        type: "clarification",
        title: text.title,
        subtitle: text.subtitle,
        badges: ["全校课表"],
        items: [
          { title: text.itemTitle, subtitle: text.itemSubtitle, value: "" },
          { title: "也可以查", subtitle: "班级、教师、教室或课程安排", value: "" },
        ],
        actions: [],
      },
    ],
    suggestions: text.suggestions,
    toolCalls: [{ name: "search_school_schedule_local", status: "clarify" }],
    safety: {
      provider: "local-schedule",
      resolvedProvider: "local-schedule",
      externalProviderUsed: false,
      mode: "tool-grounded",
    },
    metrics: {
      intentName: "school_schedule_query",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: 0,
    },
  };
}

function buildScheduleResponse(parsed, target, detailPayload, releaseParams, startedAt, previousContext) {
  const type = normalizeScheduleType(parsed.targetType);
  const courses = extractCourses(detailPayload);
  const filteredCourses = filterCourses(courses, parsed);
  const subtitle = scheduleIntentParser.getTimeSubtitle(parsed, releaseParams.currentTeachingWeek);
  const title = type === "class"
    ? `${target.name}课表`
    : `${target.name}${getTypeTitle(type)}`;
  const courseItems = filteredCourses.length
    ? filteredCourses.slice(0, 8).map(buildCourseItem)
    : [
        {
          title: "该时间暂无课程安排",
          subtitle: "可查看完整课表确认其他周次或日期",
          value: "无课",
        },
      ];
  const scheduleUrlParams = {
    type,
    id: target.detailId,
    name: target.name,
    keyword: target.name,
    term: releaseParams.term,
    releaseVersion: releaseParams.releaseVersion,
    week: parsed.week,
    weekday: parsed.weekday,
  };
  const followupWeek = Number(parsed.week || releaseParams.currentTeachingWeek || 0);
  const nextWeekText = followupWeek ? `第${Math.max(1, followupWeek + 1)}周` : "其他周次";
  const card = {
    type: "schedule_result",
    title,
    subtitle,
    badges: [
      getTypeLabel(type),
      subtitle,
      releaseParams.term,
    ].filter(Boolean),
    items: courseItems,
    actions: [
      {
        label: "查看完整课表",
        type: "navigate",
        url: scheduleNavigator.buildScheduleViewUrl(scheduleUrlParams),
      },
      {
        label: parsed.weekday ? "继续查其他星期" : "继续查其他周次",
        type: "ask",
        payload: {
          message: parsed.weekday ? `${target.name}看全周课表` : `${target.name}${nextWeekText}课表`,
        },
      },
      {
        label: "打开全校课表",
        type: "navigate",
        url: scheduleNavigator.buildSchoolUrl(scheduleUrlParams),
      },
    ],
  };
  const answer = filteredCourses.length
    ? `已为你查询 ${target.name} ${subtitle}课表。`
    : `已为你查询 ${target.name} ${subtitle}课表，该时间暂无课程安排。`;
  const primaryCourse = filteredCourses[0] || null;
  const contextPatch = contextManager.buildSchedulePatch(parsed, {
    targetType: getContextType(type),
    targetName: target.name,
    week: parsed.week,
    weekday: parsed.weekday,
    title,
    total: filteredCourses.length,
    noCourse: filteredCourses.length === 0,
    source: "school-schedule-index",
    lastQueryResult: {
      title,
      total: filteredCourses.length,
      noCourse: filteredCourses.length === 0,
      detailId: target.detailId,
      term: releaseParams.term,
      releaseVersion: releaseParams.releaseVersion,
      primaryClassroom: primaryCourse ? courseRoom(primaryCourse) : "",
      primaryCourseName: primaryCourse ? courseName(primaryCourse) : "",
    },
  });
  return {
    answer,
    cards: [card],
    suggestions: [
      parsed.weekday ? "看全周课表" : "那周三呢",
      parsed.week ? "换成另一个班级" : "第16周呢",
      "打开全校课表",
    ].slice(0, 3),
    toolCalls: [
      {
        name: "search_school_schedule_local",
        status: "success",
      },
      {
        name: "get_schedule_detail",
        status: "success",
      },
    ],
    taskSteps: [],
    evidence: {
      verified: true,
      term: releaseParams.term,
      releaseVersion: releaseParams.releaseVersion,
      currentWeek: releaseParams.currentTeachingWeek || "",
      checkedAt: new Date().toISOString(),
      source: "school-schedule-index",
      resultCount: filteredCourses.length,
    },
    safety: {
      provider: "local-schedule",
      resolvedProvider: "local-schedule",
      externalProviderUsed: false,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "school_schedule_query",
      latencyMs: Date.now() - startedAt,
      externalProviderUsed: false,
      resultCount: filteredCourses.length,
    },
    parsedIntent: parsed,
    contextSlots: contextManager.mergeContextSlots(previousContext, contextPatch),
  };
}

function buildErrorResponse(parsed, releaseParams, error) {
  return {
    answer: "全校课表索引暂时不可用，已保留你的查询。你可以稍后重试，或直接跳转到全校课表页面查看。",
    cards: [
      {
        type: "schedule_result",
        variant: "error",
        title: "课表索引暂时不可用",
        subtitle: parsed && (parsed.targetName || parsed.rawTargetName) || "",
        badges: ["全校课表", "稍后重试"],
        items: [
          {
            title: "错误信息",
            subtitle: safeText(error && (error.code || error.message || error.errMsg), 120),
            value: "",
          },
        ],
        actions: [
          {
            label: "跳转到全校课表",
            type: "navigate",
            url: scheduleNavigator.buildSchoolUrl({
              type: parsed && parsed.targetType || "class",
              keyword: parsed && (parsed.targetName || parsed.rawTargetName) || "",
              term: releaseParams.term,
              releaseVersion: releaseParams.releaseVersion,
              week: parsed && parsed.week,
              weekday: parsed && parsed.weekday,
            }),
          },
        ],
      },
    ],
    suggestions: ["重新查询", "查班级本周课表", "打开全校课表"],
    toolCalls: [{ name: "search_school_schedule_local", status: "failed" }],
    evidence: {
      verified: false,
      term: releaseParams.term,
      releaseVersion: releaseParams.releaseVersion,
      checkedAt: new Date().toISOString(),
    },
    safety: {
      provider: "local-schedule",
      resolvedProvider: "local-schedule",
      externalProviderUsed: false,
      mode: "fallback",
      fallbackReason: safeText(error && (error.code || error.message || error.errMsg), 120),
    },
    metrics: {
      intentName: "school_schedule_query",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: 0,
    },
  };
}

async function resolveTarget(parsed, releaseParams) {
  const type = normalizeScheduleType(parsed.targetType);
  const keyword = safeText(parsed.targetName || parsed.rawTargetName, 120);
  if (!keyword) return { status: "missing", type, keyword };

  if (type === "class") {
    const index = await loadIndex("class", releaseParams);
    const aliasResult = scheduleAliasMap.resolveClassAlias(keyword, index.items || []);
    if (aliasResult.status !== "matched") {
      return Object.assign({ type, keyword, index }, aliasResult);
    }
    return {
      status: "matched",
      type,
      keyword,
      item: aliasResult.item,
      name: aliasResult.normalizedName,
      detailId: getItemDetailId(aliasResult.item) || aliasResult.normalizedName,
      aliasMatched: aliasResult.aliasMatched === true,
    };
  }

  const searchResult = await searchIndex(type, keyword, releaseParams);
  const picked = pickBestItem(type, searchResult.items || [], keyword);
  if (picked.status !== "matched") {
    return Object.assign({ type, keyword, index: searchResult }, picked);
  }
  return {
    status: "matched",
    type,
    keyword,
    item: picked.item,
    name: getItemDisplayName(type, picked.item) || keyword,
    detailId: getItemDetailId(picked.item) || keyword,
  };
}

async function tryHandleScheduleQuery(message, clientContext = {}) {
  const startedAt = Date.now();
  const previousContext = getConversationContextSlots(clientContext);
  const parsed = scheduleIntentParser.parseScheduleIntent(message, previousContext, clientContext || {});
  if (!parsed || !parsed.isScheduleIntent) return null;

  if (!parsed.targetType || !parsed.targetName) {
    return buildClarificationResponse(parsed);
  }

  const releaseParams = resolveReleaseParams(clientContext);
  releaseParams.currentTeachingWeek = clientContext.currentTeachingWeek || clientContext.currentWeek || null;

  try {
    const resolved = await resolveTarget(parsed, releaseParams);
    if (resolved.status === "unknown_alias") {
      return buildUnknownAliasResponse(parsed);
    }
    if (resolved.status === "ambiguous") {
      return buildCandidateResponse(parsed, resolved.candidates, releaseParams, "ambiguous");
    }
    if (resolved.status !== "matched") {
      return buildCandidateResponse(parsed, resolved.candidates || [], releaseParams, "not_found");
    }
    parsed.targetType = resolved.type;
    parsed.targetName = resolved.name;
    const detailPayload = await loadDetail(resolved.type, resolved.item, resolved.name, releaseParams);
    return buildScheduleResponse(parsed, resolved, detailPayload, releaseParams, startedAt, previousContext);
  } catch (error) {
    return buildErrorResponse(parsed, releaseParams, error);
  }
}

module.exports = {
  UNKNOWN_CLASS_ALIAS_MESSAGE,
  filterCourses,
  getItemDisplayName,
  tryHandleScheduleQuery,
};
