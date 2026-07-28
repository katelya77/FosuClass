const capabilityManifestService = require("../capabilityManifestService");
const followUpResolver = require("../planner/followUpResolver");
const { normalizeGoalContract } = require("./goalContract");

function compact(value) {
  return String(value == null ? "" : value).replace(/\s+/g, "").trim();
}

function workingStateFrom(input = {}) {
  const conversationState = input.conversationState || {};
  const workingMemory = conversationState.workingMemory || input.workingMemory || input.context && input.context.workingMemory || {};
  return followUpResolver.normalizeConversationWorkingState(
    Object.assign({}, workingMemory, {
      pendingClarification: conversationState.pendingClarification
        || input.context && input.context.pendingClarification
        || workingMemory.pendingClarification
        || null,
    })
  );
}

function activeSearchClarification(state = {}) {
  const pending = state.pendingClarification;
  if (!pending || pending.intentName !== "search_school_index") return null;
  if (!["teacher", "class", "classroom", "course"].includes(pending.type)) return null;
  const expiresAt = Number(pending.expiresAt || 0);
  if (expiresAt && expiresAt < Date.now()) return null;
  return pending;
}

function resolvePendingEntityContract(contract, state, message) {
  const pending = activeSearchClarification(state);
  const entity = compact(message);
  const compatibleGoal = ["clarify_missing_slot", "conversational_help", "search_school_index"].includes(contract.goal);
  if (!pending || !compatibleGoal || entity.length < 2 || entity.length > 40) return contract;
  if (/空教室|天气|今天|明天|后天|导入|提醒|诊断|怎么用|你能做什么/.test(entity)) return contract;
  return normalizeGoalContract({
    goal: "search_school_index",
    entityType: pending.type,
    entity,
    normalizedEntity: entity,
    constraints: contract.constraints || {},
    followUpMode: "fill_pending_clarification",
    confidence: Math.max(0.85, Number(contract.confidence) || 0),
    needsClarification: false,
  });
}

function resolveClarificationType(contract, deterministicHint = {}) {
  if (contract.goal !== "clarify_missing_slot" || contract.entityType !== "none") return contract;
  const slots = deterministicHint && deterministicHint.slots && typeof deterministicHint.slots === "object"
    ? deterministicHint.slots
    : {};
  const hintedType = String(slots.type || slots.slot && slots.slot.type || "").toLowerCase();
  if (!["teacher", "class", "classroom", "course", "campus"].includes(hintedType)) return contract;
  return normalizeGoalContract(Object.assign({}, contract, { entityType: hintedType }));
}

const INHERITABLE_ENTITY_ROLES = new Set(["teacher", "class", "classroom", "course"]);

function mergeConstraints(contract, state, followUpResolution) {
  const current = contract.constraints || {};
  if (["inherit_active_goal", "inherit_last_entity", "replace_constraints", "fill_pending_clarification"].includes(contract.followUpMode)) {
    // M4-T2: the follow-up merge base (working-state constraints overlaid by
    // the contract, plus message-declared constraint switches) is decided by
    // the single follow-up resolver. The raw contract constraints still
    // overlay last so V1-only keys (detailId/sections/college…) and explicit
    // values keep their exact legacy semantics.
    const inherited = followUpResolution && followUpResolution.constraints && typeof followUpResolution.constraints === "object"
      ? followUpResolution.constraints
      : state.lastConstraints || {};
    return Object.assign({}, inherited, current);
  }
  return Object.assign({}, current);
}

// Project the single follow-up resolver's inheritance decision back into V1
// entity fields. The resolver's order (lastResolvedEntity > lastEntity >
// stored contract > current contract) is the authority; this helper only
// picks the first inheritable entity it returned.
function inheritedEntityFromResolution(resolution) {
  if (!resolution || typeof resolution !== "object") return null;
  const candidates = (Array.isArray(resolution.entities) ? resolution.entities : [])
    .concat(Array.isArray(resolution.inheritedEntities) ? resolution.inheritedEntities : []);
  const hit = candidates.find((item) => item
    && INHERITABLE_ENTITY_ROLES.has(String(item.role || "").toLowerCase())
    && String(item.value == null ? "" : item.value).trim());
  return hit
    ? { role: String(hit.role).toLowerCase(), value: String(hit.value) }
    : null;
}

function commonSlots(constraints = {}) {
  const slots = {};
  const copy = [
    "date", "dateOffset", "dateHint", "weekday", "periodHint", "campus", "building",
    "sections", "sectionStart", "sectionEnd", "durationSections", "term", "releaseVersion",
    "detailId", "grade", "majorCode", "majorName", "className", "teacherName", "courseName",
    "classroom", "q", "type", "collegeCode", "collegeName",
  ];
  copy.forEach((key) => {
    if (constraints[key] !== undefined && constraints[key] !== null && constraints[key] !== "") {
      slots[key] = constraints[key];
    }
  });
  if (constraints.teachingWeek != null) slots.week = constraints.teachingWeek;
  else if (constraints.week != null) slots.week = constraints.week;
  if (constraints.continuousSections != null) slots.minFreeSections = constraints.continuousSections;
  else if (constraints.minFreeSections != null) slots.minFreeSections = constraints.minFreeSections;
  if (constraints.college && !slots.collegeName) slots.collegeName = constraints.college;
  return slots;
}

function clarificationIntent(entityType, goal, entity = "") {
  const missingByType = {
    teacher: "teacherName",
    class: "className",
    classroom: "classroom",
    course: "courseName",
    campus: "campus",
  };
  const missing = missingByType[entityType] || "taskTarget";
  const prompts = {
    teacher: "请告诉我教师姓名，例如陈芳。",
    class: "请告诉我完整班级名称。",
    classroom: "请告诉我教室名称。",
    course: "请告诉我课程名称。",
    campus: "请告诉我校区名称。",
  };
  return {
    name: "clarify_missing_slot",
    slots: {
      slot: { missing, type: entityType || "none", prompt: prompts[entityType] || "请再补充一下任务目标。" },
      missing,
      type: entityType || "none",
      q: compact(entity),
      activeGoal: goal,
    },
    confidence: 1,
  };
}

function resolveGoalContract(input = {}) {
  let contract = normalizeGoalContract(input.contract || {});
  if (!capabilityManifestService.getIntent(contract.goal)) {
    const error = new Error(`Goal is not in manifest: ${contract.goal}`);
    error.code = "GOAL_CONTRACT_GOAL_NOT_ALLOWED";
    throw error;
  }
  const state = workingStateFrom(input);
  contract = resolveClarificationType(contract, input.deterministicHint || {});
  contract = resolvePendingEntityContract(contract, state, input.message || "");
  // M4-T2: follow-up constraint merge + entity inheritance delegate to the
  // single implementation (planner/followUpResolver.resolve). The V1 contract
  // is upgraded through the resolver's V2 adapter; resolution never throws.
  const followUpResolution = followUpResolver.resolve({
    message: input.message || "",
    goalContractV2: contract,
    workingState: state,
  });
  const constraints = mergeConstraints(contract, state, followUpResolution);
  const slots = commonSlots(constraints);
  let entityType = contract.entityType;
  let entity = compact(contract.normalizedEntity || contract.entity);
  let inheritedEntity = null;
  if (!entity && ["inherit_last_entity", "inherit_active_goal", "fill_pending_clarification"].includes(contract.followUpMode)) {
    inheritedEntity = state.lastResolvedEntity || null;
    const inherited = inheritedEntityFromResolution(followUpResolution);
    if (inherited) {
      entity = compact(inherited.value);
      entityType = inherited.role || entityType;
    }
  }

  let intent;
  if (contract.goal === "search_school_index") {
    if (contract.needsClarification || !entity || entityType === "none") {
      intent = clarificationIntent(entityType, contract.goal, entity);
    } else {
      intent = {
        name: contract.goal,
        slots: Object.assign({}, slots, {
          type: entityType,
          q: entity,
          lockedEntityType: entityType,
        }),
        confidence: contract.confidence,
        followUp: contract.followUpMode !== "new_goal",
      };
    }
  } else if (contract.goal === "get_campus_weather") {
    const campus = compact(entityType === "campus" ? entity : (constraints.campus || slots.campus));
    if (contract.needsClarification || !campus) intent = clarificationIntent("campus", contract.goal, campus);
    else intent = {
      name: contract.goal,
      slots: Object.assign({}, slots, { campus }),
      confidence: contract.confidence,
      followUp: contract.followUpMode !== "new_goal",
    };
  } else if (contract.goal === "search_empty_rooms" || contract.goal === "search_continuous_empty_rooms") {
    intent = {
      name: contract.goal,
      slots,
      confidence: contract.confidence,
      followUp: contract.followUpMode !== "new_goal",
    };
  } else if (contract.goal === "set_current_schedule") {
    const resolved = inheritedEntity || state.lastResolvedEntity || null;
    const detailId = compact(slots.detailId || resolved && (resolved.id || resolved.detailId));
    const name = compact(entity || slots.className || resolved && resolved.name);
    if (contract.needsClarification || !name || !detailId) {
      intent = clarificationIntent("class", contract.goal, name);
    } else {
      intent = {
        name: contract.goal,
        slots: Object.assign({}, slots, { detailId, name, explicitCommand: true }),
        confidence: contract.confidence,
        followUp: contract.followUpMode !== "new_goal",
      };
    }
  } else if (contract.needsClarification) {
    intent = clarificationIntent(entityType, contract.goal, entity);
  } else {
    if (entity) {
      slots.q = slots.q || entity;
      if (entityType !== "none") slots.type = slots.type || entityType;
    }
    intent = {
      name: contract.goal,
      slots,
      confidence: contract.confidence,
      followUp: contract.followUpMode !== "new_goal",
    };
  }

  return {
    contract,
    intent,
    constraints,
    inheritedEntity,
    workingState: state,
  };
}

module.exports = {
  commonSlots,
  resolveGoalContract,
};
