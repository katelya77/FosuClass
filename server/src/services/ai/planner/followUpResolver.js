/**
 * Unified Follow-up Resolver for multi-turn constraint inheritance.
 * Handles omission, pronouns, corrections, and constraint replacement.
 * Pure functions — no I/O.
 *
 * M4-T1: this module is the single follow-up resolution implementation the
 * repository converges on. The legacy exports (resolveFollowUp & friends,
 * above) keep their exact shipped behavior for current callers
 * (toolRegistry, goalResolver) until M4-T2 rewires those call sites. The
 * GoalContract-V2-aware entry point `resolve({ message, goalContractV2,
 * workingState, pendingClarification })` is appended below as an additive
 * export; it consumes V2 contracts (or V1 payloads upgraded through the V2
 * adapter), the typed conversation working state, and stored
 * working-memory goal contracts.
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
 * M4-T3: field set aligned with memory/workingMemory and the task contract —
 * activeGoal / pendingClarification / lastGoalContract / lastResolvedEntity /
 * lastConstraints / pendingAction / providerUsed / understandingSource
 * (plus the legacy lastEntity(Type)/lastSuccessfulTools/lastResultRefs fields).
 */
function emptyConversationWorkingState() {
  return {
    activeGoal: "",
    pendingClarification: null,
    lastEntityType: "",
    lastEntity: "",
    lastResolvedEntity: null,
    lastConstraints: emptyConstraints(),
    lastGoalContract: null,
    lastSuccessfulTools: [],
    lastResultRefs: [],
    pendingAction: null,
    providerUsed: "",
    understandingSource: "",
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

// pendingClarification unified shape (M4-T3 three-party alignment): the same
// 5-key payload produced by runtime/verificationCoordinator.buildClarificationPatch
// and stored by memory/workingMemory.normalizeStoredPendingClarification —
//   { intentName, type, missing, createdAt, expiresAt }
// Normalization only coerces keys/types; expiry stays consumer-owned
// (pickPendingClarification re-checks expiresAt), so expired entries are kept
// and only malformed payloads degrade to null. Local copy on purpose: the
// planner must not depend on the memory layer.
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

function normalizeConversationWorkingState(raw = {}) {
  const base = emptyConversationWorkingState();
  if (!raw || typeof raw !== "object") return base;
  const next = Object.assign({}, base);
  next.activeGoal = safeText(raw.activeGoal || raw.currentGoal, 160);
  next.pendingClarification = normalizeStoredPendingClarification(raw.pendingClarification);
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
  // M4-T3 alignment: stored goal contract rides the typed working state in the
  // same V2-normalized form workingMemory keeps (never throws; unupgradable
  // payloads degrade to null, mirroring normalizeStoredGoalContract).
  next.lastGoalContract = coerceGoalContractV2Input(raw.lastGoalContract).contract;
  next.providerUsed = safeText(raw.providerUsed, 40);
  next.understandingSource = safeText(raw.understandingSource, 40);
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
  if (/大后天/.test(value)) return { dateOffset: 3, dateHint: "in_3_days" };
  if (/后天/.test(value)) return { dateOffset: 2, dateHint: "day_after_tomorrow" };
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

// ---------------------------------------------------------------------------
// GoalContract V2-aware unified follow-up resolution (M4-T1)
//
// `resolve()` is the single follow-up decision point this repository
// converges on (migration plan M4). It consumes:
//   - message:            current user message (raw text);
//   - goalContractV2:     current turn GoalContract — normalized V2, or a V1
//                         payload upgraded via the V2 adapter (never throws);
//   - workingState:       typed conversation working state / working memory
//                         (activeGoal, lastEntity(Type), lastResolvedEntity,
//                         lastConstraints, lastSuccessfulTools,
//                         pendingClarification, stored lastGoalContract);
//   - pendingClarification: explicit override that takes precedence over the
//                         working state's own pendingClarification.
// It returns a structured resolution:
//   { resolvedIntent, inheritedEntities, followUpMode, provenance,
//     goalId, entities, constraints, confidence }
// with followUpMode "none" + resolvedIntent null for non-follow-up messages
// (pass-through, never a false positive). The legacy exports above are left
// untouched for M4-T2 to retire call sites onto this function.
// ---------------------------------------------------------------------------

const goalContractV2 = require("../understanding/goalContractV2");

const V2_CONTRACT_VERSION = goalContractV2.CONTRACT_VERSION;
const GOAL_ID_SET = new Set(goalContractV2.GOAL_IDS);
const ENTITY_SEARCH_GOAL = "search_school_index";
const PERSONAL_SCHEDULE_GOALS = new Set([
  "get_today_courses",
  "get_tomorrow_courses",
  "get_next_course",
  "get_week_schedule",
]);
const DECLARED_FOLLOW_UP_MODES = new Set([
  "inherit_active_goal",
  "inherit_last_entity",
  "replace_constraints",
  "fill_pending_clarification",
  "correction",
]);
const INHERITABLE_ENTITY_ROLES = new Set(["teacher", "class", "classroom", "course"]);
// Date/campus/task vocabulary in the *new* half of "不是A，是B" means the
// message is a constraint/task statement, not an entity correction.
const CORRECTION_NEW_VALUE_BLACKLIST = /天气|空教室|空课室|课表|今天|今日|明天|明日|后天|星期|周[一二三四五六日天1-7]|上午|下午|晚上|早上|导入|提醒|诊断|设为|打开|吗/;
const PENDING_FILL_BLACKLIST = /空教室|天气|今天|明天|后天|导入|提醒|诊断|怎么用|你能做什么|换成|改成|不是/;

/**
 * Coerce a GoalContract input into the normalized V2 shape. Accepts an
 * already-V2 contract or a legacy V1 payload (upgraded through the V2
 * adapter). Never throws — an unupgradable payload degrades to null so the
 * resolver can still work from working state alone (mirrors
 * runtime/goalContractResolver.toRuntimeGoalContractV2 and
 * memory/workingMemory.normalizeStoredGoalContract degradation semantics).
 */
function coerceGoalContractV2Input(raw) {
  const none = { contract: null, source: "none" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return none;
  try {
    if (raw.contractVersion === V2_CONTRACT_VERSION) {
      return { contract: goalContractV2.normalizeGoalContractV2(raw), source: "v2" };
    }
    if (typeof raw.goal === "string" && raw.goal) {
      return {
        contract: goalContractV2.fromV1Contract(raw, {
          source: "adapter",
          understandingSource: "followup_resolver_v1_input",
        }),
        source: "v1_upgraded",
      };
    }
  } catch (error) {
    return none;
  }
  return none;
}

// Working memory stores goalIds from the manifest, but legacy working states
// may carry pre-manifest goal labels (e.g. "open_schedule"). Only manifest
// goalIds may leave this resolver.
function mapLegacyGoalId(goal) {
  const value = String(goal || "").trim();
  if (!value) return "";
  if (GOAL_ID_SET.has(value)) return value;
  if (value === "open_schedule") return ENTITY_SEARCH_GOAL;
  return "";
}

// Goal preference: current turn contract > stored contract > working state.
// clarify_missing_slot is a conversation state, not a resolvable goal.
function resolveGoalIdPreference({ contract, previousContract, state }) {
  const fromContract = contract && contract.goalId !== "clarify_missing_slot" ? contract.goalId : "";
  const fromStored = previousContract && previousContract.goalId !== "clarify_missing_slot" ? previousContract.goalId : "";
  return fromContract || fromStored || mapLegacyGoalId(state.activeGoal);
}

// Map V1/V2 contract constraints (understanding/goalContract.js shape) into
// the working-state constraint shape used by this resolver.
function mapContractConstraints(raw = {}) {
  const mapped = {};
  if (!raw || typeof raw !== "object") return mapped;
  if (raw.date) mapped.date = raw.date;
  if (raw.dateOffset != null) mapped.dateOffset = raw.dateOffset;
  if (raw.dateHint) mapped.dateHint = raw.dateHint;
  const week = raw.teachingWeek != null ? raw.teachingWeek : raw.week;
  if (week != null) mapped.teachingWeek = week;
  if (raw.weekday != null) mapped.weekday = raw.weekday;
  if (raw.periodHint) mapped.periodHint = raw.periodHint;
  if (raw.campus) mapped.campus = raw.campus;
  if (raw.collegeCode) mapped.collegeCode = raw.collegeCode;
  const continuous = raw.continuousSections != null ? raw.continuousSections : raw.minFreeSections;
  if (continuous != null) mapped.continuousSections = continuous;
  if (raw.building) mapped.building = raw.building;
  if (raw.sections != null) {
    mapped.sections = Array.isArray(raw.sections) ? raw.sections.join(",") : raw.sections;
  }
  return mapped;
}

// goalResolver.mergeConstraints parity: working-state constraints are the
// base; non-empty contract constraints overlay them.
function mergeConstraintBase(state, contract) {
  const base = normalizeConstraints(state.lastConstraints || {});
  if (!contract) return base;
  const overlay = normalizeConstraints(mapContractConstraints(contract.constraints || {}));
  const merged = Object.assign({}, base);
  Object.keys(overlay).forEach((key) => {
    if (overlay[key] !== "" && overlay[key] != null) merged[key] = overlay[key];
  });
  return merged;
}

function trackInheritedConstraints(base, replaced) {
  return Object.keys(base).filter((key) => base[key] !== "" && base[key] != null && !replaced.includes(key));
}

// Message-derived constraint updates shared by every constraint path. The
// regexes are the same primitives the legacy resolver uses; `replaced` lists
// the working-shape keys this turn changed (legacy replacedFields parity).
function applyMessageConstraintUpdates(message, base) {
  const next = Object.assign({}, base);
  const replaced = [];
  const mark = (key) => {
    if (!replaced.includes(key)) replaced.push(key);
  };

  const campus = inferCampus(message);
  if (campus && campus !== next.campus) {
    next.campus = campus;
    mark("campus");
  }

  const dateInfo = parseDateOffset(message);
  if (dateInfo) {
    next.dateOffset = dateInfo.dateOffset;
    next.dateHint = dateInfo.dateHint;
    mark("dateOffset");
  }

  const continuous = parseContinuousSections(message);
  if (continuous != null) {
    next.continuousSections = continuous;
    mark("continuousSections");
  }

  const weekdayMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
  const weekdayMatch = compact(message).match(/周([一二三四五六日天1-7])/) || compact(message).match(/星期([一二三四五六日天])/);
  if (weekdayMatch && weekdayMap[weekdayMatch[1]] != null) {
    next.weekday = weekdayMap[weekdayMatch[1]];
    mark("weekday");
  }
  const weekMatch = compact(message).match(/第(\d{1,2})周/) || compact(message).match(/换成(\d{1,2})周/);
  if (weekMatch) {
    next.teachingWeek = Number(weekMatch[1]);
    mark("teachingWeek");
  }
  if (/上午|早上/.test(message)) {
    next.periodHint = "morning";
    mark("periodHint");
  } else if (/下午/.test(message)) {
    next.periodHint = "afternoon";
    mark("periodHint");
  } else if (/晚上|夜间/.test(message)) {
    next.periodHint = "evening";
    mark("periodHint");
  }
  return { constraints: next, replaced };
}

// Date-word short follow-ups ("还是明天" / "那后天呢") — the legacy gate
// deliberately excludes date words; the V2 resolver adds them so time
// constraint switches resolve through the same unified path.
function isDateOnlyFollowUp(text) {
  const value = compact(text);
  if (!value || value.length > 16) return false;
  return /^(那|还是|换成|改成|继续|再|就看|看)?(今天|今日|明天|明日|后天|大后天)(呢|啊|呀)?[？?！!。.]?$/.test(value);
}

function isContinuousRefineFollowUp(text) {
  return /只看连续|连续两节空教室|连着两节/.test(compact(text));
}

// "刚才那个班" / "那(个)老师呢" — short anaphoric reference to the entity
// resolved earlier this thread. Digit-bearing messages are concrete new
// queries, not anaphora.
function isAnaphoricEntityReference(text) {
  const value = compact(text);
  if (!value || value.length > 16) return false;
  if (/\d/.test(value)) return false;
  if (/空教室|天气|课表|设为|打开|导入|提醒|不是|换成|改成|星期/.test(value)) return false;
  if (/刚才|刚刚|上个|之前/.test(value)) return true;
  return /^(那个|那|这|该)(个|位|间|门)?(班|班级|老师|教师|教室|课程|课)(的|呢|啊)?/.test(value);
}

/**
 * Parse "不是A，是B" self-corrections. Returns { oldValue, newValue } or null.
 * Conservative: questions ("是不是…吗") and constraint/task statements are
 * rejected so ordinary messages never trigger the correction path.
 */
function parseEntityCorrection(message) {
  const value = compact(message);
  if (!value || value.length > 40) return null;
  if (/^是不是/.test(value) || /吗/.test(value)) return null;
  const match = value.match(/^不是(.{1,24}?)[，,；;、]*(?:是|应该是|应该是|改成|改为|换成|换为)(.{1,24}?)$/);
  if (!match) return null;
  const stripTail = (item) => String(item || "").replace(/[呢啊呀吧嘛]+/, "").replace(/[？?！!。.]+$/, "");
  const oldValue = stripTail(match[1]);
  const newValue = stripTail(match[2]);
  if (!oldValue || !newValue) return null;
  if (CORRECTION_NEW_VALUE_BLACKLIST.test(newValue)) return null;
  return { oldValue, newValue };
}

function markInheritedEntity(entity, inheritedFrom) {
  return {
    role: safeText(entity.role, 24).toLowerCase(),
    value: safeText(entity.value, 120),
    normalizedValue: safeText(entity.normalizedValue != null ? entity.normalizedValue : entity.value, 120),
    confidence: Number.isFinite(Number(entity.confidence)) ? Number(entity.confidence) : 0.85,
    provenance: "deterministic",
    inheritedFrom: safeText(inheritedFrom, 40),
  };
}

// Entity inheritance order (goalResolver :132-141 parity):
// lastResolvedEntity > lastEntity/lastEntityType > stored contract entities.
function inheritedEntityFromState(state, contract, previousContract) {
  if (state.lastResolvedEntity && state.lastResolvedEntity.name) {
    return markInheritedEntity({
      role: state.lastResolvedEntity.type || "class",
      value: state.lastResolvedEntity.name,
      confidence: 0.9,
    }, "last_resolved_entity");
  }
  if (state.lastEntity) {
    return markInheritedEntity({
      role: state.lastEntityType || "class",
      value: state.lastEntity,
      confidence: 0.85,
    }, "working_state");
  }
  const fromStored = previousContract && previousContract.entities
    .find((entity) => INHERITABLE_ENTITY_ROLES.has(entity.role));
  if (fromStored) return markInheritedEntity(fromStored, "last_goal_contract");
  const fromContract = contract && contract.entities
    .find((entity) => INHERITABLE_ENTITY_ROLES.has(entity.role));
  if (fromContract) return markInheritedEntity(fromContract, "current_contract");
  return null;
}

function pickPendingClarification(explicit, state) {
  const pending = (explicit && typeof explicit === "object" && explicit) || state.pendingClarification || null;
  if (!pending || typeof pending !== "object") return null;
  const expiresAt = Number(pending.expiresAt || 0);
  if (expiresAt > 0 && expiresAt < Date.now()) return null;
  return pending;
}

function buildWeatherResolutionIntent(constraints, confidence) {
  return {
    name: "get_campus_weather",
    slots: {
      campus: constraints.campus || undefined,
      dateOffset: constraints.dateOffset != null ? constraints.dateOffset : undefined,
      dateHint: constraints.dateHint || undefined,
      date: constraints.date || undefined,
    },
    followUp: true,
    confidence,
  };
}

function buildEmptyRoomsIntent(goalId, constraints, confidence) {
  const continuous = goalId === "search_empty_rooms" && constraints.continuousSections == null;
  return {
    name: continuous ? "search_empty_rooms" : "search_continuous_empty_rooms",
    slots: {
      campus: constraints.campus || undefined,
      building: constraints.building || undefined,
      minFreeSections: constraints.continuousSections || (continuous ? undefined : 2),
      date: constraints.date || undefined,
      dateOffset: constraints.dateOffset != null ? constraints.dateOffset : undefined,
      week: constraints.teachingWeek || undefined,
      weekday: constraints.weekday || undefined,
      periodHint: constraints.periodHint || undefined,
    },
    followUp: true,
    confidence,
  };
}

function buildSchoolIndexIntent(role, value, constraints, confidence, extraSlots = {}) {
  return {
    name: ENTITY_SEARCH_GOAL,
    slots: Object.assign({
      type: role,
      q: value,
      lockedEntityType: role,
      week: constraints.teachingWeek || undefined,
      weekday: constraints.weekday || undefined,
      periodHint: constraints.periodHint || undefined,
      campus: constraints.campus || undefined,
    }, extraSlots),
    followUp: true,
    confidence,
  };
}

// Date switch on personal-schedule goals: offset 0 → today, 1 → tomorrow;
// other offsets keep the active goal and carry dateOffset as a slot.
function buildPersonalScheduleIntent(goalId, constraints, confidence) {
  let name = PERSONAL_SCHEDULE_GOALS.has(goalId) ? goalId : "get_today_courses";
  if (constraints.dateOffset === 0) name = "get_today_courses";
  else if (constraints.dateOffset === 1) name = "get_tomorrow_courses";
  return {
    name,
    slots: {
      dateOffset: constraints.dateOffset != null ? constraints.dateOffset : undefined,
      dateHint: constraints.dateHint || undefined,
      week: constraints.teachingWeek || undefined,
      weekday: constraints.weekday || undefined,
      periodHint: constraints.periodHint || undefined,
    },
    followUp: true,
    confidence,
  };
}

function followUpResult({ followUpMode, goalId, intent, entities, inheritedEntities, constraints, provenanceBase, extraProvenance, confidence }) {
  return {
    resolvedIntent: intent,
    inheritedEntities: inheritedEntities || [],
    followUpMode,
    provenance: Object.assign({}, provenanceBase, extraProvenance || {}),
    goalId: goalId || "",
    entities: entities || [],
    constraints,
    confidence: Number(confidence) || 0,
  };
}

// "不是A，是B": replace the entity addressed by `role` with the new value and
// redo the previous search-shaped goal. Entity corrections re-run
// search_school_index because a corrected name has no verified detailId yet
// (set_current_schedule / get_schedule_detail require one). Campus
// corrections update the campus constraint instead (campus lives in
// constraints, not in the entity slot, throughout the legacy chain).
function resolveCorrection({ correction, state, contract, previousContract, constraintsBase, provenanceBase }) {
  const stripNameAffix = (item) => String(item || "").replace(/老师|教师/g, "");
  const oldBare = stripNameAffix(correction.oldValue);
  const matches = (value) => {
    if (!value) return false;
    const bare = stripNameAffix(value);
    return Boolean(bare) && (bare === oldBare || String(value) === correction.oldValue);
  };

  let role = "";
  if (state.lastResolvedEntity && matches(state.lastResolvedEntity.name)) role = state.lastResolvedEntity.type || "";
  if (!role && state.lastEntity && matches(state.lastEntity)) role = state.lastEntityType || "";
  if (!role) {
    const hit = (contract ? contract.entities : []).concat(previousContract ? previousContract.entities : [])
      .find((entity) => matches(entity.value) || matches(entity.normalizedValue));
    if (hit) role = hit.role;
  }
  if (!role && inferCampus(correction.newValue)) role = "campus";
  if (!role && /班/.test(correction.newValue)) role = "class";
  if (!role && /老师|教师/.test(correction.oldValue)) role = "teacher";
  if (!role) role = state.lastEntityType || "";
  if (!role) role = /^[\u3400-\u9fff·]{2,4}$/.test(correction.newValue) ? "teacher" : "class";

  if (role === "campus") {
    const campus = inferCampus(correction.newValue) || safeText(correction.newValue, 40);
    if (!campus) return null;
    const constraints = Object.assign({}, constraintsBase, { campus });
    const goalId = resolveGoalIdPreference({ contract, previousContract, state });
    const tools = state.lastSuccessfulTools || [];
    const emptyRoomLike = /empty_room|search_empty|search_continuous/.test(goalId)
      || tools.some((tool) => /empty_room/.test(tool));
    const intent = emptyRoomLike
      ? buildEmptyRoomsIntent("search_continuous_empty_rooms", constraints, 0.9)
      : buildWeatherResolutionIntent(constraints, 0.9);
    return followUpResult({
      followUpMode: "correction",
      goalId: intent.name,
      intent,
      entities: [{ role: "campus", value: campus, normalizedValue: campus, confidence: 0.9, provenance: "deterministic" }],
      inheritedEntities: [],
      constraints,
      provenanceBase,
      extraProvenance: {
        correction: true,
        replacedRoles: ["campus"],
        replacedConstraints: ["campus"],
        inheritedConstraints: trackInheritedConstraints(constraintsBase, ["campus"]),
        correctedFrom: safeText(correction.oldValue, 60),
      },
      confidence: 0.9,
    });
  }

  if (!INHERITABLE_ENTITY_ROLES.has(role)) return null;
  const value = role === "teacher" ? stripNameAffix(correction.newValue) : String(correction.newValue || "");
  if (!value || value.length > 40) return null;
  const previousEntities = (previousContract ? previousContract.entities : [])
    .filter((entity) => entity.role !== role && INHERITABLE_ENTITY_ROLES.has(entity.role))
    .map((entity) => markInheritedEntity(entity, "last_goal_contract"));
  const intent = buildSchoolIndexIntent(role, value, constraintsBase, 0.9, {
    correctedFrom: safeText(correction.oldValue, 60),
  });
  return followUpResult({
    followUpMode: "correction",
    goalId: ENTITY_SEARCH_GOAL,
    intent,
    entities: [{ role, value, normalizedValue: value, confidence: 0.9, provenance: "deterministic" }],
    inheritedEntities: previousEntities,
    constraints: constraintsBase,
    provenanceBase,
    extraProvenance: {
      correction: true,
      replacedRoles: [role],
      inheritedConstraints: trackInheritedConstraints(constraintsBase, []),
      correctedFrom: safeText(correction.oldValue, 60),
    },
    confidence: 0.9,
  });
}

// Bare entity message while a pending clarification is active fills the
// missing slot (legacy fill_pending_entity parity for teacher, generalized
// to class/classroom/course per goalResolver.resolvePendingEntityContract).
function resolvePendingFill({ message, pending, state, contract, previousContract, constraintsBase, provenanceBase }) {
  const role = String(pending.type || "").toLowerCase();
  if (!INHERITABLE_ENTITY_ROLES.has(role)) return null;
  let entity = compact(message);
  if (role === "teacher") entity = entity.replace(/老师|教师/g, "");
  const valid = role === "teacher"
    ? entity.length >= 2 && entity.length <= 12
      && /^[\u3400-\u9fffA-Za-z·]+$/.test(entity)
      && !/天气|空教室|课表|设为|打开|换成/.test(entity)
    : entity.length >= 2 && entity.length <= 40 && !PENDING_FILL_BLACKLIST.test(entity);
  if (!valid) return null;
  const goalId = mapLegacyGoalId(pending.intentName)
    || resolveGoalIdPreference({ contract, previousContract, state })
    || ENTITY_SEARCH_GOAL;
  const intent = {
    name: goalId,
    slots: {
      type: role,
      q: entity,
      lockedEntityType: role,
      filledFromPendingClarification: true,
      missing: safeText(pending.missing, 40) || undefined,
    },
    followUp: true,
    confidence: 0.95,
  };
  return followUpResult({
    followUpMode: "fill_pending_clarification",
    goalId,
    intent,
    entities: [{ role, value: entity, normalizedValue: entity, confidence: 0.95, provenance: "deterministic" }],
    inheritedEntities: [],
    constraints: constraintsBase,
    provenanceBase,
    extraProvenance: {
      filledSlot: safeText(pending.missing, 40),
      inheritedConstraints: trackInheritedConstraints(constraintsBase, []),
    },
    confidence: 0.95,
  });
}

// Contract-declared follow-up modes: the understanding layer judged this turn
// a follow-up; this resolver performs the deterministic inheritance the mode
// declares (constraint merge / entity inheritance / correction replacement).
function resolveContractDeclared({ message, contract, previousContract, state, constraintsBase, provenanceBase }) {
  const mode = contract.followUpMode;
  const goalId = GOAL_ID_SET.has(contract.goalId) ? contract.goalId : "";
  if (!goalId || goalId === "clarify_missing_slot" || goalId === "conversational_help") return null;

  const contractEntities = (contract.entities || []).filter((entity) => entity.role !== "none" && entity.value);
  let effectiveEntities = contractEntities.map((entity) => markInheritedEntity(entity, "current_contract"));
  let inheritedEntities = [];
  let replacedRoles = [];
  if (mode === "correction") {
    replacedRoles = effectiveEntities.map((entity) => entity.role);
    inheritedEntities = (previousContract ? previousContract.entities : [])
      .filter((entity) => !replacedRoles.includes(entity.role) && INHERITABLE_ENTITY_ROLES.has(entity.role))
      .map((entity) => markInheritedEntity(entity, "last_goal_contract"));
  } else if (!effectiveEntities.length && ["inherit_last_entity", "inherit_active_goal", "fill_pending_clarification"].includes(mode)) {
    const inherited = inheritedEntityFromState(state, contract, previousContract);
    if (inherited) {
      effectiveEntities = [inherited];
      inheritedEntities = [inherited];
    }
  } else if (effectiveEntities.length) {
    inheritedEntities = effectiveEntities;
  }

  const updates = applyMessageConstraintUpdates(message, constraintsBase);
  const constraints = updates.constraints;
  const primary = effectiveEntities.find((entity) => INHERITABLE_ENTITY_ROLES.has(entity.role) || entity.role === "campus") || null;
  const confidence = Math.max(0.7, Math.min(1, Number(contract.confidence) || 0.85));
  let intent = null;
  if (goalId === ENTITY_SEARCH_GOAL) {
    if (!primary || !INHERITABLE_ENTITY_ROLES.has(primary.role)) return null;
    intent = buildSchoolIndexIntent(primary.role, primary.normalizedValue || primary.value, constraints, confidence);
  } else if (goalId === "get_campus_weather") {
    const campus = (primary && primary.role === "campus" && primary.value) || constraints.campus;
    if (!campus) return null;
    intent = buildWeatherResolutionIntent(Object.assign({}, constraints, { campus }), confidence);
  } else if (goalId === "search_empty_rooms" || goalId === "search_continuous_empty_rooms") {
    intent = buildEmptyRoomsIntent(goalId, constraints, confidence);
  } else if (goalId === "set_current_schedule") {
    const resolved = state.lastResolvedEntity || null;
    const name = (primary && primary.value) || (resolved && resolved.name) || "";
    const detailId = (resolved && resolved.id) || "";
    if (!name || !detailId) return null;
    intent = {
      name: "set_current_schedule",
      slots: { detailId, name: compact(name), explicitCommand: true },
      followUp: true,
      confidence,
    };
  } else if (PERSONAL_SCHEDULE_GOALS.has(goalId)) {
    intent = buildPersonalScheduleIntent(goalId, constraints, confidence);
  } else {
    intent = { name: goalId, slots: {}, followUp: true, confidence };
  }
  return followUpResult({
    followUpMode: mode,
    goalId: intent.name,
    intent,
    entities: effectiveEntities,
    inheritedEntities,
    constraints,
    provenanceBase,
    extraProvenance: {
      correction: mode === "correction",
      replacedRoles,
      replacedConstraints: updates.replaced,
      inheritedConstraints: trackInheritedConstraints(constraintsBase, updates.replaced),
    },
    confidence,
  });
}

// Deterministic constraint-only follow-ups ("换成江湾" / "还是明天" /
// "那周三呢" / "只看连续两节空教室"): update the constraints the message
// names, inherit everything else, and rebuild the intent for the active
// goal family (weather / empty rooms / personal schedule / school index).
function resolveConstraintFollowUp({ message, state, contract, previousContract, constraintsBase, provenanceBase }) {
  const goalId = resolveGoalIdPreference({ contract, previousContract, state });
  const updates = applyMessageConstraintUpdates(message, constraintsBase);
  const constraints = updates.constraints;
  const tools = state.lastSuccessfulTools || [];
  const compacted = compact(message);
  const campus = inferCampus(message);
  const continuous = parseContinuousSections(message);

  const weatherLike = /get_campus_weather|get_course_weather_advice|weather|天气/.test(goalId)
    || tools.some((tool) => /weather/.test(tool));
  const emptyRoomLike = /empty_room|search_empty|search_continuous|空教室/.test(goalId)
    || tools.some((tool) => /empty_room/.test(tool))
    || continuous != null;

  let intent = null;
  let confidence = 0.9;
  let entities = [];
  let inheritedEntities = [];
  if (weatherLike && (campus || updates.replaced.includes("dateOffset")) && !/空教室|课表|教师|班级/.test(compacted)) {
    intent = buildWeatherResolutionIntent(constraints, 0.96);
    confidence = 0.96;
  } else if (emptyRoomLike && (continuous != null || campus || constraints.periodHint || constraints.weekday != null)) {
    intent = buildEmptyRoomsIntent("search_continuous_empty_rooms", constraints, 0.94);
    confidence = 0.94;
  } else if (PERSONAL_SCHEDULE_GOALS.has(goalId)) {
    intent = buildPersonalScheduleIntent(goalId, constraints, 0.92);
    confidence = 0.92;
  } else {
    const inherited = inheritedEntityFromState(state, contract, previousContract);
    if (inherited) {
      entities = [inherited];
      inheritedEntities = [inherited];
      intent = buildSchoolIndexIntent(inherited.role, inherited.value, constraints, 0.92);
      confidence = 0.92;
    }
  }
  if (!intent && campus && isCampusSwapOnly(message)) {
    intent = buildWeatherResolutionIntent(constraints, 0.75);
    confidence = 0.75;
  }
  if (!intent) return null;
  return followUpResult({
    followUpMode: "replace_constraints",
    goalId: intent.name,
    intent,
    entities,
    inheritedEntities,
    constraints,
    provenanceBase,
    extraProvenance: {
      replacedConstraints: updates.replaced,
      inheritedConstraints: trackInheritedConstraints(constraintsBase, updates.replaced),
    },
    confidence,
  });
}

// "刚才那个班": inherit the entity resolved earlier this thread and rebuild
// the search intent with any constraint tweaks the message carries.
function resolveAnaphoraFollowUp({ message, state, contract, previousContract, constraintsBase, provenanceBase }) {
  const inherited = inheritedEntityFromState(state, contract, previousContract);
  if (!inherited) return null;
  const updates = applyMessageConstraintUpdates(message, constraintsBase);
  const intent = buildSchoolIndexIntent(inherited.role, inherited.value, updates.constraints, 0.9);
  return followUpResult({
    followUpMode: "inherit_last_entity",
    goalId: ENTITY_SEARCH_GOAL,
    intent,
    entities: [inherited],
    inheritedEntities: [inherited],
    constraints: updates.constraints,
    provenanceBase,
    extraProvenance: {
      replacedConstraints: updates.replaced,
      inheritedConstraints: trackInheritedConstraints(constraintsBase, updates.replaced),
    },
    confidence: 0.9,
  });
}

/**
 * Unified GoalContract-V2-aware follow-up resolution (M4 single implementation).
 * @param {{message?: string, goalContractV2?: object, workingState?: object, pendingClarification?: object}} input
 * @returns {{resolvedIntent: object|null, inheritedEntities: object[], followUpMode: string, provenance: object, goalId: string, entities: object[], constraints: object, confidence: number}}
 */
function resolve(input = {}) {
  const safeInput = input && typeof input === "object" ? input : {};
  const message = String(safeInput.message == null ? "" : safeInput.message).trim();
  const rawState = safeInput.workingState && typeof safeInput.workingState === "object" ? safeInput.workingState : {};
  const state = normalizeConversationWorkingState(rawState);
  const coerced = coerceGoalContractV2Input(safeInput.goalContractV2);
  const contract = coerced.contract;
  const previousContract = coerceGoalContractV2Input(rawState.lastGoalContract).contract;
  const constraintsBase = mergeConstraintBase(state, contract);
  const provenanceBase = {
    source: "deterministic",
    resolver: "planner.followUpResolver",
    contractSource: coerced.source,
    correction: false,
    replacedRoles: [],
    replacedConstraints: [],
    inheritedConstraints: [],
  };
  const noneResult = () => followUpResult({
    followUpMode: "none",
    goalId: resolveGoalIdPreference({ contract, previousContract, state }),
    intent: null,
    entities: [],
    inheritedEntities: [],
    constraints: constraintsBase,
    provenanceBase,
    extraProvenance: { inheritedConstraints: trackInheritedConstraints(constraintsBase, []) },
    confidence: 0,
  });
  if (!message) return noneResult();

  try {
    // 1. Explicit self-correction ("不是A，是B") — most specific signal.
    const correction = parseEntityCorrection(message);
    if (correction) {
      const corrected = resolveCorrection({ correction, state, contract, previousContract, constraintsBase, provenanceBase });
      if (corrected) return corrected;
    }
    // 2. Pending clarification slot fill (explicit param wins over state).
    const pending = pickPendingClarification(safeInput.pendingClarification, state);
    if (pending) {
      const filled = resolvePendingFill({ message, pending, state, contract, previousContract, constraintsBase, provenanceBase });
      if (filled) return filled;
    }
    // 3. Contract-declared follow-up mode (understanding layer judgment).
    if (contract && DECLARED_FOLLOW_UP_MODES.has(contract.followUpMode)) {
      const declared = resolveContractDeclared({ message, contract, previousContract, state, constraintsBase, provenanceBase });
      if (declared) return declared;
    }
    // 4. Deterministic constraint-only gates (legacy parity + date words).
    if (isConstraintOnlyFollowUp(message) || isCampusSwapOnly(message)
      || isDateOnlyFollowUp(message) || isContinuousRefineFollowUp(message)) {
      const replaced = resolveConstraintFollowUp({ message, state, contract, previousContract, constraintsBase, provenanceBase });
      if (replaced) return replaced;
    }
    // 5. Anaphoric entity reference ("刚才那个班").
    if (isAnaphoricEntityReference(message)) {
      const anaphora = resolveAnaphoraFollowUp({ message, state, contract, previousContract, constraintsBase, provenanceBase });
      if (anaphora) return anaphora;
    }
  } catch (error) {
    // Chat-path safety: follow-up resolution must never break a turn.
    return noneResult();
  }
  return noneResult();
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
  // GoalContract V2-aware unified resolution (M4-T1, additive).
  coerceGoalContractV2Input,
  isDateOnlyFollowUp,
  isAnaphoricEntityReference,
  parseEntityCorrection,
  resolve,
};
