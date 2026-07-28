/**
 * Planner selection and budget policy by runtime mode.
 */

const capabilityManifestService = require("../capabilityManifestService");

function isGeneralAssistantEnabled(runtimeMode, env = process.env) {
  const mode = capabilityManifestService.normalizeRuntimeMode(runtimeMode);
  if (mode === "public") return false;
  if (mode === "dev") {
    if (env.AI_GENERAL_ASSISTANT_ENABLED === "0" || env.AI_GENERAL_ASSISTANT_ENABLED === "false") return false;
    return true;
  }
  // trial: admin/config switch; default off unless explicitly enabled
  return env.AI_GENERAL_ASSISTANT_ENABLED === "1" || env.AI_GENERAL_ASSISTANT_ENABLED === "true";
}

function getPlannerPolicy(runtimeMode, env = process.env) {
  const mode = capabilityManifestService.normalizeRuntimeMode(runtimeMode);
  const limits = capabilityManifestService.getManifest().limits || {};
  const maxPlanSteps = Math.min(5, Math.max(1, Number(env.AI_PLANNER_MAX_STEPS || limits.maxPlanSteps || 5) || 5));
  // 以代码现实为准：实际生效的 Replan 上限是 planSchema.MAX_REPLAN（2），
  // 由 observationLoop / deterministicPlanner 强制执行；该策略字段当前无消费方，口径对齐为 ≤2。
  const maxReplan = Math.min(2, Math.max(0, Number(env.AI_PLANNER_MAX_REPLAN || 2) || 2));
  const toolTimeoutMs = Math.max(10, Number(env.AI_TOOL_TIMEOUT_MS || limits.toolTimeoutMs || 8000) || 8000);
  const totalRunTimeoutMs = Math.max(toolTimeoutMs, Number(env.AI_RUN_TIMEOUT_MS || 25000) || 25000);
  const agentEnabled = !["false", "0"].includes(String(env.AI_AGENT_ENABLED == null ? "true" : env.AI_AGENT_ENABLED).toLowerCase());
  const modelPlannerEnabled = mode !== "public"
    && agentEnabled
    && (env.AI_MODEL_PLANNER_ENABLED === "1" || env.AI_MODEL_PLANNER_ENABLED === "true"
      || mode === "trial" || mode === "dev");

  return {
    runtimeMode: mode,
    useModelPlanner: modelPlannerEnabled && mode !== "public",
    maxPlanSteps,
    maxReplan,
    toolTimeoutMs,
    totalRunTimeoutMs,
    generalAssistantEnabled: isGeneralAssistantEnabled(mode, env),
    allowExpressionProvider: mode !== "public",
  };
}

function reasonCodeForTool(toolName) {
  const map = {
    get_today_courses: "NEED_CURRENT_SCHEDULE",
    get_tomorrow_courses: "NEED_CURRENT_SCHEDULE",
    get_next_course: "NEED_CURRENT_SCHEDULE",
    get_week_schedule: "NEED_CURRENT_SCHEDULE",
    get_teaching_week: "NEED_TEACHING_WEEK",
    get_term_calendar: "NEED_TEACHING_WEEK",
    search_empty_rooms: "NEED_EMPTY_ROOM_RESULTS",
    search_continuous_empty_rooms: "NEED_EMPTY_ROOM_RESULTS",
    get_campus_weather: "NEED_WEATHER",
    get_course_weather_advice: "NEED_WEATHER",
    search_campus_place: "NEED_CAMPUS_LOCATION",
    get_campus_route: "NEED_ROUTE",
    get_classroom_location: "NEED_CAMPUS_LOCATION",
    rag_search: "NEED_KNOWLEDGE",
    search_school_index: "NEED_SCHOOL_INDEX",
    get_schedule_detail: "NEED_SCHEDULE_DETAIL",
    diagnose_data_status: "NEED_DATA_STATUS",
    explain_personal_import: "NEED_PERSONAL_IMPORT_HELP",
    recommend_meeting_time: "NEED_MEETING_TIME",
    clarify_missing_slot: "NEED_USER_CLARIFICATION",
  };
  return map[String(toolName || "")] || "COMPOSE_TEXT_RESPONSE";
}

module.exports = {
  getPlannerPolicy,
  isGeneralAssistantEnabled,
  reasonCodeForTool,
};
