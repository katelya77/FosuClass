/**
 * P5b WS-A：standalone 通用插件与确定性六阶段（无校园耦合的默认业务面）。
 *
 * 这是 standalone 镜像开箱即用的最小业务面：
 * - 两个内置只读示例 Skill：
 *   - platform.time：报服务器时间（纯确定性，零外部依赖）；
 *   - platform.kb：对已发布 RAG 知识库做真实查询并返回引用（索引未就绪时如实
 *     降级，不编造内容）。
 * - 五个 Runtime 阶段全部确定性执行：public/trial/dev 任何模式下外部 Provider
 *   调用次数恒为 0（Provider 表达层接入属后续阶段，本阶段没有也不假装有）。
 *
 * 发布语义与 integrated 一致：Skill/Tool 的可执行行为永远来自本静态代码，
 * Config Kernel 发布的只是声明式 overlay（禁用/收窄），见各域发布适配器。
 */

const TIME_GOAL_RE = /(现在几点|几点了|当前时间|服务器时间|什么日期|今天日期|\bwhat time\b|\bcurrent time\b|\bserver time\b|\bdate now\b)/i;
const KB_GOAL_RE = /(配置发布|知识库|发布流程|回滚|草稿|rollback|publish|knowledge|guide|帮助|使用说明|是什么|怎么用|介绍)/i;
const RUNTIME_MODES = Object.freeze(["public", "trial", "dev"]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeRuntimeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return RUNTIME_MODES.includes(mode) ? mode : "public";
}

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

/**
 * @param {{queryKb?: (input: {query: string, configSnapshot: object}) => Promise<object>}} ports
 *   queryKb 由组合根注入（RAG 快照查询链）；缺失时 platform.kb 如实返回未配置。
 */
function createStandalonePlugin(ports = {}) {
  const queryKb = typeof ports.queryKb === "function" ? ports.queryKb : null;

  const clockTool = {
    id: "platform.clock",
    version: "1",
    description: "Read the application server's current clock (UTC). Read-only, deterministic.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        nowIso: { type: "string" },
        unixMs: { type: "number" },
        timezone: { type: "string" },
      },
      required: ["nowIso", "unixMs", "timezone"],
    },
    runtimeModes: RUNTIME_MODES,
    safety: { autonomyLevel: 1, requiresConfirmation: false, readOnly: true },
    async execute() {
      const now = new Date();
      return { nowIso: now.toISOString(), unixMs: now.getTime(), timezone: "UTC" };
    },
  };

  const kbQueryTool = {
    id: "platform.kb-query",
    version: "1",
    description: "Query the published knowledge base pinned by the run's config snapshot. Read-only.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 500 } },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    runtimeModes: RUNTIME_MODES,
    safety: { autonomyLevel: 1, requiresConfirmation: false, readOnly: true },
    async execute(args = {}, context = {}) {
      if (!queryKb) return { hits: [], reason: "kb_not_configured", kbId: "" };
      return queryKb({
        query: safeString(args.query, 500),
        configSnapshot: context && context.configSnapshot || null,
      });
    },
  };

  const skills = Object.freeze([
    Object.freeze({
      id: "platform.time",
      version: "1",
      description: "Built-in read-only example skill: report the server clock.",
      supportedGoals: Object.freeze(["platform.time"]),
      requiredSlots: Object.freeze([]),
      optionalSlots: Object.freeze([]),
      allowedTools: Object.freeze(["platform.clock"]),
      runtimeModes: RUNTIME_MODES,
      outputBlockTypes: Object.freeze(["text"]),
      providerPolicy: "deterministic",
      fallbackPolicy: "none",
      recoveryRules: Object.freeze([]),
    }),
    Object.freeze({
      id: "platform.kb",
      version: "1",
      description: "Built-in read-only example skill: answer from the published knowledge base with citations.",
      supportedGoals: Object.freeze(["platform.kb"]),
      requiredSlots: Object.freeze([]),
      optionalSlots: Object.freeze([]),
      allowedTools: Object.freeze(["platform.kb-query"]),
      runtimeModes: RUNTIME_MODES,
      outputBlockTypes: Object.freeze(["text", "list"]),
      providerPolicy: "deterministic",
      fallbackPolicy: "none",
      recoveryRules: Object.freeze([]),
    }),
  ]);

  return Object.freeze({
    id: "standalone-core",
    version: "0.1.0",
    manifestVersion: "1",
    skills,
    tools: Object.freeze([clockTool, kbQueryTool]),
  });
}

/**
 * 通用确定性五阶段（与 createAgentPlatform 的 stages 契约对齐：
 * assembleContext/decide/executeSkillTool/verify/compose）。
 *
 * @param {{plugin: object, toolRuntime: object, resolveSkillCatalog: (snapshot: object) => Promise<object>,
 *          logger?: (event: object) => void}} options
 */
function createStandaloneStages(options = {}) {
  const plugin = options.plugin;
  const toolRuntime = options.toolRuntime;
  const resolveSkillCatalog = options.resolveSkillCatalog;
  if (!plugin || !plugin.id) throw codedError("STANDALONE_STAGE_PLUGIN_REQUIRED");
  if (!toolRuntime || typeof toolRuntime.execute !== "function") throw codedError("STANDALONE_STAGE_TOOL_RUNTIME_REQUIRED");
  if (typeof resolveSkillCatalog !== "function") throw codedError("STANDALONE_STAGE_CATALOG_RESOLVER_REQUIRED");
  const skillIds = new Set(plugin.skills.map((skill) => skill.id));
  const toolIds = new Set(plugin.tools.map((tool) => tool.id));

  function requirePrivateState(stageInput) {
    const state = stageInput && stageInput.privateState;
    if (!state || typeof state !== "object") throw codedError("STANDALONE_STAGE_STATE_REQUIRED");
    return state;
  }

  async function enabledSkill(catalog, skillId) {
    const skill = catalog && typeof catalog.get === "function" ? catalog.get(skillId) : null;
    return skill && skill.enabled !== false ? skill : null;
  }

  // Context 快照会进入 Runtime artifacts 与 platformTrace：只放行低基数元数据，
  // 用户消息原文只留在 privateState（createAgentPlatform 保证其不跨包边界）。
  async function assembleContext(stageInput = {}) {
    const request = stageInput.request || {};
    const privateState = {
      message: String(request.message || "").slice(0, 4000),
      runtimeMode: normalizeRuntimeMode(request.runtimeMode),
      conversationId: safeString(request.conversationId, 96),
      requestId: safeString(request.requestId, 96),
      runId: safeString(request.runId, 128),
    };
    return {
      snapshot: {
        pluginId: plugin.id,
        runtimeMode: privateState.runtimeMode,
        messageLength: privateState.message.length,
        hasConversation: Boolean(privateState.conversationId),
      },
      privateState,
    };
  }

  async function decide(stageInput = {}) {
    const state = requirePrivateState(stageInput);
    const catalog = await resolveSkillCatalog(stageInput.configSnapshot || null);
    let goal = "general";
    let selectedSkillId = "";
    if (TIME_GOAL_RE.test(state.message) && (await enabledSkill(catalog, "platform.time"))) {
      goal = "platform.time";
      selectedSkillId = "platform.time";
    } else if (KB_GOAL_RE.test(state.message) && (await enabledSkill(catalog, "platform.kb"))) {
      goal = "platform.kb";
      selectedSkillId = "platform.kb";
    }
    if (selectedSkillId && !skillIds.has(selectedSkillId)) {
      throw codedError("STANDALONE_STAGE_SKILL_NOT_IN_PLUGIN", selectedSkillId);
    }
    return {
      skipped: false,
      goal: { name: goal },
      selectedSkillId,
      executionPolicy: "deterministic",
      decisionSource: "deterministic",
      intendedProvider: "",
      actualFirstProvider: "",
      fallbackPath: [],
      taskComplexity: "simple",
      contextId: "",
    };
  }

  async function executeSkillTool(stageInput = {}) {
    const state = requirePrivateState(stageInput);
    const decisionResult = stageInput.decision || {};
    const skillId = String(decisionResult.selectedSkillId || "");
    if (!skillId) {
      return { skipped: true, toolCalls: [], publicToolCalls: [], steps: [], contextId: "" };
    }
    const catalog = await resolveSkillCatalog(stageInput.configSnapshot || null);
    const skill = await enabledSkill(catalog, skillId);
    if (!skill) {
      // 快照解析后技能被禁用（发布收窄）：如实跳过，不执行已失授权的行为。
      return { skipped: true, skipReason: "skill_disabled", toolCalls: [], publicToolCalls: [], steps: [], contextId: "" };
    }
    let result;
    if (skillId === "platform.time") {
      result = await toolRuntime.execute("platform.clock", {}, {}, {
        allowedToolIds: skill.allowedTools,
        signal: stageInput.signal || null,
      });
    } else if (skillId === "platform.kb") {
      result = await toolRuntime.execute("platform.kb-query", { query: state.message }, {
        configSnapshot: stageInput.configSnapshot || null,
      }, {
        allowedToolIds: skill.allowedTools,
        signal: stageInput.signal || null,
      });
    } else {
      throw codedError("STANDALONE_STAGE_SKILL_UNSUPPORTED", skillId);
    }
    const toolId = skill.allowedTools[0];
    if (toolId && !toolIds.has(toolId)) throw codedError("STANDALONE_STAGE_TOOL_NOT_IN_PLUGIN", toolId);
    const toolCall = {
      toolId,
      skillId,
      status: "completed",
      result: result && typeof result === "object" ? result : {},
    };
    return {
      skipped: false,
      toolCalls: [toolCall],
      publicToolCalls: [Object.assign({}, toolCall)],
      steps: [{ key: skillId, label: skill.description || skillId, status: "done" }],
      contextId: "",
    };
  }

  async function verify(stageInput = {}) {
    const skillResult = stageInput.skillTool || {};
    const toolCalls = Array.isArray(skillResult.toolCalls) ? skillResult.toolCalls : [];
    const ok = toolCalls.every((call) => call && call.status === "completed");
    return {
      ok,
      errors: ok ? [] : [{ code: "STANDALONE_TOOL_INCOMPLETE", message: "tool call did not complete" }],
      execution: {
        steps: Array.isArray(skillResult.steps) ? skillResult.steps : [],
        verification: { ok },
      },
      contextId: "",
    };
  }

  async function compose(stageInput = {}) {
    const state = requirePrivateState(stageInput);
    const decisionResult = stageInput.decision || {};
    const skillResult = stageInput.skillTool || {};
    const verificationResult = stageInput.verification || {};
    const skillId = String(decisionResult.selectedSkillId || "");
    const toolCall = (Array.isArray(skillResult.toolCalls) ? skillResult.toolCalls : [])[0] || null;
    const runtimeMode = state.runtimeMode;

    let answer;
    let citations = [];
    let kbReady;
    if (skillId === "platform.time" && toolCall) {
      answer = `当前服务器时间（UTC）：${safeString(toolCall.result && toolCall.result.nowIso, 40)}。`;
    } else if (skillId === "platform.kb" && toolCall) {
      const result = toolCall.result || {};
      const hits = Array.isArray(result.hits) ? result.hits : [];
      kbReady = hits.length > 0;
      if (hits.length) {
        citations = hits.slice(0, 5).map((hit, index) => ({
          ref: index + 1,
          docId: safeString(hit && hit.docId, 80),
          title: safeString(hit && hit.title, 160),
          score: Number.isFinite(Number(hit && hit.score)) ? Number(Number(hit.score).toFixed(4)) : 0,
        }));
        const lines = citations.map((item) => `[${item.ref}] ${item.title}（${item.docId}）`);
        answer = `根据已发布知识库（${safeString(result.kbId, 64)} v${Number(result.servedVersion) || "?" }）：\n`
          + hits.slice(0, 3).map((hit, index) => `[${index + 1}] ${safeString(hit && (hit.snippet || hit.text), 200)}`).join("\n")
          + `\n引用：\n${lines.join("\n")}`;
      } else {
        answer = `知识库暂未返回内容（原因：${safeString(result.reason, 60) || "index_not_ready"}）。索引为异步构建，请稍后重试。`;
      }
    } else {
      answer = "你好，我是 Agent Platform 的内置确定性助手。当前未配置模型 Provider，"
        + "我可以报告服务器时间，或基于已发布知识库回答平台使用问题。";
    }

    return {
      success: true,
      status: "completed",
      answer,
      cards: [],
      suggestions: [],
      runtimeMode,
      provider: "",
      externalProviderUsed: false,
      fallback: false,
      fallbackReason: "",
      toolCalls: Array.isArray(skillResult.publicToolCalls) ? skillResult.publicToolCalls : [],
      steps: Array.isArray(skillResult.steps) ? skillResult.steps : [],
      verification: { ok: verificationResult.ok !== false },
      citations,
      kbReady: kbReady === undefined ? undefined : kbReady,
      requestId: state.requestId,
      conversationId: state.conversationId,
      contextId: "",
    };
  }

  return Object.freeze({
    assembleContext,
    decide,
    executeSkillTool,
    verify,
    compose,
  });
}

module.exports = Object.freeze({
  createStandalonePlugin,
  createStandaloneStages,
  normalizeRuntimeMode,
});
