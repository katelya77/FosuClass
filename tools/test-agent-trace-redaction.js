#!/usr/bin/env node
const assert = require("assert");

const traceRecorder = require("../server/src/services/ai/agentTraceRecorder");

traceRecorder.clearForTest();
traceRecorder.record({
  runId: "run-trace-test token: run-secret-value",
  requestId: "req-trace-test password: request-secret-value",
  conversationId: "student-conversation-id",
  runtimeMode: "public",
  intent: "get_today_courses",
  selectedSkill: "today_schedule",
  rawMessage: "password: super-secret-value",
  context: {
    currentScheduleSummary: {
      courses: [{ courseName: "Private Course", teacherName: "Private Teacher" }],
    },
  },
  toolCalls: [{ name: "get_today_courses", status: "success", summary: "token: secret-token-value" }],
  steps: [{ id: "step-1", tool: "get_today_courses", status: "success", durationMs: 3 }],
  totalDurationMs: 8,
  providerUsed: false,
  fallbackLayer: "none",
  fallbackReason: "authorization token: fallback-secret-value",
  errorCode: "password: error-secret-value",
  evidenceComplete: true,
});

const traces = traceRecorder.listForTest();
assert.strictEqual(traces.length, 1);
const trace = traces[0];
assert.match(trace.conversationIdHash, /^[a-f0-9]{16}$/);
assert.ok(!Object.prototype.hasOwnProperty.call(trace, "conversationId"));
assert.ok(!Object.prototype.hasOwnProperty.call(trace, "rawMessage"));
assert.ok(!Object.prototype.hasOwnProperty.call(trace, "context"));
assert.deepStrictEqual(trace.toolCalls, [{ name: "get_today_courses", status: "success" }]);
assert.ok(!/super-secret|secret-token|Private Course|Private Teacher|run-secret|request-secret|fallback-secret|error-secret/.test(JSON.stringify(trace)));

traceRecorder.configureForTest({ maxEntries: 2, retentionMs: 60 * 1000 });
traceRecorder.record({ runId: "run-2", conversationId: "a" });
traceRecorder.record({ runId: "run-3", conversationId: "b" });
assert.strictEqual(traceRecorder.listForTest().length, 2, "trace storage must be bounded");

traceRecorder.clearForTest();
console.log("test-agent-trace-redaction passed");
