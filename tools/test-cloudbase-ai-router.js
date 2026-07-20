const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const aiTransportRouter = require("../miniprogram/services/aiTransportRouter");
const cloudbaseHunyuanService = require("../miniprogram/services/cloudbaseHunyuanService");
const cloudbaseConfig = require("../miniprogram/config/cloudbase");

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
  }, extra);
}

function setEnvVersion(envVersion) {
  global.wx.getAccountInfoSync = () => ({ miniProgram: { envVersion } });
}

function installHunyuanProbe(onCall) {
  global.wx.cloud = {
    extend: {
      AI: {
        createModel: () => ({
          streamText: async () => {
            onCall();
            return {
              textStream: (async function* stream() { yield "unexpected"; })(),
              usage: { totalTokens: 1 },
            };
          },
        }),
      },
    },
  };
}

function reset(envVersion, extraConfig = {}) {
  mockEnv.clearStorage();
  const config = futureConfig(extraConfig);
  Object.assign(cloudbaseConfig, originalCloudbaseConfig, config);
  setEnvVersion(envVersion);
  cloudbaseHunyuanService.__setTestOverrides({
    config,
    sdkVersion: "3.15.1",
    envVersion,
  });
  delete global.wx.cloud;
}

async function assertServerFirstInEnvironment(envVersion) {
  reset(envVersion);
  let hunyuanCalls = 0;
  let serverCalls = 0;
  installHunyuanProbe(() => { hunyuanCalls += 1; });

  assert.strictEqual(
    aiTransportRouter.shouldDisableGenerativeInClient(),
    true,
    `${envVersion} must disable the client generative decision path`
  );

  const response = await aiTransportRouter.chat({
    message: "What is FosuClass?",
    context: { term: "2025-2026-2", releaseVersion: "release-v1" },
    protocolVersion: "agent.v2",
    requestId: `req-${envVersion}`,
    conversationId: `conversation-${envVersion}`,
    oracleChat: async (message, context, metadata) => {
      serverCalls += 1;
      assert.strictEqual(message, "What is FosuClass?");
      assert.strictEqual(context.term, "2025-2026-2");
      assert.deepStrictEqual(metadata, {
        protocolVersion: "agent.v2",
        requestId: `req-${envVersion}`,
        conversationId: `conversation-${envVersion}`,
      });
      return {
        protocolVersion: "agent.v2",
        status: "completed",
        answer: `server kernel: ${envVersion}`,
        safety: { externalProviderUsed: envVersion !== "release" },
      };
    },
  });

  assert.strictEqual(serverCalls, 1, `${envVersion} must call the server Agent Kernel once`);
  assert.strictEqual(hunyuanCalls, 0, `${envVersion} must not call client Hunyuan`);
  assert.strictEqual(response.answer, `server kernel: ${envVersion}`);
}

async function testAllEnvironmentsUseServerKernel() {
  await assertServerFirstInEnvironment("release");
  await assertServerFirstInEnvironment("trial");
  await assertServerFirstInEnvironment("develop");
}

async function testSensitiveCredentialStopsBeforeNetwork() {
  reset("develop");
  let hunyuanCalls = 0;
  let serverCalls = 0;
  installHunyuanProbe(() => { hunyuanCalls += 1; });

  const response = await aiTransportRouter.chat({
    message: "token: abcdefghijklmnop how do I import my schedule?",
    context: { term: "2025-2026-2" },
    redactSensitiveText: (text) => String(text).replace(/token:\s*\S+/i, "token: [REDACTED]"),
    oracleChat: async () => {
      serverCalls += 1;
      throw new Error("sensitive text must stop before the server boundary");
    },
  });

  assert.strictEqual(serverCalls, 0);
  assert.strictEqual(hunyuanCalls, 0);
  assert.strictEqual(response.fallback, true);
  assert.strictEqual(response.fallbackLayer, "client");
  assert.strictEqual(response.externalProviderUsed, false);
  assert.strictEqual(response.fallbackReason, "SENSITIVE_CREDENTIAL_REDACTED");
}

async function testServerFailureIsLeftForAssistantFallbackPolicy() {
  reset("trial");
  const failure = new Error("server unavailable");
  failure.code = "NETWORK_ERROR";

  await assert.rejects(
    () => aiTransportRouter.chat({
      message: "What classes do I have today?",
      context: {},
      oracleChat: async () => { throw failure; },
    }),
    (error) => error === failure
  );
}

function testConfigHasNoSecrets() {
  const configText = fs.readFileSync(
    path.join(__dirname, "..", "miniprogram", "config", "cloudbase.js"),
    "utf8"
  );
  assert(
    !/SecretId|SecretKey|API[_-]?KEY\s*=|Token\s*=\s*["'][A-Za-z0-9._~+/=-]{8,}/i.test(configText),
    "cloudbase config must not contain secrets"
  );
}

async function run() {
  await testAllEnvironmentsUseServerKernel();
  await testSensitiveCredentialStopsBeforeNetwork();
  await testServerFailureIsLeftForAssistantFallbackPolicy();
  testConfigHasNoSecrets();
  Object.assign(cloudbaseConfig, originalCloudbaseConfig);
  cloudbaseHunyuanService.__resetForTest();
  console.log("test-cloudbase-ai-router passed (server-first in release/trial/develop)");
}

run().catch((error) => {
  Object.assign(cloudbaseConfig, originalCloudbaseConfig);
  cloudbaseHunyuanService.__resetForTest();
  console.error(error);
  process.exit(1);
});
