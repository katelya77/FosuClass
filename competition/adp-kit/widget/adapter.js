"use strict";

const DATA_VERSION = "competition-demo-v1";
const SCHEMA_VERSION = "campus-widget/v2";
const ACTION_TYPES = new Set(["sys.chat", "sys.go_to_url", "sys.download"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compact(values) {
  return values.filter((value) => value !== undefined && value !== null && value !== "");
}

function assertVerifiedEnvelope(envelope) {
  if (!envelope || envelope.success === false) return;
  if (envelope.dataVersion !== DATA_VERSION) {
    throw new Error("Widget adapter rejected unexpected dataVersion");
  }
  if (!envelope.evidence || envelope.evidence.verified !== true) {
    throw new Error("Widget adapter rejected unverified dynamic result");
  }
}

function safeAction(id, label, message, type = "sys.chat") {
  if (!ACTION_TYPES.has(type)) throw new Error(`Unsupported widget action type: ${type}`);
  const action = { id, type, label };
  if (message) action.message = message;
  return action;
}

function deriveTimeText(envelope) {
  if (envelope && envelope.timeText) return envelope.timeText;
  const query = (envelope && envelope.query) || {};
  const weekday = query.weekday ? `周${"一二三四五六日"[Number(query.weekday) - 1] || query.weekday}` : "";
  const period = query.periodStart
    ? `第${query.periodStart}${query.periodEnd && query.periodEnd !== query.periodStart ? `-${query.periodEnd}` : ""}节`
    : "";
  return compact([query.date, query.week ? `第${query.week}周` : "", weekday, period]).join(" · ");
}

function baseViewModel(cardType, envelope, context = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    cardType,
    success: envelope && envelope.success !== false,
    queryId: (envelope && envelope.queryId) || "",
    dataVersion: (envelope && envelope.dataVersion) || DATA_VERSION,
    title: context.title || (envelope && envelope.title) || "",
    subtitle: context.subtitle || "",
    timeText: context.timeText || deriveTimeText(envelope),
    filters: [],
    summary: {},
    items: [],
    rushWarnings: [],
    actions: [],
    interaction: { waitForUser: false },
    evidence: {
      verified: Boolean(envelope && envelope.evidence && envelope.evidence.verified === true),
    },
    error: null,
  };
}

function scheduleActions(entity) {
  const name = entity && entity.name ? entity.name : "这个对象";
  const type = entity && entity.type ? entity.type : "";
  const actions = [
    safeAction("schedule-week", "查看整周", `查看${name}的整周课表`),
    safeAction("schedule-day", "换一天", `换一天看看${name}的课表`),
  ];
  if (type === "room") {
    actions.push(safeAction("schedule-room-free", "查空闲时段", `帮我找${name}的空闲时段`));
  } else {
    actions.push(safeAction("schedule-compare", "比较冲突", `把${name}和另一个对象比较一下有没有冲突`));
  }
  return actions.slice(0, 3);
}

function adaptScheduleResult(envelope, context = {}) {
  assertVerifiedEnvelope(envelope);
  const view = baseViewModel("schedule", envelope, context);
  const entity = envelope.resolvedEntity || {};
  const allItems = asArray(envelope.items);
  view.title = context.title || envelope.title || (entity.name ? `${entity.name} · 课表` : "课表查询结果");
  view.summary = {
    totalCount: allItems.length,
    shownCount: Math.min(allItems.length, 5),
    hiddenCount: Math.max(allItems.length - 5, 0),
    entityType: entity.type || "",
    entityName: entity.name || "",
  };
  view.items = allItems.slice(0, 5).map((item) => ({
    lessonId: item.lessonId || "",
    courseName: item.courseName || "",
    periodText: item.periodText || "",
    startTime: item.startTime || "",
    endTime: item.endTime || "",
    date: item.date || "",
    weekdayName: item.weekdayName || "",
    campusName: item.campusName || "",
    building: item.building || "",
    roomName: item.roomName || "",
    teachers: asArray(item.teachers),
    classes: asArray(item.classes),
  }));
  view.actions = scheduleActions(entity);
  return view;
}

function classroomFilters(envelope, context) {
  const query = Object.assign({}, (envelope && envelope.query) || {}, context.query || {});
  const filters = [];
  if (query.campus) filters.push({ id: "campus", label: query.campus, value: query.campus });
  if (query.date) filters.push({ id: "date", label: query.date, value: query.date });
  else if (query.week) filters.push({ id: "week", label: `第${query.week}周`, value: query.week });
  if (query.periodStart) {
    const periodLabel = `第${query.periodStart}${query.periodEnd && query.periodEnd !== query.periodStart ? `-${query.periodEnd}` : ""}节`;
    filters.push({ id: "period", label: periodLabel, value: periodLabel });
  }
  if (query.building) filters.push({ id: "building", label: query.building, value: query.building });
  if (query.capacity) filters.push({ id: "capacity", label: `容量≥${query.capacity}`, value: query.capacity });
  return filters;
}

function classroomActions(envelope, filters) {
  const query = envelope.query || {};
  const hasCapacity = filters.some((item) => item.id === "capacity");
  const hasBuilding = filters.some((item) => item.id === "building");
  const empty = asArray(envelope.items).length === 0;
  const actions = [];

  if (empty) {
    if (hasCapacity) actions.push(safeAction("classroom-relax-capacity", "放宽容量", "放宽一下容量条件"));
    if (hasBuilding) actions.push(safeAction("classroom-remove-building", "取消楼栋限制", "取消楼栋限制再查一次"));
    actions.push(safeAction("classroom-change-time", "换时段", "我想改一下查询时段"));
    return actions.slice(0, 3);
  }

  const otherCampus = query.campus === "校区A" ? "校区B" : query.campus === "校区B" ? "校区A" : "";
  actions.push(safeAction("classroom-change-campus", "换校区", otherCampus ? `那${otherCampus}呢` : "换个校区看看"));
  actions.push(safeAction("classroom-change-time", "改时段", "我想改一下查询时段"));
  actions.push(hasCapacity
    ? safeAction("classroom-relax-capacity", "放宽容量", "放宽一下容量条件")
    : safeAction("classroom-capacity-60", "容量≥60", "要能坐60人的"));
  return actions.slice(0, 3);
}

function adaptClassroomResult(envelope, context = {}) {
  assertVerifiedEnvelope(envelope);
  const view = baseViewModel("classroom", envelope, context);
  const allItems = asArray(envelope.items);
  view.filters = classroomFilters(envelope, context);
  view.title = context.title || envelope.title || `${(envelope.query && envelope.query.campus) || "校园"} · 空教室`;
  view.summary = {
    totalCount: allItems.length,
    shownCount: Math.min(allItems.length, 5),
    hiddenCount: Math.max(allItems.length - 5, 0),
    empty: allItems.length === 0,
  };
  view.items = allItems.slice(0, 5).map((item) => ({
    roomName: item.roomName || "",
    campusName: item.campusName || "",
    building: item.building || "",
    capacity: Number(item.capacity || 0),
    roomType: item.type || item.roomType || "",
    periodText: item.periodText || "",
    date: item.date || "",
  }));
  view.actions = classroomActions(envelope, view.filters);
  return view;
}

function adaptConflictResult(envelope, context = {}) {
  assertVerifiedEnvelope(envelope);
  const view = baseViewModel("conflict", envelope, context);
  const compared = asArray(envelope.compared);
  const summary = envelope.summary || {};
  const selfCompare = summary.selfCompare === true;
  const firstName = compared[0] && compared[0].name ? compared[0].name : "第一对象";
  const secondName = compared[1] && compared[1].name ? compared[1].name : "第二对象";

  view.title = context.title || (selfCompare
    ? `${firstName} · 课程安排风险检查`
    : `${firstName} vs ${secondName} · 课程冲突比较`);
  view.summary = {
    conflictCount: Number(summary.conflictCount || 0),
    hasConflict: summary.hasConflict === true,
    firstBusySlots: Number(summary.firstBusySlots || 0),
    secondBusySlots: Number(summary.secondBusySlots || 0),
    selfCompare,
    rushWarningCount: Number(summary.rushWarningCount || asArray(envelope.rushWarnings).length || 0),
  };
  view.items = asArray(envelope.items).slice(0, 5).map((item) => ({
    date: item.date || "",
    weekdayName: item.weekdayName || "",
    periodStart: item.periodStart || null,
    periodEnd: item.periodEnd || null,
    periodText: item.periodText || (item.periodStart ? `第${item.periodStart}-${item.periodEnd}节` : ""),
    first: item.first ? {
      courseName: item.first.courseName || "",
      periodText: item.first.periodText || "",
      campusName: item.first.campusName || "",
      roomName: item.first.roomName || "",
    } : null,
    second: item.second ? {
      courseName: item.second.courseName || "",
      periodText: item.second.periodText || "",
      campusName: item.second.campusName || "",
      roomName: item.second.roomName || "",
    } : null,
  }));
  view.rushWarnings = asArray(envelope.rushWarnings).slice(0, 3).map((warning) => ({
    entity: warning.entity || "",
    weekdayName: warning.weekdayName || "",
    gapMinutes: Number(warning.gapMinutes || 0),
    from: warning.from ? {
      courseName: warning.from.courseName || "",
      periodText: warning.from.periodText || "",
      campusName: warning.from.campusName || "",
      roomName: warning.from.roomName || "",
    } : null,
    to: warning.to ? {
      courseName: warning.to.courseName || "",
      periodText: warning.to.periodText || "",
      campusName: warning.to.campusName || "",
      roomName: warning.to.roomName || "",
    } : null,
  }));

  view.actions = selfCompare
    ? [
      safeAction("conflict-self-schedule", "查看当天课表", `查看${firstName}当天的课表`),
      safeAction("conflict-self-week", "检查整周", `检查${firstName}整周的课程安排风险`),
    ]
    : [
      safeAction("conflict-first-schedule", "看第一方课表", `查看${firstName}的课表`),
      safeAction("conflict-second-schedule", "看第二方课表", `查看${secondName}的课表`),
      safeAction("conflict-change-target", "换对象比较", `把${firstName}换一个对象继续比较冲突`),
    ];
  return view;
}

function adaptDayPlanResult(envelope, context = {}) {
  assertVerifiedEnvelope(envelope);
  const view = baseViewModel("day_plan", envelope, context);
  const items = asArray(envelope.items);
  const summary = envelope.summary || {};
  const gapCount = items.filter((item) => item.type === "gap").length;
  const studySuggestionCount = items.reduce((count, item) => count + (asArray(item.studyRooms).length ? 1 : 0), 0);
  const entity = envelope.resolvedEntity || {};
  view.title = context.title || `${(envelope.query && envelope.query.date) || envelope.timeText || "今日"} · 校园计划`;
  view.summary = {
    lessonCount: Number(summary.lessonCount || items.filter((item) => item.type === "lesson").length || 0),
    gapCount,
    studySuggestionCount,
    hasCrossCampus: summary.hasCrossCampus === true,
  };
  view.items = items.slice(0, 8).map((item) => ({
    type: item.type || "note",
    lessonId: item.lessonId || "",
    courseName: item.courseName || "",
    periodText: item.periodText || "",
    startTime: item.startTime || "",
    endTime: item.endTime || "",
    campusName: item.campusName || "",
    roomName: item.roomName || "",
    teachers: asArray(item.teachers),
    suggestion: item.suggestion || item.text || "",
    studyRooms: asArray(item.studyRooms).slice(0, 2),
  }));
  view.actions = [
    safeAction("day-plan-next-day", "看明天", "那明天的安排呢"),
    safeAction("day-plan-classroom", "找空教室", "我空闲的时候有哪些空教室适合自习"),
    safeAction("day-plan-study-2", "连续自习2节", "那天想连续自习2节"),
  ];
  if (entity && entity.name) view.subtitle = context.subtitle || `${entity.name} · 匿名赛事计划`;
  return view;
}

const ERROR_COPY = {
  ENTITY_NOT_FOUND: "没有找到这个校园对象，请换一个明确名称后重试。",
  AMBIGUOUS_ENTITY: "找到多个可能对象，请先确认要查询哪一个。",
  INVALID_PARAM: "部分查询条件不符合规则，请修改条件后重试。",
  OUT_OF_RANGE: "这个日期或教学周不在当前赛事学期范围内。",
  MISSING_PARAM: "还缺少完成本次任务所需的查询条件。",
  TIMEOUT: "工具查询超时，本次没有使用模型补造动态事实。",
};

function errorActions(code) {
  if (code === "ENTITY_NOT_FOUND") return [
    safeAction("error-edit-entity", "修改对象", "我想换一个查询对象"),
    safeAction("error-retry", "重新查询", "重新执行刚才的查询"),
  ];
  if (code === "OUT_OF_RANGE") return [
    safeAction("error-semester", "查看学期范围", "本学期的日期范围是什么"),
    safeAction("error-change-date", "换日期", "我想换一个学期内日期"),
  ];
  if (code === "MISSING_PARAM" || code === "INVALID_PARAM") return [
    safeAction("error-edit-query", "修改条件", "我想补充或修改刚才的查询条件"),
    safeAction("error-retry", "重新查询", "重新执行刚才的查询"),
  ];
  return [
    safeAction("error-retry", "重新查询", "重新执行刚才的查询"),
    safeAction("error-edit-query", "修改条件", "我想修改刚才的查询条件"),
  ];
}

function adaptErrorResult(envelope, context = {}) {
  const view = baseViewModel("error", envelope || { success: false, evidence: { verified: false } }, context);
  const error = (envelope && envelope.error) || {};
  const code = error.code || "UNKNOWN";
  view.success = false;
  view.title = context.title || "这次没有查成功";
  view.subtitle = context.subtitle || "动态事实未通过工具核验";
  view.error = {
    code,
    message: context.message || ERROR_COPY[code] || error.message || "工具暂时无法完成本次任务，请修改条件或稍后重试。",
  };
  view.actions = errorActions(code).slice(0, 3);
  return view;
}

function adaptChoiceResult(envelope, context = {}) {
  const view = baseViewModel("choice", envelope || { success: false, evidence: { verified: false } }, context);
  const originalTask = context.originalTask || "刚才的查询";
  view.success = false;
  view.title = context.title || "找到多个匹配，请确认一个";
  view.subtitle = context.subtitle || "选择后会继续原任务，不需要重新输入";
  view.interaction.waitForUser = true;
  view.items = asArray(envelope && envelope.items).slice(0, 5).map((item, index) => ({
    key: `choice-${index + 1}`,
    name: item.name || "",
    type: item.type || "",
    description: item.description || item.campusName || item.collegeName || "",
    action: safeAction(`choice-${index + 1}`, `选择${item.name || `候选${index + 1}`}`, `选择${item.name || `候选${index + 1}`}，继续${originalTask}`),
  }));
  view.actions = [safeAction("choice-rephrase", "重新描述", "我重新描述一下查询对象")];
  view.error = envelope && envelope.error ? { code: envelope.error.code || "AMBIGUOUS_ENTITY", message: envelope.error.message || "需要确认候选" } : null;
  return view;
}

module.exports = {
  DATA_VERSION,
  SCHEMA_VERSION,
  adaptScheduleResult,
  adaptClassroomResult,
  adaptConflictResult,
  adaptDayPlanResult,
  adaptErrorResult,
  adaptChoiceResult,
};
