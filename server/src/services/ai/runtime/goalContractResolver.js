const { fromV1Contract } = require("../understanding/goalContractV2");

// Understanding still emits GoalContract V1 (the model JSON schema is unchanged
// in this phase). The runtime upgrades it to the unified GoalContract V2 for
// internal state (working memory lastGoalContract); agent.v1/agent.v2 protocol
// responses keep the V1 shape. Next phase: let the model emit V2 JSON directly
// and drop this adapter. Never throws — a failed upgrade must not break chat.
function toRuntimeGoalContractV2(understanding) {
  try {
    if (!understanding || !understanding.contract) return null;
    return fromV1Contract(understanding.contract, {
      source: "adapter",
      provider: understanding.providerUsed || "",
      understandingSource: understanding.source || "",
    });
  } catch (error) {
    return null;
  }
}

/**
 * Soft-fill intent slots from Working Memory for follow-ups and incomplete queries.
 */
function enrichIntentFromWorkingMemory(intent, context = {}, conversationState = null) {
  if (!intent || typeof intent !== "object") return intent;
  const wm = (conversationState && conversationState.workingMemory)
    || context.workingMemory
    || {};
  const slots = Object.assign({}, intent.slots || {});
  const className = String(wm.className || slots.className || "").replace(/\s+/g, "");
  const teacherName = String(wm.teacherName || slots.teacherName || "").replace(/\s+/g, "");

  if (intent.name === "search_school_index" || intent.followUp === true) {
    if (!slots.q) {
      if (className) {
        slots.q = className;
        slots.type = slots.type || "class";
        slots.className = className;
      } else if (teacherName) {
        slots.q = teacherName;
        slots.type = slots.type || "teacher";
      }
    } else {
      slots.q = String(slots.q).replace(/\s+/g, "");
      if (!slots.type && /班/.test(slots.q)) slots.type = "class";
    }
    if ((slots.week == null || slots.week === "" || Number(slots.week) === 0)
      && wm.teachingWeek != null && Number(wm.teachingWeek) >= 1) {
      slots.week = Number(wm.teachingWeek);
    }
    if ((slots.weekday == null || slots.weekday === "" || Number(slots.weekday) === 0)
      && wm.weekday != null && Number(wm.weekday) >= 1) {
      slots.weekday = Number(wm.weekday);
    }
    if (!slots.periodHint && wm.periodHint) slots.periodHint = wm.periodHint;
  }

  if (/get_today_courses|get_tomorrow_courses|get_week_schedule|search_empty_rooms|search_continuous_empty_rooms/.test(String(intent.name || ""))) {
    if ((slots.week == null || Number(slots.week) === 0) && wm.teachingWeek != null && Number(wm.teachingWeek) >= 1) {
      slots.week = Number(wm.teachingWeek);
    }
    if ((slots.weekday == null || Number(slots.weekday) === 0) && wm.weekday != null && Number(wm.weekday) >= 1) {
      slots.weekday = Number(wm.weekday);
    }
    if (!slots.campus && wm.campus) slots.campus = wm.campus;
    if (!slots.periodHint && wm.periodHint) slots.periodHint = wm.periodHint;
  }

  return Object.assign({}, intent, { slots });
}

module.exports = {
  toRuntimeGoalContractV2,
  enrichIntentFromWorkingMemory,
};
