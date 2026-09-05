const {
  EXECUTION_POLICIES,
  classifyFallbackEligibility,
  createDeadline,
  deriveProviderStageLease,
  normalizeDecisionContract,
  resolveExecutionPolicy,
} = require("../../../../../packages/provider-runtime");
const capabilityManifestService = require("../capabilityManifestService");
const { defaultUnderstandingService } = require("../understanding/understandingService");
const { normalizeConstraints, normalizeGoalContract } = require("../understanding/goalContract");
const { fromV1Contract } = require("../understanding/goalContractV2");
const { resolveGoalContract } = require("../understanding/goalResolver");
const { buildDecisionMessages } = require("./decisionPrompt");
const { buildDecisionResponseSchema, expandDecisionResponse } = require("./decisionResponseSchema");
const { resolveDecisionProviders } = require("../providerRuntimeComposition");

const ENTITY_TYPES = new Set(["teacher", "class", "classroom", "course", "campus"]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function emit(onEvent, event) {
  if (typeof onEvent !== "function") return;
  try { onEvent(event); } catch (error) { /* observability cannot change the Decision */ }
}

function providerChainFromPath(path) {
  return (Array.isArray(path) ? path : []).map((item) => {
    const text = String(item || "");
    const separator = text.indexOf(":");
    const provider = separator >= 0 ? text.slice(0, separator) : text;
    const reason = separator >= 0 ? text.slice(separator + 1) : "";
    return { provider, status: reason === "success" ? "success" : "failed", reason };
  });
}

function skillOptions(skillCatalog, runtimeMode) {
  return skillCatalog.list()
    .filter((skill) => !skill.runtimeModes.length || skill.runtimeModes.includes(runtimeMode))
    .map((skill) => ({
      id: skill.id,
      description: skill.description,
      supportedGoals: skill.supportedGoals.slice(),
    }));
}

function validationOptions(skills) {
  return {
    allowedSkillIds: skills.map((skill) => skill.id),
    allowedGoalIds: Array.from(new Set(skills.flatMap((skill) => skill.supportedGoals))),
    skillGoalMap: Object.fromEntries(skills.map((skill) => [skill.id, skill.supportedGoals.slice()])),
  };
}

function projectDecisionContract(contract) {
  const primary = contract.entities.find((entity) => ENTITY_TYPES.has(entity.type)) || null;
  const constraints = Object.fromEntries(Object.entries(contract.constraints || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== ""));
  return normalizeGoalContract({
    goal: contract.goal.name,
    entityType: primary ? primary.type : "none",
    entity: primary ? primary.value : "",
    normalizedEntity: primary ? primary.value : "",
    constraints: normalizeConstraints(constraints),
    followUpMode: "new_goal",
    confidence: contract.goal.confidence,
    needsClarification: contract.goal.requiresClarification,
  });
}

function selectedSkillFor(skillCatalog, contract) {
  const candidate = contract.skillCandidates[0];
  const selected = skillCatalog.get(candidate && candidate.skillId);
  if (!selected || !selected.supportedGoals.includes(contract.goal.name)) {
    throw codedError("DECISION_SELECTED_SKILL_MISMATCH", "The selected Skill does not own the selected Goal");
  }
  const manifestSkill = skillCatalog.getSkillForIntent(contract.goal.name);
  if (!manifestSkill || manifestSkill.id !== selected.id) {
    throw codedError("DECISION_SELECTED_SKILL_MISMATCH", "Manifest Goal-to-Skill mapping rejected the selected Skill");
  }
  return selected;
}

function decisionFromUnderstanding(understanding, skillCatalog, source) {
  const skill = skillCatalog.getSkillForIntent(understanding.intent && understanding.intent.name);
  if (!skill) throw codedError("DECISION_SKILL_NOT_FOUND", "No published Skill supports the deterministic Goal");
  const contract = understanding.contract;
  const entities = contract.entityType !== "none" && contract.entity
    ? [{ type: contract.entityType, value: contract.entity, source: "context" }]
    : [];
  return normalizeDecisionContract({
    schemaVersion: "decision.v2",
    goal: {
      name: contract.goal,
      confidence: contract.confidence,
      requiresClarification: contract.needsClarification,
    },
    entities,
    constraints: contract.constraints,
    skillCandidates: [{ skillId: skill.id, confidence: contract.confidence }],
    plan: { steps: [{ id: "resolve-goal", skillId: skill.id, purpose: "Resolve the selected goal" }] },
    responseMode: "deterministic",
  }, validationOptions(skillOptions(skillCatalog, "public").concat(skillOptions(skillCatalog, "trial"), skillOptions(skillCatalog, "dev"))));
}

function isAdaptiveFastPath(intent) {
  const metadata = capabilityManifestService.getIntent(intent && intent.name);
  return Boolean(metadata && metadata.factualTask === true)
    || Boolean(metadata && metadata.externalProviderAllowed === false)
    || String(intent && intent.name || "") === "project_qa"
    || Number(intent && intent.ruleScore || 0) >= 8;
}

function createDecisionService(options = {}) {
  const providerRuntime = options.providerRuntime;
  const skillCatalog = options.skillCatalog;
  if (!providerRuntime || typeof providerRuntime.generateStructured !== "function") throw codedError("DECISION_PROVIDER_RUNTIME_REQUIRED");
  if (!skillCatalog || typeof skillCatalog.list !== "function") throw codedError("DECISION_SKILL_CATALOG_REQUIRED");
  const deterministicResolve = options.deterministicResolve;

  function resolvePolicy(input = {}) {
    const runtimeConfig = input.providerRuntimeConfig || {};
    return resolveExecutionPolicy({
      runtimeMode: input.runtimeMode,
      configuredPolicy: runtimeConfig.AI_EXECUTION_POLICY || process.env.AI_EXECUTION_POLICY || "",
      trusted: true,
    });
  }

  function deterministic(input, source, reasonCode, policy) {
    // P4a：优先使用调用方按 Run 快照绑定的已发布目录，缺省回落构造注入目录。
    const catalog = input.skillCatalog || skillCatalog;
    const understanding = defaultUnderstandingService.deterministicResult({
      message: input.message,
      context: input.context,
      conversationState: input.conversationState,
      deterministicResolve: input.deterministicResolve || deterministicResolve,
    }, source, reasonCode);
    const decisionContract = decisionFromUnderstanding(understanding, catalog, source);
    const selectedSkill = selectedSkillFor(catalog, decisionContract);
    understanding.decisionContract = decisionContract;
    return {
      executionPolicy: policy,
      intendedProvider: "",
      actualFirstProvider: "",
      fallbackPath: [],
      decisionSource: source,
      selectedSkillId: decisionContract.skillCandidates[0].skillId,
      taskComplexity: decisionContract.plan.steps.length > 1 || selectedSkill.allowedTools.length > 1 ? "multi" : "simple",
      goal: decisionContract.goal,
      decisionContract,
      goalContractV2: fromV1Contract(understanding.contract, { source: source === "deterministic_policy" ? "deterministic" : "fallback" }),
      understanding,
      intent: understanding.intent,
    };
  }

  async function decide(input = {}) {
    const runtimeMode = capabilityManifestService.normalizeRuntimeMode(input.runtimeMode || "public");
    const executionPolicy = input.executionPolicy || resolvePolicy(input);
    emit(input.onEvent, { type: "decision.started", status: "started", runtimeMode, executionPolicy, providerUsed: false });
    emit(input.onEvent, { type: "understanding.started", status: "started", runtimeMode, providerUsed: false });

    if (executionPolicy === EXECUTION_POLICIES.DETERMINISTIC) {
      const result = deterministic(input, "deterministic_policy", "PUBLIC_ZERO_PROVIDER", executionPolicy);
      emit(input.onEvent, { type: "understanding.completed", status: "success", runtimeMode, understandingSource: result.decisionSource, providerUsed: false });
      emit(input.onEvent, { type: "decision.completed", status: "success", runtimeMode, executionPolicy, decisionSource: result.decisionSource, providerUsed: false });
      return result;
    }

    const agentEnabled = !["false", "0"].includes(String(
      input.providerRuntimeConfig && input.providerRuntimeConfig.AI_AGENT_ENABLED || "true"
    ).toLowerCase());
    if (executionPolicy === EXECUTION_POLICIES.ADAPTIVE) {
      const localIntent = typeof input.deterministicResolve === "function"
        ? input.deterministicResolve(input.message, input.context || {})
        : deterministicResolve(input.message, input.context || {});
      if (!agentEnabled || isAdaptiveFastPath(localIntent)) {
        const result = deterministic(Object.assign({}, input, { deterministicIntent: localIntent }), "deterministic_adaptive", "ADAPTIVE_HIGH_CONFIDENCE", executionPolicy);
        emit(input.onEvent, { type: "understanding.completed", status: "success", runtimeMode, understandingSource: result.decisionSource, providerUsed: false });
        emit(input.onEvent, { type: "decision.completed", status: "success", runtimeMode, executionPolicy, decisionSource: result.decisionSource, providerUsed: false });
        return result;
      }
    }

    const skills = skillOptions(input.skillCatalog || skillCatalog, runtimeMode);
    const validatorOptions = validationOptions(skills);
    const providers = resolveDecisionProviders(runtimeMode, input.providerRuntimeConfig || {});
    // OpenRouter free models are used only as a semantic parser. The server
    // expands their compact intent into an authorized Skill/Plan from the
    // published catalog, so a model can neither invent nor select capabilities.
    const compactDecision = providers.intendedProvider === "openrouter";
    const decisionBudgetMs = Math.max(1, Number(input.decisionBudgetMs || 9000) || 9000);
    const providerLease = deriveProviderStageLease({
      outerBudgetMs: decisionBudgetMs,
      finishReserveMs: Math.max(0, Number(input.finishReserveMs || 500) || 0),
      selection: providers,
      providerAttemptLedger: input.providerAttemptLedger || null,
    });
    const configuredStructuredMaxTokens = Math.max(128, Math.min(2000, Number(
      input.providerRuntimeConfig && input.providerRuntimeConfig.AI_STRUCTURED_MAX_TOKENS || 1000
    ) || 1000));
    const startedAt = Date.now();
    try {
      if (!providers.intendedProvider) throw codedError("DECISION_PROVIDER_UNAVAILABLE", "No external Decision Provider is configured");
      const generated = await providerRuntime.generateStructured({
        stage: "decision",
        runtimeMode,
        executionPolicy,
        intendedProvider: providers.intendedProvider,
        fallbackProvider: providers.fallbackProvider,
        deadline: input.deadline || createDeadline({ timeoutMs: 15000 }),
        stageCapMs: providerLease.stageCapMs,
        finishReserveMs: providerLease.finishReserveMs,
        signal: input.signal || null,
        providerAttemptLedger: input.providerAttemptLedger || null,
        request: {
          purpose: "decision",
          messages: buildDecisionMessages({
            message: input.message,
            contextView: input.contextView,
            allowedSkills: skills,
            contractMode: compactDecision ? "intent" : "decision.v2",
          }),
          responseSchema: compactDecision ? buildDecisionResponseSchema(skills) : null,
          responseSchemaName: compactDecision ? "fosu_decision_intent_v1" : "fosu_decision_v2",
          providerRuntimeConfig: input.providerRuntimeConfig || {},
          principal: input.principal || null,
          conversationId: input.conversationId || "",
          maxTokens: compactDecision ? Math.min(320, configuredStructuredMaxTokens) : configuredStructuredMaxTokens,
        },
        validate(value) {
          const contract = normalizeDecisionContract(
            expandDecisionResponse(value, input.skillCatalog || skillCatalog),
            validatorOptions
          );
          projectDecisionContract(contract);
          selectedSkillFor(input.skillCatalog || skillCatalog, contract);
          return contract;
        },
        onEvent: input.onEvent,
      });
      const legacyContract = projectDecisionContract(generated.contract);
      const deterministicHint = typeof input.deterministicResolve === "function"
        ? input.deterministicResolve(input.message, input.context || {})
        : deterministicResolve(input.message, input.context || {});
      const resolved = resolveGoalContract({
        contract: legacyContract,
        message: input.message,
        context: input.context,
        conversationState: input.conversationState,
        deterministicHint,
      });
      const selectedSkill = selectedSkillFor(input.skillCatalog || skillCatalog, generated.contract);
      if (resolved.intent.name !== generated.contract.goal.name) {
        throw codedError("DECISION_GOAL_RESOLUTION_MISMATCH", "Goal resolution changed the Provider-selected Goal");
      }
      const understanding = {
        contract: resolved.contract,
        decisionContract: generated.contract,
        intent: resolved.intent,
        source: "model",
        providerUsed: generated.provider,
        externalProviderUsed: true,
        fallback: generated.provider !== generated.intendedProvider,
        reasonCode: "",
        latencyMs: Date.now() - startedAt,
        providerChain: providerChainFromPath(generated.fallbackPath),
        intendedProvider: generated.intendedProvider,
        actualFirstProvider: generated.actualFirstProvider,
        fallbackPath: generated.fallbackPath,
      };
      const result = {
        executionPolicy,
        intendedProvider: generated.intendedProvider,
        actualFirstProvider: generated.actualFirstProvider,
        fallbackPath: generated.fallbackPath,
        decisionSource: "model",
        selectedSkillId: selectedSkill.id,
        taskComplexity: generated.contract.plan.steps.length > 1 || selectedSkill.allowedTools.length > 1 ? "multi" : "simple",
        goal: generated.contract.goal,
        decisionContract: generated.contract,
        goalContractV2: fromV1Contract(resolved.contract, { source: "model", provider: generated.provider }),
        understanding,
        intent: resolved.intent,
      };
      emit(input.onEvent, { type: "understanding.completed", status: "success", runtimeMode, understandingSource: "model", provider: generated.provider, providerUsed: true, latencyMs: understanding.latencyMs });
      emit(input.onEvent, { type: "decision.completed", status: "success", runtimeMode, executionPolicy, decisionSource: "model", provider: generated.provider, providerUsed: true, latencyMs: understanding.latencyMs });
      return result;
    } catch (error) {
      if (error && error.code === "ABORTED") throw error;
      // P2R：单一 fallback eligibility 分类（与 Provider Runtime / Response 共用）。
      // 配置类错误 fail fast 并给后台可操作原因，不得包装成降级成功；
      // Schema/请求体类与其他不可重试错误不推进 fallback Provider（Runtime 已 fail fast），
      // 此处统一走受控 deterministic_fallback；临时性错误（eligible）同理降级，
      // 但换 Provider 已由 Runtime 在共享账本内尝试过至多一次。
      const classification = classifyFallbackEligibility(error);
      if (classification.failureClass === "config") {
        const actionable = codedError(
          classification.reasonCode,
          "Decision Provider 配置缺失或不可用：请在后台检查 AI_DECISION_PROVIDER / AI_UNDERSTANDING_PROVIDER、AI_PROVIDER_CHAIN、AI_BASE_URL 与 API Key 配置后重试"
        );
        actionable.failureClass = "config";
        actionable.failFast = true;
        actionable.fallbackEligible = false;
        actionable.fallbackReason = classification.reason;
        actionable.intendedProvider = String(error && error.intendedProvider || providers.intendedProvider || "");
        actionable.actualFirstProvider = String(error && error.actualFirstProvider || "");
        actionable.fallbackPath = Array.isArray(error && error.fallbackPath) ? error.fallbackPath.slice() : [];
        emit(input.onEvent, { type: "decision.completed", status: "failed", runtimeMode, executionPolicy, decisionSource: "none", reasonCode: actionable.code, failureClass: "config", providerUsed: false });
        throw actionable;
      }
      const fallback = deterministic(input, "deterministic_fallback", classification.reasonCode || String(error && error.code || "DECISION_FAILED"), executionPolicy);
      fallback.intendedProvider = String(error && error.intendedProvider || providers.intendedProvider || "");
      fallback.actualFirstProvider = String(error && error.actualFirstProvider || "");
      fallback.fallbackPath = Array.isArray(error && error.fallbackPath) ? error.fallbackPath.slice() : [];
      // P2R：failureClass / fallbackReason / remainingBudget 随阶段产物透传；Trace 统一落点由 Wave 2 收尾。
      fallback.failureClass = classification.failureClass;
      fallback.fallbackReason = classification.reason;
      fallback.remainingFallbackBudget = Number.isFinite(error && error.remainingFallbackBudget)
        ? error.remainingFallbackBudget
        : null;
      fallback.understanding.intendedProvider = fallback.intendedProvider;
      fallback.understanding.actualFirstProvider = fallback.actualFirstProvider;
      fallback.understanding.fallbackPath = fallback.fallbackPath;
      fallback.understanding.providerChain = providerChainFromPath(fallback.fallbackPath);
      fallback.understanding.failureClass = classification.failureClass;
      fallback.understanding.fallbackReason = classification.reason;
      fallback.understanding.externalProviderUsed = Boolean(fallback.actualFirstProvider);
      fallback.understanding.providerUsed = fallback.actualFirstProvider || false;
      fallback.understanding.latencyMs = Date.now() - startedAt;
      emit(input.onEvent, { type: "understanding.fallback", status: "degraded", runtimeMode, understandingSource: fallback.decisionSource, reasonCode: fallback.understanding.reasonCode, failureClass: classification.failureClass, provider: fallback.actualFirstProvider, providerUsed: Boolean(fallback.actualFirstProvider), latencyMs: fallback.understanding.latencyMs });
      emit(input.onEvent, { type: "decision.completed", status: "degraded", runtimeMode, executionPolicy, decisionSource: fallback.decisionSource, reasonCode: fallback.understanding.reasonCode, failureClass: classification.failureClass, providerUsed: Boolean(fallback.actualFirstProvider) });
      return fallback;
    }
  }

  return Object.freeze({ decide, resolvePolicy });
}

module.exports = {
  createDecisionService,
  projectDecisionContract,
};
