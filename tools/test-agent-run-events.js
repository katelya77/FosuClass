#!/usr/bin/env node
const assert = require("assert");
const agentRunEventService = require("../server/src/services/ai/agentRunEventService");
const { loadingTextForEvent, publicEventSummary, EVENT_TYPES } = require("../server/src/services/ai/runEventCatalog");
const { EVENT_MAP: AGUI_EVENT_MAP } = require("../server/src/services/ai/aguiAdapter");
const verificationCoordinator = require("../server/src/services/ai/runtime/verificationCoordinator");
const { deriveExecutionOutcome } = require("../server/src/services/ai/runtime/responseComposerBridge");

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

  const publicDiagnostic = publicEventSummary({
    type: "provider.failed",
    runtimeMode: "public",
    provider: "deepseek",
    purpose: "understanding",
    understandingSource: "model",
    reasonCode: "UPSTREAM_DETAIL",
    providerUsed: true,
  });
  assert.strictEqual(publicDiagnostic.provider, "", "public events must not expose Provider implementations");
  assert.strictEqual(publicDiagnostic.purpose, "");
  assert.strictEqual(publicDiagnostic.understandingSource, "");
  assert.strictEqual(publicDiagnostic.reasonCode, "");
  assert.strictEqual(publicDiagnostic.providerUsed, false);
  const trialDiagnostic = publicEventSummary({
    type: "provider.completed",
    runtimeMode: "trial",
    provider: "deepseek",
    purpose: "understanding",
    understandingSource: "model",
    providerUsed: true,
  });
  assert.strictEqual(trialDiagnostic.provider, "deepseek", "trial/dev keep safe Provider diagnostics");

  const partialRun = agentRunEventService.createRun({ runtimeMode: "trial" });
  const partialEmitter = agentRunEventService.createEventEmitter(partialRun.runId, "trial");
  partialEmitter({ type: "run.degraded", status: "partial", partialCompletion: true });
  agentRunEventService.setResult(partialRun.runId, { status: "partial", success: false }, "completed");
  const partialView = agentRunEventService.getRunView(partialRun.runId, { pollToken: partialRun.pollToken });
  assert.strictEqual(partialView.status, "degraded", "setResult must not overwrite an existing degraded terminal event");
  assert.strictEqual(agentRunEventService.statusFromResult({ status: "partial", success: false }), "degraded");

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

  // ---------------------------------------------------------------------
  // M2-T2: verification.started / verification.completed runtime events
  // ---------------------------------------------------------------------
  assert.ok(EVENT_TYPES.includes("verification.started"), "catalog must include verification.started");
  assert.ok(EVENT_TYPES.includes("verification.completed"), "catalog must include verification.completed");
  assert.ok(/核验/.test(loadingTextForEvent({ type: "verification.started" }, "public")));
  assert.ok(/已核验/.test(loadingTextForEvent({ type: "verification.completed", status: "verified" }, "public")));
  assert.ok(/未通过/.test(loadingTextForEvent({ type: "verification.completed", status: "failed" }, "public")));
  assert.strictEqual(AGUI_EVENT_MAP["verification.started"], "STEP_STARTED", "agui mapping for verification.started");
  assert.strictEqual(AGUI_EVENT_MAP["verification.completed"], "STEP_FINISHED", "agui mapping for verification.completed");

  // Events flow through the run store with counts/tool id preserved (and no raw data).
  const m2Run = agentRunEventService.createRun({ runtimeMode: "public" });
  const m2Emitter = agentRunEventService.createEventEmitter(m2Run.runId, "public");
  m2Emitter({ type: "verification.started", toolCount: 2 });
  m2Emitter({ type: "verification.completed", status: "failed", violationCount: 1, tool: "get_teaching_week" });
  const m2View = agentRunEventService.getRunView(m2Run.runId, { pollToken: m2Run.pollToken });
  const m2Started = m2View.events.find((item) => item.type === "verification.started");
  assert.ok(m2Started, "verification.started must appear in the polled run event stream");
  assert.strictEqual(m2Started.toolCount, 2, "toolCount must survive publicEventSummary");
  const m2Completed = m2View.events.find((item) => item.type === "verification.completed");
  assert.ok(m2Completed, "verification.completed must appear in the polled run event stream");
  assert.strictEqual(m2Completed.status, "failed");
  assert.strictEqual(m2Completed.violationCount, 1, "violationCount must survive publicEventSummary");
  assert.strictEqual(m2Completed.tool, "get_teaching_week", "tool id must survive publicEventSummary");
  assert.ok(/核验|未通过/.test(m2Completed.label), "verification.completed must carry user-safe loading copy");

  // ---------------------------------------------------------------------
  // M2-T2 wiring proof: verificationCoordinator.verifyToolResults consumes
  // real manifest policies over execution tool results, emits real RunEvents,
  // and folds the verdict into deriveExecutionOutcome's existing
  // verification/partial outputs. Fixtures are fully synthetic (no tokens,
  // no personal data, no network).
  // ---------------------------------------------------------------------
  const wiringEvents = [];
  const wiringEmit = { onEvent: (event) => wiringEvents.push(event) };

  // Green case: compliant get_teaching_week result → verified.
  const greenExecution = {
    runtimeMode: "public",
    intent: { name: "get_teaching_week", slots: {} },
    toolCalls: [{
      name: "get_teaching_week",
      status: "success",
      summary: "synthetic green fixture",
      result: { success: true, term: "2099-2100-1", currentWeek: 8, totalWeeks: 20, todayDate: "2099-10-19" },
    }],
    verification: { ok: true, errors: [], evidenceComplete: true },
  };
  const greenSummary = verificationCoordinator.verifyToolResults(greenExecution, greenExecution.intent, null, {
    eventInput: wiringEmit,
    runtimeMode: "public",
  });
  assert.strictEqual(greenSummary.status, "verified", "green fixture must be verified");
  assert.strictEqual(greenSummary.toolCount, 1);
  const startedIndex = wiringEvents.findIndex((event) => event.type === "verification.started");
  const completedIndex = wiringEvents.findIndex((event) => event.type === "verification.completed");
  assert.ok(startedIndex >= 0, "verification.started must be emitted for real verification work");
  assert.ok(completedIndex > startedIndex, "verification.completed must follow verification.started");
  assert.strictEqual(wiringEvents[startedIndex].toolCount, 1);
  assert.strictEqual(wiringEvents[completedIndex].status, "verified");
  assert.strictEqual(wiringEvents[completedIndex].violationCount, 0);
  const greenOutcome = deriveExecutionOutcome({ execution: greenExecution });
  assert.strictEqual(greenOutcome.status, "completed", "green fixture must keep completed outcome");
  assert.strictEqual(greenOutcome.verificationOk, true);

  // Red case (failed): get_teaching_week result missing required field term.
  wiringEvents.length = 0;
  const redExecution = {
    runtimeMode: "public",
    intent: { name: "get_teaching_week", slots: {} },
    toolCalls: [{
      name: "get_teaching_week",
      status: "success",
      summary: "synthetic red fixture",
      result: { success: true, currentWeek: 8 },
    }],
    verification: { ok: true, errors: [], evidenceComplete: true },
  };
  const redSummary = verificationCoordinator.verifyToolResults(redExecution, redExecution.intent, null, {
    eventInput: wiringEmit,
    runtimeMode: "public",
  });
  assert.strictEqual(redSummary.status, "failed", "missing required output field must fail verification");
  assert.strictEqual(redExecution.verification.ok, false, "failed verdict must fold into execution.verification.ok");
  assert.ok(
    redExecution.verification.errors.some((item) => item.code === "TOOL_RESULT_VERIFICATION_FAILED" && item.tool === "get_teaching_week"),
    "failed verdict must append TOOL_RESULT_VERIFICATION_FAILED to execution.verification.errors"
  );
  const redCompleted = wiringEvents.find((event) => event.type === "verification.completed");
  assert.ok(redCompleted, "verification.completed must be emitted on the red path");
  assert.strictEqual(redCompleted.status, "failed");
  assert.strictEqual(redCompleted.tool, "get_teaching_week", "completed event must name the offending tool id");
  assert.ok(redCompleted.violationCount >= 1, "completed event must carry the violation count");
  const redOutcome = deriveExecutionOutcome({ execution: redExecution });
  assert.strictEqual(redOutcome.status, "failed", "red fixture must drive deriveExecutionOutcome to failed");
  assert.strictEqual(redOutcome.eventType, "run.failed");
  assert.strictEqual(redOutcome.verificationOk, false);

  // Red case (partial): soft postcondition violation under allowPartial.
  wiringEvents.length = 0;
  const sentinelCourseName = "合成哨兵课程X7Q9";
  const partialExecution = {
    runtimeMode: "public",
    intent: { name: "get_today_courses", slots: {} },
    toolCalls: [{
      name: "get_today_courses",
      status: "success",
      summary: "synthetic partial fixture",
      result: { success: true, courses: [{ courseName: sentinelCourseName }], courseCount: 25 },
    }],
    verification: { ok: true, errors: [], evidenceComplete: true },
  };
  const partialSummary = verificationCoordinator.verifyToolResults(partialExecution, partialExecution.intent, null, {
    eventInput: wiringEmit,
    runtimeMode: "public",
  });
  assert.strictEqual(partialSummary.status, "partial", "soft violation under allowPartial must be partial");
  assert.strictEqual(partialExecution.partialCompletion, true, "partial verdict must fold into execution.partialCompletion");
  const partialOutcome = deriveExecutionOutcome({ execution: partialExecution });
  assert.strictEqual(partialOutcome.status, "partial", "partial fixture must drive deriveExecutionOutcome to partial");
  assert.strictEqual(partialOutcome.eventType, "run.degraded");
  assert.strictEqual(partialOutcome.partialCompletion, true);
  assert.ok(
    !JSON.stringify(wiringEvents).includes(sentinelCourseName),
    "verification events must never carry raw schedule data"
  );

  // Skipped case: no policy-bearing tools → no events, no execution mutation.
  wiringEvents.length = 0;
  const skippedExecution = {
    runtimeMode: "public",
    toolCalls: [{ name: "diagnose_data_status", status: "success", result: { success: true } }],
    verification: { ok: true, errors: [] },
  };
  const skippedSummary = verificationCoordinator.verifyToolResults(skippedExecution, {}, null, {
    eventInput: wiringEmit,
    runtimeMode: "public",
  });
  assert.strictEqual(skippedSummary.status, "skipped", "tools without declared policies must be skipped");
  assert.strictEqual(wiringEvents.length, 0, "no verification events may be emitted when nothing is verified");
  assert.strictEqual(skippedExecution.toolResultVerification, undefined, "skipped path must not mutate the execution");

  // Legal-empty case: tool-declared needContext empty state (no personal
  // schedule summary) is a deterministic legal empty, not a schema failure.
  wiringEvents.length = 0;
  const needContextExecution = {
    runtimeMode: "public",
    intent: { name: "course_action_advice", slots: {} },
    toolCalls: [{
      name: "get_course_route",
      status: "success",
      summary: "synthetic needContext fixture",
      result: { success: true, needContext: true, courses: [], courseCount: 0 },
    }],
    verification: { ok: true, errors: [], evidenceComplete: true },
  };
  const needContextSummary = verificationCoordinator.verifyToolResults(needContextExecution, needContextExecution.intent, null, {
    eventInput: wiringEmit,
    runtimeMode: "public",
  });
  assert.strictEqual(needContextSummary.status, "verified", "tool-declared legal empty (needContext) must not fail verification");
  assert.strictEqual(
    needContextSummary.perTool.get_course_route.status,
    "empty_accepted",
    "needContext results must be recorded as empty_accepted"
  );
  const needContextOutcome = deriveExecutionOutcome({ execution: needContextExecution });
  assert.strictEqual(needContextOutcome.status, "completed", "needContext legal empty must keep the completed outcome");

  // Failed-tool case: a tool call that already failed upstream is reported as
  // not content-verified but must NOT re-fail the run (kernel adjudicates it).
  wiringEvents.length = 0;
  const failedToolExecution = {
    runtimeMode: "public",
    intent: { name: "campus_multi_step_advice", slots: {} },
    toolCalls: [{
      name: "search_empty_rooms",
      status: "failed",
      summary: "synthetic failed-tool fixture",
      result: { success: false, code: "SYNTHETIC_UNAVAILABLE" },
    }],
    verification: { ok: true, errors: [], evidenceComplete: true },
  };
  const failedToolSummary = verificationCoordinator.verifyToolResults(failedToolExecution, failedToolExecution.intent, null, {
    eventInput: wiringEmit,
    runtimeMode: "public",
  });
  assert.strictEqual(failedToolSummary.status, "verified", "upstream-failed tool calls must not flip the aggregate");
  assert.strictEqual(
    failedToolSummary.perTool.search_empty_rooms.status,
    "skipped",
    "upstream-failed tool calls must be reported as skipped"
  );
  assert.strictEqual(
    failedToolSummary.perTool.search_empty_rooms.reason,
    "tool_call_failed",
    "skipped entries must name the upstream failure reason"
  );
  const failedToolOutcome = deriveExecutionOutcome({ execution: failedToolExecution });
  assert.strictEqual(failedToolOutcome.status, "completed", "upstream-failed tool alone must not fail the run outcome");

  // Append-only fold-in: pre-existing kernel verification errors/contract survive.
  const preserveExecution = {
    runtimeMode: "public",
    intent: { name: "get_teaching_week", slots: {} },
    toolCalls: [{
      name: "get_teaching_week",
      status: "success",
      result: { success: true, currentWeek: 8 },
    }],
    verification: { ok: false, errors: [{ code: "FACT_TOOL_EVIDENCE_REQUIRED" }], goalContract: { goal: "synthetic" } },
  };
  verificationCoordinator.verifyToolResults(preserveExecution, preserveExecution.intent, null, {
    eventInput: { onEvent: () => {} },
    runtimeMode: "public",
  });
  assert.ok(
    preserveExecution.verification.errors.some((item) => item.code === "FACT_TOOL_EVIDENCE_REQUIRED"),
    "pre-existing kernel verification errors must be preserved"
  );
  assert.ok(
    preserveExecution.verification.errors.some((item) => item.code === "TOOL_RESULT_VERIFICATION_FAILED"),
    "new verification errors must be appended, not replacing existing ones"
  );
  assert.strictEqual(
    preserveExecution.verification.goalContract && preserveExecution.verification.goalContract.goal,
    "synthetic",
    "execution.verification.goalContract must be preserved"
  );

  console.log("test-agent-run-events: PASS");
}

run();
