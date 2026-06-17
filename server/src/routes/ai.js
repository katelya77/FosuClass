const express = require("express");
const { scheduleLimiter } = require("../utils/rateLimit");
const { optionalSessionGuard, publicFosuGuard, validateJsonBody } = require("../utils/apiSecurity");
const { safeLog } = require("../utils/safeLogger");
const agentService = require("../services/ai/agentService");
const campusMapService = require("../services/ai/campusMapService");
const { buildSafeLogPayload } = require("../services/ai/safetyGuard");

const router = express.Router();

router.use(publicFosuGuard);

router.get("/campus-map/published", scheduleLimiter, (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  try {
    return res.json({
      success: true,
      data: campusMapService.getPublishedMapDocument(),
    });
  } catch (error) {
    safeLog("ai-campus-map-published-failed", { error: error.message, code: error.code || "" });
    return res.status(200).json({
      success: false,
      code: "CAMPUS_MAP_PUBLISHED_UNAVAILABLE",
      message: "校园地图数据暂时不可用。",
    });
  }
});

router.post("/agent/chat", scheduleLimiter, optionalSessionGuard, validateJsonBody(["message", "context", "protocolVersion", "requestId", "conversationId"]), async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const message = String(req.body && req.body.message || "").trim();
  if (!message) {
    return res.status(400).json({
      success: false,
      code: "MESSAGE_REQUIRED",
      message: "请输入要咨询的问题。",
      serverTime: new Date().toISOString(),
    });
  }

  try {
    const payload = await agentService.chat({
      message,
      context: req.body.context || {},
      protocolVersion: req.body.protocolVersion,
      requestId: req.body.requestId,
      conversationId: req.body.conversationId,
      serverSession: req.fosuSession ? {
        openidHash: req.fosuSession.openidHash || "",
        sessionIdHash: req.fosuSession.sessionIdHash || "",
      } : null,
    });
    safeLog("ai-agent-chat", {
      metrics: payload.metrics || {},
      provider: payload.safety && payload.safety.provider,
      toolCalls: payload.toolCalls,
    });
    return res.json(payload);
  } catch (error) {
    safeLog("ai-agent-chat-failed", buildSafeLogPayload({
      provider: "mock",
      toolCalls: [{ name: "agentService", status: "failed", summary: error.message }],
    }));
    const fallbackMetrics = {
      latencyMs: 0,
      intentName: "agentServiceFallback",
      toolCallCount: 1,
      externalProviderUsed: false,
      fallback: true,
      itemCount: 0,
      usedPersonalContext: false,
    };
    return res.status(200).json({
      success: true,
      answer: "AI 校园管家暂时不可用，已进入规则降级模式。你可以先使用全校查询、空教室或个人课表导入页面完成操作。",
      cards: [{
        type: "generic",
        title: "已降级到规则模式",
        subtitle: "没有调用外部模型，核心入口仍可使用。",
        badges: ["mock fallback", "仅供参考"],
        items: [],
        actions: [
          { label: "打开全校查询", type: "navigate", url: "/pages/school/school", payload: {} },
          { label: "打开空教室", type: "navigate", url: "/pages/empty-room/empty-room", payload: {} },
        ],
      }],
      toolCalls: [{ name: "agentService", status: "failed", summary: "fallback mock response" }],
      suggestions: ["现在有空教室吗？", "怎么导入个人课表？"],
      safety: {
        redacted: true,
        usedPersonalContext: false,
        provider: "mock",
        desiredProvider: process.env.AI_PROVIDER || "mock",
        resolvedProvider: "mock",
        mode: "tool-grounded",
        providerPolicy: process.env.AI_PROVIDER_POLICY || "auto",
        externalProviderUsed: false,
        providerDecisionReason: "agentService fallback",
        fallbackReason: "agentService fallback",
      },
      metrics: fallbackMetrics,
      serverTime: new Date().toISOString(),
    });
  }
});

module.exports = router;
