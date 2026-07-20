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

const router = express.Router();

router.get("/ai-provider/readiness-matrix", adminAuth.verifyAdminAccess, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    success: true,
    data: providerReadinessService.getAdminMatrix(),
  });
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
