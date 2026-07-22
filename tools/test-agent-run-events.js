#!/usr/bin/env node
const assert = require("assert");
const agentRunEventService = require("../server/src/services/ai/agentRunEventService");
const { loadingTextForEvent, EVENT_TYPES } = require("../server/src/services/ai/runEventCatalog");

function run() {
  agentRunEventService.resetForTests();

  // Loading mapping: greeting must not say 课表
  const hi = loadingTextForEvent({ type: "request.sanitized", intentName: "conversational_help" }, "public");
  assert.ok(!/课表/.test(hi), `greeting loading should not mention 课表, got: ${hi}`);
  assert.ok(/理解|问题|任务/.test(hi), hi);

  const schedule = loadingTextForEvent({ type: "tool.started", tool: "get_today_courses" }, "public");
  assert.ok(/课表|读取/.test(schedule), schedule);

  const weather = loadingTextForEvent({ type: "tool.started", tool: "get_campus_weather" }, "public");
  assert.ok(/天气/.test(weather), weather);

  const thinking = loadingTextForEvent({ type: "provider.started" }, "trial");
  assert.ok(/Thinking|增强/.test(thinking), thinking);

  const noThinking = loadingTextForEvent({ type: "response.composing", providerUsed: false }, "public");
  assert.ok(!/Thinking/.test(noThinking), noThinking);

  EVENT_TYPES.forEach((type) => {
    assert.ok(typeof loadingTextForEvent({ type }, "public") === "string");
  });

  // Run lifecycle + isolation
  const created = agentRunEventService.createRun({
    serverSession: { openidHash: "user-a-hash", appid: "wx-test" },
    runtimeMode: "public",
    requestId: "req-1",
    conversationId: "c-1",
  });
  assert.ok(created.runId);
  assert.ok(created.pollToken);

  const emitter = agentRunEventService.createEventEmitter(created.runId, "public");
  emitter({ type: "intent.resolved", intentName: "conversational_help" });
  emitter({ type: "response.composing", providerUsed: false });
  emitter({ type: "run.completed" });
  emitter({ type: "run.completed" });
  agentRunEventService.setResult(created.runId, {
    success: true,
    answer: "你好，我是小佛助手。",
    protocolVersion: "agent.v2",
  }, "completed");

  const view = agentRunEventService.getRunView(created.runId, { pollToken: created.pollToken });
  assert.strictEqual(view.ok, true);
  assert.strictEqual(view.status, "completed");
  assert.ok(view.events.some((item) => item.type === "run.accepted"));
  assert.strictEqual(
    view.events.filter((item) => item.type === "run.completed").length,
    1,
    "terminal run events must be idempotent"
  );
  assert.ok(view.events.every((item) => !JSON.stringify(item).includes("openid")));
  assert.ok(view.result && view.result.answer);

  // Foreign principal cannot access without poll token
  const denied = agentRunEventService.getRunView(created.runId, {
    serverSession: { openidHash: "other-user", appid: "wx-test" },
  });
  assert.strictEqual(denied.ok, false);

  // Cancel path
  const run2 = agentRunEventService.createRun({
    serverSession: { openidHash: "user-b", appid: "wx-test" },
    runtimeMode: "trial",
  });
  const cancelled = agentRunEventService.cancelRun(run2.runId, { pollToken: run2.pollToken });
  assert.strictEqual(cancelled.ok, true);
  assert.strictEqual(cancelled.status, "cancelled");
  assert.strictEqual(agentRunEventService.isCancelled(run2.runId), true);

  // afterSequence
  const viewAfter = agentRunEventService.getRunView(created.runId, {
    pollToken: created.pollToken,
    afterSequence: 1,
  });
  assert.ok(viewAfter.events.every((item) => item.sequence > 1));

  console.log("test-agent-run-events: PASS");
}

run();
