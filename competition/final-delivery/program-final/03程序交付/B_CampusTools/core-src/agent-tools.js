/**
 * R50.0 Agent Tool HTTP Façade（零依赖 CommonJS）。
 *
 * 13 个 Agent-facing 工具作为 REST alias 暴露给腾讯 ADP，禁止 ADP 依赖
 * 仓库内未部署的 r49-ma adapter：
 *
 *   campus_schedule_query        -> query_schedule
 *   campus_classroom_search      -> find_available_classrooms
 *   campus_risk_check            -> compare_schedules   （self/compare 模式确定性转换）
 *   campus_day_plan              -> generate_day_plan    （visitorId 可选，缺失时确定性使用 demoUsers[0].id）
 *   campus_overview              -> get_campus_teaching_overview
 *   campus_teacher_load_query    -> query_teacher_load   （教学周窗口教师负载排名）
 *   campus_schedule_range_query  -> query_schedule_range （多教学周课表逐周展开）
 *   campus_entity_search         -> query_entity_search  （R50.0：实体搜索/清单）
 *   campus_academic_context      -> get_academic_context （R50.0：Temporal Semantic Core，暴露 temporalContext）
 *   campus_common_free_time_query -> query_common_free_time （R50.0：多实体共同空闲）
 *   campus_room_utilization_query -> query_room_utilization （R50.0：教室利用率 Ranking Core）
 *   campus_reschedule_feasibility -> check_reschedule_feasibility （R50.0：调课 What-if 模拟）
 *   campus_group_plan            -> plan_group          （R50.0：群体计划 ranked 候选）
 *
 * 底层 CampusTools 与 MCP 接口保持不变；本模块只做参数映射与失败关闭校验，
 * 动态校园事实仍然只由 CampusTools 确定性计算。
 */

const { callTool } = require("./tools");
const { loadDataset } = require("./data");
const { fail, ERR } = require("./envelope");

function loadDecisionRuntime() {
  try {
    // Cloud Function / submission bundle: generated colocated runtime.
    return require("./decision/runtime-activation.js");
  } catch (error) {
    if (!error || error.code !== "MODULE_NOT_FOUND" || !String(error.message).includes("decision/runtime-activation.js")) throw error;
    // Canonical repository source: keep Decision Core as the SSOT.
    return require("../../../r51/decision/runtime-activation.js");
  }
}

const ADP_CONTRACT_VERSION = "R50.0";

const AGENT_TOOL_MAP = Object.freeze({
  campus_schedule_query: "query_schedule",
  campus_classroom_search: "find_available_classrooms",
  campus_risk_check: "compare_schedules",
  campus_day_plan: "generate_day_plan",
  campus_overview: "get_campus_teaching_overview",
  campus_teacher_load_query: "query_teacher_load",
  campus_schedule_range_query: "query_schedule_range",
  campus_entity_search: "query_entity_search",
  campus_academic_context: "get_academic_context",
  campus_common_free_time_query: "query_common_free_time",
  campus_room_utilization_query: "query_room_utilization",
  campus_reschedule_feasibility: "check_reschedule_feasibility",
  campus_group_plan: "plan_group",
});

const AGENT_TOOL_PATHS = Object.freeze(Object.keys(AGENT_TOOL_MAP));

function isAgentToolPath(name) {
  return AGENT_TOOL_PATHS.includes(name);
}

/**
 * 将 Agent-facing 参数确定性转换为底层 CampusTools 参数。
 * 返回 { params, mode } 或 { error: envelope }（FAIL CLOSED）。
 */
function resolveAgentParams(name, rawParams) {
  const input = { ...(rawParams || {}) };

  if (name === "campus_risk_check") {
    const mode = input.mode === "compare" ? "compare" : "self";
    delete input.mode;
    if (mode === "self") {
      // 禁止模型生成第二对象：second=first 由服务端确定性复制。
      if (!input.entityType || !input.entityName) {
        return { error: fail(ERR.MISSING_PARAM, "self 模式需要 entityType 与 entityName", {}) };
      }
      input.secondEntityType = input.entityType;
      input.secondEntityName = input.entityName;
    } else if (!input.secondEntityType || !input.secondEntityName) {
      return { error: fail(ERR.MISSING_PARAM, "compare 模式需要 secondEntityType 与 secondEntityName", {}) };
    }
    const { entityType, entityName, secondEntityType, secondEntityName, ...rest } = input;
    return {
      params: {
        firstType: entityType,
        firstName: entityName,
        secondType: secondEntityType,
        secondName: secondEntityName,
        ...rest,
      },
      mode,
    };
  }

  if (name === "campus_day_plan") {
    // visitorId 可选：缺失时只允许确定性使用当前加载数据集的 demoUsers[0].id。
    if (!input.visitorId) {
      const { data } = loadDataset();
      const first = data.demoUsers && data.demoUsers[0];
      if (!first || !first.id) {
        return { error: fail(ERR.INTERNAL, "当前数据源缺少 demoUsers[0].id，无法确定性补齐 visitorId", null) };
      }
      input.visitorId = first.id;
    }
    return { params: input };
  }

  return { params: input };
}

/**
 * 调用 Agent Tool（façade）：先转换参数，再调用底层 CampusTools。
 */
function callAgentTool(name, params, trustedContext) {
  const campusTool = AGENT_TOOL_MAP[name];
  if (!campusTool) {
    return fail(ERR.INVALID_PARAM, `未知 Agent Tool ${name}`, { allowed: AGENT_TOOL_PATHS });
  }
  const request = { ...(params || {}) };
  const decisionPreferences = request.decisionPreferences;
  delete request.decisionPreferences;
  const resolved = resolveAgentParams(name, request);
  if (resolved.error) return resolved.error;
  const raw = callTool(campusTool, resolved.params);
  if (!raw || raw.success !== true) return raw;
  const { activateDecisionForTool } = loadDecisionRuntime();
  const decision = activateDecisionForTool(name, { ...request, decisionPreferences }, raw, trustedContext || {});
  return decision ? { ...raw, decision } : raw;
}

module.exports = {
  ADP_CONTRACT_VERSION,
  AGENT_TOOL_MAP,
  AGENT_TOOL_PATHS,
  isAgentToolPath,
  resolveAgentParams,
  callAgentTool,
};
