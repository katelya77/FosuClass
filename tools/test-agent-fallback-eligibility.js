#!/usr/bin/env node
// P2R：单一 retryability / fallback eligibility 分类的验收测试。
// 覆盖 specs/xiaofu-agent-product-platform/p2r-acceptance.md 第 2 节：
//   - invalid_model / bad_request / 401 / 403 / 配置缺失 / Schema 类不 fallback（fail fast）；
//   - timeout / network / 429 / 5xx 按策略 fallback 一次；
//   - 无第三次 fallback；总 Deadline 不重置；
//   - skipped 码（熔断/未注册/方法不支持/预算耗尽/租约耗尽）不消耗 fallback 账本但记入 failureClass；
//   - 错误分类与 codedError 透传字段一致；
//   - 配置类 fail fast 且原因后台可操作；Schema 类仍走受控 deterministic_fallback。
const assert = require("node:assert");

const {
  classifyFallbackEligibility,
  createDeadline,
  createProviderRuntime,
  createStageSignal,
  normalizeDecisionContract,
  resolveProviderRootCause,
} = require("../packages/provider-runtime");
const { createSkillCatalog } = require("../packages/skill-runtime");
const { createDecisionService } = require("../server/src/services/ai/decision/decisionService");

function coded(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  return Object.assign(error, extra);
}

function createLedger(maxFallbacks = 1) {
  let fallbacksUsed = 0;
  return {
    maxFallbacks,
    fallbacksUsed() { return fallbacksUsed; },
    claimFallback() {
      if (fallbacksUsed >= maxFallbacks) return false;
      fallbacksUsed += 1;
      return true;
    },
    snapshot() { return { maxFallbacks, fallbacksUsed }; },
  };
}

function decisionContract() {
  return {
    schemaVersion: "decision.v2",
    goal: { name: "get_teaching_week", confidence: 0.99, requiresClarification: false },
    entities: [],
    constraints: {},
    skillCandidates: [{ skillId: "teaching_week", confidence: 0.98 }],
    plan: { steps: [{ id: "read-week", skillId: "teaching_week", purpose: "Read teaching week" }] },
    responseMode: "deterministic",
  };
}

const validator = (value) => normalizeDecisionContract(value, {
  allowedSkillIds: ["teaching_week"],
  allowedGoalIds: ["get_teaching_week"],
  skillGoalMap: { teaching_week: ["get_teaching_week"] },
});

function strictInput(overrides = {}) {
  return Object.assign({
    stage: "decision",
    runtimeMode: "trial",
    executionPolicy: "strict_model_first",
    intendedProvider: "primary",
    fallbackProvider: "fallback",
    request: {},
    validate: validator,
    timeoutMs: 5000,
    stageCapMs: 3500,
    finishReserveMs: 500,
  }, overrides);
}

// ── 1. 分类函数单元测试：显式枚举 + 数值状态区间，禁模糊匹配 ──
function testClassificationTable() {
  const failFast = (error, failureClass) => {
    const c = classifyFallbackEligibility(error);
    assert.strictEqual(c.failureClass, failureClass, `${JSON.stringify(error && error.code)} class`);
    assert.strictEqual(c.fallbackEligible, false, `${failureClass} must not be fallback-eligible`);
    assert.strictEqual(c.failFast, true, `${failureClass} must fail fast`);
    return c;
  };
  const eligible = (error, failureClass) => {
    const c = classifyFallbackEligibility(error);
    assert.strictEqual(c.failureClass, failureClass);
    assert.strictEqual(c.fallbackEligible, true, `${failureClass} must be fallback-eligible`);
    assert.strictEqual(c.failFast, false);
    return c;
  };
  const skipped = (error, failureClass) => {
    const c = classifyFallbackEligibility(error);
    assert.strictEqual(c.failureClass, failureClass);
    assert.strictEqual(c.fallbackEligible, false, `${failureClass} must not consume fallback budget`);
    assert.strictEqual(c.failFast, false, `${failureClass} must advance as skipped`);
    return c;
  };

  // 默认不 fallback（fail fast）
  failFast(coded("invalid_model"), "invalid_model");
  failFast(coded("provider_bad_request"), "bad_request");
  failFast(coded("ERR_BAD_REQUEST"), "bad_request");
  failFast(coded("invalid_payload"), "invalid_payload");
  failFast(coded("INVALID_PROVIDER_JSON"), "invalid_payload");
  failFast(coded("INVALID_PROVIDER_TEXT"), "invalid_payload");
  failFast(coded("PROVIDER_STRUCTURED_OUTPUT_INVALID"), "schema_violation");
  failFast(coded("DECISION_EXTRA_FIELD"), "schema_violation");
  failFast(coded("DECISION_GOAL_RESOLUTION_MISMATCH"), "schema_violation");
  failFast(coded("DECISION_PROVIDER_UNAVAILABLE"), "config");
  failFast(coded("PROVIDER_REQUIRED"), "config");
  failFast(coded("PUBLIC_PROVIDER_FORBIDDEN"), "policy");
  failFast(coded("GUARDRAIL_REJECTED"), "guardrail");
  failFast(coded("ABORTED"), "cancelled");
  failFast(coded("SOME_UNLISTED_CODE"), "unknown");
  failFast(new Error("no code at all"), "unknown");

  // 401/403 与其他确定性 4xx（error.status 与 error.response.status 错位归一）
  assert.strictEqual(failFast(coded("PROVIDER_FAILED", { status: 401 }), "auth").httpStatus, 401);
  assert.strictEqual(failFast(coded("PROVIDER_FAILED", { response: { status: 403 } }), "auth").httpStatus, 403);
  failFast(coded("PROVIDER_FAILED", { status: 400 }), "bad_request");
  failFast(coded("PROVIDER_FAILED", { response: { status: 400 } }), "bad_request");
  failFast(coded("PROVIDER_FAILED", { status: 404 }), "not_found");
  failFast(coded("PROVIDER_FAILED", { status: 422 }), "invalid_payload");
  failFast(coded("PROVIDER_FAILED", { status: 409 }), "client_error");
  // code 表优先于状态表；显式码不被状态改写
  failFast(coded("invalid_model", { status: 500 }), "invalid_model");

  // 通用传输码（axios 对整段 4xx/5xx 只给一个粗粒度码）让位于数值状态表：
  // 真实 axios 401/403 不再被误标为 bad_request，429 恢复为可 fallback 的限流类
  assert.strictEqual(failFast(coded("ERR_BAD_REQUEST", { status: 401 }), "auth").reason, "http:401");
  assert.strictEqual(failFast(coded("ERR_BAD_REQUEST", { response: { status: 403 } }), "auth").reason, "http:403");
  assert.strictEqual(eligible(coded("ERR_BAD_REQUEST", { status: 429 }), "rate_limited").reason, "http:429");
  assert.strictEqual(eligible(coded("ERR_BAD_REQUEST", { status: 408 }), "timeout").reason, "http:408");
  eligible(coded("ERR_BAD_RESPONSE", { status: 503 }), "server_error");
  // 无合法数值状态时回退 code 表（保持旧行为）
  assert.strictEqual(failFast(coded("ERR_BAD_REQUEST"), "bad_request").reason, "code:ERR_BAD_REQUEST");
  assert.strictEqual(eligible(coded("ERR_BAD_RESPONSE"), "server_error").reason, "code:ERR_BAD_RESPONSE");

  // 可 fallback 候选
  eligible(coded("PROVIDER_TIMEOUT"), "timeout");
  eligible(coded("provider_timeout"), "timeout");
  eligible(coded("ECONNABORTED"), "timeout");
  eligible(coded("PROVIDER_NETWORK"), "network");
  eligible(coded("ECONNRESET"), "network");
  eligible(coded("ERR_NETWORK"), "network");
  eligible(coded("PROVIDER_RATE_LIMITED"), "rate_limited");
  eligible(coded("ERR_BAD_RESPONSE"), "server_error");
  eligible(coded("PROVIDER_FAILED", { status: 429 }), "rate_limited");
  eligible(coded("PROVIDER_FAILED", { response: { status: 429 } }), "rate_limited");
  eligible(coded("PROVIDER_FAILED", { status: 500 }), "server_error");
  eligible(coded("PROVIDER_FAILED", { status: 502 }), "server_error");
  eligible(coded("PROVIDER_FAILED", { status: 503 }), "server_error");
  eligible(coded("PROVIDER_FAILED", { status: 408 }), "timeout");

  // 熔断/预算类 skipped：不消耗账本但保留 failureClass
  skipped(coded("PROVIDER_CIRCUIT_OPEN"), "circuit_open");
  skipped(coded("PROVIDER_NOT_REGISTERED"), "not_registered");
  skipped(coded("PROVIDER_METHOD_UNSUPPORTED"), "method_unsupported");
  skipped(coded("PROVIDER_FALLBACK_BUDGET_EXHAUSTED"), "budget_exhausted");
  skipped(coded("DEADLINE_EXCEEDED"), "deadline_exceeded");
  // NOT_CONFIGURED：链内 skipped（跳过节点的 config 记录保留）；链耗尽后由 Decision/Response fail fast
  const notConfigured = skipped(coded("NOT_CONFIGURED"), "config");
  assert.strictEqual(notConfigured.reasonCode, "NOT_CONFIGURED");

  // PROVIDER_CHAIN_EXHAUSTED 聚合包装须落到根因
  const chained = coded("PROVIDER_CHAIN_EXHAUSTED", { cause: coded("NOT_CONFIGURED") });
  const unwrapped = classifyFallbackEligibility(chained);
  assert.strictEqual(unwrapped.failureClass, "config");
  assert.strictEqual(unwrapped.failFast, true);
  assert.strictEqual(unwrapped.reasonCode, "NOT_CONFIGURED");
  assert.strictEqual(resolveProviderRootCause(chained).code, "NOT_CONFIGURED");
  const chainedTimeout = classifyFallbackEligibility(coded("PROVIDER_CHAIN_EXHAUSTED", {
    cause: coded("PROVIDER_TIMEOUT", { cause: coded("ECONNABORTED") }),
  }));
  assert.strictEqual(chainedTimeout.failureClass, "timeout");
  assert.strictEqual(chainedTimeout.fallbackEligible, true);
  console.log("✓ classification table: explicit codes + numeric HTTP status ranges, default fail fast");
}

// ── 1b. 适配器层 classifyHttpError：禁 message 正则，通用 4xx 透传给数值状态表 ──
function testAdapterClassifier() {
  const { classifyHttpError } = require("../server/src/services/ai/providers/deepseekProvider");
  const axiosError = (code, status, body, message) => {
    const error = new Error(message || code || "request failed");
    if (code) error.code = code;
    if (status) error.response = { status, data: body || {} };
    return error;
  };
  // code 枚举命中：真实超时仍被识别
  assert.strictEqual(classifyHttpError(axiosError("ECONNABORTED", 0, null, "timeout of 5000ms exceeded")), "provider_timeout");
  assert.strictEqual(classifyHttpError(axiosError("ETIMEDOUT")), "provider_timeout");
  // 禁 message 正则：消息文本恰好含 timeout/超时 的非超时错误不得误标为可重试
  assert.strictEqual(classifyHttpError(axiosError("ECONNRESET", 0, null, "read timeout waiting for upstream")), "ECONNRESET");
  assert.strictEqual(classifyHttpError(axiosError("ERR_NETWORK", 0, null, "超时：连接被重置")), "ERR_NETWORK");
  // 真实 400：按响应体细分 fail-fast 业务码（保留既有行为）
  assert.strictEqual(classifyHttpError(axiosError("ERR_BAD_REQUEST", 400, { error: { message: "Model not exist" } })), "invalid_model");
  assert.strictEqual(classifyHttpError(axiosError("ERR_BAD_REQUEST", 400, { error: { message: "response_format is invalid" } })), "invalid_payload");
  assert.strictEqual(classifyHttpError(axiosError("ERR_BAD_REQUEST", 400, { error: { message: "bad" } })), "provider_bad_request");
  // 其余 4xx 原样透传 axios 粗粒度码，由 fallbackEligibility 数值状态表精确归一
  assert.strictEqual(classifyHttpError(axiosError("ERR_BAD_REQUEST", 401, { error: { message: "Authentication Fails" } })), "ERR_BAD_REQUEST");
  assert.strictEqual(classifyHttpError(axiosError("ERR_BAD_REQUEST", 429, { error: { message: "Rate limit reached" } })), "ERR_BAD_REQUEST");
  assert.strictEqual(classifyHttpError(axiosError("ERR_BAD_RESPONSE", 503)), "ERR_BAD_RESPONSE");
  // 端到端一致性：适配器输出码 + 状态 → 共享分类落到 auth / rate_limited
  const authError = coded(classifyHttpError(axiosError("ERR_BAD_REQUEST", 401)), { status: 401 });
  assert.strictEqual(classifyFallbackEligibility(authError).failureClass, "auth");
  const limitedError = coded(classifyHttpError(axiosError("ERR_BAD_REQUEST", 429)), { status: 429 });
  assert.strictEqual(classifyFallbackEligibility(limitedError).failureClass, "rate_limited");
}

// ── 2. Provider Runtime：不可重试错误不推进 fallback Provider ──
async function testRuntimeFailFast() {
  for (const [label, primaryError, expectedClass, expectedCode] of [
    ["invalid_model", coded("invalid_model"), "invalid_model", "invalid_model"],
    ["bad_request", coded("provider_bad_request"), "bad_request", "provider_bad_request"],
    ["401", coded("PROVIDER_FAILED", { status: 401 }), "auth", "PROVIDER_FAILED"],
    ["403", coded("PROVIDER_FAILED", { response: { status: 403 } }), "auth", "PROVIDER_FAILED"],
    ["schema", coded("PROVIDER_STRUCTURED_OUTPUT_INVALID"), "schema_violation", "PROVIDER_STRUCTURED_OUTPUT_INVALID"],
  ]) {
    let fallbackCalls = 0;
    const runtime = createProviderRuntime({
      adapters: [
        { id: "primary", async generateStructured() { throw primaryError; } },
        {
          id: "fallback",
          async generateStructured() {
            fallbackCalls += 1;
            return { content: JSON.stringify(decisionContract()) };
          },
        },
      ],
    });
    const ledger = createLedger();
    await assert.rejects(
      runtime.generateStructured(strictInput({ providerAttemptLedger: ledger })),
      (error) => {
        assert.strictEqual(error.code, expectedCode, `${label}: original code must be rethrown, not wrapped`);
        assert.strictEqual(error.failureClass, expectedClass, `${label}: failureClass on codedError`);
        assert.strictEqual(error.failFast, true);
        assert.strictEqual(error.fallbackEligible, false);
        assert.strictEqual(error.intendedProvider, "primary");
        assert.strictEqual(error.actualFirstProvider, "primary");
        assert.strictEqual(error.fallbackProvider, "fallback");
        assert.deepStrictEqual(error.fallbackPath, [`primary:${expectedCode}`]);
        assert.strictEqual(error.remainingFallbackBudget, 1, `${label}: fail fast must not consume budget`);
        assert.ok(typeof error.fallbackReason === "string" && error.fallbackReason.length > 0);
        // 错误分类与 codedError 透传字段一致
        assert.strictEqual(error.failureClass, classifyFallbackEligibility(error).failureClass);
        return true;
      }
    );
    assert.strictEqual(fallbackCalls, 0, `${label}: fallback Provider must not run for non-retryable errors`);
    assert.strictEqual(ledger.fallbacksUsed(), 0, `${label}: fallback budget untouched`);
  }
  console.log("✓ runtime fail fast: invalid_model/bad_request/401/403/schema/config never reach the fallback Provider");
}

// ── 3. Provider Runtime：临时性错误按策略 fallback 一次 ──
async function testRuntimeEligibleFallback() {
  for (const [label, primaryError, expectedCode] of [
    ["timeout", coded("PROVIDER_TIMEOUT"), "PROVIDER_TIMEOUT"],
    ["network", coded("PROVIDER_NETWORK"), "PROVIDER_NETWORK"],
    ["rate_limited", coded("PROVIDER_RATE_LIMITED"), "PROVIDER_RATE_LIMITED"],
    ["http_429", coded("PROVIDER_FAILED", { status: 429 }), "PROVIDER_FAILED"],
    ["http_500", coded("PROVIDER_FAILED", { status: 500 }), "PROVIDER_FAILED"],
    ["http_503", coded("PROVIDER_FAILED", { response: { status: 503 } }), "PROVIDER_FAILED"],
  ]) {
    const deadlineAtSeen = [];
    const runtime = createProviderRuntime({
      adapters: [
        {
          id: "primary",
          async generateStructured(input) {
            deadlineAtSeen.push(input.deadlineAt);
            throw primaryError;
          },
        },
        {
          id: "fallback",
          async generateStructured(input) {
            deadlineAtSeen.push(input.deadlineAt);
            return { content: JSON.stringify(decisionContract()) };
          },
        },
      ],
    });
    const ledger = createLedger();
    const result = await runtime.generateStructured(strictInput({
      providerAttemptLedger: ledger,
      deadline: createDeadline({ timeoutMs: 5000 }),
    }));
    assert.strictEqual(result.provider, "fallback", `${label}: exactly one fallback`);
    assert.strictEqual(result.actualFirstProvider, "primary");
    assert.deepStrictEqual(result.fallbackPath, [`primary:${expectedCode}`, "fallback:success"]);
    assert.strictEqual(result.attemptCount, 2);
    assert.strictEqual(ledger.fallbacksUsed(), 1, `${label}: fallback consumes the shared budget once`);
    assert.strictEqual(deadlineAtSeen.length, 2);
    assert.strictEqual(deadlineAtSeen[0], deadlineAtSeen[1], `${label}: shared Deadline must not reset across fallback`);
  }
  console.log("✓ runtime eligible: timeout/network/429/5xx fall back exactly once on one shared Deadline");
}

// ── 4. 无第三次 fallback；链耗尽时的 failureClass 与透传字段 ──
async function testRuntimeNoThirdFallback() {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const runtime = createProviderRuntime({
    adapters: [
      { id: "primary", async generateStructured() { primaryCalls += 1; throw coded("PROVIDER_TIMEOUT"); } },
      { id: "fallback", async generateStructured() { fallbackCalls += 1; throw coded("PROVIDER_TIMEOUT"); } },
    ],
  });
  const ledger = createLedger();
  await assert.rejects(
    runtime.generateStructured(strictInput({ providerAttemptLedger: ledger })),
    (error) => {
      assert.strictEqual(error.code, "PROVIDER_CHAIN_EXHAUSTED");
      assert.strictEqual(error.failureClass, "timeout", "chain exhaustion records the root failureClass");
      assert.strictEqual(error.attemptCount, 2, "no third fallback attempt exists");
      assert.deepStrictEqual(error.fallbackPath, ["primary:PROVIDER_TIMEOUT", "fallback:PROVIDER_TIMEOUT"]);
      assert.strictEqual(error.remainingFallbackBudget, 0);
      return true;
    }
  );
  assert.strictEqual(primaryCalls, 1);
  assert.strictEqual(fallbackCalls, 1, "at most one fallback per Run");

  // skipped 码不消耗账本但出现在 failureClass 记录
  const skipRuntime = createProviderRuntime({
    adapters: [{
      id: "fallback",
      async generateStructured() { return { content: JSON.stringify(decisionContract()) }; },
    }],
  });
  const skipLedger = createLedger();
  const skipped = await skipRuntime.generateStructured(strictInput({
    intendedProvider: "ghost",
    providerAttemptLedger: skipLedger,
  }));
  assert.deepStrictEqual(skipped.fallbackPath, ["ghost:PROVIDER_NOT_REGISTERED", "fallback:success"]);
  assert.strictEqual(skipLedger.fallbacksUsed(), 1, "only the real fallback invocation claims budget");

  const exhaustedLedger = createLedger();
  await assert.rejects(
    skipRuntime.generateStructured(strictInput({
      intendedProvider: "ghost",
      providerAttemptLedger: exhaustedLedger,
      fallbackProvider: "also-ghost",
    })),
    (error) => {
      assert.strictEqual(error.code, "PROVIDER_CHAIN_EXHAUSTED");
      assert.deepStrictEqual(error.fallbackPath, ["ghost:PROVIDER_NOT_REGISTERED", "also-ghost:PROVIDER_NOT_REGISTERED"]);
      assert.strictEqual(error.failureClass, "not_registered", "skipped codes appear in the failureClass record");
      assert.strictEqual(exhaustedLedger.fallbacksUsed(), 0, "skipped codes never consume the fallback budget");
      assert.strictEqual(error.attemptCount, 0, "skipped attempts are not real adapter invocations");
      return true;
    }
  );

  // NOT_CONFIGURED 链内 skipped：跳过未配置节点到达已配置节点（多 Provider 链故障转移）
  let configuredFallbackCalls = 0;
  const partialRuntime = createProviderRuntime({
    adapters: [
      { id: "primary", async generateStructured() { throw coded("NOT_CONFIGURED"); } },
      {
        id: "fallback",
        async generateStructured() {
          configuredFallbackCalls += 1;
          return { content: JSON.stringify(decisionContract()) };
        },
      },
    ],
  });
  const partialLedger = createLedger();
  const partial = await partialRuntime.generateStructured(strictInput({ providerAttemptLedger: partialLedger }));
  assert.strictEqual(partial.provider, "fallback", "unconfigured chain leg is skipped to the configured one");
  assert.deepStrictEqual(partial.fallbackPath, ["primary:NOT_CONFIGURED", "fallback:success"]);
  assert.strictEqual(configuredFallbackCalls, 1);
  assert.strictEqual(partialLedger.fallbacksUsed(), 1, "the configured leg claims the shared budget once");

  // 全部节点未配置：链耗尽，failureClass=config（由 Decision/Response 层 fail fast）
  await assert.rejects(
    partialRuntime.generateStructured(strictInput({ fallbackProvider: "", providerAttemptLedger: createLedger() })),
    (error) => {
      assert.strictEqual(error.code, "PROVIDER_CHAIN_EXHAUSTED");
      assert.strictEqual(error.failureClass, "config", "all-unconfigured chain exhausts with config failureClass");
      assert.deepStrictEqual(error.fallbackPath, ["primary:NOT_CONFIGURED"]);
      return true;
    }
  );
  console.log("✓ no third fallback; skipped codes keep failureClass without consuming the budget");
}

// ── 5. Decision：eligible 经一次 fallback 成功；Schema 受控降级；配置类 fail fast ──
function createTestSkillCatalog() {
  return createSkillCatalog({
    skills: [{
      id: "teaching_week",
      supportedGoals: ["get_teaching_week"],
      runtimeModes: ["public", "trial", "dev"],
      allowedTools: ["get_teaching_week"],
    }],
  });
}

function decideInput(overrides = {}) {
  return Object.assign({
    message: "现在第几教学周？",
    runtimeMode: "trial",
    executionPolicy: "strict_model_first",
    providerRuntimeConfig: {
      AI_AGENT_ENABLED: "true",
      AI_PROVIDER_CHAIN: "deepseek,cloudbase-openai",
      AI_DECISION_PROVIDER: "",
    },
    context: {},
    conversationState: {},
    deterministicResolve: () => ({ name: "get_teaching_week", confidence: 1, slots: {}, ruleScore: 10 }),
    onEvent() {},
  }, overrides);
}

async function testDecisionEligibleFallback() {
  const runtime = createProviderRuntime({
    adapters: [
      { id: "deepseek", async generateStructured() { throw coded("PROVIDER_TIMEOUT"); } },
      {
        id: "cloudbase-openai",
        async generateStructured() { return { content: JSON.stringify(decisionContract()) }; },
      },
    ],
  });
  const service = createDecisionService({
    providerRuntime: runtime,
    skillCatalog: createTestSkillCatalog(),
    deterministicResolve: () => ({ name: "get_teaching_week", confidence: 1, slots: {}, ruleScore: 10 }),
  });
  const ledger = createLedger();
  const result = await service.decide(decideInput({ providerAttemptLedger: ledger }));
  assert.strictEqual(result.decisionSource, "model", "eligible error falls back to the fallback Provider once");
  assert.strictEqual(result.understanding.providerUsed, "cloudbase-openai");
  assert.deepStrictEqual(result.fallbackPath, ["deepseek:PROVIDER_TIMEOUT", "cloudbase-openai:success"]);
  assert.strictEqual(ledger.fallbacksUsed(), 1);
  console.log("✓ decision: timeout falls back once through the shared runtime");
}

async function testDecisionSchemaControlledFallback() {
  let fallbackCalls = 0;
  const runtime = createProviderRuntime({
    adapters: [
      { id: "deepseek", async generateStructured() { return { content: "not-json-at-all" }; } },
      {
        id: "cloudbase-openai",
        async generateStructured() {
          fallbackCalls += 1;
          return { content: JSON.stringify(decisionContract()) };
        },
      },
    ],
  });
  const service = createDecisionService({
    providerRuntime: runtime,
    skillCatalog: createTestSkillCatalog(),
    deterministicResolve: () => ({ name: "get_teaching_week", confidence: 1, slots: {}, ruleScore: 10 }),
  });
  const result = await service.decide(decideInput());
  assert.strictEqual(result.decisionSource, "deterministic_fallback", "Schema 类走受控降级而非换 Provider");
  assert.strictEqual(fallbackCalls, 0, "Schema 类错误不得推进 fallback Provider");
  assert.strictEqual(result.failureClass, "schema_violation");
  assert.strictEqual(result.understanding.failureClass, "schema_violation");
  assert.ok(
    result.fallbackPath[0] && result.fallbackPath[0].includes("PROVIDER_STRUCTURED_OUTPUT_INVALID"),
    "fallbackPath 保留原错误码"
  );
  assert.strictEqual(result.understanding.reasonCode, "PROVIDER_STRUCTURED_OUTPUT_INVALID");
  console.log("✓ decision: schema violations degrade deterministically with the original code in fallbackPath");
}

async function testDecisionConfigFailFast() {
  const service = createDecisionService({
    providerRuntime: { async generateStructured() { throw new Error("must not run"); } },
    skillCatalog: createTestSkillCatalog(),
    deterministicResolve: () => ({ name: "get_teaching_week", confidence: 1, slots: {}, ruleScore: 10 }),
  });
  await assert.rejects(
    service.decide(decideInput({
      providerRuntimeConfig: {
        AI_AGENT_ENABLED: "true",
        AI_PROVIDER: "mock",
        AI_DECISION_PROVIDER: "",
        AI_UNDERSTANDING_PROVIDER: "",
      },
    })),
    (error) => {
      assert.strictEqual(error.code, "DECISION_PROVIDER_UNAVAILABLE", "配置缺失 fail fast，不包装成降级成功");
      assert.strictEqual(error.failureClass, "config");
      assert.strictEqual(error.failFast, true);
      assert.ok(/AI_DECISION_PROVIDER/.test(error.message), "原因须后台可操作");
      assert.ok(/API Key|配置/.test(error.message));
      return true;
    }
  );

  // 适配器级 NOT_CONFIGURED：单节点链耗尽 → 配置类 fail fast（不包装成降级成功）
  const notConfiguredRuntime = createProviderRuntime({
    adapters: [
      { id: "deepseek", async generateStructured() { throw coded("NOT_CONFIGURED"); } },
      {
        id: "cloudbase-openai",
        async generateStructured() { return { content: JSON.stringify(decisionContract()) }; },
      },
    ],
  });
  const service2 = createDecisionService({
    providerRuntime: notConfiguredRuntime,
    skillCatalog: createTestSkillCatalog(),
    deterministicResolve: () => ({ name: "get_teaching_week", confidence: 1, slots: {}, ruleScore: 10 }),
  });
  await assert.rejects(
    service2.decide(decideInput({
      providerRuntimeConfig: {
        AI_AGENT_ENABLED: "true",
        AI_PROVIDER_CHAIN: "deepseek",
        AI_DECISION_PROVIDER: "",
      },
    })),
    (error) => {
      assert.strictEqual(error.code, "NOT_CONFIGURED", "链耗尽根因为配置缺失时 fail fast");
      assert.strictEqual(error.failureClass, "config");
      assert.ok(/AI_DECISION_PROVIDER|API Key|配置/.test(error.message), "原因须后台可操作");
      assert.deepStrictEqual(error.fallbackPath, ["deepseek:NOT_CONFIGURED"]);
      return true;
    }
  );

  // 部分配置的链：未配置节点 skipped，已配置节点正常服务（多 Provider 链故障转移语义）
  const partialChain = await service2.decide(decideInput());
  assert.strictEqual(partialChain.decisionSource, "model");
  assert.strictEqual(partialChain.understanding.providerUsed, "cloudbase-openai");
  assert.deepStrictEqual(partialChain.fallbackPath, ["deepseek:NOT_CONFIGURED", "cloudbase-openai:success"]);
  console.log("✓ decision: config errors fail fast with an admin-actionable reason");
}

// ── 6. Response：classifyProviderFailure 委托共享分类；配置类不再降级成功 ──
async function testResponseOrchestrator() {
  const orchestratorPath = require.resolve("../server/src/services/ai/runtime/providerOrchestrator");
  const providerRuntimeComposition = require("../server/src/services/ai/providerRuntimeComposition");
  const originalGetRuntime = providerRuntimeComposition.getProviderRuntime;
  const originalResolveResponse = providerRuntimeComposition.resolveResponseProviders;

  // classifyProviderFailure 保留导出签名、内部委托共享分类（禁 message 正则）
  delete require.cache[orchestratorPath];
  const orchestrator = require(orchestratorPath);
  assert.strictEqual(orchestrator.classifyProviderFailure(coded("ERR_BAD_REQUEST", { response: { status: 400 } })), "bad_request");
  assert.strictEqual(orchestrator.classifyProviderFailure(coded("provider_timeout")), "timeout");
  assert.strictEqual(orchestrator.classifyProviderFailure(coded("invalid_model")), "invalid_model");
  assert.strictEqual(orchestrator.classifyProviderFailure(coded("PROVIDER_FAILED", { status: 503 })), "server_error");
  assert.strictEqual(orchestrator.classifyProviderFailure(coded("NOT_CONFIGURED")), "config");
  assert.strictEqual(
    orchestrator.classifyProviderFailure(coded("PROVIDER_CHAIN_EXHAUSTED", { cause: coded("PROVIDER_TIMEOUT") })),
    "timeout",
    "链聚合错误按根因分类"
  );

  function responseInput(overrides = {}) {
    return Object.assign({
      intent: { name: "conversational_help", slots: {} },
      toolCalls: [],
      runtimeMode: "trial",
      executionPolicy: "strict_model_first",
      providerRuntimeConfig: {
        AI_AGENT_ENABLED: "true",
        AI_PROVIDER: "deepseek",
        AI_PROVIDER_POLICY: "always",
      },
      principal: { authenticated: true, principalKey: "fallback-eligibility-test" },
      context: { recentMessages: [], userMemories: [], currentScheduleSummary: {} },
      message: "hello",
      eventInput: { onEvent() {} },
      publicToolCalls: [],
      understanding: {},
      plannerDiag: {},
      execution: { steps: [], observations: [], verification: { ok: true, errors: [] } },
      deadline: { deadlineAt: Date.now() + 1000, remainingMs: () => 1000, lease: () => ({ timeoutMs: 500 }) },
      responseBudgetMs: 500,
      providerAttemptLedger: createLedger(),
    }, overrides);
  }

  try {
    // 配置类：链耗尽根因 NOT_CONFIGURED → fail fast，不再包装成降级成功
    providerRuntimeComposition.getProviderRuntime = () => ({
      async generate() {
        throw coded("PROVIDER_CHAIN_EXHAUSTED", {
          cause: coded("NOT_CONFIGURED"),
          intendedProvider: "deepseek",
          actualFirstProvider: "deepseek",
          fallbackPath: ["deepseek:NOT_CONFIGURED"],
          failureClass: "config",
        });
      },
    });
    await assert.rejects(
      orchestrator.generateAssistantResponse(responseInput()),
      (error) => {
        assert.strictEqual(error.code, "NOT_CONFIGURED", "Response 配置类 fail fast（reasonCode 落到根因）");
        assert.strictEqual(error.failureClass, "config");
        assert.ok(/AI_RESPONSE_PROVIDER|AI_PROVIDER_CHAIN/.test(error.message), "原因须后台可操作");
        return true;
      }
    );

    // 临时性错误：保持受控降级，fallbackReason 来自共享分类
    providerRuntimeComposition.getProviderRuntime = () => ({
      async generate() {
        throw coded("PROVIDER_CHAIN_EXHAUSTED", {
          cause: coded("PROVIDER_TIMEOUT", { cause: coded("ECONNABORTED") }),
          intendedProvider: "deepseek",
          actualFirstProvider: "deepseek",
          fallbackPath: ["deepseek:PROVIDER_TIMEOUT"],
        });
      },
    });
    const degraded = await orchestrator.generateAssistantResponse(responseInput());
    assert.strictEqual(degraded.externalProviderUsed, false);
    assert.strictEqual(degraded.providerName, "mock");
    assert.strictEqual(degraded.fallbackReason, "timeout", "fallbackReason 与共享 failureClass 口径一致");
    assert.strictEqual(degraded.failureClass, "timeout");
    // 阶段产物透传：intendedProvider/actualFirstProvider/remainingBudget 可得
    assert.strictEqual(degraded.intendedProvider, "deepseek");
    assert.strictEqual(degraded.actualFirstProvider, "deepseek");
    assert.strictEqual(degraded.remainingFallbackBudget, null, "未携带预算信息时为 null");
    assert.deepStrictEqual(
      degraded.responseProviderChain.map((item) => `${item.provider}:${item.reason}`),
      ["deepseek:PROVIDER_TIMEOUT"]
    );

    // The response Provider must time out before the enclosing response stage so
    // the deterministic payload can be returned. Giving both timers the same
    // budget makes the parent abort win and reproduces the production
    // `provider.started -> STAGE_TIMEOUT -> run.failed` race.
    const slowRuntime = createProviderRuntime({
      adapters: [{
        id: "deepseek",
        async generateStructured() { return {}; },
        generate({ signal }) {
          return new Promise((resolve, reject) => {
            const fail = () => reject(coded("PROVIDER_TIMEOUT"));
            if (signal.aborted) fail();
            else signal.addEventListener("abort", fail, { once: true });
          });
        },
      }, {
        id: "cloudbase-openai",
        async generateStructured() { return {}; },
        generate({ signal }) {
          return new Promise((resolve, reject) => {
            const fail = () => reject(coded("PROVIDER_TIMEOUT"));
            if (signal.aborted) fail();
            else signal.addEventListener("abort", fail, { once: true });
          });
        },
      }],
    });
    providerRuntimeComposition.getProviderRuntime = () => slowRuntime;
    providerRuntimeComposition.resolveResponseProviders = () => ({
      intendedProvider: "deepseek",
      fallbackProvider: "cloudbase-openai",
    });
    const parentStage = createStageSignal(null, 100);
    const keepAlive = setInterval(() => {}, 20);
    try {
      const timedFallback = await orchestrator.generateAssistantResponse(responseInput({
        signal: parentStage.signal,
        deadline: createDeadline({ timeoutMs: 1000 }),
        responseBudgetMs: 100,
      }));
      assert.strictEqual(timedFallback.providerName, "mock");
      assert.strictEqual(timedFallback.externalProviderUsed, false);
      assert.strictEqual(timedFallback.failureClass, "timeout");
      assert.strictEqual(timedFallback.providerTruth.stages.response.fallback, true);
      assert.deepStrictEqual(
        timedFallback.responseProviderChain.map((item) => `${item.provider}:${item.reason}`),
        ["deepseek:PROVIDER_TIMEOUT", "cloudbase-openai:PROVIDER_TIMEOUT"]
      );
    } finally {
      clearInterval(keepAlive);
      parentStage.cleanup();
    }
  } finally {
    providerRuntimeComposition.getProviderRuntime = originalGetRuntime;
    providerRuntimeComposition.resolveResponseProviders = originalResolveResponse;
    delete require.cache[orchestratorPath];
  }
  console.log("✓ response: classifyProviderFailure delegates to the shared classifier; config fails fast");
}

async function run() {
  testClassificationTable();
  testAdapterClassifier();
  await testRuntimeFailFast();
  await testRuntimeEligibleFallback();
  await testRuntimeNoThirdFallback();
  await testDecisionEligibleFallback();
  await testDecisionSchemaControlledFallback();
  await testDecisionConfigFailFast();
  await testResponseOrchestrator();
  console.log("\ntest-agent-fallback-eligibility: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
