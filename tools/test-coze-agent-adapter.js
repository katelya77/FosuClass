#!/usr/bin/env node
/**
 * Coze Agent Adapter unit tests: stream parse, async+poll, 401/429/5xx/timeout/abort, session map.
 * No live network unless COZE_* env present; never logs tokens.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const adapter = require("../server/src/services/ai/providers/cozeAgentAdapter");
const cozeProvider = require("../server/src/services/ai/providers/cozeProvider");

const SCRATCH = process.env.GROK_SCRATCH
  || path.join(process.env.TEMP || process.env.TMP || ".", "grok-goal-coze");
try { fs.mkdirSync(SCRATCH, { recursive: true }); } catch (e) { /* ignore */ }

let pass = 0;
let fail = 0;
const lines = [];
function check(name, cond, extra) {
  const msg = cond ? `PASS ${name}` : `FAIL ${name}${extra ? ` :: ${extra}` : ""}`;
  lines.push(msg);
  console.log(msg);
  if (cond) pass += 1; else fail += 1;
}

// Token normalize
check("strip Bearer", adapter.normalizeToken("Bearer abc.def") === "abc.def");
check("strip BOM/ws", adapter.normalizeToken("\uFEFFtok\n") === "tok");

// Session map per conversation
const s1 = adapter.mapConversationToSessionId("conv-a", { principalKey: "u1" });
const s2 = adapter.mapConversationToSessionId("conv-b", { principalKey: "u1" });
const s1b = adapter.mapConversationToSessionId("conv-a", { principalKey: "u1" });
check("session differs by conversation", s1 !== s2);
check("session stable for same conv", s1 === s1b);
check("not shared production id SdMGw…", s1.indexOf("SdMGw") < 0);

// Body shape
const body = adapter.buildQueryBody({ prompt: "打开课表", sessionId: s1, projectId: "7664956206057914406" });
check("body type query", body.type === "query");
check("body has project_id", String(body.project_id).includes("7664") || body.project_id === 7664956206057914406);
check("body has prompt text", body.content.query.prompt[0].content.text === "打开课表");

// Stream event parse via cozeProvider
const sse = [
  "event: message",
  'data: {"content":{"text":"你好"}}',
  "",
  "event: done",
  "data: [DONE]",
  "",
].join("\n");
const parsed = cozeProvider.parseWorkloadStream(sse);
check("parse stream text", parsed === "你好" || parsed.includes("你好"), parsed);

// Mock stream_run 401
(async () => {
  try {
    await adapter.streamRun({
      message: "hi",
      conversationId: "c1",
      providerRuntimeConfig: {
        COZE_AGENT_BASE_URL: "https://example.test",
        COZE_PROJECT_ID: "1",
        COZE_API_TOKEN: "fake",
      },
      fetchImpl: async () => ({ status: 401, text: async () => "{}" }),
    });
    check("401 throws", false);
  } catch (error) {
    check("401 unauthorized", error.code === "unauthorized" || error.status === 401, error.code);
  }

  try {
    await adapter.streamRun({
      message: "hi",
      conversationId: "c1",
      providerRuntimeConfig: {
        COZE_AGENT_BASE_URL: "https://example.test",
        COZE_PROJECT_ID: "1",
        COZE_API_TOKEN: "fake",
      },
      fetchImpl: async () => ({ status: 429, text: async () => "{}" }),
    });
    check("429 throws", false);
  } catch (error) {
    check("429 rate_limited", error.code === "rate_limited" || error.status === 429, error.code);
  }

  try {
    await adapter.streamRun({
      message: "hi",
      conversationId: "c1",
      providerRuntimeConfig: {
        COZE_AGENT_BASE_URL: "https://example.test",
        COZE_PROJECT_ID: "1",
        COZE_API_TOKEN: "fake",
      },
      fetchImpl: async () => ({ status: 503, text: async () => "{}" }),
    });
    check("5xx throws", false);
  } catch (error) {
    check("5xx provider_failed", error.status === 503 || error.code === "provider_failed", error.code);
  }

  // abort
  const controller = { aborted: true };
  try {
    await adapter.streamRun({
      message: "hi",
      conversationId: "c1",
      abortSignal: controller,
      providerRuntimeConfig: {
        COZE_AGENT_BASE_URL: "https://example.test",
        COZE_PROJECT_ID: "1",
        COZE_API_TOKEN: "fake",
      },
      fetchImpl: async () => ({ status: 200, text: async () => "data: {\"content\":{\"text\":\"x\"}}\n\n" }),
    });
    check("abort throws", false);
  } catch (error) {
    check("abort code", error.code === "aborted", error.code);
  }

  // successful stream mock
  try {
    const ok = await adapter.streamRun({
      message: "打开课表",
      conversationId: "c-ok",
      providerRuntimeConfig: {
        COZE_AGENT_BASE_URL: "https://example.test",
        COZE_PROJECT_ID: "1",
        COZE_API_TOKEN: "fake",
      },
      fetchImpl: async () => ({
        status: 200,
        text: async () => "event: message\ndata: {\"content\":{\"text\":\"计划打开班级课表\"}}\n\n",
      }),
    });
    check("stream success answer", ok && /课表|计划/.test(ok.answer), ok && ok.answer);
    check("stream mode", ok.mode === "stream_run");
  } catch (error) {
    check("stream success answer", false, error.message);
  }

  // async + poll (Coze task shape: result.messages[].content)
  try {
    let polls = 0;
    const result = await adapter.asyncRunAndPoll({
      message: "长任务",
      conversationId: "c-async",
      providerRuntimeConfig: {
        COZE_AGENT_BASE_URL: "https://example.test",
        COZE_PROJECT_ID: "1",
        COZE_API_TOKEN: "fake",
        COZE_POLL_INTERVAL_MS: "10",
        COZE_POLL_MAX_ATTEMPTS: "5",
      },
      sleepImpl: async () => {},
      postImpl: async () => ({ status: 200, data: { task_id: "task-1" } }),
      getImpl: async () => {
        polls += 1;
        if (polls < 2) return { status: 200, data: { status: "running" } };
        return {
          status: 200,
          data: {
            status: "completed",
            result: {
              messages: [
                { type: "human", content: [{ type: "text", text: "长任务" }] },
                { type: "ai", content: "完成了" },
              ],
            },
          },
        };
      },
    });
    check("async answer", result.answer === "完成了", result.answer);
    check("async taskId", result.taskId === "task-1");
  } catch (error) {
    check("async answer", false, error.message);
  }
  check(
    "extractAsyncTaskAnswer from messages",
    adapter.extractAsyncTaskAnswer({
      status: "completed",
      result: { messages: [{ type: "ai", content: "OK" }] },
    }) === "OK"
  );

  // public zero provider invariant is elsewhere; ensure adapter not configured without env
  check("not configured without env", adapter.isConfigured({}) === false || adapter.isConfigured({ COZE_API_TOKEN: "" }) === false);

  // live smoke optional
  const liveToken = process.env.COZE_API_TOKEN || process.env.COZE_API_KEY || "";
  if (liveToken && process.env.COZE_AGENT_BASE_URL) {
    try {
      const live = await adapter.streamRun({
        message: "仅回复OK",
        conversationId: `smoke-${Date.now()}`,
      });
      lines.push(`LIVE stream ok answerLen=${String(live.answer || "").length}`);
      check("live stream", Boolean(live.answer));
    } catch (error) {
      lines.push(`LIVE stream skip/fail code=${error.code || error.message}`);
      check("live stream optional fail recorded", true);
    }
  } else {
    lines.push("LIVE smoke skipped: no COZE env");
    check("live smoke skip recorded", true);
  }

  // ensure no token leakage in logs
  const dump = lines.join("\n");
  check("no bearer token in log dump", !/Bearer\s+[A-Za-z0-9._-]{8,}/.test(dump));
  if (liveToken) check("token not echoed", dump.indexOf(liveToken) < 0);

  console.log(`--- pass=${pass} fail=${fail}`);
  try {
    fs.writeFileSync(path.join(SCRATCH, "coze-smoke.log"), lines.join("\n"), "utf8");
  } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
