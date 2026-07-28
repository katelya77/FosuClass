#!/usr/bin/env node
/**
 * 一键修复 deepseek 链路：
 * 1) 把环境变量 DEEPSEEK_API_KEY（有效密钥）写入 trial/dev 配置的加密存储；
 * 2) 显式指定 理解/规划 阶段使用 deepseek（结构化 JSON 阶段必须由 JSON 能力强的
 *    原生 LLM 承担；主 Provider 如 coze 只负责表达/回复阶段）；
 * 3) --verify 时用新配置做一次真实上游调用。
 */
const axios = require("axios");
const providerConfigService = require("../src/services/ai/providerConfigService");

function maskKey(value) {
  const text = String(value || "");
  return text ? `****${text.slice(-4)}` : "";
}

function readKey(env = process.env) {
  const apiKey = String(env.DEEPSEEK_API_KEY || env.AI_API_KEY || "").trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required");
  return apiKey;
}

async function verifyDeepseek() {
  const rc = providerConfigService.getRuntimeConfigForEnvironment("trial");
  const apiKey = rc.DEEPSEEK_API_KEY || rc.AI_API_KEY || "";
  const baseUrl = String(rc.AI_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = rc.AI_PLANNER_MODEL || rc.AI_MODEL || "deepseek-chat";
  const startedAt = Date.now();
  try {
    await axios.post(`${baseUrl}/chat/completions`, {
      model,
      stream: false,
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }],
    }, {
      timeout: 15000,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    return { success: true, code: "DEEPSEEK_CONNECTION_OK", model, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const status = error && error.response && error.response.status;
    const upstream = error && error.response && error.response.data;
    return {
      success: false,
      code: status ? `DEEPSEEK_HTTP_${status}` : "DEEPSEEK_CONNECTION_FAILED",
      model,
      latencyMs: Date.now() - startedAt,
      upstreamMessage: String((upstream && upstream.error && upstream.error.message) || error.message || "").replace(/[A-Za-z0-9_-]{24,}/g, "***").slice(0, 160),
    };
  }
}

async function configureDeepseek(options = {}) {
  const env = options.env || process.env;
  const configService = options.configService || providerConfigService;
  const apiKey = readKey(env);
  ["dev", "trial"].forEach((environment) => {
    configService.saveConfig({
      environment,
      activeEnvironment: environment,
      enabled: true,
      runtimeMode: "competition",
      deepseekApiKey: apiKey,
      // 结构化阶段显式分工：理解/规划走 deepseek（JSON 模式可靠）；
      // 回复阶段留空 = 跟随主 Provider（当前 coze，可在后台随时切换）。
      understandingProvider: "deepseek",
      plannerProvider: "deepseek",
      responseProvider: "",
      mirrorEnvironments: [],
    });
  });
  const summary = {
    success: true,
    configuredEnvironments: ["trial", "dev"],
    apiKeyMasked: maskKey(apiKey),
    stageProviders: { understanding: "deepseek", planner: "deepseek", response: "(follow-primary)" },
    verified: false,
  };
  if (options.verify !== true) return summary;
  const diagnostic = await verifyDeepseek();
  Object.assign(summary, {
    success: diagnostic.success === true,
    verified: diagnostic.success === true,
    code: diagnostic.code,
    model: diagnostic.model,
    latencyMs: diagnostic.latencyMs,
    upstreamMessage: diagnostic.upstreamMessage || "",
  });
  if (!summary.success) {
    const error = new Error(`DeepSeek verification failed: ${diagnostic.code} ${diagnostic.upstreamMessage || ""}`.trim());
    error.code = diagnostic.code;
    throw error;
  }
  return summary;
}

if (require.main === module) {
  configureDeepseek({ verify: process.argv.includes("--verify") })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ success: false, code: error.code || "DEEPSEEK_CONFIG_FAILED", message: String(error.message || "configuration failed").slice(0, 200) })}\n`);
      process.exit(1);
    });
}

module.exports = {
  configureDeepseek,
};
