const express = require("express");
const { scheduleLimiter } = require("../utils/rateLimit");
const { optionalSessionGuard, publicFosuGuard, validateJsonBody } = require("../utils/apiSecurity");
const { safeLog } = require("../utils/safeLogger");
const agentService = require("../services/ai/agentService");
const campusMapService = require("../services/ai/campusMapService");
const weatherService = require("../services/ai/weatherService");
const { buildSafeLogPayload } = require("../services/ai/safetyGuard");

const router = express.Router();

router.use(publicFosuGuard);

router.get("/campus-map/published", scheduleLimiter, (req, res) => {
  try {
    const data = campusMapService.getPublishedMapDocument();
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    if (data.etag) res.setHeader("ETag", data.etag);
    if (data.hash) res.setHeader("X-Fosu-Campus-Map-Hash", data.hash);
    if (data.version) res.setHeader("X-Fosu-Campus-Map-Version", data.version);
    const ifNoneMatch = String(req.headers["if-none-match"] || "");
    const acceptedEtags = data.etag ? [data.etag, `W/${data.etag}`] : [];
    if (acceptedEtags.length && ifNoneMatch.split(",").map((item) => item.trim()).some((item) => acceptedEtags.includes(item))) {
      return res.status(304).end();
    }
    return res.json({
      success: true,
      data,
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

router.get("/weather", scheduleLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const weather = await weatherService.getCampusWeather({
      campus: req.query && (req.query.campus || req.query.location),
      message: req.query && req.query.message,
      dateHint: req.query && req.query.dateHint,
      topic: req.query && req.query.topic,
    });
    return res.json({
      success: true,
      weather,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    safeLog("ai-weather-failed", { error: error.message, code: error.code || "" });
    return res.json({
      success: true,
      weather: {
        success: false,
        code: error.code || "WEATHER_PROVIDER_FAILED",
        campus: String(req.query && req.query.campus || "仙溪校区").slice(0, 40),
        sourceId: "weather-provider",
        summary: "当前天气数据源暂不可用。",
        alerts: [],
      },
      serverTime: new Date().toISOString(),
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
      answer: "校园服务管家暂时不可用，已进入本地规则模式。你可以先使用全校查询、空教室或个人课表导入页面完成操作。",
      cards: [{
        type: "generic",
        title: "已降级到规则模式",
        subtitle: "核心入口仍可使用。",
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
