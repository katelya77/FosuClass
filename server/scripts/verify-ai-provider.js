const path = require("path");

require("../src/config");

const agentService = require("../src/services/ai/agentService");
const aiProviderConfigService = require("../src/services/ai/providerConfigService");

function args() {
  const result = {};
  process.argv.slice(2).forEach((item) => {
    const match = String(item).match(/^--([^=]+)(?:=(.*))?$/);
    if (match) result[match[1]] = match[2] === undefined ? true : match[2];
  });
  return result;
}

function summarizeStatus(status) {
  return {
    provider: status.provider,
    policy: status.providerPolicy,
    model: status.model,
    baseUrl: status.baseUrl,
    enabled: status.enabled,
    keyConfigured: Boolean(status.deepseekKeyConfigured || status.cozeKeyConfigured),
    deepseekKeyConfigured: Boolean(status.deepseekKeyConfigured),
    cozeKeyConfigured: Boolean(status.cozeKeyConfigured),
    cozeBotIdConfigured: Boolean(status.cozeBotIdConfigured),
    runtimeConfigExists: Boolean(status.runtimeConfigExists),
    runtimeConfigPath: status.runtimeConfigPath ? path.relative(process.cwd(), status.runtimeConfigPath) : "",
    envPath: status.envPath ? path.relative(process.cwd(), status.envPath) : "",
  };
}

async function runProbe(message, contextPatch = {}) {
  const startedAt = Date.now();
  const response = await agentService.chat({
    message,
    context: Object.assign({
      currentPage: "verify-ai-provider",
      timezone: "Asia/Shanghai",
      currentScheduleSummary: { enabled: false, targetType: "", targetName: "", courses: [] },
    }, contextPatch),
  });
  return {
    provider: response.safety && response.safety.provider || "mock",
    desiredProvider: response.safety && response.safety.desiredProvider || "",
    resolvedProvider: response.safety && response.safety.resolvedProvider || "",
    externalProviderUsed: response.safety && response.safety.externalProviderUsed === true,
    providerPolicy: response.safety && response.safety.providerPolicy || "",
    providerDecisionReason: response.safety && response.safety.providerDecisionReason || "",
    fallbackReason: response.safety && response.safety.fallbackReason || "",
    mode: response.safety && response.safety.mode || "tool-grounded",
    elapsedMs: Date.now() - startedAt,
    toolCalls: response.toolCalls || [],
  };
}

async function run() {
  const options = args();
  const status = aiProviderConfigService.getStatus();
  const statusPayload = summarizeStatus(status);
  if (options.mode === "status" || options.statusOnly) {
    console.log(JSON.stringify(Object.assign({ success: true, statusOnly: true }, statusPayload), null, 2));
    return;
  }

  const deterministicToolTest = await runProbe("今天还有课吗？");
  const projectQaTest = await runProbe("FosuClass 是什么？小佛你了解当前项目吗？");
  const previousPolicy = process.env.AI_PROVIDER_POLICY;
  let forceProviderTest;
  try {
    process.env.AI_PROVIDER_POLICY = "always";
    forceProviderTest = await runProbe("请用项目知识解释 AI 管家架构。");
  } finally {
    if (previousPolicy === undefined) {
      delete process.env.AI_PROVIDER_POLICY;
    } else {
      process.env.AI_PROVIDER_POLICY = previousPolicy;
    }
  }

  console.log(JSON.stringify(Object.assign({
    success: true,
    statusOnly: false,
    deterministicToolTest,
    projectQaTest,
    forceProviderTest,
    fallbackMock: deterministicToolTest.provider !== "deepseek" && status.provider === "deepseek",
  }, statusPayload), null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || "VERIFY_AI_PROVIDER_FAILED",
    message: error.message,
  }, null, 2));
  process.exit(1);
});
