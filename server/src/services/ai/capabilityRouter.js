/**
 * Capability Router: lightweight scoring over manifest skills/tools.
 *
 * M6-T2：工具候选唯一来源是 capability manifest——本文件不再手工列举任何
 * 工具 id。每个 intent 的候选工具经 manifestToolsForIntent 派生：
 * manifest intents[*].allowedTools ∩ 对应 skill.allowedTools ∩ 已注册执行 ∩
 * runtime 政策，与 T1 resolveManifestAllowedTools 同一口径，不旁路交集。
 * （Principal 因子在本层惰性：路由输入不含 principal——sanitizeAgentContext
 * 白名单不带该字段；计划/执行层由 buildPlanForIntent 与工具执行鉴权再次收口。）
 * 下方正则/权重仅是 Understanding 结构化意图未覆盖消息次级目标时的兜底匹配层：
 * 命中后只产出 intent 名，工具集仍经同一 manifest 派生交集获得。
 */

const capabilityManifestService = require("./capabilityManifestService");
const skillRegistry = require("./skillRegistry");
const toolRegistry = require("./toolRegistry");

const MAX_SKILLS = 3;
const MAX_TOOLS = 12;

/** 始终可用的兜底能力，以 intent 名声明；工具由 manifest 派生。 */
const BASELINE_INTENTS = Object.freeze(["clarify_missing_slot", "rag_search"]);

/**
 * 兜底匹配层：正则命中只映射到 intent 名（第二份手工工具 id 表已删除）。
 * skillBoost 仅是消息驱动的 skill 权重，不是能力来源。
 */
const MESSAGE_FALLBACK_HINTS = Object.freeze([
  { re: /天气|下雨|雨|穿什么/, intents: ["get_campus_weather", "get_course_weather_advice"], skillBoost: { campus_weather: 25 } },
  { re: /空教室|自习|空闲教室/, intents: ["search_empty_rooms", "search_continuous_empty_rooms", "diagnose_data_status"], skillBoost: { find_empty_room: 30, find_continuous_empty_room: 20 } },
  { re: /连续四节|连续两节|连续\s*[24]节/, intents: ["search_continuous_empty_rooms", "search_empty_rooms"], skillBoost: { find_continuous_empty_room: 35 } },
  { re: /明天|明日/, intents: ["get_tomorrow_courses"], skillBoost: { tomorrow_schedule: 25 } },
  { re: /今天|今日|下一节|有没有课|有课吗/, intents: ["get_today_courses", "get_next_course"], skillBoost: { today_schedule: 20, next_course: 15 } },
  { re: /路线|怎么走|怎么去|在哪里/, intents: ["get_campus_route", "search_campus_place", "get_classroom_location"], skillBoost: { campus_place_navigation: 30 } },
  { re: /提醒|上课前/, intents: ["manage_course_reminders"], skillBoost: { course_reminders: 35 } },
  { re: /冲突|课表变化|缺教室/, intents: ["inspect_schedule_health", "detect_schedule_changes"], skillBoost: { schedule_health: 30 } },
  { re: /教学周|第几周/, intents: ["get_teaching_week", "get_term_calendar"], skillBoost: {} },
  { re: /导入|个人课表|同步课表/, intents: ["explain_personal_import"], skillBoost: { personal_schedule_import_help: 30 } },
]);

/**
 * 单个 intent 的候选工具 = Intent ∩ Skill ∩ 已注册执行 ∩ Runtime 政策
 * （与 toolRegistry resolveManifestAllowedTools 同口径；Principal 因子见文件头说明）。
 * manifest 之外或未注册可执行的工具一律剔除（只收不放）。
 */
function manifestToolsForIntent(intentName, runtimeMode) {
  const intent = capabilityManifestService.getIntent(intentName && intentName.name || intentName);
  if (!intent || !Array.isArray(intent.allowedTools) || !intent.allowedTools.length) return [];
  const skill = capabilityManifestService.getManifest().skills[intent.skill];
  const skillTools = new Set(skill && Array.isArray(skill.allowedTools) ? skill.allowedTools : []);
  const registered = new Set(toolRegistry.listToolNames());
  return intent.allowedTools
    .map((toolName) => String(toolName))
    .filter((toolName) => skillTools.has(toolName)
      && registered.has(toolName)
      && capabilityManifestService.isToolAllowedForRuntime(toolName, runtimeMode));
}

/** 兜底基线工具：BASELINE_INTENTS 经 manifest 派生。 */
function baselineTools(runtimeMode) {
  const tools = [];
  BASELINE_INTENTS.forEach((intentName) => {
    manifestToolsForIntent(intentName, runtimeMode).forEach((toolName) => {
      if (!tools.includes(toolName)) tools.push(toolName);
    });
  });
  return tools;
}

/** 个人课表相关工具：manifest 中 needsPersonalScheduleSummary 意图的主工具（allowedTools 首项）。 */
function personalSchedulePrimaryTools(runtimeMode) {
  const manifest = capabilityManifestService.getManifest();
  const tools = [];
  Object.values(manifest.intents).forEach((intent) => {
    if (!intent || intent.needsPersonalScheduleSummary !== true) return;
    const primary = Array.isArray(intent.allowedTools) && intent.allowedTools.length
      ? String(intent.allowedTools[0])
      : "";
    if (primary && manifestToolsForIntent(intent.id, runtimeMode).includes(primary) && !tools.includes(primary)) {
      tools.push(primary);
    }
  });
  return tools;
}

/**
 * 全部 manifest intent 映射的工具并集（每个 intent 均过 Skill∩已注册∩Runtime 交集）。
 * skill 扩展路径的工具也必须落在该并集内：任何候选工具都可追溯到至少一条
 * manifest intent 映射，不存在游离的第二份语义表。真实 manifest 中 skill 工具
 * 集合与 intent 工具集合相等，因此该过滤对现状为零行为变化、只收不放。
 */
function manifestRoutableToolSet(runtimeMode) {
  const manifest = capabilityManifestService.getManifest();
  const set = new Set();
  Object.values(manifest.intents).forEach((intent) => {
    manifestToolsForIntent(intent && intent.id, runtimeMode).forEach((tool) => set.add(tool));
  });
  return set;
}

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

function toolHealthy(toolName, input = {}) {
  const health = input.toolHealth || input.context && input.context.toolHealth || {};
  if (!health || typeof health !== "object") return true;
  if (Object.prototype.hasOwnProperty.call(health, toolName)) {
    return health[toolName] !== false && health[toolName] !== "down";
  }
  return true;
}

function toolPrereqsMet(toolName, input = {}) {
  try {
    const meta = getToolSafetyMeta(toolName);
    const prereqs = meta.prerequisites || [];
    if (!prereqs.length) return true;
    const context = input.context || {};
    return prereqs.every((p) => {
      if (p === "personal_schedule" || p === "currentScheduleSummary") {
        return Boolean(context.currentScheduleSummary && context.currentScheduleSummary.enabled);
      }
      if (p === "release_pack") {
        return Boolean(context.releaseVersion || context.releasePack);
      }
      return true;
    });
  } catch (_) {
    return true;
  }
}

function scoreSkill(skill, input = {}) {
  let score = 0;
  const intentName = String((input.intent && input.intent.name) || input.intentName || "");
  const message = String(input.message || "");
  const working = input.workingMemory || {};
  const page = String((input.context && (input.context.page || input.context.currentPage)) || "");
  const hasPersonal = Boolean(
    input.context && input.context.currentScheduleSummary && input.context.currentScheduleSummary.enabled
  );

  // Primary intent support
  const supported = skill.supportedIntents || [];
  if (intentName && supported.includes(intentName)) score += 100;
  if (input.primarySkillId && skill.id === input.primarySkillId) score += 80;

  // Description / id keyword overlap with message
  const desc = `${skill.id} ${skill.description || ""}`;
  const keywords = desc.match(/[\u3400-\u9fff]{2,}|[a-zA-Z_]{3,}/g) || [];
  keywords.slice(0, 12).forEach((kw) => {
    if (kw.length >= 2 && message.indexOf(kw) >= 0) score += 8;
  });

  // Working memory entities
  if (working.className || working.teacherName || working.courseName) {
    if (/schedule|课表|school/.test(skill.id + desc)) score += 20;
  }
  if (working.campus && /empty|room|weather|campus|空/.test(skill.id + desc)) score += 12;
  if (working.preferredName && /reminder|memory|preference/.test(skill.id + desc)) score += 5;

  // Current page
  if (page && /today|index/.test(page) && /today|next_course/.test(skill.id)) score += 15;
  if (page && /school|search/.test(page) && /school|search/.test(skill.id)) score += 12;

  // Personal schedule presence
  if (hasPersonal && /today|tomorrow|next_course|reminder|schedule_health/.test(skill.id)) score += 18;
  if (!hasPersonal && /personal_import/.test(skill.id) && /导入|个人课表/.test(message)) score += 25;

  // 兜底消息权重（仅 skill 打分，不改变能力来源）
  MESSAGE_FALLBACK_HINTS.forEach((hint) => {
    if (hint.re.test(message) && hint.skillBoost && hint.skillBoost[skill.id]) {
      score += Number(hint.skillBoost[skill.id]) || 0;
    }
  });

  // Multi-goal utterances
  const multiGoal = (
    (/有课|课表|没课/.test(message) && /空教室|自习|天气/.test(message))
    || (/顺便|同时|再|然后|没课的话/.test(message) && /天气|空教室|课表/.test(message))
  );
  if (multiGoal && /schedule|empty|weather|multi_step|campus/.test(skill.id)) score += 22;

  // Tool health / prereqs: penalize skills whose tools are all unhealthy
  const tools = skill.allowedTools || [];
  if (tools.length) {
    const healthyCount = tools.filter((t) => toolAllowedInMode(t, input.runtimeMode)
      && toolHealthy(t, input)
      && toolPrereqsMet(t, input)).length;
    if (healthyCount === 0) score -= 50;
    else score += Math.min(15, healthyCount * 2);
  }

  return score;
}

/**
 * @returns {{ skillIds: string[], skills: object[], candidateTools: string[], primarySkillId: string, routeReason: string, scores: object }}
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
  const allSkills = listManifestSkills().filter((s) => skillAllowedInMode(s, runtimeMode));

  const scored = allSkills.map((skill) => ({
    skill,
    score: scoreSkill(skill, Object.assign({}, input, { runtimeMode, primarySkillId })),
  })).filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  let selectedSkills = scored.slice(0, MAX_SKILLS).map((row) => row.skill);

  // Always include primary skill if allowed
  if (primarySkill && skillAllowedInMode(primarySkill, runtimeMode)) {
    if (!selectedSkills.some((s) => s.id === primarySkill.id)) {
      selectedSkills = [primarySkill].concat(selectedSkills).slice(0, MAX_SKILLS);
    }
  }

  if (!selectedSkills.length && primarySkill) selectedSkills.push(primarySkill);
  if (!selectedSkills.length) {
    const fallback = skillRegistry.getSkill("knowledge_search") || allSkills[0];
    if (fallback) selectedSkills.push(fallback);
  }

  // Tool scores —— 所有来源均为 manifest 派生，无手工工具 id
  const toolScores = new Map();
  const baselineSet = new Set(baselineTools(runtimeMode));
  const routableSet = manifestRoutableToolSet(runtimeMode);
  baselineSet.forEach((t) => {
    if (toolHealthy(t, input)) toolScores.set(t, 100);
  });

  selectedSkills.forEach((skill, skillIndex) => {
    const skillWeight = 40 - skillIndex * 10;
    (skill.allowedTools || []).forEach((tool) => {
      if (!routableSet.has(tool) || !toolAllowedInMode(tool, runtimeMode) || !toolHealthy(tool, input)) return;
      if (!toolPrereqsMet(tool, input) && !baselineSet.has(tool)) {
        // still allow but lower score
        toolScores.set(tool, Math.max(toolScores.get(tool) || 0, skillWeight - 15));
        return;
      }
      toolScores.set(tool, Math.max(toolScores.get(tool) || 0, skillWeight + 20));
    });
  });

  // 兜底层：正则命中 intent 名，工具经 manifest 派生交集获得
  MESSAGE_FALLBACK_HINTS.forEach((hint) => {
    if (!hint.re.test(message)) return;
    (hint.intents || []).forEach((intentName) => {
      manifestToolsForIntent(intentName, runtimeMode).forEach((tool) => {
        if (toolHealthy(tool, input)) {
          toolScores.set(tool, Math.max(toolScores.get(tool) || 0, 28));
        }
      });
    });
  });

  if (input.context && input.context.currentScheduleSummary
    && input.context.currentScheduleSummary.enabled) {
    personalSchedulePrimaryTools(runtimeMode).forEach((t) => {
      if (toolHealthy(t, input)) {
        toolScores.set(t, Math.max(toolScores.get(t) || 0, 22));
      }
    });
  }

  const candidateTools = Array.from(toolScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0])
    .slice(0, MAX_TOOLS);

  // Ensure primary skill tools not fully dropped when under cap
  if (primarySkill && candidateTools.length < MAX_TOOLS) {
    (primarySkill.allowedTools || []).forEach((t) => {
      if (candidateTools.length >= MAX_TOOLS) return;
      if (routableSet.has(t) && toolAllowedInMode(t, runtimeMode) && !candidateTools.includes(t) && toolHealthy(t, input)) {
        candidateTools.push(t);
      }
    });
  }

  const multiGoal = (
    (/有课|课表|没课/.test(message) && /空教室|自习|天气/.test(message))
    || (/顺便|同时|再|然后|没课的话/.test(message) && /天气|空教室|课表/.test(message))
  );

  return {
    skillIds: selectedSkills.map((s) => s.id).slice(0, MAX_SKILLS),
    skills: selectedSkills.slice(0, MAX_SKILLS),
    candidateTools: candidateTools.slice(0, MAX_TOOLS),
    primarySkillId,
    primarySkill,
    multiSkill: selectedSkills.length > 1,
    routeReason: multiGoal ? "multi_goal_scored" : (selectedSkills.length > 1 ? "scored_related" : "scored_primary"),
    scores: scored.slice(0, 8).reduce((acc, row) => {
      acc[row.skill.id] = row.score;
      return acc;
    }, {}),
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
  scoreSkill,
};
