const express = require("express");
const { scheduleLimiter } = require("../utils/rateLimit");
const { optionalSessionGuard, publicFosuGuard, validateJsonBody, verifySessionTokenDetailed } = require("../utils/apiSecurity");
const { getSecurityMode } = require("../services/securityModeService");
const { safeLog } = require("../utils/safeLogger");
const agentService = require("../services/ai/agentService");
const campusMapService = require("../services/ai/campusMapService");
const weatherService = require("../services/ai/weatherService");
const { buildSafeLogPayload } = require("../services/ai/safetyGuard");
const capabilityManifestService = require("../services/ai/capabilityManifestService");
const runtimeModeService = require("../services/ai/runtimeModeService");
const { defaultMemoryService } = require("../services/ai/conversation/conversationMemoryService");
const agentReadinessService = require("../services/ai/agentReadinessService");
const agentRunEventService = require("../services/ai/agentRunEventService");
const agentProtocol = require("../services/ai/agentProtocol");

const router = express.Router();

router.use(publicFosuGuard);

function requireSessionGuard(req, res, next) {
  const security = getSecurityMode();
  const token = req.headers["x-fosu-session"];
  const result = verifySessionTokenDetailed(token);
  if (result.valid) {
    req.fosuSession = result.payload;
    return next();
  }
  if (security.observeOnly && !security.requireDynamicSession) {
    // Even in observe mode, memory APIs require real session ownership.
  }
  const code = result.code === "FOSU_SESSION_EXPIRED"
    ? "FOSU_SESSION_EXPIRED"
    : (token ? "FOSU_SESSION_INVALID" : "FOSU_SESSION_REQUIRED");
  return res.status(401).json({
    success: false,
    code,
    reasonCode: code,
    message: "需要有效小程序会话才能管理云端记忆。",
    serverTime: new Date().toISOString(),
  });
}

function handleMemoryError(res, error) {
  const status = Number(error && error.statusCode) || 400;
  return res.status(status).json({
    success: false,
    code: error && error.code || "MEMORY_ERROR",
    message: error && error.message || "记忆操作失败",
    serverTime: new Date().toISOString(),
  });
}

/**
 * Resolve request-scoped runtime mode for memory/run APIs.
 * Never trust client-supplied runtimeMode as authorization; use session + envVersion.
 */
function resolveRequestRuntimeDecision(req, extraContext = {}) {
  const bodyContext = req.body && req.body.context && typeof req.body.context === "object"
    ? req.body.context
    : {};
  const context = Object.assign({}, bodyContext, extraContext, {
    envVersion: extraContext.envVersion
      || req.query.envVersion
      || req.headers["x-fosu-env-version"]
      || bodyContext.envVersion
      || bodyContext.miniprogramVersion
      || "",
    miniprogramVersion: extraContext.miniprogramVersion
      || req.query.miniprogramVersion
      || bodyContext.miniprogramVersion
      || "",
  });
  return runtimeModeService.resolveRuntimeMode({
    context,
    serverSession: req.fosuSession || null,
  });
}

function resolveMemoryRuntimeMode(req) {
  return resolveRequestRuntimeDecision(req).runtimeMode;
}

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

router.get("/agent/capabilities", scheduleLimiter, optionalSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const runtimeMode = runtimeModeService.resolveConfiguredMode();
  const enhancedModeEnabled = runtimeMode !== "public"
    && String(process.env.AI_AGENT_ENABLED || "false").toLowerCase() === "true";
  return res.json(Object.assign({ success: true }, capabilityManifestService.publicCapabilityView(
    runtimeMode,
    enhancedModeEnabled
  ), {
    serverTime: new Date().toISOString(),
  }));
});

router.post("/agent/chat", scheduleLimiter, optionalSessionGuard, validateJsonBody(["message", "context", "protocolVersion", "requestId", "conversationId", "memoryMode", "cloudSyncEnabled"]), async (req, res) => {
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
    const context = Object.assign({}, req.body.context || {});
    if (req.body.memoryMode) context.memoryMode = req.body.memoryMode;
    if (req.body.cloudSyncEnabled === true) context.cloudSyncEnabled = true;
    const payload = await agentService.chat({
      message,
      context,
      protocolVersion: req.body.protocolVersion,
      requestId: req.body.requestId,
      conversationId: req.body.conversationId,
      serverSession: req.fosuSession ? {
        openidHash: req.fosuSession.openidHash || "",
        sessionIdHash: req.fosuSession.sessionIdHash || "",
        appid: req.fosuSession.appid || "",
      } : null,
    });
    safeLog("ai-agent-chat", {
      metrics: payload.metrics || {},
      provider: payload.safety && payload.safety.provider,
      toolCalls: payload.toolCalls,
      memoryMode: payload.memory && payload.memory.mode,
    });
    return res.json(payload);
  } catch (error) {
    safeLog("ai-agent-chat-failed", buildSafeLogPayload({
      provider: "mock",
      toolCalls: [{ name: "agentService", status: "failed", summary: error.message }],
    }));
    return res.status(200).json(agentService.buildServiceFailureResponse({
      message,
      context: req.body && req.body.context || {},
      protocolVersion: req.body && req.body.protocolVersion,
      requestId: req.body && req.body.requestId,
      conversationId: req.body && req.body.conversationId,
      serverSession: req.fosuSession ? {
        openidHash: req.fosuSession.openidHash || "",
        sessionIdHash: req.fosuSession.sessionIdHash || "",
        appid: req.fosuSession.appid || "",
      } : null,
    }, error));
  }
});

router.get("/agent/conversations", scheduleLimiter, requireSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultMemoryService.listConversations({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
    });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleMemoryError(res, error);
  }
});

router.get("/agent/conversations/:conversationId", scheduleLimiter, requireSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultMemoryService.getConversation({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
      conversationId: req.params.conversationId,
    });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleMemoryError(res, error);
  }
});

router.patch("/agent/conversations/:conversationId", scheduleLimiter, requireSessionGuard, validateJsonBody(["title", "memoryMode", "memoryPolicy", "expectedRevision", "deleteCloudData"]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultMemoryService.patchConversation({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
      conversationId: req.params.conversationId,
      title: req.body && req.body.title,
      memoryMode: req.body && req.body.memoryMode,
      memoryPolicy: req.body && req.body.memoryPolicy,
      expectedRevision: req.body && req.body.expectedRevision,
      deleteCloudData: req.body && req.body.deleteCloudData === true,
    });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleMemoryError(res, error);
  }
});

router.delete("/agent/conversations/:conversationId", scheduleLimiter, requireSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultMemoryService.deleteConversation({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
      conversationId: req.params.conversationId,
    });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleMemoryError(res, error);
  }
});

router.delete("/agent/memory", scheduleLimiter, requireSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultMemoryService.clearAllMemory({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
    });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleMemoryError(res, error);
  }
});

router.post("/agent/memory-policy", scheduleLimiter, requireSessionGuard, validateJsonBody(["mode", "conversationId", "clearExisting", "expectedRevision", "title"]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultMemoryService.setMemoryPolicy({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
      mode: req.body && req.body.mode,
      conversationId: req.body && req.body.conversationId,
      title: req.body && req.body.title,
      clearExisting: req.body && req.body.clearExisting === true,
      expectedRevision: req.body && req.body.expectedRevision,
    });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleMemoryError(res, error);
  }
});

router.get("/agent/readiness", scheduleLimiter, optionalSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const decision = resolveRequestRuntimeDecision(req, {
      envVersion: req.query.envVersion,
      miniprogramVersion: req.query.miniprogramVersion,
    });
    const readiness = agentReadinessService.resolveRequestReadiness({
      context: {
        envVersion: req.query.envVersion || req.headers["x-fosu-env-version"] || "",
        miniprogramVersion: req.query.miniprogramVersion || "",
      },
      serverSession: req.fosuSession || null,
      runtimeMode: decision.runtimeMode,
    });
    return res.json(Object.assign({ success: true }, readiness, {
      statusMachine: agentReadinessService.toClientStatusMachine(readiness),
      serverTime: new Date().toISOString(),
    }));
  } catch (error) {
    safeLog("ai-agent-readiness-failed", { error: error.message, code: error.code || "" });
    return res.status(200).json({
      success: true,
      network: "reachable",
      server: "ready",
      runtimeMode: "public",
      enhancedMode: "disabled",
      authorization: "allowed",
      providerConfigured: false,
      providerReachable: false,
      memoryAvailable: false,
      runEventsSupported: true,
      reasonCode: "READINESS_DEGRADED",
      statusMachine: "public_ready",
      checkedAt: new Date().toISOString(),
      serverTime: new Date().toISOString(),
    });
  }
});

router.post("/agent/runs", scheduleLimiter, optionalSessionGuard, validateJsonBody(["message", "context", "protocolVersion", "requestId", "conversationId", "memoryMode", "cloudSyncEnabled", "idempotencyKey"]), async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const message = String(req.body && req.body.message || "").trim();
  if (!message) {
    return res.status(400).json({
      success: false,
      code: "MESSAGE_REQUIRED",
      message: "请输入要咨询的问题。",
      serverTime: new Date().toISOString(),
    });
  }

  const context = Object.assign({}, req.body.context || {});
  if (req.body.memoryMode) context.memoryMode = req.body.memoryMode;
  if (req.body.cloudSyncEnabled === true) context.cloudSyncEnabled = true;
  const runtimeDecision = resolveRequestRuntimeDecision(req, context);
  const requestId = String(req.body.requestId || agentProtocol.createRequestId()).slice(0, 96);
  const conversationId = String(req.body.conversationId || "").slice(0, 96);
  const created = agentRunEventService.createRun({
    serverSession: req.fosuSession || null,
    runtimeMode: runtimeDecision.runtimeMode,
    requestId,
    conversationId,
  });

  // Async execution: respond immediately, client polls events.
  setImmediate(() => {
    const onEvent = agentRunEventService.createEventEmitter(created.runId, runtimeDecision.runtimeMode);
    agentService.chat({
      message,
      context,
      protocolVersion: req.body.protocolVersion,
      requestId,
      conversationId,
      runId: created.runId,
      serverSession: req.fosuSession ? {
        openidHash: req.fosuSession.openidHash || "",
        sessionIdHash: req.fosuSession.sessionIdHash || "",
        appid: req.fosuSession.appid || "",
      } : null,
      onEvent,
    }).then((payload) => {
      if (agentRunEventService.isCancelled(created.runId)) {
        agentRunEventService.setResult(created.runId, null, "cancelled");
        return;
      }
      const status = payload && payload.status === "cancelled"
        ? "cancelled"
        : (payload && (payload.fallback || payload.status === "degraded") ? "degraded" : (payload && payload.success === false ? "failed" : "completed"));
      if (status === "completed") onEvent({ type: "run.completed", runtimeMode: runtimeDecision.runtimeMode });
      else if (status === "degraded") onEvent({ type: "run.degraded", runtimeMode: runtimeDecision.runtimeMode, reasonCode: String(payload.fallbackReason || "").slice(0, 80) });
      else if (status === "failed") onEvent({ type: "run.failed", runtimeMode: runtimeDecision.runtimeMode });
      agentRunEventService.setResult(created.runId, payload, status);
    }).catch((error) => {
      onEvent({
        type: "run.failed",
        runtimeMode: runtimeDecision.runtimeMode,
        reasonCode: String(error && error.code || "AGENT_SERVICE_UNAVAILABLE").slice(0, 80),
      });
      agentRunEventService.setResult(created.runId, agentService.buildServiceFailureResponse({
        message,
        context,
        protocolVersion: req.body.protocolVersion,
        requestId,
        conversationId,
        runId: created.runId,
        serverSession: req.fosuSession || null,
      }, error), "failed");
    });
  });

  return res.status(202).json({
    success: true,
    runId: created.runId,
    pollToken: created.pollToken,
    status: created.status,
    nextPollMs: created.nextPollMs,
    expiresAt: created.expiresAt,
    serverTime: new Date().toISOString(),
  });
});

router.get("/agent/runs/:runId", scheduleLimiter, optionalSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const view = agentRunEventService.getRunView(req.params.runId, {
    pollToken: req.query.pollToken || req.headers["x-fosu-run-poll-token"] || "",
    serverSession: req.fosuSession || null,
    afterSequence: req.query.afterSequence,
  });
  if (!view.ok) {
    return res.status(view.status || 404).json({
      success: false,
      code: view.code || "RUN_NOT_FOUND",
      message: "无法读取该运行任务。",
      serverTime: new Date().toISOString(),
    });
  }
  return res.json({
    success: true,
    runId: view.runId,
    status: view.status,
    events: view.events,
    result: view.result,
    nextPollMs: view.nextPollMs,
    checkedAt: view.checkedAt,
    serverTime: new Date().toISOString(),
  });
});

router.post("/agent/runs/:runId/cancel", scheduleLimiter, optionalSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const result = agentRunEventService.cancelRun(req.params.runId, {
    pollToken: req.body && req.body.pollToken || req.query.pollToken || req.headers["x-fosu-run-poll-token"] || "",
    serverSession: req.fosuSession || null,
  });
  if (!result.ok) {
    return res.status(result.status || 404).json({
      success: false,
      code: result.code || "RUN_NOT_FOUND",
      message: "无法取消该运行任务。",
      serverTime: new Date().toISOString(),
    });
  }
  return res.json({
    success: true,
    runId: req.params.runId,
    status: result.status || "cancelled",
    alreadyFinished: result.alreadyFinished === true,
    serverTime: new Date().toISOString(),
  });
});

module.exports = router;
