#!/usr/bin/env node
/**
 * test-provider-control-plane.js — Provider 控制面专项认证（M1）
 *
 * 覆盖断言组 ①—⑪（T1 = ①—⑤，T2 = ⑥—⑪）：
 *   ① 权威五元组形态（getAuthoritativeProviderConfig）
 *   ② 单选 = 第一跳（recomputeChainForPrimary / saveConfig / getProviderChain 三者一致）
 *   ③ 三阶段显式链（resolveStageChain）
 *   ④ probe 桩语义（probeProvider + isProviderVerified）
 *   ⑤ probe / readiness 语义（public 禁 probe、configuredAvailable 与 verified 分离）
 *   ⑥ recent_success / 指标（lastSuccessAt / callCount / p50 / p95，resetForTest 清零）
 *   ⑦ error_classification（classifyFailure 稳定映射锁定）
 *   ⑧ circuit breaker（阈值开断 → 链上跳过 → 冷却 half-open）
 *   ⑨ public 恒零外部调用（链解析 + generate/probe 计数桩归零）
 *   ⑩ Shadow Eval 隔离（不改写主结果、不泄漏内容、失败不外抛、无 memory 依赖）
 *   ⑪ 后台 UI 与运行时同源（admin 路由静态断言 + 五元组/阶段链行为一致）
 *
 * 每组装在独立 async run 函数里，登记进 GROUPS 数组；main 依次调用、逐组记录 PASS/FAIL，
 * 组间用 providerChainService.resetForTest() 清零进程内指标。
 *
 * 隔离纪律：
 * - 所有外部 Provider 行为一律注入桩（probeGenerate），禁止真实网络请求；
 * - fixture 密钥一律 "unit-test-key-not-real"，不打印、不持久化真实配置值；
 * - 配置存储指向 os.tmpdir() 下的临时目录，进程退出前清理；
 * - require server 模块之前 scrub 可能污染的开发环境 env；
 * - 断言消息只写标量，禁止 JSON.stringify 整个 config/status 对象（server/.env 派生值可能混入）。
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// --- 配置存储隔离：必须先于任何 server 模块 require ---
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-provider-control-plane-"));
process.env.FOSU_AI_PROVIDER_CONFIG_PATH = path.join(tempRoot, "secure", "ai-provider-config.json");
process.env.FOSU_AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// server/.env 在本机真实存在：阻止 provider 模块把 .env 文件值当作已配置凭据。
process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";

[
  "AI_AGENT_ENABLED",
  "AI_PROVIDER",
  "AI_PROVIDER_POLICY",
  "AI_PROVIDER_CHAIN",
  "AI_RUNTIME_MODE",
  "AI_PROVIDER_ACTIVE_ENV",
  "AI_PROVIDER_ENVIRONMENTS",
  "AI_UNDERSTANDING_PROVIDER",
  "AI_PLANNER_PROVIDER",
  "AI_RESPONSE_PROVIDER",
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "COZE_API_KEY",
  "COZE_ENABLED",
  "CLOUDBASE_OPENAI_API_KEY",
  "CLOUDBASE_OPENAI_ENABLED",
  "AI_PROVIDER_CIRCUIT_FAILURES",
  "AI_PROVIDER_CIRCUIT_COOLDOWN_MS",
  "AI_PROVIDER_SHADOW_ENABLED",
  "AI_PROVIDER_SHADOW",
].forEach((key) => {
  delete process.env[key];
});

const providerConfigService = require("../server/src/services/ai/providerConfigService");
const providerChainService = require("../server/src/services/ai/providerChainService");
const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
const cozeProvider = require("../server/src/services/ai/providers/cozeProvider");
const cloudbaseOpenaiProvider = require("../server/src/services/ai/providers/cloudbaseOpenaiProvider");

const FAKE_KEY = "unit-test-key-not-real";

// async 版 withEnv（参照 tools/test-provider-readiness.js:6-21，finally 恢复；
// 必须 await fn() 后再恢复，否则异步断言会在 env 还原后才执行）。
async function withEnv(patch, fn) {
  const previous = {};
  Object.keys(patch).forEach((key) => {
    previous[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  });
  try {
    return await fn();
  } finally {
    Object.keys(patch).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

// ---------------------------------------------------------------------------
// ① 权威五元组形态
// ---------------------------------------------------------------------------
async function runGroup1FiveTupleShape() {
  providerConfigService.saveConfig({
    environment: "trial",
    provider: "deepseek",
    apiKey: FAKE_KEY,
  });
  const auth = providerConfigService.getAuthoritativeProviderConfig("trial");
  assert.deepStrictEqual(
    Object.keys(auth).sort(),
    ["configVersion", "effectiveChain", "environment", "fallbackProviders", "primaryProvider", "stageAssignments"],
    "g1 authoritative config must expose exactly the six tuple keys"
  );
  assert.strictEqual(auth.environment, "trial", "g1 environment");
  assert.deepStrictEqual(
    auth.effectiveChain,
    [auth.primaryProvider].concat(auth.fallbackProviders),
    "g1 effectiveChain must deep-equal [primaryProvider, ...fallbackProviders]"
  );
  assert.deepStrictEqual(
    Object.keys(auth.stageAssignments).sort(),
    ["planner", "response", "understanding"],
    "g1 stageAssignments must contain exactly understanding/planner/response"
  );
  assert.strictEqual(typeof auth.configVersion, "string", "g1 configVersion must be a string");
  assert.ok(auth.configVersion.length > 0, "g1 configVersion must be non-empty after saveConfig");

  const publicAuth = providerConfigService.getAuthoritativeProviderConfig("public");
  assert.deepStrictEqual(
    {
      environment: publicAuth.environment,
      primaryProvider: publicAuth.primaryProvider,
      fallbackProviders: publicAuth.fallbackProviders,
      effectiveChain: publicAuth.effectiveChain,
      stageAssignments: publicAuth.stageAssignments,
    },
    {
      environment: "public",
      primaryProvider: "mock",
      fallbackProviders: [],
      effectiveChain: ["mock"],
      stageAssignments: { understanding: "mock", planner: "mock", response: "mock" },
    },
    "g1 public authoritative tuple must be mock-locked"
  );
  assert.strictEqual(typeof publicAuth.configVersion, "string", "g1 public configVersion must be a string");
}

// ---------------------------------------------------------------------------
// ② 单选 = 第一跳
// ---------------------------------------------------------------------------
async function runGroup2PrimaryIsFirstHop() {
  assert.strictEqual(
    providerConfigService.recomputeChainForPrimary("deepseek", ""),
    "deepseek",
    "g2 empty previous chain collapses to primary only"
  );
  assert.strictEqual(
    providerConfigService.recomputeChainForPrimary("deepseek", "coze,mock"),
    "deepseek,coze,mock",
    "g2 primary prepended before previous fallbacks"
  );
  assert.strictEqual(
    providerConfigService.recomputeChainForPrimary("coze", "deepseek,coze,mock"),
    "coze,deepseek,mock",
    "g2 mid-chain single-select promoted to first hop, rest keep order"
  );

  providerConfigService.saveConfig({
    environment: "trial",
    provider: "deepseek",
    apiKey: FAKE_KEY,
  });
  const auth = providerConfigService.getAuthoritativeProviderConfig("trial");
  assert.strictEqual(auth.primaryProvider, "deepseek", "g2 primaryProvider after single-select save");
  assert.strictEqual(auth.effectiveChain[0], "deepseek", "g2 effectiveChain first hop after single-select save");
  assert.strictEqual(auth.effectiveChain[0], auth.primaryProvider, "g2 single-select must equal first hop");

  const flat = providerConfigService.getRuntimeConfigForEnvironment("trial");
  const runtimeChain = providerChainService.getProviderChain("trial", flat);
  assert.strictEqual(runtimeChain[0], "deepseek", "g2 runtime chain first hop must agree with authoritative tuple");
}

// ---------------------------------------------------------------------------
// ③ 三阶段显式链
// ---------------------------------------------------------------------------
async function runGroup3StageChains() {
  providerConfigService.saveConfig({
    environment: "trial",
    provider: "deepseek",
    understandingProvider: "coze",
    plannerProvider: "cloudbase-openai",
    responseProvider: "",
    apiKey: FAKE_KEY,
  });
  const flat = providerConfigService.getRuntimeConfigForEnvironment("trial");
  const mainChain = providerChainService.getProviderChain("trial", flat);
  assert.strictEqual(mainChain[0], "deepseek", "g3 main chain first hop");

  const understanding = providerChainService.resolveStageChain("understanding", flat, "trial");
  assert.strictEqual(understanding[0], "coze", "g3 understanding stage first hop");
  assert.deepStrictEqual(
    understanding.slice(1),
    mainChain.filter((name) => name !== "coze"),
    "g3 understanding remainder must be main chain minus coze, original order"
  );

  const planner = providerChainService.resolveStageChain("planner", flat, "trial");
  assert.strictEqual(planner[0], "cloudbase-openai", "g3 planner stage first hop");

  const response = providerChainService.resolveStageChain("response", flat, "trial");
  assert.deepStrictEqual(response, mainChain, "g3 empty response stage must follow the main chain");

  const invalidStageConfig = {
    AI_PROVIDER_CHAIN: "deepseek,mock",
    AI_UNDERSTANDING_PROVIDER: "not-a-real-provider",
  };
  assert.deepStrictEqual(
    providerChainService.resolveStageChain("understanding", invalidStageConfig, "trial"),
    ["deepseek", "mock"],
    "g3 invalid stage value must fall back to the main chain"
  );
  assert.deepStrictEqual(
    providerChainService.resolveStageChain("nonsense", invalidStageConfig, "trial"),
    ["deepseek", "mock"],
    "g3 unknown stage must fall back to the main chain"
  );
}

// ---------------------------------------------------------------------------
// ④ probe 桩（每个子例前 resetForTest）
// ---------------------------------------------------------------------------
async function runGroup4ProbeStubs() {
  // 成功桩
  providerChainService.resetForTest();
  let successCalls = 0;
  const okResult = await providerChainService.probeProvider("deepseek", {
    runtimeMode: "trial",
    probeGenerate: async () => {
      successCalls += 1;
      return { content: "ok" };
    },
  });
  assert.strictEqual(okResult.health, "ok", "g4 success stub health");
  assert.strictEqual(okResult.reasonCode, "", "g4 success stub reasonCode");
  assert.strictEqual(successCalls, 1, "g4 success stub must be invoked exactly once");
  assert.strictEqual(
    providerChainService.isProviderVerified("deepseek"),
    true,
    "g4 success probe must mark provider verified"
  );

  // 失败桩（code ETIMEDOUT + message 命中 /timeout/i → classifyFailure === "timeout"）
  providerChainService.resetForTest();
  const timeoutError = new Error("unit-test timeout");
  timeoutError.code = "ETIMEDOUT";
  const failResult = await providerChainService.probeProvider("deepseek", {
    runtimeMode: "trial",
    probeGenerate: async () => {
      throw timeoutError;
    },
  });
  assert.strictEqual(failResult.health, "degraded", "g4 failing stub health");
  assert.strictEqual(
    failResult.reasonCode,
    providerChainService.classifyFailure(timeoutError),
    "g4 failing stub reasonCode must equal classifyFailure(error)"
  );
  assert.strictEqual(failResult.reasonCode, "timeout", "g4 failing stub reasonCode must be timeout");
  assert.strictEqual(
    providerChainService.isProviderVerified("deepseek"),
    false,
    "g4 failing probe must not mark provider verified"
  );

  // mock
  providerChainService.resetForTest();
  const mockResult = await providerChainService.probeProvider("mock", { runtimeMode: "trial" });
  assert.strictEqual(mockResult.health, "ok", "g4 mock probe health");

  // 未知名
  providerChainService.resetForTest();
  const unknownResult = await providerChainService.probeProvider("no-such-provider", { runtimeMode: "trial" });
  assert.strictEqual(unknownResult.health, "disabled", "g4 unknown provider health");
  assert.strictEqual(unknownResult.reasonCode, "PROVIDER_UNKNOWN", "g4 unknown provider reasonCode");

  // 未配置：无 probeGenerate 且 providerRuntimeConfig / process.env 均无密钥
  providerChainService.resetForTest();
  await withEnv(
    { DEEPSEEK_API_KEY: undefined, AI_API_KEY: undefined, FOSUCLASS_DEEPSEEK_API_KEY: undefined },
    async () => {
      const unconfigured = await providerChainService.probeProvider("deepseek", {
        runtimeMode: "trial",
        providerRuntimeConfig: {},
      });
      assert.strictEqual(unconfigured.health, "disabled", "g4 unconfigured provider health");
      assert.strictEqual(unconfigured.reasonCode, "NOT_CONFIGURED", "g4 unconfigured provider reasonCode");
    }
  );
}

// ---------------------------------------------------------------------------
// ⑤ probe / readiness 语义
// ---------------------------------------------------------------------------
async function runGroup5ProbeReadinessSemantics() {
  // public 禁 probe，且不得触桩
  providerChainService.resetForTest();
  let publicStubCalls = 0;
  const forbidden = await providerChainService.probeProvider("deepseek", {
    runtimeMode: "public",
    probeGenerate: async () => {
      publicStubCalls += 1;
      return { content: "ok" };
    },
  });
  assert.strictEqual(forbidden.health, "forbidden", "g5 public probe health");
  assert.strictEqual(forbidden.reasonCode, "PUBLIC_PROVIDER_FORBIDDEN", "g5 public probe reasonCode");
  assert.strictEqual(publicStubCalls, 0, "g5 public probe must never invoke the stub");

  const runtimeConfig = { AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: FAKE_KEY };
  const deepseekStatus = (list) => list.find((item) => item.name === "deepseek");

  // 成功 probe 后 verified === true
  providerChainService.resetForTest();
  await providerChainService.probeProvider("deepseek", {
    runtimeMode: "trial",
    probeGenerate: async () => ({ content: "ok" }),
  });
  const afterProbe = deepseekStatus(providerChainService.getStatus("trial", runtimeConfig));
  assert.ok(afterProbe, "g5 deepseek status entry must exist on the chain");
  assert.strictEqual(afterProbe.verified, true, "g5 verified must be true after a successful probe");

  // configuredAvailable 与 verified 分离（对照：未调用 → configured 但 not verified；probe 后 → 双 true）
  providerChainService.resetForTest();
  const beforeCall = deepseekStatus(providerChainService.getStatus("trial", runtimeConfig));
  assert.ok(beforeCall, "g5 deepseek status entry must exist before any call");
  assert.strictEqual(beforeCall.configuredAvailable, true, "g5 configured key must imply configuredAvailable");
  assert.strictEqual(beforeCall.verified, false, "g5 verified must be false before any real call");
  await providerChainService.probeProvider("deepseek", {
    runtimeMode: "trial",
    probeGenerate: async () => ({ content: "ok" }),
  });
  const afterCall = deepseekStatus(providerChainService.getStatus("trial", runtimeConfig));
  assert.strictEqual(afterCall.verified, true, "g5 verified must flip to true after a successful probe");
  assert.strictEqual(afterCall.configuredAvailable, true, "g5 configuredAvailable must stay true after a successful probe");
}

// ---------------------------------------------------------------------------
// ⑥ recent_success / 指标
// ---------------------------------------------------------------------------
async function runGroup6RecentSuccessMetrics() {
  const runtimeConfig = { AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: FAKE_KEY };
  const probeOk = () => providerChainService.probeProvider("deepseek", {
    runtimeMode: "trial",
    probeGenerate: async () => ({ content: "ok" }),
  });
  const deepseekStatus = () => providerChainService
    .getStatus("trial", runtimeConfig)
    .find((item) => item.name === "deepseek");

  providerChainService.resetForTest();
  await probeOk();
  const afterFirst = deepseekStatus();
  assert.ok(afterFirst, "g6 deepseek status entry must exist");
  assert.ok(afterFirst.callCount >= 1, "g6 callCount must increase after the first success");
  await probeOk();
  await probeOk();
  const afterThree = deepseekStatus();
  assert.strictEqual(afterThree.callCount, 3, "g6 callCount must equal 3 after three successful probes");
  assert.strictEqual(typeof afterThree.lastSuccessAt, "string", "g6 lastSuccessAt type");
  assert.ok(afterThree.lastSuccessAt.length > 0, "g6 lastSuccessAt must be non-empty after success");
  // latencyMs 由 Date.now() 实测可能为 0，0 是合法有限值，只断言有限与 p95 >= p50。
  assert.ok(Number.isFinite(afterThree.p50LatencyMs), "g6 p50LatencyMs must be finite");
  assert.ok(Number.isFinite(afterThree.p95LatencyMs), "g6 p95LatencyMs must be finite");
  assert.ok(afterThree.p95LatencyMs >= afterThree.p50LatencyMs, "g6 p95 must be >= p50");

  providerChainService.resetForTest();
  const cleared = deepseekStatus();
  assert.strictEqual(cleared.callCount, 0, "g6 resetForTest must clear callCount");
  assert.strictEqual(cleared.lastSuccessAt, "", "g6 resetForTest must clear lastSuccessAt");
  assert.strictEqual(cleared.p50LatencyMs, 0, "g6 resetForTest must clear p50LatencyMs");
  assert.strictEqual(cleared.p95LatencyMs, 0, "g6 resetForTest must clear p95LatencyMs");
}

// ---------------------------------------------------------------------------
// ⑦ error_classification：锁定 classifyFailure 现实现稳定映射
// ---------------------------------------------------------------------------
async function runGroup7ErrorClassification() {
  const timeoutError = new Error("unit-test timeout");
  timeoutError.code = "ETIMEDOUT";
  assert.strictEqual(providerChainService.classifyFailure(timeoutError), "timeout", "g7 timeout classification via message");
  assert.strictEqual(providerChainService.classifyFailure({ status: 401, message: "unauthorized" }), "unauthorized", "g7 401 classification");
  assert.strictEqual(providerChainService.classifyFailure({ status: 403, message: "forbidden" }), "forbidden", "g7 403 classification");
  assert.strictEqual(providerChainService.classifyFailure({ status: 429, message: "too many" }), "rate_limited", "g7 429 classification");
  // 现实现无专门网络错误映射：无 status 命中时返回 code 本身，以现实现为准锁定。
  assert.strictEqual(providerChainService.classifyFailure({ code: "ECONNRESET", message: "socket hang up" }), "ECONNRESET", "g7 network error falls through to its code");
  assert.strictEqual(providerChainService.classifyFailure({}), "provider_failed", "g7 empty error classification");
}

// ---------------------------------------------------------------------------
// ⑧ circuit breaker（阈值开断 → 链上跳过 → 冷却 half-open）
// ---------------------------------------------------------------------------
async function runGroup8CircuitBreaker() {
  await withEnv({ AI_PROVIDER_CIRCUIT_FAILURES: "2", AI_PROVIDER_CIRCUIT_COOLDOWN_MS: "1000" }, async () => {
    providerChainService.resetForTest();
    const boom = new Error("unit-test timeout");
    boom.code = "ETIMEDOUT";
    const failProbe = () => providerChainService.probeProvider("deepseek", {
      runtimeMode: "trial",
      probeGenerate: async () => {
        throw boom;
      },
    });
    await failProbe();
    await failProbe();

    const runtimeConfig = { AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: FAKE_KEY };
    const deepseekStatus = () => providerChainService
      .getStatus("trial", runtimeConfig)
      .find((item) => item.name === "deepseek");
    const opened = deepseekStatus();
    assert.ok(opened, "g8 deepseek status entry must exist");
    assert.strictEqual(opened.circuitBreaker.state, "open", "g8 circuit must open at the failure threshold");
    assert.ok(opened.circuitBreaker.openedAt, "g8 openedAt must be recorded");
    assert.ok(opened.circuitBreaker.nextProbeAt, "g8 nextProbeAt must be recorded");

    const result = await providerChainService.generateWithChain(
      { message: "unit-test" },
      { runtimeMode: "trial", providerRuntimeConfig: runtimeConfig }
    );
    assert.strictEqual(result.provider, "mock", "g8 open circuit must fall back to mock");
    assert.ok(
      result.providerChain.some((attempt) => attempt.provider === "deepseek"
        && attempt.status === "skipped"
        && attempt.reason === "circuit_open"),
      "g8 attempts must record deepseek skipped with circuit_open"
    );

    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.strictEqual(providerChainService.isCircuitOpen("deepseek"), false, "g8 circuit must leave open state after cooldown");
    assert.strictEqual(deepseekStatus().circuitBreaker.state, "half-open", "g8 circuit must transition to half-open after cooldown");

    providerChainService.resetForTest();
  });
}

// ---------------------------------------------------------------------------
// ⑨ public 恒零外部调用
// ---------------------------------------------------------------------------
async function runGroup9PublicZeroExternalCalls() {
  const cfg = {
    AI_PROVIDER: "deepseek",
    AI_UNDERSTANDING_PROVIDER: "coze",
    AI_PLANNER_PROVIDER: "cloudbase-openai",
    AI_RESPONSE_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: FAKE_KEY,
  };
  ["understanding", "planner", "response"].forEach((stage) => {
    assert.deepStrictEqual(
      providerChainService.resolveStageChain(stage, cfg, "public"),
      ["mock"],
      `g9 public stage chain must be mock-only (${stage})`
    );
  });
  assert.deepStrictEqual(providerChainService.getProviderChain("public", cfg), ["mock"], "g9 public main chain must be mock-only");

  // env 回退路径：runtimeConfig 传 {}，同名键只存在于 process.env，public 仍全 mock。
  await withEnv({
    AI_PROVIDER: "deepseek",
    AI_UNDERSTANDING_PROVIDER: "coze",
    AI_PLANNER_PROVIDER: "cloudbase-openai",
    AI_RESPONSE_PROVIDER: "deepseek",
    AI_RUNTIME_MODE: "public",
  }, async () => {
    ["understanding", "planner", "response"].forEach((stage) => {
      assert.deepStrictEqual(
        providerChainService.resolveStageChain(stage, {}, ""),
        ["mock"],
        `g9 public stage chain via env fallback must be mock-only (${stage})`
      );
    });
    assert.deepStrictEqual(providerChainService.getProviderChain("public", {}), ["mock"], "g9 public main chain via env fallback must be mock-only");
  });

  // 计数桩替换全部外部 Provider 的 generate/generateStructured，finally 恢复。
  const originals = [];
  let externalCalls = 0;
  [deepseekProvider, cozeProvider, cloudbaseOpenaiProvider].forEach((mod) => {
    ["generate", "generateStructured"].forEach((fnName) => {
      if (typeof mod[fnName] !== "function") return;
      originals.push([mod, fnName, mod[fnName]]);
      mod[fnName] = async () => {
        externalCalls += 1;
        return { answer: "unit-test-stub" };
      };
    });
  });
  let probeStubCalls = 0;
  try {
    const primary = await providerChainService.generateWithChain(
      { message: "unit-test" },
      { runtimeMode: "public", providerRuntimeConfig: cfg }
    );
    assert.strictEqual(primary.provider, "mock", "g9 public generateWithChain must resolve to mock");
    const staged = await providerChainService.generateWithChain(
      { message: "unit-test" },
      { runtimeMode: "public", providerRuntimeConfig: cfg, stage: "understanding" }
    );
    assert.strictEqual(staged.provider, "mock", "g9 public staged generateWithChain must resolve to mock");
    const forbidden = await providerChainService.probeProvider("deepseek", {
      runtimeMode: "public",
      probeGenerate: async () => {
        probeStubCalls += 1;
        return { content: "ok" };
      },
    });
    assert.strictEqual(forbidden.health, "forbidden", "g9 public probe health");
    assert.strictEqual(forbidden.reasonCode, "PUBLIC_PROVIDER_FORBIDDEN", "g9 public probe reasonCode");
    assert.strictEqual(externalCalls, 0, "g9 public mode must never call external provider generate/generateStructured");
    assert.strictEqual(probeStubCalls, 0, "g9 public probe must never invoke the stub");
  } finally {
    originals.forEach(([mod, fnName, original]) => {
      mod[fnName] = original;
    });
  }
}

// ---------------------------------------------------------------------------
// ⑩ Shadow Eval 隔离
// ---------------------------------------------------------------------------
async function runGroup10ShadowEvalIsolation() {
  providerChainService.resetForTest();
  const originalGenerate = deepseekProvider.generate;
  deepseekProvider.generate = async () => ({ answer: "primary-answer", provider: "deepseek" });
  try {
    const shadowConfig = {
      AI_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: FAKE_KEY,
      AI_PROVIDER_SHADOW_ENABLED: "true",
      AI_PROVIDER_SHADOW: "coze",
      AI_PROVIDER_SHADOW_TIMEOUT_MS: "1000",
    };
    const result = await providerChainService.generateWithChain(
      { message: "unit-test" },
      {
        runtimeMode: "trial",
        providerRuntimeConfig: shadowConfig,
        shadowGenerate: async () => ({ content: "shadow-content-must-not-leak" }),
      }
    );
    assert.strictEqual(result.answer, "primary-answer", "g10 shadow must not rewrite the primary answer");
    assert.strictEqual(result.provider, "deepseek", "g10 shadow must not rewrite the primary provider");
    assert.strictEqual(result.shadowEvaluation.status, "scheduled", "g10 shadow evaluation must be scheduled in background");
    assert.ok(
      !JSON.stringify(result).includes("shadow-content-must-not-leak"),
      "g10 shadow content must never leak into the primary result"
    );

    const failedShadow = await providerChainService.generateWithChain(
      { message: "unit-test" },
      {
        runtimeMode: "trial",
        providerRuntimeConfig: shadowConfig,
        shadowGenerate: async () => {
          throw new Error("unit-test shadow boom");
        },
      }
    );
    assert.strictEqual(failedShadow.answer, "primary-answer", "g10 failing shadow must not change the primary answer");
    assert.strictEqual(failedShadow.provider, "deepseek", "g10 failing shadow must not change the primary provider");
    // 让后台 shadow 结算完：失败只走 provider.shadow.failed 事件，进程不得崩溃。
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    deepseekProvider.generate = originalGenerate;
  }

  const direct = await providerChainService.runShadowEvaluation(
    {},
    {
      runtimeMode: "trial",
      providerRuntimeConfig: { AI_PROVIDER_SHADOW_ENABLED: "true", AI_PROVIDER_SHADOW: "coze" },
      shadowGenerate: async () => {
        throw new Error("unit-test shadow boom");
      },
    },
    "deepseek"
  );
  assert.strictEqual(direct.status, "failed", "g10 direct shadow evaluation must report failed without throwing");

  const source = fs.readFileSync(
    path.join(__dirname, "..", "server", "src", "services", "ai", "providerChainService.js"),
    "utf8"
  );
  assert.ok(!/require\s*\([^)]*memory/i.test(source), "g10 providerChainService must not require memory modules");
  assert.ok(!source.includes("workingMemory"), "g10 providerChainService must not reference workingMemory");
  assert.ok(!source.includes("memoryController"), "g10 providerChainService must not reference memoryController");
}

// ---------------------------------------------------------------------------
// ⑪ 后台 UI 与运行时同源
// ---------------------------------------------------------------------------
async function runGroup11AdminRuntimeSameSource() {
  const adminSource = fs.readFileSync(
    path.join(__dirname, "..", "server", "src", "routes", "admin.js"),
    "utf8"
  );
  assert.ok(/getAuthoritativeProviderConfig\s*\(/.test(adminSource), "g11 admin status API must expose the authoritative tuple");

  const adminPagesSource = fs.readFileSync(
    path.join(__dirname, "..", "server", "src", "routes", "adminPages.js"),
    "utf8"
  );
  assert.ok(adminPagesSource.includes("/api/admin/ai-provider/readiness-matrix"), "g11 admin page must call readiness-matrix API");
  assert.ok(adminPagesSource.includes("/api/admin/ai-provider/probe"), "g11 admin page must call probe API");

  providerConfigService.saveConfig({
    environment: "trial",
    provider: "deepseek",
    understandingProvider: "coze",
    plannerProvider: "cloudbase-openai",
    responseProvider: "",
    apiKey: FAKE_KEY,
  });
  const auth = providerConfigService.getAuthoritativeProviderConfig("trial");
  const flat = providerConfigService.getRuntimeConfigForEnvironment("trial");
  assert.strictEqual(
    auth.effectiveChain[0],
    providerChainService.resolveStageChain("response", flat, "trial")[0],
    "g11 empty response stage must follow the authoritative first hop"
  );
  assert.strictEqual(auth.stageAssignments.understanding, "coze", "g11 authoritative understanding assignment");
  assert.strictEqual(
    providerChainService.resolveStageChain("understanding", flat, "trial")[0],
    auth.stageAssignments.understanding,
    "g11 runtime understanding first hop must equal authoritative assignment"
  );
  assert.strictEqual(auth.stageAssignments.planner, "cloudbase-openai", "g11 authoritative planner assignment");
  assert.strictEqual(
    providerChainService.resolveStageChain("planner", flat, "trial")[0],
    auth.stageAssignments.planner,
    "g11 runtime planner first hop must equal authoritative assignment"
  );
  assert.strictEqual(auth.stageAssignments.response, auth.primaryProvider, "g11 empty response assignment resolves to primary");
  assert.strictEqual(
    providerChainService.resolveStageChain("response", flat, "trial")[0],
    auth.stageAssignments.response,
    "g11 runtime response first hop must equal authoritative assignment"
  );
}

// ---------------------------------------------------------------------------
// main：依次调用各断言组；后续里程碑续写时把新组追加到 GROUPS。
// ---------------------------------------------------------------------------
const GROUPS = [
  ["group1 five-tuple shape", runGroup1FiveTupleShape],
  ["group2 primary-is-first-hop", runGroup2PrimaryIsFirstHop],
  ["group3 stage chains", runGroup3StageChains],
  ["group4 probe stubs", runGroup4ProbeStubs],
  ["group5 probe/readiness semantics", runGroup5ProbeReadinessSemantics],
  ["group6 recent-success metrics", runGroup6RecentSuccessMetrics],
  ["group7 error classification", runGroup7ErrorClassification],
  ["group8 circuit breaker", runGroup8CircuitBreaker],
  ["group9 public zero external calls", runGroup9PublicZeroExternalCalls],
  ["group10 shadow eval isolation", runGroup10ShadowEvalIsolation],
  ["group11 admin/runtime same source", runGroup11AdminRuntimeSameSource],
];

async function main() {
  let failures = 0;
  for (const [name, run] of GROUPS) {
    try {
      await run();
      console.log(`  PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL ${name}`);
      console.error((error && error.stack) || error);
    }
  }
  if (failures > 0) {
    console.error(`test-provider-control-plane: FAIL (${failures}/${GROUPS.length} groups failed)`);
    process.exitCode = 1;
    return;
  }
  console.log("test-provider-control-plane: PASS");
}

main()
  .catch((error) => {
    console.error((error && error.stack) || error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
