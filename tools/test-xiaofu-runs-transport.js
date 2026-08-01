#!/usr/bin/env node
// Production transport must be the runs API + RunEvent polling driven by the
// single active-run state source (agentRunShell): UI states come from real
// server events, never from client-side guesses. The legacy direct-chat
// oracle is compatibility-only (P6b): explicit rollback flag or server-side
// RUN_PROTOCOL_UNSUPPORTED only; plain network errors/timeouts must surface
// truthfully instead of silently downgrading product semantics.
const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const aiTransportRouter = require("../miniprogram/services/aiTransportRouter");
const agentRunShell = require("../miniprogram/services/agentRunShell");
const utilsRequest = require("../miniprogram/utils/request");
const cloudbaseConfig = require("../miniprogram/config/cloudbase");

const originalStartRun = agentRunShell.shell.startRun;
const originalPost = utilsRequest.post;
const originalFlag = cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED;

function readCompatLog() {
  try {
    const value = wx.getStorageSync(aiTransportRouter.DIRECT_CHAT_COMPAT_KEY);
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

async function testRunsTransportIsTheDefaultPath() {
  cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED = true;
  mockEnv.clearStorage();
  const calls = { startRun: 0, oracle: 0 };
  const emittedEvents = [];
  const statuses = [];

  agentRunShell.shell.startRun = async (input) => {
    calls.startRun += 1;
    assert.strictEqual(input.message, "今天有什么课");
    assert.strictEqual(input.context.term, "2025-2026-2");
    assert.strictEqual(input.requestId, "req-runs-1");
    assert.strictEqual(input.conversationId, "conversation-runs-1");
    assert.strictEqual(input.memoryMode, "local_only");
    const events = [
      { type: "understanding.started", sequence: 1, eventId: "evt_1", label: "正在理解你的目标" },
      { type: "tool.started", tool: "get_today_courses", sequence: 2, eventId: "evt_2", label: "正在读取今日课表" },
      { type: "run.completed", sequence: 3, eventId: "evt_3", label: "已完成" },
    ];
    input.callbacks.onRunCreated({ runId: "run-1", pollToken: "poll-1" });
    input.callbacks.onRunEvents(events.slice(0, 2));
    input.callbacks.onRunEvents(events.slice());
    input.callbacks.onStatus({ type: "run.completed", text: "已完成" });
    return {
      status: "completed",
      events,
      result: {
        protocolVersion: "agent.v2",
        status: "completed",
        answer: "今天有两节课",
        safety: { externalProviderUsed: false },
      },
    };
  };

  const response = await aiTransportRouter.chat({
    message: "今天有什么课",
    context: { term: "2025-2026-2" },
    protocolVersion: "agent.v2",
    requestId: "req-runs-1",
    conversationId: "conversation-runs-1",
    callbacks: {
      onRunEvents: (batch, all) => {
        emittedEvents.push(...batch);
        // 契约：第二参为累计全量（页面据此 slice(-12) 展示）。
        assert.ok(Array.isArray(all) && all.length >= batch.length);
      },
      onStatus: (status) => statuses.push(status),
    },
    // Even when a legacy oracle is supplied, the runs path must win unless
    // the rollback flag is explicitly off.
    oracleChat: async () => {
      calls.oracle += 1;
      throw new Error("legacy oracle must not be called in runs mode");
    },
  });

  assert.strictEqual(calls.startRun, 1, "production path must go through agentRunShell");
  assert.strictEqual(calls.oracle, 0, "legacy oracle short-circuit must be gone");
  assert.deepStrictEqual(emittedEvents.map((item) => item.type), [
    "understanding.started",
    "tool.started",
    "run.completed",
  ]);
  assert.strictEqual(response.answer, "今天有两节课");
  assert.ok(Array.isArray(response.runEvents) && response.runEvents.length === 3);
  const submitted = statuses.find((item) => item && item.type === "request.submitted");
  assert.ok(submitted, "submit status must be emitted");
  assert.ok(
    !/理解|查询|核验/.test(submitted.text),
    `pre-event status must stay neutral, got: ${submitted.text}`
  );
}

async function testRollbackFlagRestoresLegacyOracle() {
  cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED = false;
  mockEnv.clearStorage();
  const calls = { startRun: 0, oracle: 0 };
  agentRunShell.shell.startRun = async () => {
    calls.startRun += 1;
    throw new Error("runs API must not be called in rollback mode");
  };
  const response = await aiTransportRouter.chat({
    message: "hello",
    context: {},
    oracleChat: async () => {
      calls.oracle += 1;
      return { protocolVersion: "agent.v2", status: "completed", answer: "legacy ok" };
    },
  });
  assert.strictEqual(calls.oracle, 1, "rollback flag must restore the legacy oracle path");
  assert.strictEqual(calls.startRun, 0);
  assert.strictEqual(response.answer, "legacy ok");
  const log = readCompatLog();
  assert.ok(log.some((entry) => entry.compatReason === "explicit_flag"
    && entry.transport === "direct_chat_compat"), "compat 使用必须记录 explicit_flag");
}

async function testProtocolUnsupportedEngagesControlledCompat() {
  cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED = true;
  mockEnv.clearStorage();
  const calls = { startRun: 0, directChat: 0 };
  agentRunShell.shell.startRun = async () => {
    calls.startRun += 1;
    const error = new Error("RUN_PROTOCOL_UNSUPPORTED");
    error.errorClass = "unsupported_protocol";
    error.code = "RUN_PROTOCOL_UNSUPPORTED";
    throw error;
  };
  utilsRequest.post = async (path, body) => {
    calls.directChat += 1;
    assert.strictEqual(path, "/api/ai/agent/chat");
    assert.strictEqual(body.message, "今天有什么课");
    return { protocolVersion: "agent.v2", status: "completed", answer: "compat answer" };
  };
  const response = await aiTransportRouter.chat({
    message: "今天有什么课",
    context: {},
    callbacks: {},
  });
  assert.strictEqual(calls.startRun, 1);
  assert.strictEqual(calls.directChat, 1, "协议不兼容必须进入受控 direct chat 兼容");
  assert.strictEqual(response.answer, "compat answer");
  assert.strictEqual(response.compatMode, "direct_chat");
  assert.strictEqual(response.compatReason, "protocol_unsupported");
  assert.strictEqual(response.transport, "direct_chat_compat");
  // 兼容通道绝不伪造执行状态：不得附 runEvents，plan/verification 不存在，
  // toolCalls/taskSteps 只能是 normalizeOracleResponse 的空默认（非编造内容）。
  assert.ok(!("runEvents" in response), "direct chat compat must not fabricate runEvents");
  assert.ok(!("plan" in response) && !("verification" in response) && !("actionReceipt" in response),
    "direct chat compat must not fabricate plan/verification/action_receipt");
  assert.deepStrictEqual(response.toolCalls, []);
  assert.deepStrictEqual(response.taskSteps, []);
  const log = readCompatLog();
  assert.ok(log.some((entry) => entry.compatReason === "protocol_unsupported"
    && entry.protocolVersion === "agent.v2"
    && entry.featureImpact), "compat 使用必须记录 protocol_unsupported 五元组");
}

async function testNetworkErrorNeverSilentlyDowngrades() {
  cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED = true;
  mockEnv.clearStorage();
  const calls = { directChat: 0, oracle: 0 };
  agentRunShell.shell.startRun = async () => {
    const error = new Error("wx.request:fail timeout");
    error.code = "NETWORK";
    throw error;
  };
  utilsRequest.post = async () => {
    calls.directChat += 1;
    throw new Error("direct chat must not be used for plain network errors");
  };
  let caught = null;
  try {
    await aiTransportRouter.chat({
      message: "今天有什么课",
      context: {},
      callbacks: {},
      oracleChat: async () => {
        calls.oracle += 1;
        return { answer: "must not be used either" };
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught && caught.code === "NETWORK", "网络错误必须如实上抛");
  assert.strictEqual(calls.directChat, 0, "普通网络错误不得静默转 direct chat");
  assert.strictEqual(calls.oracle, 0);
  assert.strictEqual(readCompatLog().length, 0, "非兼容场景不得记录 compat");
}

async function testTimeoutIsTruthfulRetriableError() {
  cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED = true;
  mockEnv.clearStorage();
  const calls = { directChat: 0 };
  agentRunShell.shell.startRun = async () => ({
    status: "running",
    events: [],
    result: null,
    timeout: true,
  });
  utilsRequest.post = async () => {
    calls.directChat += 1;
    throw new Error("timeout must not fall back to direct chat");
  };
  let caught = null;
  try {
    await aiTransportRouter.chat({ message: "今天有什么课", context: {}, callbacks: {} });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "超时必须抛错而非静默降级");
  assert.strictEqual(caught.code, "TIMEOUT");
  assert.strictEqual(caught.reasonCode, "RUN_TIMEOUT");
  assert.strictEqual(caught.retriable, true);
  assert.strictEqual(calls.directChat, 0);
}

async function run() {
  await testRunsTransportIsTheDefaultPath();
  await testRollbackFlagRestoresLegacyOracle();
  await testProtocolUnsupportedEngagesControlledCompat();
  await testNetworkErrorNeverSilentlyDowngrades();
  await testTimeoutIsTruthfulRetriableError();
  console.log("test-xiaofu-runs-transport: PASS (5 scenarios)");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  agentRunShell.shell.startRun = originalStartRun;
  utilsRequest.post = originalPost;
  cloudbaseConfig.AI_AGENT_RUNS_TRANSPORT_ENABLED = originalFlag;
});
