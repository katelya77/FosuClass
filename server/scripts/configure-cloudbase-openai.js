#!/usr/bin/env node
const axios = require("axios");
const providerConfigService = require("../src/services/ai/providerConfigService");
const cloudbaseOpenaiProvider = require("../src/services/ai/providers/cloudbaseOpenaiProvider");

const DEFAULT_BASE_URL = "https://cloud1-d3g17rpe7566d3d5c.api.tcloudbasegateway.com/v1/ai/cloudbase";
const DEFAULT_TEXT_MODEL = "hy3-preview";

function maskKey(value) {
  const text = String(value || "");
  return text ? `****${text.slice(-4)}` : "";
}

function readCloudbaseConfig(env = process.env) {
  const apiKey = String(env.CLOUDBASE_OPENAI_API_KEY || "").trim();
  const baseUrl = String(env.CLOUDBASE_OPENAI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const textModel = String(env.CLOUDBASE_OPENAI_TEXT_MODEL || DEFAULT_TEXT_MODEL).trim();
  if (!apiKey) throw new Error("CLOUDBASE_OPENAI_API_KEY is required");
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new Error("CLOUDBASE_OPENAI_BASE_URL is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("CLOUDBASE_OPENAI_BASE_URL must be a plain https URL");
  }
  if (!textModel) throw new Error("CLOUDBASE_OPENAI_TEXT_MODEL is required");
  return { apiKey, baseUrl, textModel };
}

async function verifyConnection(config) {
  const startedAt = Date.now();
  try {
    await axios.post(`${config.baseUrl}/chat/completions`, {
      model: config.textModel,
      stream: false,
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }],
    }, {
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    return { success: true, code: "CLOUDBASE_OPENAI_CONNECTION_OK", latencyMs: Date.now() - startedAt };
  } catch (error) {
    const code = cloudbaseOpenaiProvider.classifyHttpError(error) || "CLOUDBASE_OPENAI_CONNECTION_FAILED";
    const status = error && error.response && error.response.status;
    return {
      success: false,
      code: status ? `${code}_HTTP_${status}` : code,
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function configureCloudbaseOpenai(options = {}) {
  const env = options.env || process.env;
  const configService = options.configService || providerConfigService;
  const config = readCloudbaseConfig(env);
  const setPrimary = options.setPrimary === true;
  ["dev", "trial"].forEach((environment) => {
    const payload = {
      environment,
      activeEnvironment: environment,
      enabled: true,
      runtimeMode: "competition",
      cloudbaseOpenaiEnabled: true,
      cloudbaseOpenaiBaseUrl: config.baseUrl,
      cloudbaseOpenaiTextModel: config.textModel,
      cloudbaseOpenaiApiKey: config.apiKey,
      mirrorEnvironments: [],
    };
    if (setPrimary) {
      Object.assign(payload, {
        provider: "cloudbase-openai",
        providerPolicy: "auto",
        providerChain: "cloudbase-openai,deepseek,mock",
      });
    }
    configService.saveConfig(payload);
  });
  const summary = {
    success: true,
    configuredEnvironments: ["trial", "dev"],
    activeEnvironment: "trial",
    setPrimary,
    baseUrlHost: new URL(config.baseUrl).hostname,
    textModel: config.textModel,
    apiKeyMasked: maskKey(config.apiKey),
    verified: false,
  };
  if (options.verify !== true) return summary;
  const diagnostic = await verifyConnection(config);
  Object.assign(summary, {
    success: diagnostic.success === true,
    verified: diagnostic.success === true,
    code: diagnostic.code,
    latencyMs: diagnostic.latencyMs,
  });
  if (!summary.success) {
    const error = new Error(`CloudBase OpenAI verification failed: ${diagnostic.code}`);
    error.code = diagnostic.code;
    throw error;
  }
  return summary;
}

if (require.main === module) {
  configureCloudbaseOpenai({
    verify: process.argv.includes("--verify"),
    setPrimary: process.argv.includes("--primary"),
  })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ success: false, code: error.code || "CLOUDBASE_OPENAI_CONFIG_FAILED", message: String(error.message || "configuration failed").slice(0, 180) })}\n`);
      process.exit(1);
    });
}

module.exports = {
  configureCloudbaseOpenai,
  readCloudbaseConfig,
};
