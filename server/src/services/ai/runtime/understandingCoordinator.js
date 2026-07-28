const toolRegistry = require("../toolRegistry");
const knowledgeBaseService = require("../knowledgeBaseService");
const capabilityManifestService = require("../capabilityManifestService");
const { defaultUnderstandingService } = require("../understanding/understandingService");
const { emitChatEvent } = require("./runEventPublisher");

const FACT_TOOL_INTENTS = new Set(Object.values(capabilityManifestService.getManifest().intents)
  .filter((item) => item.factualTask)
  .map((item) => item.id));

function isProjectKnowledgeIntent(intent) {
  const name = intent && intent.name;
  return name === "project_qa" || name === "conversational_help";
}

function isFactToolIntent(intent) {
  const name = intent && intent.name;
  return FACT_TOOL_INTENTS.has(name);
}

function isKnownRuleIntentName(name) {
  const value = String(name || "").trim();
  return Boolean(value && (FACT_TOOL_INTENTS.has(value) || value === "project_qa" || value === "conversational_help" || value === "next_course_location"));
}

function shouldRuleOverrideIntent(ruleIntentName, parsedIntent) {
  if (!isKnownRuleIntentName(ruleIntentName)) return false;
  const parsedName = parsedIntent && parsedIntent.name || "";
  if (!parsedName || parsedName === "generic" || parsedName === "conversational_help" || parsedName === "project_qa") return true;
  if (parsedName === "rag_search" && ruleIntentName !== "rag_search") return true;
  return parsedName === ruleIntentName;
}

function resolveRuleBackedIntent(message, context = {}) {
  const parsedIntent = toolRegistry.resolveIntent(message, context);
  const environment = context.assistantEnvironment || context.runtimeMode || "public";
  let ruleMatch = null;
  try {
    const matched = knowledgeBaseService.matchLocalRule({ query: message, environment });
    ruleMatch = matched && matched.matched ? matched : null;
  } catch (error) {
    ruleMatch = null;
  }
  if (!ruleMatch || !ruleMatch.rule || !shouldRuleOverrideIntent(ruleMatch.rule.intentName, parsedIntent)) {
    return { intent: parsedIntent, ruleMatch };
  }
  const intent = Object.assign({}, parsedIntent, {
    name: ruleMatch.rule.intentName,
    slots: Object.assign({}, parsedIntent.slots || {}),
    ruleId: ruleMatch.rule.id,
    ruleTitle: ruleMatch.rule.title,
    ruleScore: ruleMatch.score,
    source: "knowledge-rule",
  });
  return { intent, ruleMatch };
}

/**
 * Understanding coordination: unified model-first understanding with the
 * deterministic rule-backed resolver as fallback and chat event forwarding.
 */
async function runUnderstanding(input = {}) {
  const context = input.context || {};
  return defaultUnderstandingService.understand({
    message: input.message,
    context,
    conversationState: input.conversationState || {
      conversationSummary: context.conversationSummary || "",
      recentMessages: context.recentMessages || [],
      workingMemory: context.workingMemory || null,
      pendingClarification: context.pendingClarification || null,
      contextSlots: context.conversationSlots || {},
    },
    runtimeMode: input.runtimeMode,
    providerRuntimeConfig: input.providerRuntimeConfig,
    principal: input.principal,
    conversationId: input.conversationId,
    deterministicResolve: (message, safeContext) => resolveRuleBackedIntent(message, safeContext).intent,
    onEvent: (event) => emitChatEvent(input.eventInput || {}, Object.assign({
      runtimeMode: input.runtimeMode,
    }, event)),
  });
}

module.exports = {
  FACT_TOOL_INTENTS,
  isProjectKnowledgeIntent,
  isFactToolIntent,
  isKnownRuleIntentName,
  shouldRuleOverrideIntent,
  resolveRuleBackedIntent,
  runUnderstanding,
};
