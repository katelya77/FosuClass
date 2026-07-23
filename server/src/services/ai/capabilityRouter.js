/**
 * Capability Router: Goal/Intent → 1–3 related Skills → ≤8–12 candidate Tools.
 * Pure function over manifest + working memory + runtime mode.
 */

const capabilityManifestService = require("./capabilityManifestService");
const skillRegistry = require("./skillRegistry");

const MAX_SKILLS = 3;
const MAX_TOOLS = 12;
const MIN_TOOLS = 8;

const ALWAYS_TOOLS = Object.freeze([
  "clarify_missing_slot",
  "rag_search",
]);

const INTENT_RELATED_SKILLS = Object.freeze({
  campus_multi_step_advice: ["campus_multi_step_advice", "today_schedule", "tomorrow_schedule", "find_empty_room", "campus_weather"],
  get_today_courses: ["today_schedule", "find_empty_room", "campus_weather"],
  get_tomorrow_courses: ["tomorrow_schedule", "find_empty_room", "campus_weather", "campus_multi_step_advice"],
  get_next_course: ["next_course", "campus_place_navigation", "campus_weather"],
  search_empty_rooms: ["find_empty_room", "today_schedule", "campus_weather"],
  search_continuous_empty_rooms: ["find_continuous_empty_room", "find_empty_room", "today_schedule"],
  get_campus_weather: ["campus_weather", "today_schedule"],
  recommend_meeting_time: ["recommend_meeting_time", "find_empty_room", "today_schedule"],
  search_school_index: ["search_school_schedule"],
  get_schedule_detail: ["search_school_schedule"],
  manage_course_reminders: ["course_reminders", "today_schedule"],
  create_course_reminder: ["course_reminders", "today_schedule"],
  conversational_help: ["knowledge_search"],
  project_qa: ["knowledge_search"],
  course_action_advice: ["course_action_advice", "next_course", "campus_weather"],
  inspect_schedule_health: ["schedule_health", "today_schedule"],
});

const MESSAGE_TOOL_HINTS = Object.freeze([
  { re: /天气|下雨|雨|穿什么/, tools: ["get_campus_weather", "get_course_weather_advice"] },
  { re: /空教室|自习|空闲教室/, tools: ["search_empty_rooms", "search_continuous_empty_rooms", "diagnose_data_status"] },
  { re: /连续四节|连续两节|连续\s*[24]节/, tools: ["search_continuous_empty_rooms", "search_empty_rooms"] },
  { re: /明天|明日/, tools: ["get_tomorrow_courses"] },
  { re: /今天|今日|下一节|有没有课|有课吗/, tools: ["get_today_courses", "get_next_course"] },
  { re: /路线|怎么走|怎么去|在哪里/, tools: ["get_campus_route", "search_campus_place", "get_classroom_location"] },
  { re: /提醒|上课前/, tools: ["create_course_reminder", "list_course_reminders"] },
  { re: /冲突|课表变化|缺教室/, tools: ["inspect_schedule_conflicts", "detect_schedule_changes"] },
  { re: /教学周|第几周/, tools: ["get_teaching_week", "get_term_calendar"] },
  { re: /导入|个人课表|同步课表/, tools: ["explain_personal_import"] },
]);

function listManifestSkills() {
  try {
    return skillRegistry.listSkills() || [];
  } catch (_) {
    const manifest = capabilityManifestService.getManifest();
    return Object.values(manifest.skills || {}).map((s) => ({
      id: s.id,
      description: s.description,
      allowedTools: s.allowedTools || [],
      supportedIntents: s.supportedIntents || [],
      runtimeModes: s.runtimeModes || ["public", "trial", "dev"],
    }));
  }
}

function skillAllowedInMode(skill, runtimeMode) {
  const modes = skill.runtimeModes || ["public", "trial", "dev"];
  return modes.includes(runtimeMode);
}

function toolAllowedInMode(toolName, runtimeMode) {
  try {
    return capabilityManifestService.isToolAllowedForRuntime(toolName, runtimeMode);
  } catch (_) {
    return true;
  }
}

/**
 * @returns {{ skillIds: string[], skills: object[], candidateTools: string[], primarySkillId: string, routeReason: string }}
 */
function routeCapabilities(input = {}) {
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(input.runtimeMode || "public");
  const intentName = String(
    (input.intent && input.intent.name) || input.intentName || ""
  );
  const message = String(input.message || "");
  const primarySkill = input.skill
    || (intentName ? skillRegistry.getSkillForIntent(intentName) : null);
  const primarySkillId = primarySkill && primarySkill.id || "";
  const working = input.workingMemory || {};
  const allSkills = listManifestSkills().filter((s) => skillAllowedInMode(s, runtimeMode));

  const relatedIds = new Set();
  if (primarySkillId) relatedIds.add(primarySkillId);

  const mapped = INTENT_RELATED_SKILLS[intentName] || [];
  mapped.forEach((id) => relatedIds.add(id));

  // Working-memory driven expansion
  if (working.className || working.teachingWeek != null || /课表|有课/.test(message)) {
    relatedIds.add("today_schedule");
    relatedIds.add("search_school_schedule");
  }
  if (working.campus || /空教室|自习/.test(message)) relatedIds.add("find_empty_room");
  if (/天气/.test(message)) relatedIds.add("campus_weather");

  // Multi-goal utterances
  const multiGoal = (
    (/有课|课表/.test(message) && /空教室|自习|天气/.test(message))
    || (/顺便|同时|再|然后/.test(message) && /天气|空教室|课表/.test(message))
  );
  if (multiGoal) {
    ["today_schedule", "tomorrow_schedule", "find_empty_room", "campus_weather", "campus_multi_step_advice"].forEach((id) => {
      relatedIds.add(id);
    });
  }

  const selectedSkills = [];
  relatedIds.forEach((id) => {
    if (selectedSkills.length >= MAX_SKILLS) return;
    const skill = allSkills.find((s) => s.id === id) || skillRegistry.getSkill(id);
    if (skill && skillAllowedInMode(skill, runtimeMode)) selectedSkills.push(skill);
  });

  if (!selectedSkills.length && primarySkill) selectedSkills.push(primarySkill);
  if (!selectedSkills.length) {
    const fallback = skillRegistry.getSkill("knowledge_search") || allSkills[0];
    if (fallback) selectedSkills.push(fallback);
  }

  const toolSet = new Set(ALWAYS_TOOLS.filter((t) => toolAllowedInMode(t, runtimeMode)));
  selectedSkills.forEach((skill) => {
    (skill.allowedTools || []).forEach((tool) => {
      if (toolAllowedInMode(tool, runtimeMode)) toolSet.add(tool);
    });
  });

  MESSAGE_TOOL_HINTS.forEach((hint) => {
    if (hint.re.test(message)) {
      hint.tools.forEach((tool) => {
        if (toolAllowedInMode(tool, runtimeMode)) toolSet.add(tool);
      });
    }
  });

  // Prefer personal schedule tools when summary present
  if (input.context && input.context.currentScheduleSummary
    && input.context.currentScheduleSummary.enabled) {
    ["get_today_courses", "get_tomorrow_courses", "get_next_course"].forEach((t) => {
      if (toolAllowedInMode(t, runtimeMode)) toolSet.add(t);
    });
  }

  let candidateTools = Array.from(toolSet);
  // Bound to 8–12: if too many, keep primary skill tools + message hints + always
  if (candidateTools.length > MAX_TOOLS) {
    const priority = new Set(ALWAYS_TOOLS);
    if (primarySkill) (primarySkill.allowedTools || []).forEach((t) => priority.add(t));
    MESSAGE_TOOL_HINTS.forEach((hint) => {
      if (hint.re.test(message)) hint.tools.forEach((t) => priority.add(t));
    });
    const prioritized = candidateTools.filter((t) => priority.has(t));
    const rest = candidateTools.filter((t) => !priority.has(t));
    candidateTools = prioritized.concat(rest).slice(0, MAX_TOOLS);
  }

  // Ensure at least primary tools when under-filled
  if (candidateTools.length < Math.min(MIN_TOOLS, (primarySkill && primarySkill.allowedTools || []).length)) {
    (primarySkill && primarySkill.allowedTools || []).forEach((t) => {
      if (candidateTools.length >= MAX_TOOLS) return;
      if (toolAllowedInMode(t, runtimeMode) && !candidateTools.includes(t)) candidateTools.push(t);
    });
  }

  return {
    skillIds: selectedSkills.map((s) => s.id).slice(0, MAX_SKILLS),
    skills: selectedSkills.slice(0, MAX_SKILLS),
    candidateTools: candidateTools.slice(0, MAX_TOOLS),
    primarySkillId,
    primarySkill,
    multiSkill: selectedSkills.length > 1,
    routeReason: multiGoal ? "multi_goal_message" : (selectedSkills.length > 1 ? "related_skills" : "primary_skill"),
  };
}

/**
 * Tool safety level helpers for Level 0–4 autonomy policy.
 */
function getToolSafetyMeta(toolName) {
  const manifest = capabilityManifestService.getManifest();
  const tool = manifest.tools && manifest.tools[toolName];
  if (!tool) {
    return {
      toolName,
      safetyLevel: "low",
      operation: "read",
      requiresConfirmation: false,
      autonomyLevel: 1,
      parallelizable: true,
      idempotent: true,
    };
  }
  const safety = String(tool.safetyLevel || "low");
  const operation = String(tool.operation || (safety === "high" || safety === "critical" ? "write" : "read"));
  const confirmation = String(tool.confirmation || (operation === "write" || operation === "delete" ? "required" : "none"));
  let autonomyLevel = 1;
  if (operation === "delete" || safety === "critical") autonomyLevel = 4;
  else if (operation === "write" || confirmation === "required") autonomyLevel = 3;
  else if (safety === "medium") autonomyLevel = 2;
  else autonomyLevel = 1;

  return {
    toolName,
    purpose: tool.purpose || "",
    whenToUse: tool.whenToUse || "",
    whenNotToUse: tool.whenNotToUse || "",
    safetyLevel: safety,
    operation,
    requiresConfirmation: confirmation === "required" || confirmation === "double",
    requiresDoubleConfirm: confirmation === "double" || operation === "delete",
    autonomyLevel,
    parallelizable: tool.parallelizable !== false && operation === "read",
    idempotent: tool.idempotent !== false,
    estimatedLatency: tool.timeoutMs || tool.estimatedLatency || 2000,
    cacheTtl: tool.cacheTtl || 0,
    errorCodes: tool.errorCodes || [],
    inputSchema: tool.inputSchema || null,
    outputSchema: tool.outputSchema || null,
    prerequisites: tool.prerequisites || [],
  };
}

function classifyAutonomyLevel(planSteps = []) {
  const steps = Array.isArray(planSteps) ? planSteps : [];
  if (!steps.length) return 0;
  let max = 1;
  steps.forEach((step) => {
    const meta = getToolSafetyMeta(step.toolName || step.name);
    if (meta.autonomyLevel > max) max = meta.autonomyLevel;
  });
  if (steps.length > 1 && max < 2) max = 2;
  return max;
}

module.exports = {
  MAX_SKILLS,
  MAX_TOOLS,
  routeCapabilities,
  getToolSafetyMeta,
  classifyAutonomyLevel,
};
