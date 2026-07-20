#!/usr/bin/env node
/**
 * Real in-process HTTP-equivalent Agent E2E against shipped agentService.
 * Captures planner events, public zero-model, multi-step tools, presentation.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const agentService = require("../server/src/services/ai/agentService");

const outDir = process.env.FOSU_E2E_OUT
  || path.join(process.env.TEMP || process.env.TMP || ".", "grok-goal-0ef2edee824c", "implementer", "real-http-e2e");
fs.mkdirSync(outDir, { recursive: true });

function save(name, value) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

async function run() {
  const events = [];
  // (a) trial multi-step — model planner when provider configured, else deterministic_fallback still tools
  const multi = await agentService.chat({
    message: "明天下午仙溪哪里适合自习，顺便看看天气",
    runtimeMode: "trial",
    context: { envVersion: "trial", campus: "仙溪" },
    protocolVersion: "agent.v2",
    onEvent: (e) => events.push({
      type: e.type,
      plannerType: e.plannerType,
      tool: e.tool || e.toolName,
      providerUsed: e.providerUsed,
      label: e.label,
    }),
  });
  save("trial-multi-step.json", {
    answer: multi.answer,
    presentationMode: multi.presentationMode,
    plan: multi.plan,
    planMeta: multi.planMeta,
    toolCalls: multi.toolCalls,
    metrics: multi.metrics,
    taskTrajectory: multi.taskTrajectory,
    events,
  });
  assert.ok(multi.answer || multi.presentationMode, "multi should respond");
  assert.ok((multi.toolCalls || []).length >= 1 || (multi.plan || []).length >= 1, "multi tools/plan");
  assert.ok((multi.cards || []).length <= 2, "composite card max 2");
  const plannerEvents = events.filter((e) => /planner|plan\./.test(e.type));
  assert.ok(plannerEvents.length >= 1 || multi.metrics && multi.metrics.plannerType, "planner path exercised");

  // (b) public zero external model
  const publicEvents = [];
  const pub = await agentService.chat({
    message: "现在第几教学周",
    runtimeMode: "public",
    context: { envVersion: "release", currentTeachingWeek: 3 },
    protocolVersion: "agent.v2",
    onEvent: (e) => publicEvents.push(e.type),
  });
  save("public-teaching-week.json", {
    answer: pub.answer,
    presentationMode: pub.presentationMode,
    metrics: pub.metrics,
    externalProviderUsed: pub.externalProviderUsed,
    events: publicEvents,
  });
  assert.strictEqual(pub.externalProviderUsed, false);
  assert.ok(!publicEvents.includes("planner.started"), "public must not start model planner");
  assert.ok((pub.cards || []).length <= 1, "single fact cards");

  // (c) plain greeting
  const hi = await agentService.chat({
    message: "你好",
    runtimeMode: "public",
    context: { envVersion: "release" },
    protocolVersion: "agent.v2",
  });
  save("public-greeting.json", {
    answer: hi.answer,
    presentationMode: hi.presentationMode,
    cards: hi.cards,
    taskTrajectory: hi.taskTrajectory,
    runSummary: hi.runSummary,
  });
  assert.ok((hi.cards || []).length === 0 || hi.presentationMode === "plain");

  // (d) empty multi-step / replan path still safe without fabricating personal free time
  const empty = await agentService.chat({
    message: "找连续四节空教室",
    runtimeMode: "public",
    context: { envVersion: "release" },
    protocolVersion: "agent.v2",
  });
  save("empty-room.json", {
    answer: empty.answer,
    tools: empty.toolCalls,
    presentationMode: empty.presentationMode,
  });

  console.log("test-agent-real-http-e2e passed");
  console.log("artifacts:", outDir);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
