#!/usr/bin/env node
/**
 * Provider 链路诊断（脱敏）：打印 trial/dev 解析结果与一次真实上游调用的成败细节。
 * 只输出模型名/Base URL host/键存在性/上游错误码，绝不输出任何密钥或完整 URL 凭据。
 */
const axios = require("axios");
const providerConfigService = require("../src/services/ai/providerConfigService");

function hostOf(url) {
  try {
    return new URL(String(url || "")).hostname || "";
  } catch (error) {
    return "(invalid-url)";
  }
}

function summarizeEnvironment(environment) {
  const rc = providerConfigService.getRuntimeConfigForEnvironment(environment);
  const status = providerConfigService.getStatus(environment);
  const profile = status.environmentProfiles && status.environmentProfiles[environment] || {};
  return {
    environment,
    provider: rc.AI_PROVIDER,
    chain: rc.AI_PROVIDER_CHAIN || profile.providerChain || "",
    stageProviders: {
      understanding: profile.understandingProvider || "(follow-primary)",
      planner: profile.plannerProvider || "(follow-primary)",
      response: profile.responseProvider || "(follow-primary)",
    },
    deepseek: {
      baseUrlHost: hostOf(rc.AI_BASE_URL),
      model: rc.AI_MODEL || "",
      understandingModel: rc.AI_UNDERSTANDING_MODEL || "",
      plannerModel: rc.AI_PLANNER_MODEL || "",
      hasKey: Boolean(rc.AI_API_KEY || rc.DEEPSEEK_API_KEY),
    },
    coze: {
      apiMode: rc.COZE_API_MODE,
      endpointHost: hostOf(rc.COZE_WORKLOAD_ENDPOINT),
      hasProjectId: Boolean(rc.COZE_PROJECT_ID),
      hasKey: Boolean(rc.COZE_API_KEY),
    },
    cloudbaseOpenai: {
      enabled: rc.CLOUDBASE_OPENAI_ENABLED,
      baseUrlHost: hostOf(rc.CLOUDBASE_OPENAI_BASE_URL),
      textModel: rc.CLOUDBASE_OPENAI_TEXT_MODEL || "",
      hasKey: Boolean(rc.CLOUDBASE_OPENAI_API_KEY),
    },
  };
}

async function probeDeepseekRaw(rc) {
  const apiKey = rc.AI_API_KEY || rc.DEEPSEEK_API_KEY || "";
  if (!apiKey) return { skipped: "no-key" };
  const baseUrl = String(rc.AI_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = rc.AI_PLANNER_MODEL || rc.AI_MODEL || "deepseek-chat";
  const startedAt = Date.now();
  try {
    const response = await axios.post(`${baseUrl}/chat/completions`, {
      model,
      stream: false,
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }],
    }, {
      timeout: 12000,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    return { ok: true, model, latencyMs: Date.now() - startedAt, upstreamModel: response.data && response.data.model || "" };
  } catch (error) {
    const status = error && error.response && error.response.status;
    const upstream = error && error.response && error.response.data;
    return {
      ok: false,
      model,
      latencyMs: Date.now() - startedAt,
      httpStatus: status || 0,
      upstreamCode: upstream && upstream.error && upstream.error.code || "",
      upstreamMessage: String((upstream && upstream.error && upstream.error.message) || error.message || "").slice(0, 200),
    };
  }
}

async function main() {
  const environments = process.argv.includes("--env")
    ? [process.argv[process.argv.indexOf("--env") + 1]]
    : ["trial", "dev"];
  for (const environment of environments) {
    const summary = summarizeEnvironment(environment);
    console.log(JSON.stringify({ type: "summary", ...summary }));
    if (process.argv.includes("--probe")) {
      const rc = providerConfigService.getRuntimeConfigForEnvironment(environment);
      const probe = await probeDeepseekRaw(rc);
      console.log(JSON.stringify({ type: "deepseek-raw-probe", environment, ...probe }));
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ type: "diagnose-failed", message: String(error.message || error).slice(0, 200) }));
  process.exit(1);
});
