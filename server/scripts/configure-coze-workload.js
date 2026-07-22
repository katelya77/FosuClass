#!/usr/bin/env node
const providerConfigService = require("../src/services/ai/providerConfigService");
const cozeProvider = require("../src/services/ai/providers/cozeProvider");

function maskId(value) {
  const text = String(value || "");
  return text ? `****${text.slice(-4)}` : "";
}

function readWorkloadConfig(env = process.env) {
  const apiKey = String(env.COZE_API_KEY || "").trim();
  const endpoint = String(env.COZE_WORKLOAD_ENDPOINT || "").trim().replace(/\/+$/, "");
  const projectId = String(env.COZE_PROJECT_ID || "").trim();
  if (!apiKey) throw new Error("COZE_API_KEY is required");
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch (error) {
    throw new Error("COZE_WORKLOAD_ENDPOINT is invalid");
  }
  if (parsed.protocol !== "https:"
    || !parsed.hostname.endsWith(".coze.site")
    || parsed.pathname !== "/stream_run"
    || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("COZE_WORKLOAD_ENDPOINT must be an official https://*.coze.site/stream_run endpoint");
  }
  if (!/^\d{10,30}$/.test(projectId)) throw new Error("COZE_PROJECT_ID is invalid");
  return {
    apiKey,
    apiMode: "workload",
    endpoint,
    projectId,
  };
}

async function configureCozeWorkload(options = {}) {
  const env = options.env || process.env;
  const configService = options.configService || providerConfigService;
  const provider = options.provider || cozeProvider;
  const config = readWorkloadConfig(env);
  ["dev", "trial"].forEach((environment) => {
    configService.saveConfig({
      environment,
      activeEnvironment: environment,
      enabled: true,
      provider: "coze",
      providerPolicy: "auto",
      providerChain: "coze,deepseek,mock",
      runtimeMode: "competition",
      cozeEnabled: true,
      cozeApiMode: "workload",
      cozeWorkloadEndpoint: config.endpoint,
      cozeProjectId: config.projectId,
      cozeApiKey: config.apiKey,
      mirrorEnvironments: [],
    });
  });
  const summary = {
    success: true,
    configuredEnvironments: ["trial", "dev"],
    activeEnvironment: "trial",
    apiMode: "workload",
    endpointHost: new URL(config.endpoint).hostname,
    projectIdMasked: maskId(config.projectId),
    verified: false,
  };
  if (options.verify !== true) return summary;
  const diagnostic = await provider.testConnection({
    principal: { principalKey: "deploy-coze-workload-diagnostic", runtimeMode: "trial", deployEnv: "production" },
    providerRuntimeConfig: configService.getRuntimeConfigForEnvironment("trial"),
  });
  Object.assign(summary, {
    success: diagnostic.success === true,
    verified: diagnostic.success === true,
    code: diagnostic.code || "COZE_CONNECTION_FAILED",
    latencyMs: Number(diagnostic.latencyMs || 0),
    projectIdMasked: diagnostic.projectIdMasked || summary.projectIdMasked,
  });
  if (!summary.success) {
    const error = new Error(diagnostic.message || "Coze workload verification failed");
    error.code = diagnostic.code || "COZE_CONNECTION_FAILED";
    throw error;
  }
  return summary;
}

if (require.main === module) {
  configureCozeWorkload({ verify: process.argv.includes("--verify") })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ success: false, code: error.code || "COZE_WORKLOAD_CONFIG_FAILED", message: String(error.message || "configuration failed").slice(0, 180) })}\n`);
      process.exit(1);
    });
}

module.exports = {
  configureCozeWorkload,
  readWorkloadConfig,
};
