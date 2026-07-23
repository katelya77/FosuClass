/**
 * Deterministic planner for public (and fallback for trial/dev).
 * Builds structured plans from skill planBuilder + multi-step intent patterns.
 */

const capabilityManifestService = require("../capabilityManifestService");
const skillRegistry = require("../skillRegistry");
const toolRegistry = require("../toolRegistry");
const { emptyPlan, normalizePlan } = require("./planSchema");
const { validatePlan } = require("./planValidator");
const { reasonCodeForTool } = require("./plannerPolicy");

const CLARIFICATION_HINTS = {
  teacherName: {
    slot: "teacherName",
    prompt: "你想查询哪位老师？",
    suggestions: ["张老师", "李老师", "王老师"],
  },
  className: {
    slot: "className",
    prompt: "请告诉我班级名称，例如「25动医6班」。",
    suggestions: ["25动医6班", "本班课表"],
  },
  courseName: {
    slot: "courseName",
    prompt: "你想查哪门课程？",
    suggestions: [],
  },
  classroom: {
    slot: "classroom",
    prompt: "请提供教室编号，例如 C7-201。",
    suggestions: ["C7", "仙溪教学楼"],
  },
  campus: {
    slot: "campus",
    prompt: "请问是哪个校区？",
    suggestions: ["仙溪", "河滨", "魁奇"],
  },
  date: {
    slot: "date",
    prompt: "请问要查哪一天？",
    suggestions: ["今天", "明天", "周三"],
  },
  week: {
    slot: "week",
    prompt: "请问要查第几教学周？",
    suggestions: ["本周", "第16周"],
  },
  sections: {
    slot: "sections",
    prompt: "请问要查哪几节课的空教室？",
    suggestions: ["1-2节", "3-4节", "5-6节", "连续两节"],
  },
  duration: {
    slot: "duration",
    prompt: "你需要连续空闲多久？",
    suggestions: ["连续两节", "连续四节", "两小时"],
  },
};

function detectMissingSlot(message, intent) {
  const text = String(message || "");
  const name = intent && intent.name || "";
  const slots = (intent && intent.slots) || {};

  if (name === "clarify_missing_slot" && slots.slot) {
    const type = slots.slot.type || slots.slot.missing || "";
    if (type === "teacher" || /teacher/i.test(type)) return CLARIFICATION_HINTS.teacherName;
    if (type === "class" || /class/i.test(type)) return CLARIFICATION_HINTS.className;
    if (type === "course" || /course/i.test(type)) return CLARIFICATION_HINTS.courseName;
    if (type === "classroom" || /classroom|room/i.test(type)) return CLARIFICATION_HINTS.classroom;
  }

  if ((/查老师|教师课表|老师课表/.test(text)) && !slots.q && !slots.teacherName) {
    return CLARIFICATION_HINTS.teacherName;
  }
  if ((/查班级|班级课表/.test(text)) && !slots.q && !slots.className) {
    return CLARIFICATION_HINTS.className;
  }
  if ((/空教室/.test(text)) && !slots.sections && !slots.duration && !/现在|这节|当前|连续/.test(text)) {
    // soft: don't always clarify if default sections exist in tool
  }
  return null;
}

function expandMultiStepPlan(message, intent, context) {
  const text = String(message || "");
  const steps = [];
  const isStudyPlan = /自习|适合学习|哪里合适|规划.*自习|顺便.*天气|天气.*顺便/.test(text);
  const wantsWeather = /天气|下雨|雨|热不热|穿什么/.test(text);
  const wantsEmpty = /空教室|自习|空闲教室|找教室/.test(text);
  const wantsSchedule = /有课|课表|下一节|今[天日]|明[天日]|空档|空闲时间/.test(text);
  const wantsPlace = /怎么去|在哪里|地点|路线|附近/.test(text);

  if (intent && intent.name === "campus_multi_step_advice" || (isStudyPlan && (wantsEmpty || wantsWeather))) {
    if (wantsSchedule || /明天|下午|今天/.test(text)) {
      const tool = /明天/.test(text) ? "get_tomorrow_courses" : "get_today_courses";
      steps.push({
        toolName: tool,
        args: {},
        reasonCode: "NEED_CURRENT_SCHEDULE",
        stopOnFailure: false,
      });
    }
    if (wantsEmpty || isStudyPlan) {
      steps.push({
        toolName: /连续/.test(text) ? "search_continuous_empty_rooms" : "search_empty_rooms",
        args: {
          campus: (intent && intent.slots && intent.slots.campus) || context.campus || "仙溪",
          duration: /四节|4节/.test(text) ? 4 : 2,
        },
        reasonCode: "NEED_EMPTY_ROOM_RESULTS",
        dependsOn: steps.length ? [steps[steps.length - 1] && "step-1"].filter(Boolean) : [],
        stopOnFailure: false,
      });
    }
    if (wantsWeather) {
      steps.push({
        toolName: "get_campus_weather",
        args: {
          campus: (intent && intent.slots && intent.slots.campus) || "仙溪",
        },
        reasonCode: "NEED_WEATHER",
        stopOnFailure: false,
      });
    }
    if (wantsPlace) {
      steps.push({
        toolName: "search_campus_place",
        args: { q: (intent && intent.slots && intent.slots.q) || "教学楼" },
        reasonCode: "NEED_CAMPUS_LOCATION",
        stopOnFailure: false,
      });
    }
  }

  // "周三下午有课吗？没有的话帮我找教室" / multi-goal free-time + rooms + weather
  if ((/有课吗|有没有课|没.*找教室|没有.*教室|没课的话/.test(text) && wantsEmpty)
    || (wantsSchedule && wantsEmpty && wantsWeather)) {
    if (!steps.some((s) => /courses|schedule/.test(s.toolName))) {
      steps.unshift({
        toolName: /明天|明日/.test(text) ? "get_tomorrow_courses" : "get_today_courses",
        args: {},
        reasonCode: "NEED_CURRENT_SCHEDULE",
        stopOnFailure: false,
      });
    }
    if (!steps.some((s) => /empty_room/.test(s.toolName))) {
      steps.push({
        toolName: /连续/.test(text) ? "search_continuous_empty_rooms" : "search_empty_rooms",
        args: {
          duration: /四节|4节/.test(text) ? 4 : 2,
        },
        reasonCode: "NEED_EMPTY_ROOM_RESULTS",
        stopOnFailure: false,
      });
    }
    if (wantsWeather && !steps.some((s) => /weather/.test(s.toolName))) {
      steps.push({
        toolName: "get_campus_weather",
        args: {},
        reasonCode: "NEED_WEATHER",
        stopOnFailure: false,
      });
    }
  }

  return steps;
}

function plan(input = {}) {
  const message = String(input.message || "");
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(input.runtimeMode || "public");
  const intent = input.intent || { name: "conversational_help", slots: {}, confidence: 0 };
  const context = input.context || {};
  const skill = input.skill || skillRegistry.getSkillForIntent(intent.name);
  const clarification = detectMissingSlot(message, intent);

  if (clarification) {
    return validatePlan(normalizePlan({
      goal: "clarify_missing_slot",
      intent: "clarify_missing_slot",
      confidence: Number(intent.confidence) || 0.9,
      slots: intent.slots || {},
      needsClarification: true,
      clarification,
      steps: [{
        id: "step-1",
        skillId: "clarify_query",
        toolName: "clarify_missing_slot",
        args: { slot: clarification.slot, prompt: clarification.prompt },
        reasonCode: "NEED_USER_CLARIFICATION",
        stopOnFailure: true,
      }],
      stopCondition: "clarification_needed",
      plannerType: "deterministic",
    }), { runtimeMode, skill: skillRegistry.getSkill("clarify_query") });
  }

  // Prefer registered skill / toolRegistry plans for known multi-step intents so
  // capability contracts stay stable; use expandMultiStepPlan only as enrichment.
  const skillPlan = skill && typeof skill.planBuilder === "function"
    ? skill.planBuilder({ message, context, intent, runtimeMode })
    : toolRegistry.buildPlanForIntent(intent, message, context);
  const multi = expandMultiStepPlan(message, intent, context);
  let rawSteps = [];
  if (Array.isArray(skillPlan) && skillPlan.length) {
    rawSteps = skillPlan.map((step, index) => ({
      id: `step-${index + 1}`,
      skillId: skill && skill.id || "",
      toolName: step.toolName || step.name,
      args: step.args || step.input || {},
      reasonCode: reasonCodeForTool(step.toolName || step.name),
      dependsOn: [],
      stopOnFailure: true,
    }));
  } else if (multi.length) {
    rawSteps = multi.map((step, index) => ({
      id: `step-${index + 1}`,
      skillId: skill && skill.id || "campus_multi_step_advice",
      toolName: step.toolName,
      args: step.args || {},
      reasonCode: step.reasonCode || reasonCodeForTool(step.toolName),
      dependsOn: step.dependsOn || [],
      stopOnFailure: step.stopOnFailure !== false,
    }));
  }

  // Enrich skill plan with multi-step tools within Capability Router candidate set
  // (falls back to primary skill allowlist when availableTools not provided).
  if (rawSteps.length && multi.length) {
    const routeAllowed = new Set(
      (Array.isArray(input.availableTools) && input.availableTools.length
        ? input.availableTools
        : (skill && skill.allowedTools) || [])
    );
    const existing = new Set(rawSteps.map((s) => s.toolName));
    multi.forEach((step) => {
      if (!existing.has(step.toolName) && (!routeAllowed.size || routeAllowed.has(step.toolName))) {
        rawSteps.push({
          id: `step-${rawSteps.length + 1}`,
          skillId: skill && skill.id || "campus_multi_step_advice",
          toolName: step.toolName,
          args: step.args || {},
          reasonCode: step.reasonCode || reasonCodeForTool(step.toolName),
          dependsOn: [],
          stopOnFailure: false,
        });
        existing.add(step.toolName);
      }
    });
  }

  // Pure multi-goal when skill plan is empty/single but message needs composition.
  if (multi.length > 1 && rawSteps.length <= 1) {
    const routeAllowed = new Set(
      (Array.isArray(input.availableTools) && input.availableTools.length
        ? input.availableTools
        : multi.map((s) => s.toolName))
    );
    rawSteps = multi
      .filter((step) => routeAllowed.has(step.toolName))
      .map((step, index) => ({
        id: `step-${index + 1}`,
        skillId: "campus_multi_step_advice",
        toolName: step.toolName,
        args: step.args || {},
        reasonCode: step.reasonCode || reasonCodeForTool(step.toolName),
        dependsOn: step.dependsOn || [],
        stopOnFailure: step.stopOnFailure !== false,
      }));
  }

  // Conversational / knowledge without tools
  if (!rawSteps.length && (intent.name === "conversational_help" || intent.name === "project_qa")) {
    return validatePlan(normalizePlan({
      goal: safeGoal(intent),
      intent: intent.name,
      confidence: Number(intent.confidence) || 0.5,
      slots: intent.slots || {},
      needsClarification: false,
      steps: intent.name === "project_qa" || /知识|怎么办|如何|说明/.test(message)
        ? [{
          id: "step-1",
          skillId: "knowledge_search",
          toolName: "rag_search",
          args: { q: message.slice(0, 200) },
          reasonCode: "NEED_KNOWLEDGE",
          stopOnFailure: false,
        }]
        : [],
      stopCondition: "all_steps_done",
      plannerType: "deterministic",
    }), {
      runtimeMode,
      skill: skillRegistry.getSkill("knowledge_search") || skill,
      allowedTools: ["rag_search", "clarify_missing_slot"].concat(skill && skill.allowedTools || []),
    });
  }

  // Always include primary skill tools; Capability Router candidates expand, never shrink.
  const allowed = new Set((skill && skill.allowedTools) || []);
  if (Array.isArray(input.availableTools)) {
    input.availableTools.forEach((tool) => allowed.add(tool));
  }
  multi.forEach((s) => allowed.add(s.toolName));
  if (rawSteps.some((s) => s.toolName === "rag_search")) allowed.add("rag_search");
  // Multi-step study plans may use tools beyond single skill whitelist
  if (multi.length > 1 || rawSteps.length > 1) {
    ["get_today_courses", "get_tomorrow_courses", "search_empty_rooms", "search_continuous_empty_rooms",
      "get_campus_weather", "search_campus_place", "clarify_missing_slot"].forEach((t) => allowed.add(t));
  }

  return validatePlan(normalizePlan({
    goal: safeGoal(intent),
    intent: (multi.length > 1 || rawSteps.length > 1) && /空教室|天气|自习|有课/.test(message)
      ? "campus_multi_step_advice"
      : (intent.name || ""),
    confidence: Number(intent.confidence) || 0,
    slots: Object.assign({}, intent.slots || {}, context.conversationSlots || {}, input.conversationState && input.conversationState.contextSlots || {}),
    needsClarification: false,
    steps: rawSteps,
    stopCondition: "all_steps_done",
    plannerType: "deterministic",
  }), {
    runtimeMode,
    skill: (multi.length > 1 || rawSteps.length > 1)
      ? (skillRegistry.getSkill("campus_multi_step_advice") || skill)
      : skill,
    allowedTools: Array.from(allowed),
  });
}

function safeGoal(intent) {
  return String((intent && intent.displayName) || (intent && intent.name) || "campus_task").slice(0, 120);
}

function replan(input = {}) {
  const { MAX_REPLAN } = require("./planSchema");
  const previous = input.previousPlan || emptyPlan();
  const observations = Array.isArray(input.previousObservations) ? input.previousObservations : [];
  const replanCount = Math.max(0, Number(previous.replanCount) || 0) + 1;
  if (replanCount > MAX_REPLAN) {
    return validatePlan(normalizePlan({
      ...previous,
      replanCount,
      stopCondition: "budget_exhausted",
      steps: [],
    }), {
      runtimeMode: input.runtimeMode,
      allowedTools: [],
    });
  }

  const emptyRoomFailed = observations.some((obs) => {
    const tool = String(obs.tool || "");
    return /empty_room/.test(tool) && (obs.status === "failed" || Number(obs.factCount || 0) === 0);
  });
  const noSchedule = observations.some((obs) => {
    const tool = String(obs.tool || "");
    return /courses|schedule/.test(tool) && (obs.status === "failed" || Number(obs.factCount || 0) === 0
      || /NO_PERSONAL|EMPTY|无个人|未导入/.test(String(obs.code || obs.summary || "")));
  });

  if (noSchedule) {
    return validatePlan(normalizePlan({
      goal: "personal_schedule_import_help",
      intent: "explain_personal_import",
      confidence: 0.8,
      needsClarification: true,
      clarification: {
        slot: "freeTime",
        prompt: "当前没有可用的个人课表。你可以先导入个人课表，或直接告诉我空闲时段（例如「周三下午 3-4 节」）。",
        suggestions: ["怎么导入个人课表", "周三下午空教室", "连续两节空教室"],
      },
      steps: [{
        id: "step-1",
        skillId: "personal_schedule_import_help",
        toolName: "explain_personal_import",
        args: {},
        reasonCode: "NEED_PERSONAL_IMPORT_HELP",
        stopOnFailure: false,
      }],
      stopCondition: "clarification_needed",
      replanCount,
      plannerType: "deterministic",
    }), {
      runtimeMode: input.runtimeMode,
      allowedTools: ["explain_personal_import", "clarify_missing_slot"],
    });
  }

  if (emptyRoomFailed) {
    const prevArgs = (previous.steps || []).find((s) => /empty_room/.test(s.toolName));
    const duration = Math.max(2, Number(prevArgs && prevArgs.args && prevArgs.args.duration || 4) - 2);
    return validatePlan(normalizePlan({
      goal: "expand_empty_room_search",
      intent: previous.intent || "search_empty_rooms",
      confidence: 0.7,
      slots: previous.slots || {},
      steps: [{
        id: "step-1",
        skillId: "find_empty_room",
        toolName: duration >= 3 ? "search_continuous_empty_rooms" : "search_empty_rooms",
        args: Object.assign({}, prevArgs && prevArgs.args || {}, {
          duration,
          building: "", // broaden building filter
        }),
        reasonCode: "EXPAND_EMPTY_ROOM_SEARCH",
        stopOnFailure: false,
      }],
      stopCondition: "empty_result_recovery",
      replanCount,
      plannerType: "deterministic",
    }), {
      runtimeMode: input.runtimeMode,
      allowedTools: ["search_empty_rooms", "search_continuous_empty_rooms", "diagnose_data_status"],
    });
  }

  return validatePlan(normalizePlan({
    ...previous,
    replanCount,
    steps: [],
    stopCondition: "all_steps_done",
  }), {
    runtimeMode: input.runtimeMode,
    allowedTools: (previous.steps || []).map((s) => s.toolName),
  });
}

module.exports = {
  plan,
  replan,
  detectMissingSlot,
  expandMultiStepPlan,
};
