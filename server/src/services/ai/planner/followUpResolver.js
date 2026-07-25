/**
 * Unified Follow-up Resolver for multi-turn constraint inheritance.
 * Handles omission, pronouns, corrections, and constraint replacement.
 * Pure functions — no I/O.
 */

const safetyGuard = require("../safetyGuard");

function safeText(value, max = 120) {
  return safetyGuard.redactSensitiveText(String(value == null ? "" : value)).slice(0, max);
}

function compact(value) {
  return String(value || "").replace(/\s+/g, "");
}

function emptyConstraints() {
  return {
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
  };
}

/**
 * Typed conversation working state (thread-scoped, not long-term user memory).
 */
function emptyConversationWorkingState() {
  return {
    activeGoal: "",
    pendingClarification: null,
    lastEntityType: "",
    lastEntity: "",
    lastResolvedEntity: null,
    lastConstraints: emptyConstraints(),
    lastSuccessfulTools: [],
    lastResultRefs: [],
    pendingAction: null,
    updatedAt: "",
  };
}

function coerceOptionalNumber(value, { min = null, allowZero = true } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (!allowZero && n === 0) return null;
  if (min != null && n < min) return null;
  return n;
}

function normalizeConstraints(raw = {}) {
  const base = emptyConstraints();
  if (!raw || typeof raw !== "object") return base;
  return {
    date: safeText(raw.date, 40),
    // Do not use Number(null) — that becomes 0 and wrongly means "today".
    dateOffset: coerceOptionalNumber(raw.dateOffset, { allowZero: true }),
    dateHint: safeText(raw.dateHint, 40),
    teachingWeek: coerceOptionalNumber(raw.teachingWeek, { min: 1, allowZero: false }),
    weekday: coerceOptionalNumber(raw.weekday, { min: 1, allowZero: false }),
    periodHint: safeText(raw.periodHint, 40),
    campus: safeText(raw.campus, 40),
    collegeCode: safeText(raw.collegeCode, 24),
    continuousSections: coerceOptionalNumber(raw.continuousSections, { min: 1, allowZero: false }),
    building: safeText(raw.building, 40),
    sections: safeText(raw.sections, 40),
  };
}

function normalizeConversationWorkingState(raw = {}) {
  const base = emptyConversationWorkingState();
  if (!raw || typeof raw !== "object") return base;
  const next = Object.assign({}, base);
  next.activeGoal = safeText(raw.activeGoal || raw.currentGoal, 160);
  next.pendingClarification = raw.pendingClarification || null;
  next.lastEntityType = safeText(raw.lastEntityType, 40);
  next.lastEntity = safeText(raw.lastEntity, 120);
  next.lastResolvedEntity = raw.lastResolvedEntity && typeof raw.lastResolvedEntity === "object"
    ? {
      type: safeText(raw.lastResolvedEntity.type, 40),
      id: safeText(raw.lastResolvedEntity.id || raw.lastResolvedEntity.detailId, 128),
      name: safeText(raw.lastResolvedEntity.name, 120),
    }
    : null;
  next.lastConstraints = normalizeConstraints(raw.lastConstraints || raw.constraints || {});
  // Merge flat legacy fields into constraints
  if (!next.lastConstraints.campus && raw.campus) next.lastConstraints.campus = safeText(raw.campus, 40);
  if (next.lastConstraints.dateOffset == null && raw.dateOffset != null) {
    next.lastConstraints.dateOffset = Number(raw.dateOffset);
  }
  if (!next.lastConstraints.dateHint && raw.dateHint) {
    next.lastConstraints.dateHint = safeText(raw.dateHint, 40);
  }
  if (next.lastConstraints.teachingWeek == null && raw.teachingWeek != null) {
    next.lastConstraints.teachingWeek = Number(raw.teachingWeek);
  }
  if (next.lastConstraints.weekday == null && raw.weekday != null) {
    next.lastConstraints.weekday = Number(raw.weekday);
  }
  if (!next.lastConstraints.periodHint && raw.periodHint) {
    next.lastConstraints.periodHint = safeText(raw.periodHint, 40);
  }
  if (!next.lastEntity && (raw.teacherName || raw.className)) {
    next.lastEntity = safeText(raw.teacherName || raw.className, 120);
    next.lastEntityType = raw.teacherName ? "teacher" : "class";
  }
  next.lastSuccessfulTools = Array.isArray(raw.lastSuccessfulTools)
    ? raw.lastSuccessfulTools.map((t) => safeText(t, 80)).filter(Boolean).slice(0, 12)
    : (Array.isArray(raw.executedTools)
      ? raw.executedTools.map((t) => safeText(t, 80)).filter(Boolean).slice(0, 12)
      : []);
  next.lastResultRefs = Array.isArray(raw.lastResultRefs) ? raw.lastResultRefs.slice(0, 8) : [];
  next.pendingAction = raw.pendingAction || null;
  next.updatedAt = safeText(raw.updatedAt || "", 40);
  return next;
}

function inferCampus(text) {
  const value = compact(text);
  if (/河滨/.test(value)) return "河滨校区";
  if (/江湾/.test(value)) return "江湾校区";
  if (/仙溪/.test(value)) return "仙溪校区";
  return "";
}

function parseDateOffset(text) {
  const value = compact(text);
  if (/后天/.test(value)) return { dateOffset: 2, dateHint: "day_after_tomorrow" };
  if (/大后天/.test(value)) return { dateOffset: 3, dateHint: "in_3_days" };
  if (/明天|翌日|明日/.test(value)) return { dateOffset: 1, dateHint: "tomorrow" };
  if (/今天|今日/.test(value)) return { dateOffset: 0, dateHint: "today" };
  return null;
}

function parseContinuousSections(text) {
  const value = compact(text);
  if (!/连续|连着|连堂|两节|只看/.test(value)) return null;
  if (!/空教室|空课室|教室/.test(value) && !/节/.test(value)) return null;
  const digit = value.match(/(\d+)\s*节/);
  if (digit) return Math.min(6, Math.max(1, Number(digit[1]) || 2));
  if (/两|2/.test(value)) return 2;
  if (/三|3/.test(value)) return 3;
  if (/连续/.test(value)) return 2;
  return null;
}

function isCampusSwapOnly(text) {
  const value = compact(text);
  if (!value || value.length > 24) return false;
  // 换成江湾 / 改成仙溪校区 / 江湾呢 / 那江湾
  if (/^(那|还是|继续)?(换成|换为|换到|改成|改为|切换到|切换成)?(河滨|江湾|仙溪)(校区)?(呢|啊|呀)?[？?！!。.]?$/.test(value)) {
    return true;
  }
  if (/^(河滨|江湾|仙溪)(校区)?(呢|啊)?[？?]?$/.test(value)) return true;
  return false;
}

function isConstraintOnlyFollowUp(text) {
  const value = compact(text);
  if (!value || value.length > 32) return false;
  if (isCampusSwapOnly(value)) return true;
  if (/^(那|换成|改成|还是|继续|再|只看)?(周[一二三四五六日天1-7]|星期[一二三四五六日天]|第?\d{1,2}周|上午|下午|晚上|早上|连续[两二三四五六\d]+节|连续两节|两节空教室)(空教室)?(呢|啊|呀)?[？?！!。.]?$/.test(value)) {
    return true;
  }
  if (/只看连续|连续两节|连着两节/.test(value) && value.length <= 20) return true;
  return false;
}

/**
 * Resolve follow-up against typed working state.
 * @returns {null|{kind, goal, entityType, entity, constraints, inheritedFields, replacedFields, confidence, needsClarification, intent}}
 */
function resolveFollowUp(message, workingState = {}, context = {}) {
  const text = String(message || "").trim();
  if (!text) return null;
  const state = normalizeConversationWorkingState(
    workingState && Object.keys(workingState).length
      ? workingState
      : Object.assign({}, context.workingMemory || {}, {
        activeGoal: (context.workingMemory && context.workingMemory.currentGoal)
          || (context.conversationSlots && context.conversationSlots.lastIntent)
          || context.lastIntent
          || "",
        lastConstraints: context.workingMemory || {},
      })
  );

  // Bare name filling pending clarification (e.g. 陈芳 after 查教师课表)
  const pending = state.pendingClarification
    || (context.pendingClarification && typeof context.pendingClarification === "object"
      ? context.pendingClarification
      : null);
  const pendingExpired = Boolean(
    pending
    && Number(pending.expiresAt || 0) > 0
    && Number(pending.expiresAt) < Date.now()
  );
  if (pending && !pendingExpired && pending.type === "teacher" && pending.missing === "teacherName") {
    const name = compact(text).replace(/老师|教师/g, "");
    if (name.length >= 2 && name.length <= 12 && /^[\u3400-\u9fffA-Za-z·]+$/.test(name)
      && !/天气|空教室|课表|设为|打开|换成/.test(name)) {
      return {
        kind: "fill_pending_entity",
        goal: state.activeGoal || "open_schedule",
        entityType: "teacher",
        entity: name,
        normalizedEntity: name,
        constraints: state.lastConstraints,
        inheritedFields: ["activeGoal", "entityType"],
        replacedFields: ["entity"],
        confidence: 0.95,
        needsClarification: false,
        intent: {
          name: "search_school_index",
          slots: {
            type: "teacher",
            q: name,
            lockedEntityType: "teacher",
            filledFromPendingClarification: true,
            missing: "teacherName",
          },
          followUp: true,
          confidence: 0.95,
        },
      };
    }
  }

  if (!isConstraintOnlyFollowUp(text) && !isCampusSwapOnly(text)) {
    // Continuous empty-room refine may be slightly longer: 只看连续两节空教室
    if (!/只看连续|连续两节空教室|连着两节/.test(compact(text))) {
      return null;
    }
  }

  const activeGoal = state.activeGoal
    || String((context.conversationSlots && context.conversationSlots.lastIntent) || "");
  const prev = normalizeConstraints(state.lastConstraints);
  const inheritedFields = [];
  const replacedFields = [];
  const next = Object.assign({}, prev);
  Object.keys(prev).forEach((k) => {
    if (prev[k] !== "" && prev[k] != null) inheritedFields.push(k);
  });

  const campus = inferCampus(text);
  if (campus) {
    if (next.campus && next.campus !== campus) replacedFields.push("campus");
    else if (!next.campus) inheritedFields.push("campus");
    next.campus = campus;
    if (!replacedFields.includes("campus") && prev.campus !== campus) replacedFields.push("campus");
  }

  const dateInfo = parseDateOffset(text);
  if (dateInfo) {
    next.dateOffset = dateInfo.dateOffset;
    next.dateHint = dateInfo.dateHint;
    replacedFields.push("dateOffset");
  }

  const continuous = parseContinuousSections(text);
  if (continuous != null) {
    next.continuousSections = continuous;
    replacedFields.push("continuousSections");
  }

  // Weekday / week / period (legacy patterns)
  const weekdayMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
  const wm = compact(text).match(/周([一二三四五六日天1-7])/) || compact(text).match(/星期([一二三四五六日天])/);
  if (wm && weekdayMap[wm[1]] != null) {
    next.weekday = weekdayMap[wm[1]];
    replacedFields.push("weekday");
  }
  const weekMatch = compact(text).match(/第(\d{1,2})周/) || compact(text).match(/换成(\d{1,2})周/);
  if (weekMatch) {
    next.teachingWeek = Number(weekMatch[1]);
    replacedFields.push("teachingWeek");
  }
  if (/上午|早上/.test(text)) {
    next.periodHint = "morning";
    replacedFields.push("periodHint");
  } else if (/下午/.test(text)) {
    next.periodHint = "afternoon";
    replacedFields.push("periodHint");
  } else if (/晚上|夜间/.test(text)) {
    next.periodHint = "evening";
    replacedFields.push("periodHint");
  }

  // Weather follow-up: campus swap inherits dateOffset
  const weatherGoal = /get_campus_weather|weather|天气/.test(activeGoal)
    || (state.lastSuccessfulTools || []).some((t) => /weather/.test(t));
  if (weatherGoal && campus && !/空教室|课表|教师|班级/.test(compact(text))) {
    return {
      kind: "follow_up_modify_constraint",
      goal: "get_campus_weather",
      entityType: "",
      entity: "",
      constraints: next,
      inheritedFields: inheritedFields.filter((f) => f !== "campus"),
      replacedFields: Array.from(new Set(replacedFields.concat(["campus"]))),
      confidence: 0.96,
      needsClarification: false,
      intent: {
        name: "get_campus_weather",
        slots: {
          campus: next.campus,
          dateOffset: next.dateOffset != null ? next.dateOffset : undefined,
          dateHint: next.dateHint || undefined,
          date: next.date || undefined,
        },
        followUp: true,
        confidence: 0.96,
      },
    };
  }

  // Empty room continuous refine
  const emptyRoomGoal = /empty_room|空教室|search_empty|search_continuous/.test(activeGoal)
    || (state.lastSuccessfulTools || []).some((t) => /empty_room/.test(t))
    || continuous != null;
  if (emptyRoomGoal && (continuous != null || campus || next.periodHint || next.weekday != null)) {
    const minFree = next.continuousSections || continuous || 2;
    return {
      kind: "follow_up_modify_constraint",
      goal: "search_continuous_empty_rooms",
      entityType: "",
      entity: "",
      constraints: next,
      inheritedFields,
      replacedFields: Array.from(new Set(replacedFields)),
      confidence: 0.94,
      needsClarification: false,
      intent: {
        name: "search_continuous_empty_rooms",
        slots: {
          campus: next.campus || undefined,
          building: next.building || undefined,
          minFreeSections: minFree,
          date: next.date || undefined,
          dateOffset: next.dateOffset != null ? next.dateOffset : undefined,
          week: next.teachingWeek || undefined,
          weekday: next.weekday || undefined,
          periodHint: next.periodHint || undefined,
        },
        followUp: true,
        confidence: 0.94,
      },
    };
  }

  // Schedule-like week/weekday follow-up
  if (state.lastEntity || state.lastEntityType) {
    const type = state.lastEntityType || "class";
    const q = state.lastEntity || "";
    if (q) {
      return {
        kind: "follow_up_modify_constraint",
        goal: activeGoal || "search_school_index",
        entityType: type,
        entity: q,
        constraints: next,
        inheritedFields: inheritedFields.concat(["entity", "entityType"]),
        replacedFields: Array.from(new Set(replacedFields)),
        confidence: 0.92,
        needsClarification: false,
        intent: {
          name: "search_school_index",
          slots: {
            type,
            q,
            lockedEntityType: type,
            week: next.teachingWeek || undefined,
            weekday: next.weekday || undefined,
            periodHint: next.periodHint || undefined,
            campus: next.campus || undefined,
          },
          followUp: true,
          confidence: 0.92,
        },
      };
    }
  }

  // Campus swap without known goal — still try weather if only campus words
  if (campus && isCampusSwapOnly(text)) {
    return {
      kind: "follow_up_modify_constraint",
      goal: "get_campus_weather",
      entityType: "",
      entity: "",
      constraints: next,
      inheritedFields,
      replacedFields: ["campus"],
      confidence: 0.75,
      needsClarification: false,
      intent: {
        name: "get_campus_weather",
        slots: {
          campus: next.campus,
          dateOffset: next.dateOffset != null ? next.dateOffset : undefined,
          dateHint: next.dateHint || undefined,
        },
        followUp: true,
        confidence: 0.75,
      },
    };
  }

  return null;
}

/**
 * Merge follow-up result into working state after a successful turn.
 */
function applyTurnToWorkingState(previous, turn = {}) {
  const prev = normalizeConversationWorkingState(previous);
  const next = Object.assign({}, prev);
  if (turn.activeGoal || turn.goal) next.activeGoal = safeText(turn.activeGoal || turn.goal, 160);
  if (turn.pendingClarification !== undefined) next.pendingClarification = turn.pendingClarification;
  if (turn.entityType || turn.lastEntityType) {
    next.lastEntityType = safeText(turn.entityType || turn.lastEntityType, 40);
  }
  if (turn.entity || turn.lastEntity) {
    next.lastEntity = safeText(turn.entity || turn.lastEntity, 120);
  }
  if (turn.lastResolvedEntity) next.lastResolvedEntity = turn.lastResolvedEntity;
  if (turn.constraints || turn.lastConstraints) {
    next.lastConstraints = normalizeConstraints(
      Object.assign({}, prev.lastConstraints, turn.constraints || turn.lastConstraints)
    );
  }
  if (Array.isArray(turn.tools) || Array.isArray(turn.lastSuccessfulTools)) {
    const tools = (turn.tools || turn.lastSuccessfulTools || []).map((t) => safeText(t, 80)).filter(Boolean);
    next.lastSuccessfulTools = Array.from(new Set(prev.lastSuccessfulTools.concat(tools))).slice(-12);
  }
  if (turn.pendingAction !== undefined) next.pendingAction = turn.pendingAction;
  next.updatedAt = new Date().toISOString();
  return normalizeConversationWorkingState(next);
}

module.exports = {
  emptyConstraints,
  emptyConversationWorkingState,
  normalizeConstraints,
  normalizeConversationWorkingState,
  inferCampus,
  parseDateOffset,
  parseContinuousSections,
  isCampusSwapOnly,
  isConstraintOnlyFollowUp,
  resolveFollowUp,
  applyTurnToWorkingState,
};
