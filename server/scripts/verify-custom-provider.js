#!/usr/bin/env node
/**
 * 自定义 Provider（custom-openai）真实链路验证脚本（在 VPS 容器内运行）：
 * 1) 用 DEEPSEEK_API_KEY 注册一条 OpenAI 兼容自定义条目（api.deepseek.com 是 OpenAI 协议）；
 * 2) 真实调用 fetchModelList（GET /models）验证"获取模型列表"能力；
 * 3) 将 trial 环境全部阶段切到 custom-openai，做一次真实 agentService.chat；
 * 4) probeProvider 探测并确认熔断/指标记录；
 * 5) finally 恢复 trial 原配置，清理熔断。
 * 输出仅含脱敏摘要，绝不打印密钥。
 */
const providerConfigService = require("../src/services/ai/providerConfigService");
const providerChainService = require("../src/services/ai/providerChainService");
const customProviderStore = require("../src/services/ai/customProviderStore");

function sanitize(text) {
  return String(text || "").replace(/[A-Za-z0-9_-]{24,}/g, "***").slice(0, 200);
}

async function main() {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required");
  const summary = { success: false, steps: {} };

  const statusBefore = providerConfigService.getStatus();
  const trialBefore = Object.assign({}, (statusBefore.environmentProfiles || {}).trial || {});
  const activeBefore = statusBefore.activeEnvironment || "trial";

  try {
    // 1) 注册自定义条目（OpenAI 协议，DeepSeek 端点）
    const saved = providerConfigService.saveCustomProvider({
      entry: {
        label: "DeepSeek 兼容端点（e2e）",
        protocol: "openai",
        baseUrl: "https://api.deepseek.com",
        apiKey,
        model: "deepseek-chat",
        enabled: true,
        strictJsonMode: true,
      },
      setActive: true,
    });
    const entries = (saved.customProviders || []).map((item) => ({
      id: item.id, label: item.label, protocol: item.protocol, usable: item.usable, hasKey: item.apiKeyConfigured === true,
    }));
    summary.steps.saved = { count: entries.length, entries, activeCustomId: saved.activeCustomId || "" };
    const entryId = saved.activeCustomId || (entries[0] && entries[0].id) || "";

    // 2) 真实 GET /models
    try {
      const fetched = await customProviderStore.fetchModelList({
        protocol: "openai",
        baseUrl: "https://api.deepseek.com",
        apiKey,
        timeoutMs: 10000,
      });
      const models = Array.isArray(fetched.models) ? fetched.models : [];
      summary.steps.fetchModels = {
        success: true,
        count: models.length,
        hasDeepseekChat: models.includes("deepseek-chat"),
        sample: models.slice(0, 5),
      };
    } catch (error) {
      summary.steps.fetchModels = { success: false, code: error.code || "FETCH_MODELS_FAILED", message: sanitize(error.message) };
    }

    // 3) trial 全阶段切到 custom-openai
    providerConfigService.saveConfig(Object.assign({}, trialBefore, {
      environment: "trial",
      activeEnvironment: "trial",
      provider: "custom-openai",
      understandingProvider: "custom-openai",
      plannerProvider: "custom-openai",
      responseProvider: "custom-openai",
      mirrorEnvironments: [],
    }));

    const agentService = require("../src/services/ai/agentService");
    const startedAt = Date.now();
    const payload = await agentService.chat({
      message: "你是什么模型",
      context: {
        currentPage: "custom-provider-e2e",
        timezone: "Asia/Shanghai",
        envVersion: "trial",
        currentScheduleSummary: { enabled: false, targetType: "", targetName: "", courses: [] },
      },
      serverSession: { adminProviderVerification: true },
    });
    const safety = payload.safety || {};
    summary.steps.chat = {
      status: payload.status || "completed",
      externalProviderUsed: safety.externalProviderUsed === true,
      provider: safety.provider || "",
      resolvedProvider: safety.resolvedProvider || "",
      fallbackReason: safety.fallbackReason || "",
      latencyMs: (payload.metrics && payload.metrics.latencyMs) || Date.now() - startedAt,
      answerSnippet: String(payload.answer || "").slice(0, 60),
    };

    // 4) 探测（写入与真实调用同一套指标）
    try {
      const probe = await providerChainService.probeProvider("custom-openai", {
        runtimeMode: "competition",
        providerRuntimeConfig: providerConfigService.getRuntimeConfigForEnvironment("trial"),
        timeoutMs: 8000,
      });
      summary.steps.probe = {
        success: probe.success === true,
        code: probe.code || "",
        latencyMs: probe.latencyMs || 0,
        verified: providerChainService.isProviderVerified("custom-openai"),
      };
    } catch (error) {
      summary.steps.probe = { success: false, code: error.code || "PROBE_FAILED", message: sanitize(error.message) };
    }

    summary.entryId = entryId;
    summary.success = Boolean(
      summary.steps.saved.count >= 1
      && summary.steps.fetchModels.success
      && summary.steps.chat.externalProviderUsed
      && summary.steps.chat.resolvedProvider === "custom-openai"
      && summary.steps.probe.success
    );
  } finally {
    // 5) 恢复 trial 原配置（saveConfig 为全量写，逐字段还原）
    try {
      providerConfigService.saveConfig(Object.assign({}, trialBefore, {
        environment: "trial",
        activeEnvironment: activeBefore,
        mirrorEnvironments: [],
      }));
      summary.steps.restored = {
        provider: trialBefore.provider || "",
        understandingProvider: trialBefore.understandingProvider || "",
        plannerProvider: trialBefore.plannerProvider || "",
        responseProvider: trialBefore.responseProvider || "",
      };
    } catch (error) {
      summary.steps.restored = { error: sanitize(error.message) };
      summary.success = false;
    }
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.success) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ success: false, code: error.code || "CUSTOM_PROVIDER_E2E_FAILED", message: sanitize(error.message) })}\n`);
  process.exit(1);
});
