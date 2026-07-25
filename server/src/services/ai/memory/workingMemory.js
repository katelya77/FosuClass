/**
 * Per-turn working memory — goals, entities, slots, tools, pending steps.
 * Pure functions; no I/O.
 */

const safetyGuard = require("../safetyGuard");
const { normalizeContextSlots } = require("../conversation/conversationSchema");

function emptyWorkingMemory() {
  return {
    currentGoal: "",
    currentSubtask: "",
    confirmedEntities: {},
    className: "",
    teacherName: "",
    courseName: "",
    classroom: "",
    campus: "",
    dateHint: "",
    teachingWeek: null,
    weekday: null,
    sectionStart: null,
    sectionEnd: null,
    periodHint: "",
    userConstraints: [],
    pendingClarification: null,
    executedTools: [],
    lastObservations: [],
    incompleteSteps: [],
    lastRecommendation: null,
    pendingWriteOps: [],
    preferredName: "",
    // 当前首页课表目标（仅在客户端 Action 执行成功且 Receipt 验证通过后提交）。
    currentScheduleTarget: null,
    // 类型化关系记忆（"我妈妈叫X"）：relation 为机器可读的稳定标识，
    // displayRelation 为用户原始表述，name 为关系人称呼。
    namedRelations: [],
    updatedAt: "",
  };
}

function safeText(value, max = 120) {
  return safetyGuard.redactSensitiveText(String(value == null ? "" : value)).slice(0, max);
}

function pickNumber(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const raw = values[i];
    if (raw === null || raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    // Week/weekday/section never use 0 as a valid value in FosuClass schemas.
    if (n === 0) continue;
    return n;
  }
  return null;
}

function normalizeClassName(value) {
  return safeText(value, 80).replace(/\s+/g, "");
}

function normalizeWorkingMemory(raw = {}) {
  const base = emptyWorkingMemory();
  if (!raw || typeof raw !== "object") return base;
  const next = Object.assign({}, base);
  next.currentGoal = safeText(raw.currentGoal, 160);
  next.currentSubtask = safeText(raw.currentSubtask, 120);
  next.confirmedEntities = raw.confirmedEntities && typeof raw.confirmedEntities === "object"
    ? Object.keys(raw.confirmedEntities).slice(0, 12).reduce((acc, key) => {
      acc[safeText(key, 40)] = safeText(raw.confirmedEntities[key], 80);
      return acc;
    }, {})
    : {};
  next.className = normalizeClassName(raw.className || raw.confirmedEntities && raw.confirmedEntities.className);
  next.teacherName = safeText(raw.teacherName, 80);
  next.courseName = safeText(raw.courseName, 80);
  next.classroom = safeText(raw.classroom, 40);
  next.campus = safeText(raw.campus, 40);
  next.dateHint = safeText(raw.dateHint, 40);
  next.teachingWeek = pickNumber(raw.teachingWeek, raw.week, raw.lastWeek);
  next.weekday = pickNumber(raw.weekday, raw.lastWeekday);
  next.sectionStart = pickNumber(raw.sectionStart);
  next.sectionEnd = pickNumber(raw.sectionEnd);
  next.periodHint = safeText(raw.periodHint, 40);
  next.userConstraints = Array.isArray(raw.userConstraints)
    ? raw.userConstraints.map((item) => safeText(item, 80)).filter(Boolean).slice(0, 8)
    : [];
  next.pendingClarification = raw.pendingClarification || null;
  next.executedTools = Array.isArray(raw.executedTools)
    ? raw.executedTools.map((item) => safeText(item, 80)).filter(Boolean).slice(0, 12)
    : [];
  next.lastObservations = Array.isArray(raw.lastObservations)
    ? raw.lastObservations.slice(0, 8).map((obs) => ({
      tool: safeText(obs.tool || obs.name, 80),
      status: safeText(obs.status, 24),
      factCount: Math.max(0, Number(obs.factCount || 0) || 0),
      summary: safeText(obs.summary, 120),
    }))
    : [];
  next.incompleteSteps = Array.isArray(raw.incompleteSteps)
    ? raw.incompleteSteps.map((item) => safeText(item, 80)).filter(Boolean).slice(0, 8)
    : [];
  next.lastRecommendation = raw.lastRecommendation && typeof raw.lastRecommendation === "object"
    ? {
      summary: safeText(raw.lastRecommendation.summary, 120),
      count: Math.max(0, Number(raw.lastRecommendation.count || 0) || 0),
    }
    : null;
  next.pendingWriteOps = Array.isArray(raw.pendingWriteOps)
    ? raw.pendingWriteOps.slice(0, 4).map((op) => ({
      tool: safeText(op.tool || op.name, 80),
      status: safeText(op.status || "awaiting_confirmation", 40),
    }))
    : [];
  next.preferredName = safeText(raw.preferredName, 24);
  next.currentScheduleTarget = raw.currentScheduleTarget && typeof raw.currentScheduleTarget === "object"
    ? {
      type: safeText(raw.currentScheduleTarget.type, 24),
      detailId: safeText(raw.currentScheduleTarget.detailId, 128),
      name: safeText(raw.currentScheduleTarget.name, 120),
      term: safeText(raw.currentScheduleTarget.term, 40),
    }
    : null;
  if (next.currentScheduleTarget && (!next.currentScheduleTarget.detailId || !next.currentScheduleTarget.name)) {
    next.currentScheduleTarget = null;
  }
  next.namedRelations = Array.isArray(raw.namedRelations)
    ? raw.namedRelations.slice(0, 8).map((item) => ({
      relation: safeText(item && item.relation, 40),
      displayRelation: safeText(item && item.displayRelation, 40),
      name: safeText(item && item.name, 60),
    })).filter((item) => item.relation && item.name)
    : [];
  next.updatedAt = safeText(raw.updatedAt || "", 40);
  return next;
}

/**
 * Merge previous working memory with this turn's intent/slots/message.
 * Unmodified conditions are inherited (class/week/task type).
 */
function updateWorkingMemory(previous, input = {}) {
  const prev = normalizeWorkingMemory(previous);
  const slots = input.slots && typeof input.slots === "object" ? input.slots : {};
  const contextSlots = normalizeContextSlots(input.contextSlots || input.conversationSlots || {});
  const message = safeText(input.message, 500);
  const intentName = safeText(input.intentName || (input.intent && input.intent.name) || "", 80);
  const next = Object.assign({}, prev);

  // Inherit unless this turn explicitly changes a field.
  const className = normalizeClassName(
    slots.className || (slots.q && /班/.test(String(slots.q)) ? slots.q : "")
    || contextSlots.className
    || (contextSlots.lastTargetName && /班/.test(contextSlots.lastTargetName) ? contextSlots.lastTargetName : "")
    || prev.className
  );
  const teacherName = safeText(slots.teacherName || contextSlots.teacherName || prev.teacherName, 80);
  const courseName = safeText(slots.courseName || contextSlots.courseName || prev.courseName, 80);
  const classroom = safeText(slots.classroom || contextSlots.classroom || prev.classroom, 40);
  const campus = safeText(slots.campus || contextSlots.campus || input.campus || prev.campus, 40);

  let teachingWeek = pickNumber(slots.week, slots.lastWeek, contextSlots.week, contextSlots.lastWeek, prev.teachingWeek);
  let weekday = pickNumber(slots.weekday, slots.lastWeekday, contextSlots.weekday, contextSlots.lastWeekday, prev.weekday);

  // Follow-up phrases: "那周三呢" / "下午呢" / "换成第17周"
  // Prefer explicit message modifiers; otherwise keep previous (never overwrite with 0).
  if (/周[一二三四五六日天1-7]/.test(message) || /星期[一二三四五六日天]/.test(message)) {
    const map = {
      一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
      1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
    };
    const m = message.match(/周([一二三四五六日天1-7])/) || message.match(/星期([一二三四五六日天])/);
    if (m && map[m[1]] != null) weekday = map[m[1]];
  }
  if (/第\s*(\d{1,2})\s*周/.test(message) || /换成.*?(\d{1,2})\s*周/.test(message)) {
    const wm = message.match(/第\s*(\d{1,2})\s*周/) || message.match(/(\d{1,2})\s*周/);
    if (wm) {
      const parsed = Number(wm[1]);
      if (Number.isFinite(parsed) && parsed >= 1) teachingWeek = parsed;
    }
  }
  // Slots may ship invalid 0 from older buildContextSlots — fall back to prev.
  if (weekday == null || weekday < 1) weekday = prev.weekday;
  if (teachingWeek == null || teachingWeek < 1) teachingWeek = prev.teachingWeek;

  let periodHint = prev.periodHint || "";
  if (/上午|早上/.test(message)) periodHint = "morning";
  else if (/下午/.test(message)) periodHint = "afternoon";
  else if (/晚上|夜间/.test(message)) periodHint = "evening";
  else if (slots.periodHint) periodHint = safeText(slots.periodHint, 40);

  next.className = className;
  next.teacherName = teacherName;
  next.courseName = courseName;
  next.classroom = classroom;
  next.campus = campus;
  next.teachingWeek = teachingWeek;
  next.weekday = weekday;
  next.periodHint = periodHint;
  next.sectionStart = pickNumber(slots.sectionStart, contextSlots.sectionStart, prev.sectionStart);
  next.sectionEnd = pickNumber(slots.sectionEnd, contextSlots.sectionEnd, prev.sectionEnd);

  if (intentName && !/conversational_help|conversation_memory/.test(intentName)) {
    next.currentGoal = intentName;
  } else if (message && !prev.currentGoal) {
    next.currentGoal = message.slice(0, 80);
  }

  if (className) next.confirmedEntities.className = className;
  if (teacherName) next.confirmedEntities.teacherName = teacherName;
  if (courseName) next.confirmedEntities.courseName = courseName;
  if (classroom) next.confirmedEntities.classroom = classroom;
  if (campus) next.confirmedEntities.campus = campus;
  if (teachingWeek != null) next.confirmedEntities.week = String(teachingWeek);
  if (weekday != null) next.confirmedEntities.weekday = String(weekday);

  if (input.preferredName) next.preferredName = safeText(input.preferredName, 24);
  // 仅在显式给定（Receipt 提交 / 用户纠正）时更新；否则继承 prev。
  if (input.currentScheduleTarget !== undefined) {
    next.currentScheduleTarget = input.currentScheduleTarget;
  }
  if (Array.isArray(input.namedRelations)) {
    next.namedRelations = input.namedRelations;
  }
  if (input.pendingClarification !== undefined) {
    next.pendingClarification = input.pendingClarification;
  }

  if (Array.isArray(input.executedTools) && input.executedTools.length) {
    const merged = prev.executedTools.concat(input.executedTools.map((t) => safeText(t, 80)));
    next.executedTools = Array.from(new Set(merged)).slice(-12);
  }
  if (Array.isArray(input.observations) && input.observations.length) {
    next.lastObservations = input.observations.slice(0, 8).map((obs) => ({
      tool: safeText(obs.tool || obs.name, 80),
      status: safeText(obs.status, 24),
      factCount: Math.max(0, Number(obs.factCount || 0) || 0),
      summary: safeText(obs.summary, 120),
    }));
  }
  if (input.lastRecommendation) {
    next.lastRecommendation = {
      summary: safeText(input.lastRecommendation.summary, 120),
      count: Math.max(0, Number(input.lastRecommendation.count || 0) || 0),
    };
  }
  if (Array.isArray(input.pendingWriteOps)) {
    next.pendingWriteOps = input.pendingWriteOps.slice(0, 4);
  }

  next.updatedAt = new Date().toISOString();
  return normalizeWorkingMemory(next);
}

function workingMemoryToSlots(working) {
  const wm = normalizeWorkingMemory(working);
  return normalizeContextSlots({
    lastTargetType: wm.className ? "class" : (wm.teacherName ? "teacher" : (wm.classroom ? "classroom" : "")),
    lastTargetName: wm.className || wm.teacherName || wm.courseName || wm.classroom || "",
    lastWeek: wm.teachingWeek,
    lastWeekday: wm.weekday,
    className: wm.className,
    teacherName: wm.teacherName,
    courseName: wm.courseName,
    classroom: wm.classroom,
    campus: wm.campus,
    week: wm.teachingWeek,
    weekday: wm.weekday,
    sectionStart: wm.sectionStart,
    sectionEnd: wm.sectionEnd,
    lastIntent: wm.currentGoal,
    q: wm.className || wm.teacherName || wm.courseName || "",
  });
}

function summarizeWorkingMemory(working) {
  const wm = normalizeWorkingMemory(working);
  const parts = [];
  if (wm.currentGoal) parts.push(`目标 ${wm.currentGoal}`);
  if (wm.className) parts.push(`班级 ${wm.className}`);
  if (wm.teacherName) parts.push(`教师 ${wm.teacherName}`);
  if (wm.campus) parts.push(`校区 ${wm.campus}`);
  if (wm.teachingWeek != null) parts.push(`第${wm.teachingWeek}周`);
  if (wm.weekday != null) parts.push(`周${wm.weekday}`);
  if (wm.periodHint) parts.push(wm.periodHint === "afternoon" ? "下午" : wm.periodHint);
  if (wm.preferredName) parts.push(`称呼 ${wm.preferredName}`);
  if (wm.currentScheduleTarget && wm.currentScheduleTarget.name) parts.push(`当前课表 ${wm.currentScheduleTarget.name}`);
  if (wm.namedRelations.length) {
    parts.push(`关系 ${wm.namedRelations.map((r) => `${r.displayRelation || r.relation}=${r.name}`).join("，")}`);
  }
  if (wm.executedTools.length) parts.push(`已用工具 ${wm.executedTools.slice(-4).join("/")}`);
  return parts.join("；").slice(0, 200);
}

module.exports = {
  emptyWorkingMemory,
  normalizeWorkingMemory,
  updateWorkingMemory,
  workingMemoryToSlots,
  summarizeWorkingMemory,
};
