/**
 * Goal Contract: multi-skill required outcomes + verification.
 * Finish only when every requiredOutcome is satisfied or an acceptable partial is recorded.
 */

const OUTCOME_RULES = Object.freeze({
  tomorrow_schedule_checked: {
    tools: ["get_tomorrow_courses", "get_today_courses", "get_schedule_detail", "search_school_index"],
    acceptEmpty: true,
    emptyCodes: ["NO_PERSONAL", "EMPTY_RESULT", "NO_COURSES"],
  },
  today_schedule_checked: {
    tools: ["get_today_courses", "get_next_course", "get_schedule_detail", "search_school_index"],
    acceptEmpty: true,
    emptyCodes: ["NO_PERSONAL", "EMPTY_RESULT", "NO_COURSES"],
  },
  free_time_resolved: {
    tools: ["get_tomorrow_courses", "get_today_courses", "get_next_course"],
    acceptEmpty: true,
    emptyCodes: ["NO_PERSONAL", "EMPTY_RESULT", "NO_COURSES", "FREE"],
  },
  empty_room_resolved: {
    tools: ["search_empty_rooms", "search_continuous_empty_rooms"],
    acceptEmpty: true,
    emptyCodes: ["EMPTY", "NO_ROOM", "EMPTY_RESULT"],
  },
  weather_resolved: {
    tools: ["get_campus_weather", "get_course_weather_advice"],
    acceptEmpty: false,
    allowSoftFail: true,
    emptyCodes: ["UNAVAILABLE", "FAILED", "WEATHER_UNAVAILABLE"],
  },
  next_course_resolved: {
    tools: ["get_next_course", "get_today_courses"],
    acceptEmpty: true,
    emptyCodes: ["NO_PERSONAL", "EMPTY_RESULT", "NO_COURSES"],
  },
  final_recommendation_composed: {
    tools: [],
    composerOnly: true,
  },
  reminder_confirm_prepared: {
    tools: ["create_course_reminder", "list_course_reminders"],
    requireConfirmation: true,
  },
  schedule_health_checked: {
    tools: ["inspect_schedule_conflicts", "detect_schedule_changes"],
    acceptEmpty: true,
  },
});

function messageSuggestsOutcomes(message = "") {
  const text = String(message || "");
  const outcomes = [];
  if (/明天|明日/.test(text) && /课|有没有|有课/.test(text)) {
    outcomes.push("tomorrow_schedule_checked", "free_time_resolved");
  }
  if (/今天|今日/.test(text) && /课|有没有|有课/.test(text)) {
    outcomes.push("today_schedule_checked", "free_time_resolved");
  }
  if (/空教室|连续.*空|自习/.test(text)) {
    outcomes.push("empty_room_resolved");
  }
  if (/天气|下雨|雨/.test(text)) {
    outcomes.push("weather_resolved");
  }
  if (/顺便|同时|再|然后|没课的话|如果没课/.test(text) && outcomes.length) {
    outcomes.push("final_recommendation_composed");
  }
  if (/提醒|上课前/.test(text)) {
    outcomes.push("reminder_confirm_prepared");
  }
  if (/冲突|课表变化|缺教室/.test(text)) {
    outcomes.push("schedule_health_checked");
  }
  return Array.from(new Set(outcomes));
}

function deriveRequiredOutcomes(input = {}) {
  const fromPlan = Array.isArray(input.requiredOutcomes) ? input.requiredOutcomes.filter(Boolean) : [];
  if (fromPlan.length) return fromPlan.slice(0, 8);
  const fromMessage = messageSuggestsOutcomes(input.message || "");
  if (fromMessage.length >= 2) return fromMessage.slice(0, 8);
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const tools = steps.map((s) => s.toolName || s.name).filter(Boolean);
  const outcomes = [];
  if (tools.some((t) => /tomorrow/.test(t))) outcomes.push("tomorrow_schedule_checked", "free_time_resolved");
  if (tools.some((t) => /today|next_course/.test(t))) outcomes.push("today_schedule_checked");
  if (tools.some((t) => /empty_room/.test(t))) outcomes.push("empty_room_resolved");
  if (tools.some((t) => /weather/.test(t))) outcomes.push("weather_resolved");
  if (outcomes.length >= 2) outcomes.push("final_recommendation_composed");
  return Array.from(new Set(outcomes)).slice(0, 8);
}

function callMatchesOutcome(call, rule) {
  const name = String(call && call.name || call && call.tool || "");
  if (!rule.tools.length) return false;
  return rule.tools.some((t) => name === t || name.indexOf(t) >= 0 || t.indexOf(name) >= 0);
}

function observationMatchesOutcome(obs, rule) {
  const tool = String(obs && obs.tool || "");
  return rule.tools.some((t) => tool === t || tool.indexOf(t) >= 0);
}

/**
 * @returns {{ complete: boolean, satisfied: string[], missing: string[], partial: string[], outcomes: object[] }}
 */
function verifyGoalContract(input = {}) {
  const required = deriveRequiredOutcomes(input);
  if (!required.length) {
    return {
      complete: true,
      satisfied: [],
      missing: [],
      partial: [],
      outcomes: [],
      partialCompletion: false,
    };
  }

  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
  const observations = Array.isArray(input.observations) ? input.observations : [];
  const satisfied = [];
  const missing = [];
  const partial = [];
  const outcomes = [];

  required.forEach((outcomeId) => {
    const rule = OUTCOME_RULES[outcomeId];
    if (!rule) {
      satisfied.push(outcomeId);
      outcomes.push({ id: outcomeId, status: "unknown_accepted" });
      return;
    }
    if (rule.composerOnly) {
      // Satisfied when at least one other factual outcome resolved and we have an answer path.
      const othersOk = required
        .filter((id) => id !== outcomeId && OUTCOME_RULES[id] && !OUTCOME_RULES[id].composerOnly)
        .every((id) => satisfied.includes(id) || partial.includes(id));
      if (othersOk || input.answerComposed === true) {
        satisfied.push(outcomeId);
        outcomes.push({ id: outcomeId, status: "composed" });
      } else {
        // Defer — will be marked after re-check below
        outcomes.push({ id: outcomeId, status: "pending_compose" });
      }
      return;
    }

    const relatedCalls = toolCalls.filter((c) => callMatchesOutcome(c, rule));
    const relatedObs = observations.filter((o) => observationMatchesOutcome(o, rule));
    const any = relatedCalls.length || relatedObs.length;
    if (!any) {
      missing.push(outcomeId);
      outcomes.push({ id: outcomeId, status: "missing" });
      return;
    }

    const successCall = relatedCalls.find((c) => {
      if (c.status === "failed" || c.status === "error") return false;
      const result = c.result || {};
      if (result.success === false) return false;
      if (rule.requireConfirmation) return result.requiresConfirmation === true || result.pendingConfirmation === true;
      return true;
    });

    const failedSoft = relatedCalls.some((c) => {
      const code = String((c.result && c.result.code) || c.code || "");
      const status = c.status;
      return status === "failed" || (rule.allowSoftFail && rule.emptyCodes && rule.emptyCodes.some((ec) => code.indexOf(ec) >= 0));
    });

    const emptyOk = relatedCalls.some((c) => {
      const result = c.result || {};
      const code = String(result.code || "");
      const factCount = Number(result.total || result.courseCount || result.factCount || 0) || 0;
      if (factCount > 0) return false;
      if (rule.acceptEmpty && rule.emptyCodes && rule.emptyCodes.some((ec) => code.indexOf(ec) >= 0)) return true;
      if (rule.acceptEmpty && (result.success !== false)) return true;
      return false;
    });

    if (successCall && !rule.requireConfirmation) {
      const factCount = Number(
        (successCall.result && (successCall.result.total || successCall.result.courseCount || successCall.result.factCount))
        || 0
      ) || 0;
      if (factCount > 0 || rule.acceptEmpty || emptyOk) {
        satisfied.push(outcomeId);
        outcomes.push({ id: outcomeId, status: factCount > 0 ? "satisfied" : "empty_accepted", tool: successCall.name });
        return;
      }
    }

    if (rule.requireConfirmation && successCall) {
      satisfied.push(outcomeId);
      outcomes.push({ id: outcomeId, status: "confirm_prepared", tool: successCall.name });
      return;
    }

    if (rule.allowSoftFail && failedSoft) {
      partial.push(outcomeId);
      outcomes.push({ id: outcomeId, status: "soft_fail_accepted" });
      return;
    }

    if (emptyOk) {
      partial.push(outcomeId);
      outcomes.push({ id: outcomeId, status: "empty_partial" });
      return;
    }

    const failedHard = relatedCalls.every((c) => c.status === "failed" || (c.result && c.result.success === false));
    if (failedHard) {
      missing.push(outcomeId);
      outcomes.push({ id: outcomeId, status: "failed" });
      return;
    }

    // Tool ran with indeterminate result — treat as partial for multi-step UX.
    partial.push(outcomeId);
    outcomes.push({ id: outcomeId, status: "partial" });
  });

  // Resolve composer-only after other outcomes known
  required.forEach((outcomeId) => {
    const rule = OUTCOME_RULES[outcomeId];
    if (!rule || !rule.composerOnly) return;
    if (satisfied.includes(outcomeId) || missing.includes(outcomeId) || partial.includes(outcomeId)) return;
    const factual = required.filter((id) => id !== outcomeId && OUTCOME_RULES[id] && !OUTCOME_RULES[id].composerOnly);
    const factualOk = factual.every((id) => satisfied.includes(id) || partial.includes(id));
    if (factualOk) {
      satisfied.push(outcomeId);
      const entry = outcomes.find((o) => o.id === outcomeId);
      if (entry) entry.status = "composed";
    } else {
      missing.push(outcomeId);
    }
  });

  const complete = missing.length === 0;
  return {
    complete,
    satisfied,
    missing,
    partial,
    outcomes,
    partialCompletion: !complete && partial.length > 0 && missing.every((id) => {
      const rule = OUTCOME_RULES[id];
      return rule && rule.allowSoftFail;
    }),
    requiredOutcomes: required,
  };
}

module.exports = {
  OUTCOME_RULES,
  messageSuggestsOutcomes,
  deriveRequiredOutcomes,
  verifyGoalContract,
};
