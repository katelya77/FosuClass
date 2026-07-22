/**
 * AI Provider admin diagnostics (phase-3 readiness matrix + enhanced diagnose).
 * Kept outside admin.js to respect the architecture line-count ceiling.
 */
const express = require("express");
const adminAuth = require("../../services/adminAuth");
const { safeLog } = require("../../utils/safeLogger");
const agentService = require("../../services/ai/agentService");
const providerReadinessService = require("../../services/ai/providerReadinessService");
const agentReadinessService = require("../../services/ai/agentReadinessService");
const providerConfigService = require("../../services/ai/providerConfigService");
const cozeProvider = require("../../services/ai/providers/cozeProvider");

const router = express.Router();

function isAllowedCozeBaseUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (process.env.NODE_ENV === "test" && parsed.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(parsed.hostname)) return true;
    return parsed.protocol === "https:"
      && ["api.coze.cn", "api.coze.com"].includes(parsed.hostname)
      && !parsed.username && !parsed.password;
  } catch (error) {
    return false;
  }
}

router.get("/ai-provider/readiness-matrix", adminAuth.verifyAdminAccess, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    success: true,
    data: providerReadinessService.getAdminMatrix(),
  });
});

router.post("/ai-provider/test-coze", adminAuth.verifyAdminAccess, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const environment = providerConfigService.normalizeEnvironment(req.body && req.body.environment || "trial");
  if (environment === "public") {
    return res.status(400).json({
      success: false,
      code: "COZE_TEST_PUBLIC_FORBIDDEN",
      message: "正式版禁止调用外部 Provider；请在 trial/dev 配置中测试。",
    });
  }
  try {
    const runtime = providerConfigService.getRuntimeConfigForEnvironment(environment);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim().slice(0, 4096) : "";
    const botId = typeof body.botId === "string" ? body.botId.trim().slice(0, 120) : "";
    const requestedBaseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim()
      ? body.baseUrl.trim().replace(/\/+$/, "")
      : String(runtime.COZE_API_BASE_URL || "https://api.coze.cn").replace(/\/+$/, "");
    if (!isAllowedCozeBaseUrl(requestedBaseUrl)) {
      return res.status(400).json({
        success: false,
        code: "COZE_BASE_URL_NOT_ALLOWED",
        message: "仅允许 Coze 官方 API 域名。",
      });
    }
    const diagnostic = await cozeProvider.testConnection({
      principal: { principalKey: "admin-coze-diagnostic", runtimeMode: environment, deployEnv: environment },
      providerRuntimeConfig: Object.assign({}, runtime, {
        COZE_ENABLED: "true",
        COZE_API_BASE_URL: requestedBaseUrl,
        COZE_API_KEY: apiKey || runtime.COZE_API_KEY || "",
        COZE_BOT_ID: botId || runtime.COZE_BOT_ID || runtime.COZE_AGENT_ID || "",
        COZE_CHAT_ENDPOINT: "/v3/chat",
      }),
    });
    return res.json({ success: true, data: diagnostic });
  } catch (error) {
    safeLog("coze-connection-diagnostic-failed", { code: String(error && error.code || "COZE_CONNECTION_FAILED").slice(0, 80) });
    return res.status(200).json({
      success: true,
      data: Object.assign({ success: false }, cozeProvider.classifyConnectionError(error)),
    });
  }
});

router.post("/ai-provider/diagnose-enhanced", adminAuth.verifyAdminAccess, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const startedAt = Date.now();
  try {
    const matrix = providerReadinessService.getAdminMatrix();
    const active = matrix.activeEnvironment || "public";
    const envSnapshot = matrix.environments[active] || providerReadinessService.evaluateEnvironment(active);
    const clientEnvVersion = String(req.body && req.body.envVersion || "trial");
    const readiness = agentReadinessService.resolveRequestReadiness({
      context: { envVersion: clientEnvVersion },
      serverSession: { adminProviderVerification: true, openidHash: "admin-diagnose" },
    });
    let probe = null;
    if (active !== "public" && envSnapshot.agentEnabled) {
      const payload = await agentService.chat({
        message: "请用一句话回复“小佛增强能力连接成功”。",
        context: {
          currentPage: "admin-ai-provider-diagnose",
          timezone: "Asia/Shanghai",
          envVersion: clientEnvVersion,
          currentScheduleSummary: { enabled: false, targetType: "", targetName: "", courses: [] },
        },
        serverSession: { adminProviderVerification: true },
      });
      probe = {
        provider: payload.safety && payload.safety.provider || "mock",
        resolvedProvider: payload.safety && payload.safety.resolvedProvider || "",
        externalProviderUsed: payload.safety && payload.safety.externalProviderUsed === true,
        fallbackReason: payload.safety && payload.safety.fallbackReason || "",
        providerDecisionReason: payload.safety && payload.safety.providerDecisionReason || "",
        latencyMs: payload.metrics && payload.metrics.latencyMs || 0,
        answerSnippet: String(payload.answer || "").slice(0, 80),
        writesConversation: false,
      };
    }
    const suggestions = [];
    if (envSnapshot.reasonCode === "SERVER_RUNTIME_PUBLIC" || active === "public") {
      suggestions.push("当前活动环境是 public：正式版永不调用生成式 Provider。请切换 trial/dev 活动环境后再测。");
    }
    if (envSnapshot.reasonCode === "AGENT_DISABLED") {
      suggestions.push("打开 AI_AGENT_ENABLED=true（仅 trial/dev Profile）。");
    }
    if (envSnapshot.reasonCode === "PROVIDER_MOCK") {
      suggestions.push("将 AI_PROVIDER 设为 deepseek/coze/cloudbase-openai，并配置 Key。");
    }
    if (envSnapshot.reasonCode === "PROVIDER_KEY_MISSING") {
      suggestions.push("补全 Provider API Key，并确认加密配置可读。");
    }
    if (envSnapshot.reasonCode === "PROVIDER_EXPIRED") {
      suggestions.push("Coze 临时 Provider 已到期，请续期或从 Provider Chain 移除。");
    }
    if (readiness.reasonCode === "ENHANCED_SESSION_NOT_AUTHORIZED") {
      suggestions.push("配置 AI_COMPETITION_OPENID_HASH_PREFIXES 或关闭 AI_ENHANCED_REQUIRE_SESSION（仅开发）。");
    }
    if (readiness.reasonCode === "TRIAL_ENV_NOT_ALLOWED") {
      suggestions.push("确认小程序 envVersion 为 develop/trial，并设置 AI_COMPETITION_ALLOW_TRIAL_ENV=true。");
    }

    return res.json({
      success: true,
      data: {
        checkedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        matrix,
        activeEnvironment: active,
        environmentSnapshot: envSnapshot,
        readiness,
        probe,
        suggestions,
      },
    });
  } catch (error) {
    safeLog("ai-provider-diagnose-failed", { error: error.message, code: error.code || "" });
    return res.status(200).json({
      success: false,
      code: error.code || "DIAGNOSE_FAILED",
      message: "增强能力诊断失败。",
    });
  }
});

module.exports = router;
