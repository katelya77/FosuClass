#!/usr/bin/env node
/**
 * Lightweight e2e matrix against agent kernel + response composer (no live provider).
 */
const assert = require("assert");
const { AgentKernel } = require("../server/src/services/ai/agentKernel");
const responseComposer = require("../server/src/services/ai/responseComposer");
const mockProvider = require("../server/src/services/ai/providers/mockProvider");
const toolRegistry = require("../server/src/services/ai/toolRegistry");

const cases = [
  { message: "你好", intent: "conversational_help", expectPlain: true },
  { message: "你是谁", intent: "project_qa", expectPlain: true },
  { message: "现在第几教学周", intent: "get_teaching_week", expectFact: true },
  { message: "查老师课表", expectClarify: true },
  { message: "明天下午仙溪哪里适合自习顺便看看天气", expectMulti: true },
];

async function run() {
  const kernel = new AgentKernel({
    toolExecutor: async (name, args, context) => {
      if (name === "clarify_missing_slot") {
        return { success: true, needClarification: true, total: 0 };
      }
      if (name === "get_teaching_week") {
        return { success: true, week: 3, term: "2025-2026-2", total: 1, summary: "第3教学周" };
      }
      if (name === "get_tomorrow_courses") {
        return { success: true, courses: [], total: 0, code: "NO_PERSONAL_SCHEDULE", summary: "无个人课表" };
      }
      if (name === "search_empty_rooms" || name === "search_continuous_empty_rooms") {
        return { success: true, items: [{ room: "C7-101" }], total: 1 };
      }
      if (name === "get_campus_weather") {
        return { success: true, campus: "仙溪", summary: "多云", total: 1 };
      }
      if (name === "explain_personal_import") {
        return { success: true, title: "导入说明", total: 1 };
      }
      if (name === "rag_search") {
        return { success: true, hits: [], noAnswer: true, total: 0 };
      }
      return toolRegistry.executeToolAsync
        ? toolRegistry.executeTool(name, args, context)
        : { success: true, total: 0 };
    },
  });

  for (const item of cases) {
    const intent = item.intent
      ? { name: item.intent, slots: {}, confidence: 0.8 }
      : toolRegistry.resolveIntent(item.message, {});
    const execution = await kernel.execute({
      message: item.message,
      intent,
      runtimeMode: "public",
      context: { envVersion: "release" },
    });
    assert.ok(execution, item.message);

    if (item.expectClarify) {
      assert.ok(
        execution.structuredPlan && execution.structuredPlan.needsClarification
          || (execution.intent && execution.intent.name === "clarify_missing_slot")
          || (execution.toolCalls || []).some((t) => t.name === "clarify_missing_slot")
          || (execution.structuredPlan && execution.structuredPlan.clarification),
        `clarify: ${item.message}`
      );
    }

    if (item.expectMulti) {
      assert.ok(
        (execution.toolCalls || []).length >= 1 || (execution.structuredPlan && execution.structuredPlan.steps.length >= 1),
        `multi: ${item.message}`
      );
    }

    const generated = mockProvider.generate({
      intent: execution.intent || intent,
      toolResults: (execution.toolCalls || []).map((t) => ({
        name: t.name,
        status: t.status,
        summary: t.summary,
        result: t.result,
      })),
    });
    const composed = responseComposer.compose({
      answer: generated.answer,
      cards: generated.cards,
      suggestions: generated.suggestions,
      intentName: (execution.intent && execution.intent.name) || intent.name,
      runtimeMode: "public",
      toolCalls: execution.toolCalls,
      steps: execution.steps,
      plan: execution.structuredPlan,
    });

    if (item.expectPlain) {
      assert.strictEqual(composed.presentationMode, "plain", item.message);
      assert.strictEqual(composed.cards.length, 0, item.message);
    }
    if (item.expectFact) {
      assert.ok(["single_card", "multi_card", "plain"].includes(composed.presentationMode), item.message);
    }
  }

  // public provider policy zero external is enforced by agentService evaluateProviderPolicy
  const { evaluateProviderPolicy } = require("../server/src/services/ai/agentService");
  const decision = evaluateProviderPolicy(
    { name: "conversational_help" },
    [],
    "auto",
    "deepseek",
    "public",
    { AI_AGENT_ENABLED: "true", AI_PROVIDER: "deepseek" }
  );
  assert.strictEqual(decision.useExternal, false);

  console.log(`test-agent-e2e-matrix passed (${cases.length} scenarios)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
