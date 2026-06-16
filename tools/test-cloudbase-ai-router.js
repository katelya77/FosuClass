const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const aiTransportRouter = require("../miniprogram/services/aiTransportRouter");
const cloudbaseHunyuanService = require("../miniprogram/services/cloudbaseHunyuanService");
const cloudbaseConfig = require("../miniprogram/config/cloudbase");
const { classifyAiRoute } = require("../miniprogram/shared/aiRouteClassifier");

const originalCloudbaseConfig = Object.assign({}, cloudbaseConfig);

function futureConfig(extra = {}) {
  return Object.assign({
    CLOUDBASE_ENABLED: true,
    CLOUDBASE_AI_ENABLED: true,
    CLOUDBASE_AI_MODEL: "hy3-preview",
    CLOUDBASE_AI_PROMO_EXPIRES_AT: "2099-12-14T23:59:59+08:00",
    AI_GENERATIVE_PUBLIC_ENABLED: true,
    AI_COMPETITION_MODE: true,
    AI_TOOL_ONLY_MODE: false,
    AI_CLIENT_EXPRESSION_LAYER_ENABLED: true,
    AI_MAX_HISTORY_MESSAGES: 6,
    AI_MAX_USER_MESSAGE_LENGTH: 1200,
    AI_MAX_DAILY_GENERATIVE_REQUESTS: 20,
  }, extra);
}

function installHunyuanStream(handler) {
  global.wx.cloud = {
    extend: {
      AI: {
        createModel: () => ({
          streamText: handler,
        }),
      },
    },
  };
}

function streamFromChunks(chunks, delayMs = 0) {
  return {
    textStream: (async function* generator() {
      for (const chunk of chunks) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        yield chunk;
      }
    })(),
    usage: { totalTokens: 12 },
  };
}

function setEnvVersion(envVersion) {
  global.wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: envVersion || "develop" } });
}

function reset(config, envVersion) {
  mockEnv.clearStorage();
  const nextConfig = config || futureConfig();
  Object.assign(cloudbaseConfig, originalCloudbaseConfig, nextConfig);
  setEnvVersion(envVersion || "develop");
  cloudbaseHunyuanService.__setTestOverrides({
    config: nextConfig,
    sdkVersion: "3.15.1",
    envVersion: envVersion || "develop",
  });
  delete global.wx.cloud;
}

function redact(text) {
  return String(text || "")
    .replace(/token\s*[:：=]\s*[A-Za-z0-9._~+/=-]+/gi, "token: [已脱敏]")
    .replace(/密码\s*[:：=]\s*[^\s，。；;]+/gi, "密码: [已脱敏]");
}

async function testDeterministicDoesNotCallHunyuan() {
  reset();
  let hunyuanCalled = 0;
  let oracleCalled = 0;
  installHunyuanStream(async () => {
    hunyuanCalled += 1;
    return streamFromChunks(["不应调用"]);
  });
  const response = await aiTransportRouter.chat({
    message: "今天还有课吗？",
    context: { term: "2025-2026-2" },
    redactSensitiveText: redact,
    oracleChat: async () => {
      oracleCalled += 1;
      return {
        answer: "工具计算：今天没有课。",
        safety: { provider: "mock", resolvedProvider: "mock", externalProviderUsed: false },
        metrics: { intentName: "get_today_courses" },
      };
    },
  });
  assert.strictEqual(classifyAiRoute("今天还有课吗？").route, "oracle-tool");
  assert.strictEqual(oracleCalled, 1);
  assert.strictEqual(hunyuanCalled, 0);
  assert.strictEqual(response.answer, "工具计算：今天没有课。");
}

async function testReleaseGateBlocksCompetitionMode() {
  reset(futureConfig({
    AI_GENERATIVE_PUBLIC_ENABLED: false,
    AI_COMPETITION_MODE: true,
  }), "release");
  let hunyuanCalled = 0;
  let oracleCalled = 0;
  installHunyuanStream(async () => {
    hunyuanCalled += 1;
    return streamFromChunks(["release should not call Hunyuan"]);
  });
  assert.strictEqual(cloudbaseHunyuanService.getAvailability().available, false);
  assert.strictEqual(cloudbaseHunyuanService.getAvailability().code, "AI_GENERATIVE_PUBLIC_DISABLED");
  assert.strictEqual(aiTransportRouter.shouldDisableGenerativeInClient(), true);

  const response = await aiTransportRouter.chat({
    message: "FosuClass 是什么？",
    context: { term: "2025-2026-2" },
    redactSensitiveText: redact,
    oracleChat: async () => {
      oracleCalled += 1;
      return {
        answer: "server agent handles disabled client expression layer",
        safety: { provider: "mock", resolvedProvider: "mock", externalProviderUsed: false },
        metrics: { intentName: "project_qa" },
      };
    },
  });
  assert.strictEqual(hunyuanCalled, 0, "release + public=false + competition=true must not call Hunyuan");
  assert.strictEqual(oracleCalled, 1, "disabled client expression layer should delegate to the server agent");
  assert.strictEqual(response.answer, "server agent handles disabled client expression layer");
}

async function testReleaseGateKeepsToolOnlyQueriesAvailable() {
  reset(futureConfig({
    AI_GENERATIVE_PUBLIC_ENABLED: false,
    AI_COMPETITION_MODE: true,
  }), "release");
  let hunyuanCalled = 0;
  let oracleCalled = 0;
  installHunyuanStream(async () => {
    hunyuanCalled += 1;
    return streamFromChunks(["should not run"]);
  });
  const response = await aiTransportRouter.chat({
    message: "今天还有课吗？",
    context: { term: "2025-2026-2" },
    redactSensitiveText: redact,
    oracleChat: async () => {
      oracleCalled += 1;
      return {
        answer: "工具查询仍然可用",
        safety: { provider: "mock", resolvedProvider: "mock", externalProviderUsed: false },
        metrics: { intentName: "get_today_courses" },
      };
    },
  });
  assert.strictEqual(hunyuanCalled, 0);
  assert.strictEqual(oracleCalled, 1);
  assert.strictEqual(response.answer, "工具查询仍然可用");
}

async function assertCompetitionModeAllowed(envVersion) {
  reset(futureConfig({
    AI_GENERATIVE_PUBLIC_ENABLED: false,
    AI_COMPETITION_MODE: true,
  }), envVersion);
  let hunyuanCalled = 0;
  installHunyuanStream(async () => {
    hunyuanCalled += 1;
    return streamFromChunks([`${envVersion} competition Hunyuan ok`]);
  });
  assert.strictEqual(cloudbaseHunyuanService.getAvailability().available, true);
  assert.strictEqual(aiTransportRouter.shouldDisableGenerativeInClient(), false);
  const response = await aiTransportRouter.chat({
    message: "FosuClass 是什么？",
    context: { term: "2025-2026-2" },
    redactSensitiveText: redact,
    oracleChat: async () => {
      throw new Error("oracle should not be called when Hunyuan is allowed");
    },
  });
  assert.strictEqual(hunyuanCalled, 1, `${envVersion} + competition=true should call Hunyuan`);
  assert.strictEqual(response.safety.resolvedProvider, "cloudbase-hunyuan");
}

async function testTrialCompetitionAllowsHunyuan() {
  await assertCompetitionModeAllowed("trial");
}

async function testDevelopCompetitionAllowsHunyuan() {
  await assertCompetitionModeAllowed("develop");
}

async function testReleasePublicEnabledAllowsHunyuan() {
  reset(futureConfig({
    AI_GENERATIVE_PUBLIC_ENABLED: true,
    AI_COMPETITION_MODE: true,
  }), "release");
  let hunyuanCalled = 0;
  installHunyuanStream(async () => {
    hunyuanCalled += 1;
    return streamFromChunks(["release public Hunyuan ok"]);
  });
  assert.strictEqual(cloudbaseHunyuanService.getAvailability().available, true);
  assert.strictEqual(aiTransportRouter.shouldDisableGenerativeInClient(), false);
  const response = await aiTransportRouter.chat({
    message: "FosuClass 是什么？",
    context: {},
    redactSensitiveText: redact,
    oracleChat: async () => {
      throw new Error("oracle should not be called when public release Hunyuan is enabled");
    },
  });
  assert.strictEqual(hunyuanCalled, 1);
  assert.strictEqual(response.safety.resolvedProvider, "cloudbase-hunyuan");
}

async function testProjectQaCallsHunyuan() {
  reset();
  let hunyuanCalled = 0;
  installHunyuanStream(async (payload) => {
    hunyuanCalled += 1;
    const text = JSON.stringify(payload);
    assert(!text.includes("原始 XLS"), "raw XLS should not be sent to model");
    return streamFromChunks(["FosuClass 是课表工具，", "事实由工具提供。"]);
  });
  const deltas = [];
  const response = await aiTransportRouter.chat({
    message: "FosuClass 是什么？",
    context: { term: "2025-2026-2", releaseVersion: "v1" },
    history: [{ role: "user", content: "你好" }],
    redactSensitiveText: redact,
    oracleChat: async () => {
      throw new Error("oracle should not be called when Hunyuan succeeds");
    },
    callbacks: {
      onDelta: (delta) => deltas.push(delta),
    },
  });
  assert.strictEqual(hunyuanCalled, 1);
  assert(deltas.length >= 2, "streaming deltas should be forwarded");
  assert.strictEqual(response.safety.resolvedProvider, "cloudbase-hunyuan");
  assert.strictEqual(response.metrics.externalProviderUsed, true);
  assert(response.answer.includes("FosuClass"));
}

async function testHunyuanUnavailableFallsBackOracle() {
  reset();
  let oracleCalled = 0;
  const response = await aiTransportRouter.chat({
    message: "这个小程序怎么用？",
    context: {},
    redactSensitiveText: redact,
    oracleChat: async () => {
      oracleCalled += 1;
      return {
        answer: "DeepSeek 备用回答",
        safety: { provider: "deepseek", resolvedProvider: "deepseek", externalProviderUsed: true },
        metrics: { intentName: "project_qa" },
      };
    },
  });
  assert.strictEqual(oracleCalled, 1);
  assert.strictEqual(response.answer, "DeepSeek 备用回答");
  assert.strictEqual(response.safety.hunyuanFallbackReason, "WX_CLOUD_AI_UNAVAILABLE");
}

async function testOracleUnavailableFriendlyFallback() {
  reset();
  const response = await aiTransportRouter.chat({
    message: "你是谁？",
    context: {},
    redactSensitiveText: redact,
    oracleChat: async () => {
      throw new Error("oracle offline");
    },
  });
  assert.strictEqual(response.safety.resolvedProvider, "mock");
  assert(response.answer.includes("规则降级"));
  assert(response.cards[0].title.includes("AI 生成内容"));
}

async function testConcurrentLimitFallsBackAfterOneRetry() {
  reset();
  let hunyuanCalls = 0;
  installHunyuanStream(async () => {
    hunyuanCalls += 1;
    const error = new Error("EXCEED_CONCURRENT_REQUEST_LIMIT");
    error.code = "EXCEED_CONCURRENT_REQUEST_LIMIT";
    throw error;
  });
  const statuses = [];
  const response = await aiTransportRouter.chat({
    message: "介绍一下佛课小表",
    context: {},
    redactSensitiveText: redact,
    oracleChat: async () => ({
      answer: "当前使用人数较多，已切换备用回答。",
      safety: { provider: "deepseek", resolvedProvider: "deepseek", externalProviderUsed: true },
      metrics: { intentName: "project_qa" },
    }),
    callbacks: {
      onStatus: (status) => statuses.push(status.text),
    },
  });
  assert.strictEqual(hunyuanCalls, 2, "concurrent limit should retry once");
  assert(response.answer.includes("备用回答"));
  assert(statuses.some((item) => /使用人数较多|备用回答/.test(item)), "user-friendly busy status should be emitted");
}

async function testExpiredAndLowBaseLibDisableHunyuan() {
  reset(futureConfig({ CLOUDBASE_AI_PROMO_EXPIRES_AT: "2020-01-01T00:00:00+08:00" }));
  let oracleCalled = 0;
  const expired = await aiTransportRouter.chat({
    message: "FosuClass 是什么？",
    context: {},
    redactSensitiveText: redact,
    oracleChat: async () => {
      oracleCalled += 1;
      return { answer: "已回退 Oracle", safety: { provider: "mock", resolvedProvider: "mock" }, metrics: {} };
    },
  });
  assert.strictEqual(oracleCalled, 1);
  assert.strictEqual(expired.safety.hunyuanFallbackReason, "CLOUDBASE_AI_PROMO_EXPIRED");

  reset();
  cloudbaseHunyuanService.__setTestOverrides({
    config: futureConfig(),
    sdkVersion: "3.8.0",
    envVersion: "develop",
  });
  oracleCalled = 0;
  const lowBase = await aiTransportRouter.chat({
    message: "这个项目安全吗？",
    context: {},
    redactSensitiveText: redact,
    oracleChat: async () => {
      oracleCalled += 1;
      return { answer: "低基础库已回退", safety: { provider: "mock", resolvedProvider: "mock" }, metrics: {} };
    },
  });
  assert.strictEqual(oracleCalled, 1);
  assert.strictEqual(lowBase.safety.hunyuanFallbackReason, "WX_BASELIB_TOO_LOW");
}

async function testModelOutputCannotInjectAction() {
  reset();
  installHunyuanStream(async () => streamFromChunks([
    '{"answer":"点这里","cards":[{"actions":[{"type":"navigate","url":"javascript:alert(1)"}]}]} https://evil.example/path',
  ]));
  const response = await aiTransportRouter.chat({
    message: "你能介绍功能吗？",
    context: {},
    redactSensitiveText: redact,
    oracleChat: async () => {
      throw new Error("oracle should not run");
    },
  });
  const text = JSON.stringify(response);
  assert(!text.includes("javascript:"), "dangerous protocol should be removed");
  assert(!text.includes("evil.example"), "arbitrary URL should be removed");
  assert(response.cards.every((card) => !Array.isArray(card.actions) || card.actions.length === 0), "model must not create actions");
}

async function testSensitiveCredentialNotSentToModel() {
  reset();
  let hunyuanCalled = 0;
  installHunyuanStream(async () => {
    hunyuanCalled += 1;
    return streamFromChunks(["不应调用"]);
  });
  const response = await aiTransportRouter.chat({
    message: "token: abcdefghijklmnop 这个小程序怎么用？",
    context: {},
    redactSensitiveText: redact,
    oracleChat: async () => {
      throw new Error("oracle should not receive sensitive raw text");
    },
  });
  assert.strictEqual(hunyuanCalled, 0);
  assert(response.answer.includes("敏感信息"));
}

async function testSingleflightAvoidsDuplicateTokenCost() {
  reset();
  let hunyuanCalls = 0;
  installHunyuanStream(async () => {
    hunyuanCalls += 1;
    return streamFromChunks(["单飞结果"], 5);
  });
  const input = {
    message: "FosuClass 是什么？",
    context: { term: "2025-2026-2" },
    history: [],
  };
  const [left, right] = await Promise.all([
    cloudbaseHunyuanService.generate(input),
    cloudbaseHunyuanService.generate(input),
  ]);
  assert.strictEqual(hunyuanCalls, 1);
  assert.strictEqual(left.text, right.text);
}

async function testStreamTimeoutFallsBackAndCountsOnce() {
  reset(futureConfig({
    AI_HUNYUAN_TOTAL_TIMEOUT_MS: 25,
    AI_MAX_DAILY_GENERATIVE_REQUESTS: 20,
  }));
  let oracleCalled = 0;
  installHunyuanStream(async () => ({
    textStream: (async function* generator() {
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield "late";
    })(),
    usage: { totalTokens: 99 },
  }));
  const response = await aiTransportRouter.chat({
    message: "FosuClass 鏄粈涔堬紵",
    context: { term: "2025-2026-2" },
    redactSensitiveText: redact,
    oracleChat: async () => {
      oracleCalled += 1;
      return {
        answer: "Oracle fallback after timeout",
        safety: { provider: "deepseek", resolvedProvider: "deepseek", externalProviderUsed: true },
        metrics: { totalTokens: 3, intentName: "project_qa" },
      };
    },
  });
  const counter = mockEnv.storage.get(cloudbaseHunyuanService.DAILY_LIMIT_KEY);
  assert.strictEqual(oracleCalled, 1);
  assert.strictEqual(response.safety.hunyuanFallbackReason, "CLOUDBASE_AI_FIRST_TOKEN_TIMEOUT");
  assert.strictEqual(counter.count, 1, "timed-out Hunyuan request should count daily quota once");
}

function testConfigHasNoSecrets() {
  const configText = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "config", "cloudbase.js"), "utf8");
  assert(!/SecretId|SecretKey|API[_-]?KEY\s*=|Token\s*=\s*["'][A-Za-z0-9._~+/=-]{8,}/i.test(configText), "cloudbase config must not contain secrets");
}

async function run() {
  await testDeterministicDoesNotCallHunyuan();
  await testReleaseGateBlocksCompetitionMode();
  await testReleaseGateKeepsToolOnlyQueriesAvailable();
  await testTrialCompetitionAllowsHunyuan();
  await testDevelopCompetitionAllowsHunyuan();
  await testReleasePublicEnabledAllowsHunyuan();
  await testProjectQaCallsHunyuan();
  await testHunyuanUnavailableFallsBackOracle();
  await testOracleUnavailableFriendlyFallback();
  await testConcurrentLimitFallsBackAfterOneRetry();
  await testExpiredAndLowBaseLibDisableHunyuan();
  await testModelOutputCannotInjectAction();
  await testSensitiveCredentialNotSentToModel();
  await testSingleflightAvoidsDuplicateTokenCost();
  await testStreamTimeoutFallsBackAndCountsOnce();
  testConfigHasNoSecrets();
  Object.assign(cloudbaseConfig, originalCloudbaseConfig);
  cloudbaseHunyuanService.__resetForTest();
  console.log("test-cloudbase-ai-router passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
