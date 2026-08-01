#!/usr/bin/env node
/**
 * P7a Engine conformance suite — suiteVersion: p7a-conformance-1
 *
 * 本 suite 对应 Fosu Engine（server/src/services/ai/engine/fosuEngine.js，
 * engineId=fosu-runtime）声明的 conformance.suiteVersion `p7a-conformance-1`。
 * 全部 22 项通过即 Fosu Engine 对该 suite 视为 "suite-verified"——证据只输出到
 * stdout（文末 conformance-evidence 行），不写回引擎声明；引擎自身的
 * conformance.status 永远只是 self-declared（agentEngine.js 纪律）。
 *
 * 路径层级约定（每项用例注释标注）：
 * - 【engine 轻量链】createAgentRuntime（真）+ 确定性假 stages + createFosuEngine（真）
 *   + createEngineRegistry（真）→ registry.resolve() → engine.execute()。
 * - 【platform 轻量装配】createAgentPlatform（真）+ engineRegistry + engineTraceMetadata
 *   + 假 stages；用于 error.engineTrace / platformTrace.engine 等平台层语义。
 * - 【platformComposition 全装配】server 生产组合根（agentService.chat →
 *   platformComposition.getPlatform() → engineRegistry.resolve → fosu engine）。
 * - 【runHandlers 链】platformComposition.getRunHandlers()（生产 Run API + journal
 *   run store）。用例 16/22 的幂等与恢复语义本就在 Run API/run store 层（engine
 *   如实声明 supportsResume=false，恢复由 Run 协议层 cursor 重放承担——见
 *   createRuntimeEngine 注释），故经该层最深真实路径验证并在此注释层级。
 *
 * 纪律：零第三方依赖；public 运行模式外部 Provider 调用恒 0（19/20 项经
 * 127.0.0.1 回环桩计数，无外网）；禁止只 mock Adapter 方法后断言调用。
 */

// ---- 环境必须先于任何 server 模块 require 固定（FOSU_DATA_DIR 重定向到临时目录）----
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "p7a-conformance-"));
process.env.NODE_ENV = "test";
process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "false";
process.env.AI_ALLOW_PERSONAL_CONTEXT = "true";
process.env.AI_WEATHER_ENABLED = "false";
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
process.env.FOSU_DATA_DIR = path.join(TMP_ROOT, "data");
process.env.FOSU_AGENT_MEMORY_SECRET = "p7a-conformance-memory-secret-00";
process.env.FOSU_AGENT_REMINDER_SECRET = "p7a-conformance-reminder-secret";
delete process.env.FOSU_AGENT_REPOSITORY_BACKEND;
delete process.env.AGENT_PG_URL;

const protocol = require("../packages/agent-protocol");
const uiSchema = require("../packages/ui-schema");
const {
  ENGINE_CAPABILITY_KEYS,
  createAgentRuntime,
  createEngineRegistry,
  engineTraceMetadata,
} = require("../packages/agent-runtime");
const { createAgentPlatform } = require("../apps/agent-server");
const {
  FOSU_CONFORMANCE_SUITE,
  FOSU_ENGINE_ID,
  createFosuEngine,
} = require("../server/src/services/ai/engine/fosuEngine");

assert.strictEqual(FOSU_CONFORMANCE_SUITE, "p7a-conformance-1", "suite 版本必须与 Fosu Engine 声明一致");

// ---------------- 断言/报告骨架（与既有 tools/test-*.js 同风格） ----------------
const results = [];
let passCount = 0;
let failCount = 0;

async function check(id, name, fn) {
  try {
    await fn();
    passCount += 1;
    results.push(`PASS ${id} ${name}`);
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    failCount += 1;
    results.push(`FAIL ${id} ${name}`);
    console.error(`FAIL ${id} ${name}: ${error && error.stack || error}`);
  }
}

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

// ---------------- 轻量链 fixture（手法对齐 tools/test-agent-runtime-lifecycle.js） ----------------
function makeRuntimeStages(overrides = {}) {
  return Object.assign({
    context: async ({ request }) => ({ message: String(request.message || ""), messageCount: 1 }),
    decision: async () => ({
      goal: { name: "echo" },
      selectedSkillId: "campus.plain_text",
      decisionSource: "deterministic",
    }),
    skillTool: async () => ({ toolCalls: [] }),
    verification: async () => ({ ok: true, errors: [] }),
    response: async () => ({
      answer: "这是确定性文本回答。",
      responseMode: "deterministic",
      runtimeMode: "public",
    }),
  }, overrides);
}

function makeEngineChain(runtimeOptions = {}) {
  const traces = [];
  const runtime = createAgentRuntime(Object.assign({
    protocol,
    uiSchema,
    traceSink: (trace) => traces.push(trace),
  }, runtimeOptions));
  const engine = createFosuEngine({ runtime });
  const registry = createEngineRegistry({ featureFlags: { allowExperimentalEngines: false } });
  registry.register(engine, { makeDefault: true });
  return { runtime, engine, registry, traces };
}

function makeInput({ runId, stages, events, signal, message = "你好", runtimeMode = "public", configVersion = "cfg_p7a_1", extraRequest }) {
  return {
    request: Object.assign({ runId, runtimeMode, message }, extraRequest || {}),
    configSnapshot: { configVersion, pluginIds: ["fosu-campus"] },
    stages,
    signal: signal || null,
    emit: (event) => events.push(event),
  };
}

// 【platform 轻量装配】fixture：createAgentPlatform 的五方法 stages 面。
function makePlatformStages(overrides = {}) {
  return Object.assign({
    assembleContext: async ({ request }) => ({ message: String(request.message || ""), messageCount: 1 }),
    decide: async () => ({
      goal: { name: "echo" },
      selectedSkillId: "campus.plain_text",
      decisionSource: "deterministic",
    }),
    executeSkillTool: async () => ({ toolCalls: [] }),
    verify: async () => ({ ok: true, errors: [] }),
    compose: async () => ({
      answer: "平台链文本回答。",
      responseMode: "deterministic",
      runtimeMode: "public",
      success: true,
      status: "completed",
    }),
  }, overrides);
}

function makePlatformChain(platformStages) {
  const runtime = createAgentRuntime({ protocol, uiSchema });
  const engine = createFosuEngine({ runtime });
  const registry = createEngineRegistry({ featureFlags: { allowExperimentalEngines: false } });
  registry.register(engine, { makeDefault: true });
  const platform = createAgentPlatform({
    runtime,
    engineRegistry: registry,
    engineTraceMetadata,
    plugin: { id: "fosu-campus", version: "0.0.0-p7a", manifestVersion: "p7a-test-1" },
    stages: platformStages,
  });
  return { runtime, engine, registry, platform };
}

// ---------------- 递归键扫描（17/18 项共用） ----------------
const REASONING_KEY = /(chain.?of.?thought|hidden.?reasoning|^reasoning$|^reasoning[_-]|^thinking$|^thoughts?$|internal.?monologue)/i;
const SENSITIVE_KEY = /(api.?key|authorization|cookie|credential|password|secret|system.?prompt|access.?token|refresh.?token|private.?key)/i;
const SECRET_VALUE = /(sk-[a-z0-9_-]{8,}|bearer\s+[a-z0-9._-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

function collectKeyHits(value, predicate, pathPrefix = "$", hits = [], seen = new Set()) {
  const test = typeof predicate === "function" ? predicate : (key) => predicate.test(key);
  if (!value || typeof value !== "object") return hits;
  if (seen.has(value)) return hits;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectKeyHits(item, predicate, `${pathPrefix}[${index}]`, hits, seen));
    return hits;
  }
  Object.entries(value).forEach(([key, item]) => {
    if (test(key)) hits.push(`${pathPrefix}.${key}`);
    collectKeyHits(item, predicate, `${pathPrefix}.${key}`, hits, seen);
  });
  return hits;
}

// ---------------- runHandlers 链 fixture（对齐 tools/test-agent-run-protocol.js） ----------------
function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { if (!this.statusCode) this.statusCode = 200; this.body = payload; return this; },
    send(payload) { if (!this.statusCode) this.statusCode = 200; this.body = payload; return this; },
  };
}

function mockReq(body, extra = {}) {
  return Object.assign({
    body,
    query: {},
    params: {},
    headers: {},
    agentRuntimeDecision: { runtimeMode: "public" },
  }, extra);
}

async function getRunBody(runHandlers, runId, pollToken, afterSequence) {
  const res = mockRes();
  await runHandlers.getRun(mockReq({}, { params: { runId }, query: { pollToken, afterSequence } }), res);
  assert.strictEqual(res.statusCode, 200, `getRun 必须 200，实际 ${res.statusCode}`);
  return res.body;
}

async function waitForTerminal(runHandlers, runId, pollToken, timeoutMs = 20000) {
  const startedAt = Date.now();
  for (;;) {
    const body = await getRunBody(runHandlers, runId, pollToken, "0");
    if (["completed", "failed", "cancelled", "degraded"].includes(body.status)) return body;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`run ${runId} 未在 ${timeoutMs}ms 内到达终态（last=${body.status}）`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// =================================================================================
async function main() {
  // ---------- 01 纯文本只读 Skill 经 engine 执行成功【engine 轻量链】 ----------
  await check("01", "纯文本只读 Skill 经 engine 执行成功", async () => {
    const chain = makeEngineChain();
    const events = [];
    const result = await chain.registry.resolve({ environment: "public" }).execute(
      makeInput({ runId: "p7a_c01", stages: makeRuntimeStages(), events }),
    );
    assert(result.artifacts.decision.selectedSkillId, "decision 必须选出 Skill");
    assert.deepStrictEqual(result.artifacts.skillTool.toolCalls, [], "纯文本 Skill 不得产生 Tool 调用");
    assert(String(result.artifacts.response.answer || "").length > 0, "response 必须有文本");
    assert(result.ui.blocks.some((block) => block.type === "text" && block.text.length > 0), "ui 必须含文本块");
    assert.strictEqual(events.at(-1).type, "runtime.completed");
  });

  // ---------- 02 只读 Tool 经 engine 执行成功【engine 轻量链】 ----------
  await check("02", "只读 Tool 经 engine 执行成功（skillTool 真实被调、toolCall 记录）", async () => {
    let skillToolCalls = 0;
    const stages = makeRuntimeStages({
      decision: async () => ({
        goal: { name: "read_week" },
        selectedSkillId: "campus.teaching_week",
        decisionSource: "deterministic",
        toolRequest: { name: "campus.get_teaching_week", args: {} },
      }),
      skillTool: async ({ decision }) => {
        skillToolCalls += 1;
        assert(decision && decision.toolRequest, "skillTool 必须收到 decision 产物");
        return { toolCalls: [{ name: "campus.get_teaching_week", status: "completed", readOnly: true }] };
      },
    });
    const chain = makeEngineChain();
    const events = [];
    const result = await chain.registry.resolve({ environment: "public" }).execute(
      makeInput({ runId: "p7a_c02", stages, events }),
    );
    assert.strictEqual(skillToolCalls, 1, "stages.skillTool 必须真实被调一次");
    assert.strictEqual(result.artifacts.skillTool.toolCalls.length, 1, "toolCall 必须记录在产物中");
    const toolStage = result.platformTrace.stages.find((stage) => stage.stage === "skill_tool");
    assert(toolStage && toolStage.outcome === "success");
    assert.strictEqual(toolStage.details.toolCallCount, 1);
    assert.deepStrictEqual(toolStage.details.toolIds, ["campus.get_teaching_week"]);
    assert(events.some((event) => event.type === "stage.completed" && event.publicPayload.stage === "skill_tool"));
  });

  // ---------- 03 Tool 只经统一 Tool Registry【engine 轻量链：静态面 + 输入形状】 ----------
  await check("03", "Tool 只经统一 Tool Registry（engine 无旁路工具通道）", async () => {
    const base = createAgentRuntime({ protocol, uiSchema });
    let capturedInputKeys = null;
    let capturedStageKeys = null;
    const instrumentedRuntime = {
      executeTurn(input) {
        capturedInputKeys = Object.keys(input).sort();
        capturedStageKeys = Object.keys(input.stages || {}).sort();
        return base.executeTurn(input);
      },
      diagnostics: base.diagnostics,
    };
    const engine = createFosuEngine({ runtime: instrumentedRuntime });
    // 静态断言：createAgentEngine 返回的引擎对象除 6 个生命周期方法外不得有函数属性。
    const fnKeys = Object.keys(engine).filter((key) => typeof engine[key] === "function").sort();
    assert.deepStrictEqual(fnKeys, ["cancel", "execute", "health", "readiness", "resume", "shutdown"],
      "engine 不得持有 execute/resume/cancel/readiness/health/shutdown 之外的函数属性");
    assert(!Object.keys(engine).some((key) => /tool|skill|rag|memory|provider|search/i.test(key)),
      "engine 不得持有旁路领域通道属性");
    assert.deepStrictEqual(Object.keys(engine.capabilities).sort(), ENGINE_CAPABILITY_KEYS.slice().sort(),
      "capabilities 必须恰好是 11 个契约键");
    const registry = createEngineRegistry({ featureFlags: { allowExperimentalEngines: false } });
    registry.register(engine, { makeDefault: true });
    let toolPortUsed = 0;
    const stages = makeRuntimeStages({
      skillTool: async () => {
        toolPortUsed += 1;
        return { toolCalls: [{ name: "campus.get_teaching_week", status: "completed" }] };
      },
    });
    const events = [];
    const result = await registry.resolve({ environment: "public" }).execute(
      makeInput({ runId: "p7a_c03", stages, events }),
    );
    assert.deepStrictEqual(capturedInputKeys, ["configSnapshot", "emit", "request", "signal", "stages"],
      "engine.execute 输入不得携带 tools/toolRuntime 等旁路通道");
    assert.deepStrictEqual(capturedStageKeys, ["context", "decision", "response", "skillTool", "verification"],
      "stages.skillTool 必须是唯一工具入口");
    assert.strictEqual(toolPortUsed, 1, "运行时工具调用只出现在 stages.skillTool 路径");
    assert.strictEqual(result.artifacts.skillTool.toolCalls.length, 1);
  });

  // ---------- 04 Tool Schema 校验【engine 轻量链】 ----------
  await check("04", "Tool Schema 校验（非法参数拒绝并产生 failed 阶段）", async () => {
    let verificationRan = false;
    const stages = makeRuntimeStages({
      decision: async () => ({
        goal: { name: "read_week" },
        selectedSkillId: "campus.teaching_week",
        toolRequest: { name: "campus.get_teaching_week", args: { week: "not-a-number" } },
      }),
      skillTool: async ({ decision }) => {
        // 模拟统一 Tool Registry 的 Schema 校验（生产落点：toolSchemaRegistry）；
        // 校验失败必须 coded 拒绝，不得带毒执行。
        const args = decision.toolRequest.args;
        if (!Number.isInteger(args.week) || args.week < 1 || args.week > 30) {
          throw codedError("TOOL_ARGS_INVALID", "week must be an integer in [1, 30]");
        }
        return { toolCalls: [{ name: "campus.get_teaching_week", status: "completed" }] };
      },
      verification: async () => {
        verificationRan = true;
        return { ok: true };
      },
    });
    const chain = makeEngineChain();
    const events = [];
    await assert.rejects(
      () => chain.registry.resolve({ environment: "public" }).execute(makeInput({ runId: "p7a_c04", stages, events })),
      (error) => {
        assert.strictEqual(error.code, "TOOL_ARGS_INVALID", "engine 必须如实传播 coded 校验失败");
        const stage = error.platformTrace.stages.find((item) => item.stage === "skill_tool");
        assert(stage && stage.outcome === "failed", "Trace 必须出现 failed 的 skill_tool 阶段");
        return true;
      },
    );
    assert(events.some((event) => event.type === "stage.failed"
      && event.publicPayload.stage === "skill_tool"
      && event.publicPayload.errorCode === "TOOL_ARGS_INVALID"));
    assert.strictEqual(events.at(-1).type, "run.failed");
    assert.strictEqual(verificationRan, false, "失败阶段之后不得产生后续副作用");
  });

  // ---------- 05 Tool 权限拒绝【engine 轻量链】 ----------
  await check("05", "Tool 权限拒绝（coded 传播 + errorClass 准确）", async () => {
    const stages = makeRuntimeStages({
      skillTool: async () => {
        throw codedError("TOOL_PERMISSION_DENIED", "tool requires elevated scope");
      },
    });
    const chain = makeEngineChain();
    const events = [];
    await assert.rejects(
      () => chain.registry.resolve({ environment: "public" }).execute(makeInput({ runId: "p7a_c05", stages, events })),
      (error) => {
        assert.strictEqual(error.code, "TOOL_PERMISSION_DENIED", "权限错误 code 必须如实传播");
        const errorClass = protocol.classifyRunError(error.code);
        assert.strictEqual(errorClass, "internal",
          "权限拒绝必须归类为业务/内部失败，不得冒充 provider 故障或用户取消");
        assert(!["provider", "cancelled"].includes(errorClass));
        return true;
      },
    );
    assert(events.some((event) => event.type === "stage.failed"
      && event.publicPayload.stage === "skill_tool"
      && event.publicPayload.errorCode === "TOOL_PERMISSION_DENIED"));
    assert.strictEqual(events.at(-1).type, "run.failed");
  });

  // ---------- 06 Memory Context 可读不可越权【engine 轻量链】 ----------
  await check("06", "Memory Context 可读不可越权（engine 路径同样不可变）", async () => {
    const callerRequest = {
      runId: "p7a_c06",
      runtimeMode: "public",
      message: "hi",
      context: { memoryContext: { entries: [{ key: "campus", value: "仙溪校区" }] } },
    };
    const callerConfig = { configVersion: "cfg_p7a_mem", pluginIds: ["fosu-campus"] };
    let sawMemory = false;
    let handoffsFrozen = false;
    const stages = makeRuntimeStages({
      context: async ({ request }) => {
        const memories = request.context && request.context.memoryContext && request.context.memoryContext.entries || [];
        sawMemory = memories.length === 1 && memories[0].key === "campus";
        return { messageCount: 1, memoryCount: memories.length, memories };
      },
      decision: async ({ request, configSnapshot, context }) => {
        handoffsFrozen = Object.isFrozen(request) && Object.isFrozen(configSnapshot) && Object.isFrozen(context);
        // 越权篡改尝试：engine→runtime 对输入 immutableCopy/deepFreeze，不得生效。
        configSnapshot.configVersion = "hacked";
        request.runId = "hacked";
        context.memoryCount = 99;
        return { goal: { name: "echo" }, selectedSkillId: "campus.plain_text" };
      },
      skillTool: async ({ request, configSnapshot, context }) => {
        assert.strictEqual(configSnapshot.configVersion, "cfg_p7a_mem", "configSnapshot 篡改不得影响后续阶段");
        assert.strictEqual(request.runId, "p7a_c06", "request 篡改不得影响后续阶段");
        assert.strictEqual(context.memoryCount, 1, "context 产物篡改不得影响后续阶段");
        return { toolCalls: [] };
      },
    });
    const chain = makeEngineChain();
    const result = await chain.registry.resolve({ environment: "public" }).execute({
      request: callerRequest,
      configSnapshot: callerConfig,
      stages,
      signal: null,
      emit: () => {},
    });
    assert.strictEqual(sawMemory, true, "context 阶段必须读到注入的 memoryContext");
    assert.strictEqual(handoffsFrozen, true, "engine 路径的阶段交接必须深冻结");
    assert.strictEqual(result.configVersion, "cfg_p7a_mem");
    assert.strictEqual(result.runId, "p7a_c06");
    assert.strictEqual(Object.isFrozen(callerRequest), false, "runtime 不得冻结调用方对象");
    assert.strictEqual(Object.isFrozen(callerConfig), false, "runtime 必须克隆调用方配置");
  });

  // ---------- 07 RAG 经统一接口【engine 轻量链】 ----------
  await check("07", "RAG 经统一接口（检索经注入函数，engine 无旁路 RAG 通道）", async () => {
    let ragCalls = 0;
    // 生产落点：platformComposition.queryRagForSnapshot 经 ports 注入 context 阶段；
    // 这里以同样的注入手法提供确定性检索函数。
    async function retrieveCampusKb() {
      ragCalls += 1;
      return [{ kbId: "campus-public", title: "图书馆开放时间", score: 0.91 }];
    }
    const stages = makeRuntimeStages({
      context: async () => {
        const hits = await retrieveCampusKb();
        return { messageCount: 1, ragCount: hits.length, rag: hits };
      },
    });
    const chain = makeEngineChain();
    const result = await chain.registry.resolve({ environment: "public" }).execute(
      makeInput({ runId: "p7a_c07", stages, events: [] }),
    );
    assert.strictEqual(ragCalls, 1, "RAG 检索必须经 context 阶段注入的检索函数发生");
    assert.strictEqual(result.artifacts.context.ragCount, 1);
    assert(!Object.keys(chain.engine).some((key) => /rag|search|retrieve|embed/i.test(key)),
      "engine 不得持有旁路 RAG 通道");
  });

  // ---------- 08 RunEvent 顺序合法【engine 轻量链】 ----------
  await check("08", "RunEvent 顺序合法（sequence 严格递增 1..N、eventId 稳定、类型合法）", async () => {
    const chain = makeEngineChain();
    const events = [];
    await chain.registry.resolve({ environment: "public" }).execute(
      makeInput({ runId: "p7a_c08", stages: makeRuntimeStages(), events, configVersion: "cfg_p7a_seq" }),
    );
    assert(events.length >= 10, "完整 Run 必须有足够事件流");
    assert.deepStrictEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1),
      "sequence 必须严格递增 1..N");
    const ids = new Set(events.map((event) => event.eventId));
    assert.strictEqual(ids.size, events.length, "eventId 必须唯一（稳定标识）");
    events.forEach((event) => {
      assert(/^evt_/.test(event.eventId), `eventId 形态非法: ${event.eventId}`);
      assert(protocol.RUN_EVENT_TYPES.includes(event.type), `事件类型非法: ${event.type}`);
      assert(!Number.isNaN(Date.parse(event.createdAt)), "createdAt 必须是合法时间");
      assert.strictEqual(event.runId, "p7a_c08");
      assert.strictEqual(event.configVersion, "cfg_p7a_seq");
    });
    assert.strictEqual(events[0].type, "runtime.entered");
    assert.strictEqual(events.at(-1).type, "runtime.completed");
    assert.strictEqual(events.filter((event) => event.type === "stage.started").length, 6, "5 业务阶段 + ui 阶段");
  });

  // ---------- 09 UI Schema 合法【engine 轻量链】 ----------
  await check("09", "UI Schema 合法（blocksFromAgentResult 校验、无任意组件）", async () => {
    const chain = makeEngineChain();
    const result = await chain.registry.resolve({ environment: "public" }).execute(
      makeInput({ runId: "p7a_c09a", stages: makeRuntimeStages(), events: [] }),
    );
    assert(result.ui.blocks.length > 0);
    result.ui.blocks.forEach((block) => {
      assert(uiSchema.UI_BLOCK_TYPES.includes(block.type), `非法 UI Block 类型: ${block.type}`);
      assert.strictEqual(block.schemaVersion, "ui.v1");
    });
    // 幂等重校验：engine 产出的 blocks 必须能再次通过 ui-schema 归一。
    uiSchema.normalizeUiBlocks(result.ui.blocks);
    // 负例：任意组件必须被拒并产生 failed 的 ui 阶段。
    const badStages = makeRuntimeStages({
      response: async () => ({ ui: { blocks: [{ type: "arbitrary_widget", id: "evil" }] } }),
    });
    const badEvents = [];
    await assert.rejects(
      () => chain.registry.resolve({ environment: "public" }).execute(
        makeInput({ runId: "p7a_c09b", stages: badStages, events: badEvents }),
      ),
      (error) => {
        assert.strictEqual(error.code, "UI_BLOCK_TYPE_UNSUPPORTED");
        assert(error.platformTrace.stages.some((stage) => stage.stage === "ui" && stage.outcome === "failed"));
        return true;
      },
    );
    assert(badEvents.some((event) => event.type === "stage.failed" && event.publicPayload.stage === "ui"));
    assert.strictEqual(badEvents.at(-1).type, "run.failed");
  });

  // ---------- 10 Verification ok===true 才通过【engine 轻量链 + platformComposition 全装配】 ----------
  await check("10", "Verification ok===true 才通过", async () => {
    // 轻量链：ok:false 产物如实传播到 response 阶段；终态分类器（agentRunEventService.
    // statusFromResult，真实生产分类器）必须把 ok:false 的合成响应归类为 failed。
    const runEventService = require("../server/src/services/ai/agentRunEventService");
    let responseSawOk = null;
    const failStages = makeRuntimeStages({
      verification: async () => ({ ok: false, errors: [{ code: "EVIDENCE_INCOMPLETE", message: "证据不足" }] }),
      response: async ({ verification }) => {
        responseSawOk = verification.ok;
        return {
          answer: "无法核实，如实返回不完整。",
          success: false,
          status: "failed",
          runtimeMode: "public",
          errors: [{ code: "EVIDENCE_INCOMPLETE" }],
        };
      },
    });
    const chain = makeEngineChain();
    const failResult = await chain.registry.resolve({ environment: "public" }).execute(
      makeInput({ runId: "p7a_c10a", stages: failStages, events: [] }),
    );
    assert.strictEqual(responseSawOk, false, "response 阶段必须如实收到 verification.ok===false");
    assert.strictEqual(failResult.artifacts.response.success, false);
    assert.strictEqual(runEventService.statusFromResult(failResult.artifacts.response), "failed",
      "ok===false 的响应必须归类 failed 终态");
    const okResult = await chain.registry.resolve({ environment: "public" }).execute(
      makeInput({ runId: "p7a_c10b", stages: makeRuntimeStages(), events: [] }),
    );
    assert.strictEqual(runEventService.statusFromResult(okResult.artifacts.response), "completed",
      "ok===true 的响应必须归类 completed 终态");

    // 全装配（生产链：agentService.chat → platformComposition → engineRegistry → fosu
    // engine）：缺个人课表时生产 verification 如实 ok:false → success:false；
    // 正常 Turn ok:true → success:true。两层共同验证"ok===true 才通过"的生产行为。
    const agentService = require("../server/src/services/ai/agentService");
    const noSchedule = await agentService.chat({
      protocolVersion: "agent.v2",
      message: "今天有什么课？",
      runtimeMode: "public",
      context: { envVersion: "release", currentTeachingWeek: 3, term: "2025-2026-2", todayDate: "2026-07-21" },
    });
    assert.strictEqual(noSchedule.success, false, "verification.ok===false 必须如实走到失败/未完成路径");
    assert.strictEqual(noSchedule.evidence && noSchedule.evidence.complete, false);
    const failedVerification = noSchedule.platformTrace.stages.find((stage) => stage.stage === "verification");
    assert(failedVerification && failedVerification.details.ok === false, "生产 Trace 必须如实记录 verification.ok===false");
    assert(noSchedule.platformTrace.engine && noSchedule.platformTrace.engine.intendedEngine === FOSU_ENGINE_ID,
      "全装配链必须经 fosu engine 执行");
    const plain = await agentService.chat({
      protocolVersion: "agent.v2",
      message: "你是谁？",
      runtimeMode: "public",
      context: { envVersion: "release" },
    });
    assert.strictEqual(plain.success, true);
    const okVerification = plain.platformTrace.stages.find((stage) => stage.stage === "verification");
    assert(okVerification && okVerification.details.ok === true);
  });

  // ---------- 11 Deadline 生效【engine 轻量链】 ----------
  await check("11", "Deadline 生效（STAGE_TIMEOUT / DEADLINE_EXCEEDED，总时长受控）", async () => {
    // a) 阶段预算超时：decision 预算 60ms，阶段挂起（监听 signal 提前返回；挂起
    //    计时器必须 ref——stageSignal 的预算计时器是 unref 的（deadline.js），
    //    否则事件轮空会让进程静默退出），必须 STAGE_TIMEOUT 且总时长受控。
    const chainA = makeEngineChain({ stageBudgets: { simple: { decision: 60 } } });
    const eventsA = [];
    const startedAt = Date.now();
    await assert.rejects(
      () => chainA.registry.resolve({ environment: "public" }).execute(makeInput({
        runId: "p7a_c11a",
        events: eventsA,
        stages: makeRuntimeStages({
          decision: async ({ signal }) => {
            await new Promise((resolve) => {
              const timer = setTimeout(resolve, 5000); // ref'd 兜底：预算失效时显式 FAIL 而非静默退出
              signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
            });
            return { goal: { name: "late" } };
          },
        }),
      })),
      (error) => {
        assert.strictEqual(error.code, "STAGE_TIMEOUT");
        const stage = error.platformTrace.stages.find((item) => item.stage === "decision");
        assert(stage && stage.outcome === "timeout", "超时阶段 outcome 必须为 timeout");
        return true;
      },
    );
    const elapsedA = Date.now() - startedAt;
    assert(elapsedA < 3000, `阶段预算必须截断挂起阶段，实际耗时 ${elapsedA}ms`);
    assert(eventsA.some((event) => event.type === "stage.failed"
      && event.publicPayload.stage === "decision"
      && event.publicPayload.errorCode === "STAGE_TIMEOUT"));
    assert.strictEqual(eventsA.at(-1).type, "run.failed");

    // b) 总截止时间已过（生产 createRunHandlers 传入的 deadlineAt 形状）：直接
    //    DEADLINE_EXCEEDED，不得启动任何业务阶段。
    const chainB = makeEngineChain();
    const eventsB = [];
    const order = [];
    const startedB = Date.now();
    await assert.rejects(
      () => chainB.registry.resolve({ environment: "public" }).execute(makeInput({
        runId: "p7a_c11b",
        events: eventsB,
        extraRequest: { deadlineAt: new Date(Date.now() - 1000).toISOString() },
        stages: makeRuntimeStages({
          context: async () => { order.push("context"); return { messageCount: 1 }; },
        }),
      })),
      (error) => {
        assert.strictEqual(error.code, "DEADLINE_EXCEEDED");
        return true;
      },
    );
    assert(Date.now() - startedB < 2000, "过期 deadline 必须立即失败");
    assert.deepStrictEqual(order, [], "DEADLINE_EXCEEDED 前不得启动任何业务阶段");
    assert.strictEqual(eventsB.at(-1).type, "run.failed");
    assert.strictEqual(eventsB.at(-1).publicPayload.errorCode, "DEADLINE_EXCEEDED");
  });

  // ---------- 12 AbortSignal/cancel 生效【engine 轻量链】 ----------
  await check("12", "AbortSignal/cancel 生效（中途 abort → ABORTED + run.cancelled + 无副作用）", async () => {
    // cancel 语义经 execute 内 AbortSignal 传播（createRuntimeEngine 如实声明
    // supportsCancel=true，无独立 runId 级句柄）。
    const controller = new AbortController();
    const order = [];
    const stages = makeRuntimeStages({
      context: async () => {
        order.push("context");
        controller.abort();
        return { messageCount: 1 };
      },
      decision: async () => (order.push("decision"), {}),
      skillTool: async () => (order.push("skill_tool"), {}),
      verification: async () => (order.push("verification"), { ok: true }),
      response: async () => (order.push("response"), { answer: "no" }),
    });
    const chain = makeEngineChain();
    const events = [];
    await assert.rejects(
      () => chain.registry.resolve({ environment: "public" }).execute(
        makeInput({ runId: "p7a_c12", stages, events, signal: controller.signal }),
      ),
      (error) => {
        assert.strictEqual(error.code, "ABORTED", "中途 abort 必须是 coded ABORTED");
        assert(error.platformTrace, "取消也必须携带 platformTrace");
        return true;
      },
    );
    assert.deepStrictEqual(order, ["context"], "abort 之后任何后续阶段不得产生副作用");
    assert.strictEqual(events.at(-1).type, "run.cancelled");
    assert.strictEqual(events.some((event) => event.type === "runtime.completed"), false);
  });

  // ---------- 13 Provider 超时准确分类【engine 轻量链】 ----------
  await check("13", "Provider 超时准确分类（timeout 而非 generic failed）", async () => {
    const stages = makeRuntimeStages({
      decision: async () => {
        throw codedError("PROVIDER_TIMEOUT", "provider deadline exceeded");
      },
    });
    const chain = makeEngineChain();
    const events = [];
    await assert.rejects(
      () => chain.registry.resolve({ environment: "trial" }).execute(
        makeInput({ runId: "p7a_c13", stages, events, runtimeMode: "trial" }),
      ),
      (error) => {
        assert.strictEqual(error.code, "PROVIDER_TIMEOUT");
        const stage = error.platformTrace.stages.find((item) => item.stage === "decision");
        assert(stage, "decision 阶段记录必须存在");
        // 失败分类语义：provider-runtime classifyFallbackEligibility 经
        // decisionFailureTraceDetails 落进 Trace（normalizeErrorCode 保留原始 code）。
        assert.strictEqual(stage.details.failureClass, "timeout",
          "Provider 超时必须分类为 timeout，不得退化为 generic/unknown");
        assert(![ "unknown", "" ].includes(String(stage.details.failureClass || "")));
        assert.strictEqual(stage.details.fallbackReason, "code:PROVIDER_TIMEOUT");
        return true;
      },
    );
    assert.strictEqual(protocol.classifyRunError("PROVIDER_TIMEOUT"), "provider",
      "协议层 errorClass 必须把 PROVIDER_TIMEOUT 归为 provider 类");
    assert(events.some((event) => event.type === "stage.failed"
      && event.publicPayload.stage === "decision"
      && event.publicPayload.errorCode === "PROVIDER_TIMEOUT"));
  });

  // ---------- 14 fallback ≤1【engine 轻量链：runtime 真实 createProviderAttemptLedger(1)】 ----------
  await check("14", "fallback ≤1（providerAttemptLedger 预算耗尽后同类失败直接失败）", async () => {
    // a) 首次失败 → 唯一一次受控 fallback → 成功；fallbackPath 长度 ≤2。
    let ledgerA = null;
    const stagesA = makeRuntimeStages({
      decision: async ({ providerAttemptLedger }) => {
        ledgerA = providerAttemptLedger;
        providerAttemptLedger.noteFailure({ failureClass: "timeout", fallbackReason: "code:PROVIDER_TIMEOUT" });
        const claimed = providerAttemptLedger.claimFallback();
        if (!claimed) throw codedError("PROVIDER_FALLBACK_BUDGET_EXHAUSTED");
        return {
          goal: { name: "read_week" },
          selectedSkillId: "campus.teaching_week",
          decisionSource: "deterministic_fallback",
          actualFirstProvider: "mock",
          fallbackPath: ["deepseek:PROVIDER_TIMEOUT", "mock:success"],
        };
      },
    });
    const chainA = makeEngineChain();
    const resultA = await chainA.registry.resolve({ environment: "trial" }).execute(
      makeInput({ runId: "p7a_c14a", stages: stagesA, events: [], runtimeMode: "trial" }),
    );
    assert(ledgerA, "decision 阶段必须收到 runtime 创建的真实 providerAttemptLedger");
    assert.strictEqual(ledgerA.fallbacksUsed(), 1, "受控 fallback 恰好消耗一次预算");
    assert.strictEqual(ledgerA.snapshot().remainingBudget, 0);
    const decisionStageA = resultA.platformTrace.stages.find((stage) => stage.stage === "decision");
    assert(decisionStageA.details.fallbackPath.length <= 2, "fallbackPath 至多 1 次 fallback（2 个节点）");

    // b) 第一次 fallback 后同类失败再次发生 → 第二次 claim 被拒 → 直接失败。
    let ledgerB = null;
    const stagesB = makeRuntimeStages({
      decision: async ({ providerAttemptLedger }) => {
        ledgerB = providerAttemptLedger;
        providerAttemptLedger.noteFailure({ failureClass: "timeout", fallbackReason: "code:PROVIDER_TIMEOUT" });
        providerAttemptLedger.claimFallback(); // 唯一一次受控 fallback 已消耗
        // fallback 后同类失败再次发生：
        providerAttemptLedger.noteFailure({ failureClass: "timeout", fallbackReason: "code:PROVIDER_TIMEOUT" });
        if (!providerAttemptLedger.claimFallback()) {
          throw codedError("PROVIDER_FALLBACK_BUDGET_EXHAUSTED", "second fallback is forbidden");
        }
        return { goal: { name: "never" } };
      },
    });
    const chainB = makeEngineChain();
    const eventsB = [];
    await assert.rejects(
      () => chainB.registry.resolve({ environment: "trial" }).execute(
        makeInput({ runId: "p7a_c14b", stages: stagesB, events: eventsB, runtimeMode: "trial" }),
      ),
      (error) => {
        assert.strictEqual(error.code, "PROVIDER_FALLBACK_BUDGET_EXHAUSTED",
          "预算耗尽后的第二次同类失败必须直接失败");
        return true;
      },
    );
    assert.strictEqual(ledgerB.fallbacksUsed(), 1, "fallback 计数永远不得超过 1");
    assert.strictEqual(eventsB.at(-1).type, "run.failed");
  });

  // ---------- 15 configVersion 整个 Run 稳定【engine 轻量链】 ----------
  await check("15", "configVersion 整个 Run 稳定（事件与 trace 一致）", async () => {
    const chain = makeEngineChain();
    const events = [];
    const result = await chain.registry.resolve({ environment: "public" }).execute(
      makeInput({ runId: "p7a_c15", stages: makeRuntimeStages(), events, configVersion: "cfg_p7a_stable" }),
    );
    assert.strictEqual(result.configVersion, "cfg_p7a_stable");
    assert.strictEqual(result.platformTrace.configVersion, "cfg_p7a_stable");
    assert(events.length > 0 && events.every((event) => event.configVersion === "cfg_p7a_stable"),
      "所有 RunEvent 的 configVersion 必须一致");
    assert.strictEqual(chain.traces.length, 1, "成功 Run 必须恰好落一条 platform trace");
    assert.strictEqual(chain.traces[0].configVersion, "cfg_p7a_stable", "traceSink 落盘 trace 的 configVersion 必须一致");
  });

  // ---------- 16 ActionReceipt/写动作幂等【runHandlers 链：platformComposition 全装配】 ----------
  await check("16", "ActionReceipt 幂等（同 idempotencyKey 只执行一次）", async () => {
    // 层级说明：写动作/Run 的幂等语义在 Run API 层（createRunHandlers →
    // runRepository.createRun 幂等键去重 + 不重复调度执行链），不在 engine 层。
    // 这里经 platformComposition 全装配链验证：同 idempotencyKey 二次提交重放同一
    // Run，engine 路径（resolve → execute → runtime → stages）不重复执行。
    const platformComposition = require("../server/src/services/ai/platformComposition");
    const runHandlers = platformComposition.getRunHandlers();
    const tracesBefore = platformComposition.listRecentPlatformTraces().length;
    const res1 = mockRes();
    runHandlers.createRun(mockReq({ message: "你是谁？", idempotencyKey: "p7a-idem-1" }), res1);
    assert.strictEqual(res1.statusCode, 202, `首次 createRun 必须 202，实际 ${res1.statusCode}`);
    assert.strictEqual(res1.body.diagnostics.idempotencyKeyAccepted, true);
    const final1 = await waitForTerminal(runHandlers, res1.body.runId, res1.body.pollToken);
    assert.strictEqual(final1.status, "completed", `首个 Run 必须 completed，实际 ${final1.status}`);

    const res2 = mockRes();
    runHandlers.createRun(mockReq({ message: "你是谁？", idempotencyKey: "p7a-idem-1" }), res2);
    assert.strictEqual(res2.statusCode, 202);
    assert.strictEqual(res2.body.runId, res1.body.runId, "同 idempotencyKey 必须重放同一 Run");
    assert.strictEqual(res2.body.diagnostics.deduplicated, true);
    assert.strictEqual(res2.body.pollToken, null, "pollToken 明文不得补发");
    assert.strictEqual(platformComposition.listRecentPlatformTraces().length, tracesBefore + 1,
      "同 idempotencyKey 不得二次进入 engine 执行路径（platform trace 计数只增 1）");
    assert.strictEqual(
      final1.events.filter((event) => event.type === "runtime.entered").length,
      1,
      "单 Run 事件流必须只含一次 engine 执行痕迹",
    );
  });

  // ---------- 17 不输出隐藏推理【platform 轻量装配】 ----------
  await check("17", "不输出隐藏推理（response/platformTrace/engine 元数据/事件）", async () => {
    const chain = makePlatformChain(makePlatformStages());
    const events = [];
    const result = await chain.platform.executeTurn({
      runId: "p7a_c17",
      message: "你好",
      runtimeMode: "public",
      onEvent: (event) => events.push(event),
    });
    assert(result.platformTrace.engine, "platform 结果必须携带 engine 元数据");
    assert.strictEqual(result.platformTrace.engine.intendedEngine, FOSU_ENGINE_ID);
    const keyHits = collectKeyHits(result, REASONING_KEY).concat(collectKeyHits(events, REASONING_KEY));
    assert.deepStrictEqual(keyHits, [], `公开面不得出现隐藏推理字段: ${keyHits.join(", ")}`);
    assert(!/chain.?of.?thought|hidden.?reasoning/i.test(JSON.stringify({ result, events })),
      "公开面不得出现隐藏推理文本");
  });

  // ---------- 18 不泄露密钥与敏感记忆【platform 轻量装配 + 投毒 emit】 ----------
  await check("18", "不泄露密钥与敏感记忆（递归扫描结果与事件）", async () => {
    // 投毒密钥运行时拼接构造：静态字面量会命中 no-ai-secret-committed 的
    // provider-secret-prefix 规则（sk-+16 位），即使它是测试假密钥。
    const poisonProviderKey = ["sk", "live", "p7aPoison123"].join("-");
    const poisonedStages = makePlatformStages({
      decide: async ({ emit }) => {
        // 投毒：阶段试图把密钥写进 RunEvent 公开载荷；协议 sanitize 必须剥除。
        await emit({
          type: "provider.started",
          publicPayload: {
            provider: "mock",
            apiKey: poisonProviderKey,
            authorization: "Bearer p7a-poison",
            nested: { password: "p7a-poison-password" },
          },
        });
        return { goal: { name: "echo" }, selectedSkillId: "campus.plain_text", decisionSource: "deterministic" };
      },
    });
    const chain = makePlatformChain(poisonedStages);
    const events = [];
    const result = await chain.platform.executeTurn({
      runId: "p7a_c18",
      message: "你好",
      runtimeMode: "public",
      onEvent: (event) => events.push(event),
    });
    const keyHits = collectKeyHits(result, SENSITIVE_KEY).concat(collectKeyHits(events, SENSITIVE_KEY));
    assert.deepStrictEqual(keyHits, [], `公开面不得出现敏感键: ${keyHits.join(", ")}`);
    const json = JSON.stringify({ result, events });
    const poisonNeedles = [poisonProviderKey, "Bearer p7a-poison", "p7a-poison-password"];
    assert(!poisonNeedles.some((needle) => json.includes(needle)),
      "投毒密钥值不得出现在结果或事件中");
    assert(!SECRET_VALUE.test(json), "公开面不得出现密钥值模式");
    assert(events.some((event) => event.type === "provider.started"), "投毒事件确实经过事件管道");
  });

  // ---------- 19 public 外部 Provider 调用为 0【platformComposition 全装配 + 回环桩计数】 ----------
  const providerRequests = [];
  let providerResponseBody = null;
  const providerStub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      providerRequests.push(JSON.parse(raw || "{}"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(providerResponseBody || { choices: [{ message: { content: "{}" } }] }));
    });
  });
  await new Promise((resolve) => providerStub.listen(0, "127.0.0.1", resolve));
  const providerBaseUrl = `http://127.0.0.1:${providerStub.address().port}`;
  const providerConfigService = require("../server/src/services/ai/providerConfigService");
  const originalResolveProviderConfig = providerConfigService.resolveRuntimeProviderConfig;

  await check("19", "public 外部 Provider 调用为 0", async () => {
    const agentService = require("../server/src/services/ai/agentService");
    providerConfigService.resolveRuntimeProviderConfig = () => ({
      AI_AGENT_ENABLED: "true",
      AI_RUNTIME_MODE: "public",
      AI_EXECUTION_POLICY: "adaptive",
      AI_PROVIDER: "deepseek",
      AI_PROVIDER_CHAIN: "deepseek,mock",
      AI_DECISION_PROVIDER: "deepseek",
      AI_PROVIDER_POLICY: "tool-only",
      AI_BASE_URL: providerBaseUrl,
      AI_DECISION_MODEL: "p7a-conformance",
      AI_MODEL: "p7a-conformance",
      AI_STRUCTURED_TIMEOUT_MS: "3000",
      DEEPSEEK_API_KEY: "unit-test-placeholder-not-real",
    });
    try {
      const before = providerRequests.length;
      const response = await agentService.chat({
        message: "你是谁？",
        runtimeMode: "public",
        protocolVersion: "agent.v2",
        context: { envVersion: "release", memoryMode: "local_only" },
      });
      assert.strictEqual(providerRequests.length, before,
        "public 运行模式外部 Provider 调用计数必须恒 0（即使凭据齐备）");
      assert.strictEqual(response.externalProviderUsed, false);
      assert.strictEqual(response.success, true);
      const engineMeta = response.platformTrace && response.platformTrace.engine;
      assert(engineMeta, "public 裁剪后的 platformTrace 必须保留 engine 元数据");
      assert.strictEqual(engineMeta.intendedEngine, FOSU_ENGINE_ID);
      assert.strictEqual(engineMeta.actualEngine, FOSU_ENGINE_ID);
      assert.strictEqual(engineMeta.outcome, "success");
      assert.strictEqual(engineMeta.conformanceVersion, FOSU_CONFORMANCE_SUITE);
    } finally {
      providerConfigService.resolveRuntimeProviderConfig = originalResolveProviderConfig;
    }
  });

  // ---------- 20 strict_model_first 首个真实 Decision 来源正确【platformComposition 全装配】 ----------
  await check("20", "strict_model_first 首个真实 Decision 来源正确（非规则冒充）", async () => {
    // 手法对齐 tools/test-agent-strict-decision.js：trial + strict_model_first，
    // provider 回环桩返回合法 DecisionContract V2；断言 decision 真实经 provider
    // 调用且 Trace 如实记录 model 来源。
    const agentService = require("../server/src/services/ai/agentService");
    providerResponseBody = {
      choices: [{
        message: {
          content: JSON.stringify({
            schemaVersion: "decision.v2",
            goal: { name: "get_teaching_week", confidence: 0.99, requiresClarification: false },
            entities: [],
            constraints: {},
            skillCandidates: [{ skillId: "teaching_week", confidence: 0.98 }],
            plan: { steps: [{ id: "read-week", skillId: "teaching_week", purpose: "Read teaching week" }] },
            responseMode: "deterministic",
          }),
        },
      }],
    };
    const envKeys = ["AI_RUNTIME_MODE", "AI_PROVIDER_ACTIVE_ENV", "AI_COMPETITION_ALLOW_ALL_SESSIONS"];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.AI_RUNTIME_MODE = "trial";
    process.env.AI_PROVIDER_ACTIVE_ENV = "trial";
    process.env.AI_COMPETITION_ALLOW_ALL_SESSIONS = "true";
    providerConfigService.resolveRuntimeProviderConfig = () => ({
      AI_AGENT_ENABLED: "true",
      AI_RUNTIME_MODE: "trial",
      AI_EXECUTION_POLICY: "strict_model_first",
      AI_PROVIDER: "deepseek",
      AI_PROVIDER_CHAIN: "deepseek,mock",
      AI_DECISION_PROVIDER: "deepseek",
      AI_PROVIDER_POLICY: "tool-only",
      AI_BASE_URL: providerBaseUrl,
      AI_DECISION_MODEL: "p7a-conformance",
      AI_MODEL: "p7a-conformance",
      AI_STRUCTURED_TIMEOUT_MS: "3000",
      DEEPSEEK_API_KEY: "unit-test-placeholder-not-real",
      AI_UNDERSTANDING_RULE_FIRST: "1",
      AI_MODEL_PLANNER_ENABLED: "true",
    });
    try {
      const events = [];
      const before = providerRequests.length;
      const response = await agentService.chat({
        message: "现在第几教学周",
        runtimeMode: "trial",
        protocolVersion: "agent.v2",
        serverSession: { openidHash: "p7a-conformance-user" },
        context: { envVersion: "trial", memoryMode: "local_only" },
        onEvent: (event) => events.push(event),
      });
      assert.strictEqual(providerRequests.length, before + 1,
        "strict_model_first 首个 Decision 必须真实经 provider 调用（恰好 1 次）");
      const decisionStage = response.platformTrace.stages.find((stage) => stage.stage === "decision");
      assert(decisionStage, "decision 阶段记录必须存在");
      assert.strictEqual(decisionStage.details.executionPolicy, "strict_model_first");
      assert.strictEqual(decisionStage.details.decisionSource, "model",
        "首个 Decision 来源必须是 model，不得由规则冒充");
      assert(!["deterministic", "deterministic_fallback", "deterministic_adaptive"].includes(decisionStage.details.decisionSource));
      assert.strictEqual(decisionStage.details.actualFirstProvider, "deepseek");
      const skillToolStage = response.platformTrace.stages.find((stage) => stage.stage === "skill_tool");
      assert(skillToolStage && skillToolStage.details.planSource === "model_skeleton",
        "计划来源必须如实记录为 model_skeleton");
      assert.strictEqual(response.understanding && response.understanding.source, "model");
      assert(events.some((event) => event.type === "provider.started"),
        "provider.started 真实事件必须发出（Thinking 只允许在其之后展示）");
      assert(response.platformTrace.engine && response.platformTrace.engine.outcome === "success",
        "strict Turn 必须经 engine 路径成功执行");
    } finally {
      providerConfigService.resolveRuntimeProviderConfig = originalResolveProviderConfig;
      envKeys.forEach((key) => {
        if (previousEnv[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[key];
      });
      providerResponseBody = null;
    }
  });

  // ---------- 21 Engine 异常不破坏 Run 最终状态【platform 轻量装配】 ----------
  await check("21", "Engine 异常不破坏 Run 最终状态（engineTrace 在场 + 后续 Run 不受污染）", async () => {
    // error.engineTrace 由 createAgentPlatform 层附加，故该项经 platform 轻量装配验证。
    let failDecision = true;
    const chain = makePlatformChain(makePlatformStages({
      decide: async () => {
        if (failDecision) throw codedError("DECISION_PROVIDER_BOOM");
        return { goal: { name: "echo" }, selectedSkillId: "campus.plain_text", decisionSource: "deterministic" };
      },
    }));
    const failedEvents = [];
    await assert.rejects(
      () => chain.platform.executeTurn({
        runId: "p7a_c21a",
        message: "你好",
        runtimeMode: "public",
        onEvent: (event) => failedEvents.push(event),
      }),
      (error) => {
        assert.strictEqual(error.code, "DECISION_PROVIDER_BOOM", "engine 异常的 coded 必须如实传播");
        assert(error.engineTrace, "engine.execute 抛错必须携带 error.engineTrace");
        assert.strictEqual(error.engineTrace.outcome, "failed");
        assert.strictEqual(error.engineTrace.intendedEngine, FOSU_ENGINE_ID);
        assert.strictEqual(error.engineTrace.actualEngine, FOSU_ENGINE_ID);
        assert.strictEqual(error.engineTrace.conformanceVersion, FOSU_CONFORMANCE_SUITE);
        return true;
      },
    );
    assert.strictEqual(failedEvents.at(-1).type, "run.failed", "失败 Run 必须发出 run.failed 终态事件");
    assert.strictEqual(failedEvents.some((event) => event.type === "runtime.completed"), false);

    // 后续再次 resolve + execute 新 Run：registry 绑定同一 engine 实例，执行不受污染。
    failDecision = false;
    assert.strictEqual(chain.registry.resolve({ environment: "public" }), chain.engine,
      "失败后 registry 必须仍绑定同一 engine 实例");
    const okEvents = [];
    const ok = await chain.platform.executeTurn({
      runId: "p7a_c21b",
      message: "你好",
      runtimeMode: "public",
      onEvent: (event) => okEvents.push(event),
    });
    assert.strictEqual(ok.platformTrace.engine.outcome, "success");
    assert.strictEqual(ok.runId, "p7a_c21b");
    // 成功终态事件为 runtime.completed（run.completed 由 Run API 层追加，不在本层）。
    assert.strictEqual(okEvents.at(-1).type, "runtime.completed");
  });

  // ---------- 22 重连后可恢复事件和结果【runHandlers 链：platformComposition 全装配】 ----------
  await check("22", "重连后可恢复事件和结果（cursor 重放 + 终态结果恢复）", async () => {
    // 层级说明：恢复语义在 Run API/run store 层（getRunViewDeep cursor 深重放 +
    // 终态结果恢复）。engine 如实声明 supportsResume=false（createRuntimeEngine：
    // resume 由 Run 协议层 cursor 重放承担），故该项经 platformComposition
    // 全装配 runHandlers 链验证，并对 engine 的 resume 缺省拒绝做顺带断言。
    const platformComposition = require("../server/src/services/ai/platformComposition");
    const diagnostics = await platformComposition.getDiagnostics();
    const engineEntry = diagnostics.engines.engines.find((entry) => entry.engineId === FOSU_ENGINE_ID);
    assert(engineEntry, "生产 registry 必须注册 fosu engine");
    assert.strictEqual(engineEntry.capabilities.supportsResume, false,
      "engine 必须如实声明 supportsResume=false（恢复由 Run 协议层承担）");
    assert.strictEqual(engineEntry.isDefault, true);

    const runHandlers = platformComposition.getRunHandlers();
    const res = mockRes();
    runHandlers.createRun(mockReq({ message: "你是谁？" }), res);
    assert.strictEqual(res.statusCode, 202);
    const { runId, pollToken } = res.body;
    const finalView = await waitForTerminal(runHandlers, runId, pollToken);
    assert.strictEqual(finalView.status, "completed");
    assert(finalView.result && String(finalView.result.answer || "").length > 0,
      "终态结果必须可恢复（重连后仍能读到 answer）");
    assert(finalView.events.length > 0 && finalView.events.every((event) => /^evt_/.test(event.eventId)),
      "事件必须携带稳定 eventId");

    // 断线重连语义：从中间 cursor 重放后缀，eventId 与首次读取完全一致。
    const suffix = await getRunBody(runHandlers, runId, pollToken, "2");
    assert.deepStrictEqual(
      suffix.events.map((event) => event.eventId),
      finalView.events.slice(2).map((event) => event.eventId),
      "cursor 重放的事件 eventId 必须稳定一致",
    );
    assert.deepStrictEqual(
      suffix.events.map((event) => event.sequence),
      finalView.events.slice(2).map((event) => event.sequence),
      "cursor 重放的 sequence 不得倒退",
    );

    // cursor 推到最新：无新事件但终态结果依然可恢复。
    const cursor = finalView.eventCursor;
    assert(Number.isInteger(cursor) && cursor >= 1);
    const incremental = await getRunBody(runHandlers, runId, pollToken, String(cursor));
    assert.strictEqual(incremental.events.length, 0, "cursor 之后不得有新事件");
    assert.strictEqual(incremental.status, "completed");
    assert(incremental.result && incremental.result.answer === finalView.result.answer,
      "重连后终态结果必须一致可恢复");
  });

  await new Promise((resolve) => providerStub.close(resolve));

  // ---------------- 汇总与 suite 证据 ----------------
  console.log(`agent-engine-conformance: pass=${passCount} fail=${failCount}`);
  if (failCount === 0) {
    // 本 suite 全通过即 Fosu Engine 对 p7a-conformance-1 "suite-verified" 的运行侧
    // 证据（只输出到 stdout，不写引擎声明；引擎自身永远 self-declared）。
    console.log(`conformance-evidence: ${JSON.stringify({
      suite: FOSU_CONFORMANCE_SUITE,
      engineId: FOSU_ENGINE_ID,
      status: "suite-verified",
      checks: results.length,
      pass: passCount,
      fail: failCount,
    })}`);
  }
  if (failCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});
