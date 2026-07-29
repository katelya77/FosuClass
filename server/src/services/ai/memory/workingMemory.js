/**
 * Per-turn working memory — goals, entities, slots, tools, pending steps.
 * Pure functions; no I/O.
 */

const safetyGuard = require("../safetyGuard");
const { normalizeContextSlots } = require("../conversation/conversationSchema");
const {
  CONTRACT_VERSION: GOAL_CONTRACT_V2_VERSION,
  fromV1Contract,
  normalizeGoalContractV2,
} = require("../understanding/goalContractV2");

function emptyWorkingMemory() {
  return {
    currentGoal: "",
    currentSubtask: "",
    // Typed conversation working state (thread-scoped; not long-term user memory)
    activeGoal: "",
    lastEntityType: "",
    lastEntity: "",
    lastResolvedEntity: null,
    lastConstraints: {
      date: "",
      dateOffset: null,
      dateHint: "",
      teachingWeek: null,
      weekday: null,
      periodHint: "",
      campus: "",
      collegeCode: "",
      continuousSections: null,
      building: "",
      sections: "",
    },
    lastSuccessfulTools: [],
    lastResultRefs: [],
    pendingAction: null,
    providerUsed: "",
    understandingSource: "",
    lastGoalContract: null,
    confirmedEntities: {},
    className: "",
    teacherName: "",
    courseName: "",
    classroom: "",
    campus: "",
    dateHint: "",
    dateOffset: null,
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
    // 低敏身份事实（线程级）：学院/专业/年级，随会话保存；长期持久化仍走 User Memory。
    college: "",
    major: "",
    grade: "",
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

// lastGoalContract is stored in the unified GoalContract V2 shape. Legacy V1
// payloads (written before V2 shipped) are upgraded through the V1 adapter;
// anything unparseable is dropped instead of breaking memory hydration.
function normalizeStoredGoalContract(raw) {
  if (!raw || typeof raw !== "object") return null;
  try {
    if (raw.contractVersion === GOAL_CONTRACT_V2_VERSION) return normalizeGoalContractV2(raw);
    if (typeof raw.goal === "string" && raw.goal) {
      return fromV1Contract(raw, { source: "adapter", understandingSource: "legacy_v1_working_memory" });
    }
    return null;
  } catch (error) {
    return null;
  }
}

// pendingClarification is stored in the unified 5-key shape produced by
// runtime/verificationCoordinator.buildClarificationPatch and consumed by
// planner/followUpResolver.pickPendingClarification / resolvePendingFill:
//   { intentName, type, missing, createdAt, expiresAt }
// Hydration only normalizes keys/types (extra keys dropped, timestamps coerced
// to numbers); expiry stays consumer-owned (pickPendingClarification and
// resolvePendingClarificationPatch both re-check expiresAt), so an expired
// entry is preserved here exactly as the legacy passthrough kept it, and only
// malformed payloads degrade to null. Kept semantics-identical with the local
// normalizer in planner/followUpResolver.js (M4-T3 three-party alignment).
function normalizeStoredPendingClarification(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    intentName: safeText(raw.intentName || "search_school_index", 80),
    type: safeText(raw.type, 40),
    missing: safeText(raw.missing, 80),
    createdAt: Math.max(0, Number(raw.createdAt || 0) || 0),
    expiresAt: Math.max(0, Number(raw.expiresAt || 0) || 0),
  };
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

/** Like pickNumber but allows 0 (e.g. dateOffset for "今天"). */
function pickNumberAllowZero(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const raw = values[i];
    if (raw === null || raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
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
  next.currentGoal = safeText(raw.currentGoal || raw.activeGoal, 160);
  next.activeGoal = safeText(raw.activeGoal || raw.currentGoal, 160);
  next.currentSubtask = safeText(raw.currentSubtask, 120);
  next.lastEntityType = safeText(raw.lastEntityType, 40);
  next.lastEntity = safeText(raw.lastEntity, 120);
  next.lastResolvedEntity = raw.lastResolvedEntity && typeof raw.lastResolvedEntity === "object"
    ? {
      type: safeText(raw.lastResolvedEntity.type, 40),
      id: safeText(raw.lastResolvedEntity.id || raw.lastResolvedEntity.detailId, 128),
      name: safeText(raw.lastResolvedEntity.name, 120),
    }
    : null;
  const lc = raw.lastConstraints && typeof raw.lastConstraints === "object" ? raw.lastConstraints : {};
  next.lastConstraints = {
    date: safeText(lc.date, 40),
    dateOffset: pickNumberAllowZero(lc.dateOffset, raw.dateOffset),
    dateHint: safeText(lc.dateHint || raw.dateHint, 40),
    teachingWeek: pickNumber(lc.teachingWeek, raw.teachingWeek),
    weekday: pickNumber(lc.weekday, raw.weekday),
    periodHint: safeText(lc.periodHint || raw.periodHint, 40),
    campus: safeText(lc.campus || raw.campus, 40),
    collegeCode: safeText(lc.collegeCode, 24),
    continuousSections: pickNumber(lc.continuousSections),
    building: safeText(lc.building, 40),
    sections: safeText(lc.sections, 40),
  };
  next.lastSuccessfulTools = Array.isArray(raw.lastSuccessfulTools)
    ? raw.lastSuccessfulTools.map((item) => safeText(item, 80)).filter(Boolean).slice(0, 12)
    : [];
  next.lastResultRefs = Array.isArray(raw.lastResultRefs) ? raw.lastResultRefs.slice(0, 8) : [];
  next.pendingAction = raw.pendingAction && typeof raw.pendingAction === "object"
    ? {
      command: safeText(raw.pendingAction.command, 40),
      status: safeText(raw.pendingAction.status, 40),
      runId: safeText(raw.pendingAction.runId, 100),
      createdAt: Math.max(0, Number(raw.pendingAction.createdAt || 0) || 0),
      expiresAt: Math.max(0, Number(raw.pendingAction.expiresAt || 0) || 0),
      target: raw.pendingAction.target && typeof raw.pendingAction.target === "object"
        ? {
          type: safeText(raw.pendingAction.target.type, 24),
          detailId: safeText(raw.pendingAction.target.detailId || raw.pendingAction.target.id, 128),
          name: safeText(raw.pendingAction.target.name, 120),
          term: safeText(raw.pendingAction.target.term, 40),
        }
        : null,
    }
    : null;
  next.providerUsed = safeText(raw.providerUsed, 40);
  next.understandingSource = safeText(raw.understandingSource, 40);
  next.lastGoalContract = normalizeStoredGoalContract(raw.lastGoalContract);
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
  next.campus = safeText(raw.campus || (next.lastConstraints && next.lastConstraints.campus), 40);
  next.dateHint = safeText(raw.dateHint || (next.lastConstraints && next.lastConstraints.dateHint), 40);
  next.dateOffset = pickNumberAllowZero(raw.dateOffset, next.lastConstraints && next.lastConstraints.dateOffset);
  next.teachingWeek = pickNumber(raw.teachingWeek, raw.week, raw.lastWeek);
  next.weekday = pickNumber(raw.weekday, raw.lastWeekday);
  next.sectionStart = pickNumber(raw.sectionStart);
  next.sectionEnd = pickNumber(raw.sectionEnd);
  next.periodHint = safeText(raw.periodHint, 40);
  next.userConstraints = Array.isArray(raw.userConstraints)
    ? raw.userConstraints.map((item) => safeText(item, 80)).filter(Boolean).slice(0, 8)
    : [];
  next.pendingClarification = normalizeStoredPendingClarification(raw.pendingClarification);
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
  next.college = safeText(raw.college, 16);
  next.major = safeText(raw.major, 16);
  next.grade = safeText(raw.grade, 8);
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
    next.activeGoal = intentName;
  } else if (message && !prev.currentGoal) {
    next.currentGoal = message.slice(0, 80);
    next.activeGoal = next.currentGoal;
  } else {
    next.activeGoal = next.activeGoal || prev.activeGoal || next.currentGoal;
  }

  // Typed entity + constraints inheritance for follow-ups
  if (teacherName) {
    next.lastEntityType = "teacher";
    next.lastEntity = teacherName;
  } else if (className) {
    next.lastEntityType = "class";
    next.lastEntity = className;
  } else if (classroom) {
    next.lastEntityType = "classroom";
    next.lastEntity = classroom;
  } else if (courseName) {
    next.lastEntityType = "course";
    next.lastEntity = courseName;
  }
  const dateOffset = pickNumberAllowZero(slots.dateOffset, slots.dayOffset, input.dateOffset, prev.dateOffset);
  const dateHint = safeText(slots.dateHint || input.dateHint || prev.dateHint, 40);
  const continuousSections = pickNumber(slots.continuousSections, slots.minFreeSections, prev.lastConstraints && prev.lastConstraints.continuousSections);
  next.dateOffset = dateOffset;
  next.dateHint = dateHint || next.dateHint;
  next.lastConstraints = {
    date: safeText(slots.date || (prev.lastConstraints && prev.lastConstraints.date), 40),
    dateOffset,
    dateHint: dateHint || (prev.lastConstraints && prev.lastConstraints.dateHint) || "",
    teachingWeek,
    weekday,
    periodHint: periodHint || (prev.lastConstraints && prev.lastConstraints.periodHint) || "",
    campus,
    collegeCode: safeText(slots.collegeCode || (prev.lastConstraints && prev.lastConstraints.collegeCode), 24),
    continuousSections,
    building: safeText(slots.building || (prev.lastConstraints && prev.lastConstraints.building), 40),
    sections: safeText(slots.sections || (prev.lastConstraints && prev.lastConstraints.sections), 40),
  };

  if (className) next.confirmedEntities.className = className;
  if (teacherName) next.confirmedEntities.teacherName = teacherName;
  if (courseName) next.confirmedEntities.courseName = courseName;
  if (classroom) next.confirmedEntities.classroom = classroom;
  if (campus) next.confirmedEntities.campus = campus;
  if (teachingWeek != null) next.confirmedEntities.week = String(teachingWeek);
  if (weekday != null) next.confirmedEntities.weekday = String(weekday);

  if (input.preferredName) next.preferredName = safeText(input.preferredName, 24);
  if (input.college) next.college = safeText(input.college, 16);
  if (input.major) next.major = safeText(input.major, 16);
  if (input.grade) next.grade = safeText(input.grade, 8);
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
  if (input.pendingAction !== undefined) {
    next.pendingAction = input.pendingAction;
  }
  if (input.lastResolvedEntity !== undefined) {
    next.lastResolvedEntity = input.lastResolvedEntity;
  }
  if (input.providerUsed !== undefined) {
    next.providerUsed = safeText(input.providerUsed, 40);
  }
  if (input.understandingSource !== undefined) {
    next.understandingSource = safeText(input.understandingSource, 40);
  }
  if (input.goalContract !== undefined) {
    if (!input.goalContract) {
      next.lastGoalContract = null;
    } else {
      const stored = normalizeStoredGoalContract(input.goalContract);
      next.lastGoalContract = stored || prev.lastGoalContract;
    }
  }

  if (Array.isArray(input.executedTools) && input.executedTools.length) {
    const merged = prev.executedTools.concat(input.executedTools.map((t) => safeText(t, 80)));
    next.executedTools = Array.from(new Set(merged)).slice(-12);
    next.lastSuccessfulTools = Array.from(new Set(
      (prev.lastSuccessfulTools || []).concat(input.executedTools.map((t) => safeText(t, 80)))
    )).slice(-12);
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
