/**
 * UnderstandingService（2026-07-30, P2R 标注）
 *
 * 生产在用：`deterministicResult` —— decisionService / understandingCoordinator
 * 用它做确定性规范化（规则意图 → GoalContract），public 与降级路径均合法。
 *
 * @deprecated compatibility-only / deprecated candidate：模型版 `understand()`
 * 不再是生产路径。P2 统一 Decision 后唯一的生产侧调用入口
 * understandingCoordinator.runUnderstanding 已无任何调用方；模型理解由
 * decisionService 经 provider-runtime 的 DecisionContract V2 一次调用完成。
 * 模型路径仅被兼容测试直接引用（tools/test-agent-model-first-understanding.js）。
 * 退役门槛（P6b 完成、旧量归零、新 Runtime 全覆盖、对照测试、release-gate 绿）
 * 达成前不删除、不重构。见 specs/xiaofu-agent-product-platform/p2r-acceptance.md §5。
 */
const capabilityManifestService = require("../capabilityManifestService");
const safetyGuard = require("../safetyGuard");
const toolRegistry = require("../toolRegistry");
const {
  intentToGoalContract,
  parseGoalContractJson,
} = require("./goalContract");
const { resolveGoalContract } = require("./goalResolver");

function emit(onEvent, event) {
  if (typeof onEvent !== "function") return;
  try {
    onEvent(event);
  } catch (error) {
    // Observability must not alter the decision path.
  }
}

function configValue(runtimeConfig, key, fallback = "") {
  if (runtimeConfig && Object.prototype.hasOwnProperty.call(runtimeConfig, key)) {
    const value = runtimeConfig[key];
    return value === undefined || value === null ? fallback : value;
  }
  return process.env[key] === undefined ? fallback : process.env[key];
}

function providerStateName(name) {
  return String(name || "").toLowerCase() === "cloudbase-openai" ? "hunyuan3" : String(name || "").toLowerCase();
}

function safeWorkingContext(conversationState = {}) {
  const wm = conversationState.workingMemory || {};
  const pending = conversationState.pendingClarification || wm.pendingClarification || null;
  const pendingActive = pending && (!Number(pending.expiresAt) || Number(pending.expiresAt) >= Date.now())
    ? pending
    : null;
  return {
    activeGoal: String(wm.activeGoal || wm.currentGoal || "").slice(0, 80),
    pendingClarification: pendingActive && {
      intentName: String(pendingActive.intentName || "").slice(0, 80),
      type: String(pendingActive.type || "").slice(0, 24),
      missing: String(pendingActive.missing || "").slice(0, 40),
    },
    lastEntityType: String(wm.lastEntityType || "").slice(0, 24),
    lastEntity: safetyGuard.redactSensitiveText(String(wm.lastEntity || "")).slice(0, 80),
    lastResolvedEntity: wm.lastResolvedEntity && {
      type: String(wm.lastResolvedEntity.type || "").slice(0, 24),
      name: safetyGuard.redactSensitiveText(String(wm.lastResolvedEntity.name || "")).slice(0, 80),
    },
    constraints: wm.lastConstraints || {},
  };
}

function buildUnderstandingMessages(message, conversationState = {}) {
  const goals = Object.keys(capabilityManifestService.getManifest().intents || {});
  const system = [
    "You are the semantic understanding layer for the FosuClass campus task agent.",
    "Return exactly one strict JSON object and nothing else.",
    "The object must contain exactly: goal, entityType, entity, normalizedEntity, constraints, followUpMode, confidence, needsClarification.",
    `goal must be one of: ${goals.join(",")}.`,
    "entityType must be one of: none,teacher,class,classroom,course,campus.",
    "followUpMode must be one of: none,new_goal,inherit_active_goal,inherit_last_entity,replace_constraints,fill_pending_clarification.",
    "Never output toolName, skillName, reasoning, campus facts, credentials, URLs, or markdown.",
    "Use conversationState only to resolve omitted entities and constraints.",
  ].join(" ");
  const user = JSON.stringify({
    message: safetyGuard.redactSensitiveText(String(message || "")).slice(0, 1200),
    conversationState: safeWorkingContext(conversationState),
  });
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

async function defaultStructuredGenerate(input) {
  const structuredInferenceService = require("../structuredInferenceService");
  return structuredInferenceService.generateStructured(input);
}

class UnderstandingService {
  constructor(options = {}) {
    this.structuredGenerate = options.structuredGenerate || defaultStructuredGenerate;
    this.deterministicResolve = options.deterministicResolve || toolRegistry.resolveIntent;
  }

  deterministicIntent(input = {}) {
    if (input.deterministicIntent) return input.deterministicIntent;
    const resolve = typeof input.deterministicResolve === "function"
      ? input.deterministicResolve
      : this.deterministicResolve;
    return resolve(input.message, input.context || {});
  }

  deterministicResult(input, source, reasonCode = "") {
    const intent = this.deterministicIntent(input);
    const contract = intentToGoalContract(intent || { name: "conversational_help", slots: {} });
    const resolved = resolveGoalContract({
      contract,
      message: input.message,
      context: input.context,
      conversationState: input.conversationState,
    });
    return {
      contract: resolved.contract,
      intent: resolved.intent,
      source,
      providerUsed: false,
      externalProviderUsed: false,
      fallback: source === "deterministic_fallback",
      reasonCode: String(reasonCode || "").slice(0, 80),
      latencyMs: 0,
    };
  }

  async understand(input = {}) {
    const runtimeMode = capabilityManifestService.normalizeRuntimeMode(input.runtimeMode || "public");
    const onEvent = input.onEvent;
    emit(onEvent, {
      type: "understanding.started",
      status: "started",
      runtimeMode,
      providerUsed: false,
    });

    if (runtimeMode === "public") {
      const result = this.deterministicResult(input, "deterministic_policy", "PUBLIC_ZERO_PROVIDER");
      emit(onEvent, {
        type: "understanding.completed",
        status: "success",
        runtimeMode,
        understandingSource: result.source,
        providerUsed: false,
      });
      return result;
    }

    const runtimeConfig = input.providerRuntimeConfig || {};
    const agentEnabled = String(configValue(runtimeConfig, "AI_AGENT_ENABLED", "false")).toLowerCase();
    const enabled = String(configValue(runtimeConfig, "AI_UNDERSTANDING_ENABLED", "true")).toLowerCase();
    if (agentEnabled === "false" || agentEnabled === "0" || enabled === "false" || enabled === "0") {
      const result = this.deterministicResult(
        input,
        "deterministic_fallback",
        agentEnabled === "false" || agentEnabled === "0" ? "AGENT_PROVIDER_DISABLED" : "UNDERSTANDING_DISABLED"
      );
      emit(onEvent, {
        type: "understanding.fallback",
        status: "degraded",
        runtimeMode,
        understandingSource: result.source,
        reasonCode: result.reasonCode,
        providerUsed: false,
      });
      return result;
    }

    // 规则优先快路径：本地确定性解析已高置信命中（事实类意图由精确模式解析、
    // project_qa 显式命中、或知识规则 pattern 命中 score≥8）时跳过理解模型调用，
    // 省一次 ~6s 的模型延迟；兜底 conversational_help 仍走模型。
    // AI_UNDERSTANDING_RULE_FIRST=0 可关闭，恢复模型优先。
    const ruleFirstEnabled = String(configValue(runtimeConfig, "AI_UNDERSTANDING_RULE_FIRST", "1")).toLowerCase() !== "0";
    if (ruleFirstEnabled) {
      const localIntent = this.deterministicIntent(input);
      const intentName = localIntent && localIntent.name || "";
      const manifestIntent = capabilityManifestService.getIntent(intentName);
      const ruleScore = Number(localIntent && localIntent.ruleScore) || 0;
      const confident = Boolean(manifestIntent && manifestIntent.factualTask === true)
        || intentName === "project_qa"
        || ruleScore >= 8;
      if (confident) {
        const result = this.deterministicResult(
          input,
          "deterministic_rule_first",
          ruleScore >= 8 ? `RULE_SCORE_${ruleScore}` : "LOCAL_INTENT_HIGH_CONFIDENCE"
        );
        emit(onEvent, {
          type: "understanding.completed",
          status: "success",
          runtimeMode,
          understandingSource: result.source,
          providerUsed: false,
        });
        return result;
      }
    }

    const started = Date.now();
    let generated = null;
    const providerAttempts = [];
    const providerEventHandler = (event) => {
      if (event && event.type === "provider.started" && event.provider) {
        providerAttempts.push({ provider: providerStateName(event.provider), status: "failed", reason: "provider_interrupted" });
      } else if (event && (event.type === "provider.completed" || event.type === "provider.failed") && event.provider) {
        const provider = providerStateName(event.provider);
        for (let index = providerAttempts.length - 1; index >= 0; index -= 1) {
          if (providerAttempts[index].provider !== provider) continue;
          providerAttempts[index] = {
            provider,
            status: event.type === "provider.completed" ? "success" : "failed",
            reason: String(event.reasonCode || "").slice(0, 80),
          };
          break;
        }
      }
      emit(onEvent, event);
    };
    try {
      generated = await this.structuredGenerate({
        purpose: "understanding",
        stage: "understanding",
        messages: buildUnderstandingMessages(input.message, input.conversationState || {}),
        message: input.message,
        runtimeMode,
        providerRuntimeConfig: input.providerRuntimeConfig || {},
        principal: input.principal || null,
        conversationId: input.conversationId || "",
        onEvent: providerEventHandler,
      });
      const provider = String(generated && generated.provider || "").toLowerCase();
      if (!provider || provider === "mock") {
        const error = new Error("No external understanding provider completed");
        error.code = "UNDERSTANDING_PROVIDER_UNAVAILABLE";
        throw error;
      }
      const content = generated.content || generated.text || generated.answer || "";
      const contract = parseGoalContractJson(content);
      // Runs only after model Understanding. This hint may complete a missing
      // clarification type, but it cannot change a model-selected goal or name a tool.
      const deterministicHint = this.deterministicIntent(input);
      const resolved = resolveGoalContract({
        contract,
        message: input.message,
        context: input.context,
        conversationState: input.conversationState,
        deterministicHint,
      });
      const latencyMs = Number(generated.latencyMs || Date.now() - started) || 0;
      const result = {
        contract: resolved.contract,
        intent: resolved.intent,
        source: "model",
        providerUsed: providerStateName(provider),
        externalProviderUsed: true,
        fallback: false,
        reasonCode: "",
        latencyMs,
        providerChain: Array.isArray(generated.providerChain) ? generated.providerChain : [],
      };
      emit(onEvent, {
        type: "understanding.completed",
        status: "success",
        runtimeMode,
        understandingSource: result.source,
        provider: result.providerUsed,
        providerUsed: true,
        latencyMs,
      });
      return result;
    } catch (error) {
      const reasonCode = String(error && error.code || "UNDERSTANDING_FAILED").slice(0, 80);
      const result = this.deterministicResult(input, "deterministic_fallback", reasonCode);
      result.latencyMs = Date.now() - started;
      const generatedChain = generated && Array.isArray(generated.providerChain) ? generated.providerChain : [];
      const generatedProvider = providerStateName(generated && generated.provider || "");
      result.providerChain = generatedChain.length
        ? generatedChain
        : (providerAttempts.length ? providerAttempts : (generatedProvider && generatedProvider !== "mock"
          ? [{ provider: generatedProvider, status: "success", reason: "invalid_structured_output" }]
          : []));
      const externalAttempts = result.providerChain.filter((item) => item
        && String(item.provider || "").toLowerCase() !== "mock"
        && ["success", "failed"].includes(String(item.status || "").toLowerCase()));
      if (externalAttempts.length) {
        result.externalProviderUsed = true;
        result.providerUsed = providerStateName(externalAttempts[externalAttempts.length - 1].provider);
      }
      emit(onEvent, {
        type: "understanding.fallback",
        status: "degraded",
        runtimeMode,
        understandingSource: result.source,
        reasonCode,
        provider: result.providerUsed || "",
        providerUsed: result.externalProviderUsed === true,
        latencyMs: result.latencyMs,
      });
      return result;
    }
  }
}

const defaultUnderstandingService = new UnderstandingService();

module.exports = {
  UnderstandingService,
  buildUnderstandingMessages,
  defaultUnderstandingService,
  providerStateName,
};
