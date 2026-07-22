const express = require("express");
const { scheduleLimiter } = require("../utils/rateLimit");
const { optionalSessionGuard, publicFosuGuard, validateJsonBody, verifySessionTokenDetailed } = require("../utils/apiSecurity");
const { getSecurityMode } = require("../services/securityModeService");
const { safeLog } = require("../utils/safeLogger");
const agentService = require("../services/ai/agentService");
const campusMapService = require("../services/ai/campusMapService");
const weatherService = require("../services/ai/weatherService");
const { buildSafeLogPayload, sanitizeAgentContext } = require("../services/ai/safetyGuard");
const capabilityManifestService = require("../services/ai/capabilityManifestService");
const runtimeModeService = require("../services/ai/runtimeModeService");
const { defaultMemoryService } = require("../services/ai/conversation/conversationMemoryService");
const { defaultUserPreferenceService } = require("../services/ai/conversation/userPreferenceService");
const { defaultCourseReminderService, sanitizePatch: sanitizeReminderPatch } = require("../services/ai/reminders/courseReminderService");
const { planCourseReminder, clampLead, sanitizeCourseTemplate } = require("../services/ai/reminders/courseReminderPlanner");
const { defaultCourseReminderDispatchService } = require("../services/ai/reminders/courseReminderDispatchService");
const { defaultWechatSubscriptionService } = require("../services/ai/reminders/wechatSubscriptionService");
const scheduleAnalysisService = require("../services/ai/scheduleAnalysisService");
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

function handleReminderError(res, error) {
  const status = Math.max(400, Math.min(503, Number(error && error.statusCode) || 400));
  const code = String(error && error.code || "REMINDER_ERROR").slice(0, 80);
  const messages = {
    PRINCIPAL_REQUIRED: "需要有效小程序会话才能管理提醒。",
    REMINDER_NOT_FOUND: "没有找到这个提醒，可能已经删除。",
    REMINDER_CONFIRMATION_REQUIRED: "请先确认这次提醒操作。",
    REMINDER_CONFIRMATION_INVALID: "确认已失效，请重新操作。",
    REMINDER_CONFIRMATION_MISMATCH: "提醒内容已变化，请重新确认。",
    REMINDER_SECRET_UNAVAILABLE: "提醒服务尚未配置，请稍后再试。",
    IDEMPOTENCY_KEY_REQUIRED: "操作标识无效，请重新操作。",
  };
  safeLog("course-reminder-operation-failed", { code });
  return res.status(status).json({
    success: false,
    code,
    message: messages[code] || "提醒操作失败，请稍后重试。",
    serverTime: new Date().toISOString(),
  });
}

function resolveReminderPrincipal(req) {
  return defaultMemoryService.resolvePrincipal({
    serverSession: req.fosuSession,
    runtimeMode: resolveMemoryRuntimeMode(req),
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
    const principal = defaultMemoryService.resolvePrincipal({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
    });
    const preferences = defaultUserPreferenceService.clear({ principal });
    return res.json(Object.assign({ serverTime: new Date().toISOString(), preferences }, payload));
  } catch (error) {
    return handleMemoryError(res, error);
  }
});

router.get("/agent/memory/preferences", scheduleLimiter, requireSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const principal = defaultMemoryService.resolvePrincipal({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
    });
    const payload = defaultUserPreferenceService.list({ principal });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleMemoryError(res, error);
  }
});

router.delete("/agent/memory/preferences/:key", scheduleLimiter, requireSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const principal = defaultMemoryService.resolvePrincipal({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
    });
    const payload = defaultUserPreferenceService.remove({
      principal,
      key: req.params.key,
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

router.get("/agent/reminders/capability", scheduleLimiter, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.json(Object.assign({
    success: true,
    timezone: "Asia/Shanghai",
    authenticated: Boolean(req.fosuSession && req.fosuSession.openidHash),
  }, defaultWechatSubscriptionService.getCapability(), {
    disclosure: "微信订阅消息需要每次按平台规则由用户点击授权；未授权时仅保留应用内提醒。",
    serverTime: new Date().toISOString(),
  }));
});

router.get("/agent/reminders", scheduleLimiter, requireSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultCourseReminderService.list({ principal: resolveReminderPrincipal(req) });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleReminderError(res, error);
  }
});

router.get("/agent/reminders/in-app-events", scheduleLimiter, requireSessionGuard, (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultCourseReminderService.listInAppEvents({
      principal: resolveReminderPrincipal(req),
      limit: req.query && req.query.limit,
    });
    return res.json(Object.assign({
      deliveryMode: "app_only",
      disclosure: "这是应用内提醒收件箱；只有打开佛课小表时才能看到，不等同于微信后台推送。",
      serverTime: new Date().toISOString(),
    }, payload));
  } catch (error) {
    return handleReminderError(res, error);
  }
});

router.post("/agent/reminders/in-app-events/:eventId/acknowledge", scheduleLimiter, requireSessionGuard, validateJsonBody([]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultCourseReminderService.acknowledgeInAppEvent({
      principal: resolveReminderPrincipal(req),
      eventId: req.params.eventId,
    });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleReminderError(res, error);
  }
});



router.post("/agent/reminders/configure", scheduleLimiter, requireSessionGuard, validateJsonBody([
  "leadMinutes",
  "scope",
  "idempotencyKey",
  "subscriptionStatus",
  "currentScheduleSummary",
  "todayDate",
  "todayWeekday",
  "currentTeachingWeek",
  "clientTimestampMs",
]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const principal = resolveReminderPrincipal(req);
    if (!principal || !principal.authenticated) {
      const error = new Error("Principal required");
      error.code = "PRINCIPAL_REQUIRED";
      error.statusCode = 401;
      throw error;
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const leadMinutes = clampLead(body.leadMinutes, 20);
    const scopeRaw = String(body.scope || "all_courses").trim();
    const scope = ["all_courses", "room_change", "date_course"].includes(scopeRaw) ? scopeRaw : "all_courses";
    const summarySource = body.currentScheduleSummary && typeof body.currentScheduleSummary === "object"
      ? body.currentScheduleSummary
      : {};
    const courses = Array.isArray(summarySource.courses)
      ? summarySource.courses.slice(0, 60).map(sanitizeCourseTemplate).filter(Boolean)
      : [];
    const currentScheduleSummary = {
      enabled: summarySource.enabled === true && courses.length > 0,
      fingerprint: String(summarySource.fingerprint || "").slice(0, 80),
      courses,
    };
    const message = scope === "room_change"
      ? "只有教室变化时才提醒我"
      : `以后上课前${leadMinutes}分钟提醒我`;
    const context = {
      todayDate: String(body.todayDate || "").slice(0, 10),
      todayWeekday: Math.max(1, Math.min(7, Number(body.todayWeekday || 1) || 1)),
      currentTeachingWeek: Math.max(0, Number(body.currentTeachingWeek || 0) || 0),
      clientTimestampMs: Number(body.clientTimestampMs || Date.now()) || Date.now(),
      currentScheduleSummary,
      userPreferences: { defaultReminderLeadMinutes: leadMinutes },
    };
    const plan = planCourseReminder(message, context);
    if (!plan || plan.success !== true) {
      const code = String(plan && plan.code || "REMINDER_PLAN_INVALID").slice(0, 80);
      const statusCode = code === "SCHEDULE_REQUIRED" ? 409 : 400;
      return res.status(statusCode).json({
        success: false,
        code,
        needContext: plan && plan.needContext === true,
        actionUrl: plan && plan.actionUrl || "",
        message: code === "SCHEDULE_REQUIRED"
          ? "需要先导入个人课表，才能创建上课提醒。"
          : (code === "NO_MATCHING_COURSE"
            ? "暂时找不到可提醒的下一节课，请检查课表后重试。"
            : "无法生成提醒计划，请调整设置后重试。"),
        serverTime: new Date().toISOString(),
      });
    }
    plan.leadMinutes = leadMinutes;
    plan.scope = scope;
    plan.eventDriven = scope === "room_change";
    plan.recurrence = scope === "room_change" ? "event" : (scope === "date_course" ? "once" : "weekly");
    if (scope === "room_change") {
      plan.nextOccurrence = null;
      plan.nextTriggerAt = "";
    } else if (plan.nextOccurrence && plan.nextOccurrence.startsAt) {
      plan.nextOccurrence.triggerAt = new Date(
        Date.parse(plan.nextOccurrence.startsAt) - leadMinutes * 60000
      ).toISOString();
      plan.nextTriggerAt = plan.nextOccurrence.triggerAt;
    }
    // UI confirm button already expresses user confirmation; mint short-lived proof server-side.
    const confirmation = defaultCourseReminderService.createConfirmation({
      principal,
      operation: "create",
      payload: plan,
      idempotencyKey: body.idempotencyKey,
    });
    const payload = defaultCourseReminderService.create({
      principal,
      confirmationToken: confirmation.token,
      idempotencyKey: body.idempotencyKey,
      subscriptionStatus: body.subscriptionStatus,
    });
    return res.json(Object.assign({
      success: true,
      plan: {
        operation: plan.operation,
        scope: plan.scope,
        leadMinutes: plan.leadMinutes,
        eventDriven: plan.eventDriven === true,
        recurrence: plan.recurrence,
        nextOccurrence: plan.nextOccurrence || null,
        nextTriggerAt: plan.nextTriggerAt || "",
      },
      deliveryDisclosure: payload.reminder && payload.reminder.channel === "wechat_subscription"
        ? "已记录本次微信订阅授权；微信仍可能按平台规则限制送达。"
        : "未获得本次微信订阅授权，已降级为应用内提醒。",
      serverTime: new Date().toISOString(),
    }, payload));
  } catch (error) {
    return handleReminderError(res, error);
  }
});

router.post("/agent/reminders/plans", scheduleLimiter, requireSessionGuard, validateJsonBody([
  "leadMinutes",
  "scope",
  "idempotencyKey",
  "currentScheduleSummary",
  "todayDate",
  "todayWeekday",
  "currentTeachingWeek",
  "clientTimestampMs",
]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const principal = resolveReminderPrincipal(req);
    if (!principal || !principal.authenticated) {
      const error = new Error("Principal required");
      error.code = "PRINCIPAL_REQUIRED";
      error.statusCode = 401;
      throw error;
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const leadMinutes = clampLead(body.leadMinutes, 20);
    const scopeRaw = String(body.scope || "all_courses").trim();
    const scope = ["all_courses", "room_change", "date_course"].includes(scopeRaw) ? scopeRaw : "all_courses";
    const summarySource = body.currentScheduleSummary && typeof body.currentScheduleSummary === "object"
      ? body.currentScheduleSummary
      : {};
    const courses = Array.isArray(summarySource.courses)
      ? summarySource.courses.slice(0, 60).map(sanitizeCourseTemplate).filter(Boolean)
      : [];
    const currentScheduleSummary = {
      enabled: summarySource.enabled === true && courses.length > 0,
      fingerprint: String(summarySource.fingerprint || "").slice(0, 80),
      courses,
    };
    const message = scope === "room_change"
      ? "只有教室变化时才提醒我"
      : `以后上课前${leadMinutes}分钟提醒我`;
    const context = {
      todayDate: String(body.todayDate || "").slice(0, 10),
      todayWeekday: Math.max(1, Math.min(7, Number(body.todayWeekday || 1) || 1)),
      currentTeachingWeek: Math.max(0, Number(body.currentTeachingWeek || 0) || 0),
      clientTimestampMs: Number(body.clientTimestampMs || Date.now()) || Date.now(),
      currentScheduleSummary,
      userPreferences: { defaultReminderLeadMinutes: leadMinutes },
    };
    const plan = planCourseReminder(message, context);
    if (!plan || plan.success !== true) {
      const code = String(plan && plan.code || "REMINDER_PLAN_INVALID").slice(0, 80);
      const statusCode = code === "SCHEDULE_REQUIRED" ? 409 : 400;
      return res.status(statusCode).json({
        success: false,
        code,
        needContext: plan && plan.needContext === true,
        actionUrl: plan && plan.actionUrl || "",
        message: code === "SCHEDULE_REQUIRED"
          ? "需要先导入个人课表，才能创建上课提醒。"
          : (code === "NO_MATCHING_COURSE"
            ? "暂时找不到可提醒的下一节课，请检查课表后重试。"
            : "无法生成提醒计划，请调整设置后重试。"),
        serverTime: new Date().toISOString(),
      });
    }
    plan.leadMinutes = leadMinutes;
    plan.scope = scope;
    plan.eventDriven = scope === "room_change";
    plan.recurrence = scope === "room_change" ? "event" : (scope === "date_course" ? "once" : "weekly");
    if (scope === "room_change") {
      plan.nextOccurrence = null;
      plan.nextTriggerAt = "";
    } else if (plan.nextOccurrence && plan.nextOccurrence.startsAt) {
      plan.nextOccurrence.triggerAt = new Date(
        Date.parse(plan.nextOccurrence.startsAt) - leadMinutes * 60000
      ).toISOString();
      plan.nextTriggerAt = plan.nextOccurrence.triggerAt;
    }
    const confirmation = defaultCourseReminderService.createConfirmation({
      principal,
      operation: "create",
      payload: plan,
      idempotencyKey: body.idempotencyKey,
    });
    return res.json({
      success: true,
      plan: {
        operation: plan.operation,
        scope: plan.scope,
        leadMinutes: plan.leadMinutes,
        eventDriven: plan.eventDriven === true,
        recurrence: plan.recurrence,
        timezone: plan.timezone || "Asia/Shanghai",
        nextOccurrence: plan.nextOccurrence || null,
        nextTriggerAt: plan.nextTriggerAt || "",
        requiresConfirmation: true,
      },
      confirmationProof: confirmation.token,
      expiresAt: confirmation.expiresAt,
      disclosure: "确认后才会创建提醒；可选择微信服务通知授权，未授权时保留应用内提醒。",
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return handleReminderError(res, error);
  }
});

router.post("/agent/reminders", scheduleLimiter, requireSessionGuard, validateJsonBody(["confirmationProof", "idempotencyKey", "subscriptionStatus"]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultCourseReminderService.create({
      principal: resolveReminderPrincipal(req),
      confirmationToken: req.body && req.body.confirmationProof,
      idempotencyKey: req.body && req.body.idempotencyKey,
      subscriptionStatus: req.body && req.body.subscriptionStatus,
    });
    return res.json(Object.assign({
      serverTime: new Date().toISOString(),
      deliveryDisclosure: payload.reminder && payload.reminder.channel === "wechat_subscription"
        ? "已记录本次微信订阅授权；微信仍可能按平台规则限制送达。"
        : "未获得本次微信订阅授权，已降级为应用内提醒。",
    }, payload));
  } catch (error) {
    return handleReminderError(res, error);
  }
});

router.post("/agent/reminders/:reminderId/subscription-authorizations", scheduleLimiter, requireSessionGuard, validateJsonBody([
  "subscriptionStatus",
  "idempotencyKey",
]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultCourseReminderService.grantSubscriptionAuthorization({
      principal: resolveReminderPrincipal(req),
      reminderId: req.params.reminderId,
      subscriptionStatus: req.body && req.body.subscriptionStatus,
      idempotencyKey: req.body && req.body.idempotencyKey,
    });
    return res.json(Object.assign({
      serverTime: new Date().toISOString(),
      deliveryDisclosure: "本次接受增加 1 次微信服务通知额度；额度按微信一次性订阅规则逐次消耗。",
    }, payload));
  } catch (error) {
    return handleReminderError(res, error);
  }
});

router.post("/agent/reminders/schedule-change-events", scheduleLimiter, requireSessionGuard, validateJsonBody([
  "currentScheduleSummary",
  "baselineScheduleSummary",
  "todayDate",
  "todayWeekday",
  "currentTeachingWeek",
  "idempotencyKey",
]), async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const sanitized = sanitizeAgentContext({
      currentScheduleSummary: req.body && req.body.currentScheduleSummary,
      scheduleChangeBaseline: req.body && req.body.baselineScheduleSummary,
      todayDate: req.body && req.body.todayDate,
      todayWeekday: req.body && req.body.todayWeekday,
      currentTeachingWeek: req.body && req.body.currentTeachingWeek,
    });
    const analysis = scheduleAnalysisService.detectScheduleChanges({
      currentScheduleSummary: sanitized.currentScheduleSummary,
      baselineScheduleSummary: sanitized.scheduleChangeBaseline,
    });
    const roomChanges = (Array.isArray(analysis.changes) ? analysis.changes : [])
      .filter((change) => change && change.type === "modified"
        && Array.isArray(change.fields) && change.fields.includes("classroom"));
    const principal = resolveReminderPrincipal(req);
    const baseKey = String(req.body && req.body.idempotencyKey || "").trim().slice(0, 120);
    if (!baseKey) {
      const error = new Error("Idempotency key required");
      error.code = "IDEMPOTENCY_KEY_REQUIRED";
      error.statusCode = 400;
      throw error;
    }
    let queued = 0;
    let duplicate = roomChanges.length > 0;
    roomChanges.forEach((change, index) => {
      const result = defaultCourseReminderService.queueScheduleChangeEvent({
        principal,
        idempotencyKey: `${baseKey}:${index}`,
        referenceDate: String(req.body && req.body.todayDate || "").slice(0, 10),
        referenceWeekday: Number(req.body && req.body.todayWeekday || 0),
        referenceTeachingWeek: Number(req.body && req.body.currentTeachingWeek || 0),
        change,
      });
      queued += Number(result && result.queued || 0);
      if (!result || result.duplicate !== true) duplicate = false;
    });
    const delivery = queued > 0
      ? await defaultCourseReminderDispatchService.dispatchDue({ limit: 20 })
      : { success: true, due: 0, sent: 0, failed: 0, retried: 0, appOnlyDue: 0 };
    return res.json({
      success: true,
      changed: analysis.changed === true,
      changeCount: Array.isArray(analysis.changes) ? analysis.changes.length : 0,
      roomChangeCount: roomChanges.length,
      queued,
      duplicate: roomChanges.length > 0 && duplicate,
      delivery,
      disclosure: delivery.appOnlyDue > 0
        ? "未获得可用微信订阅授权，课表变化已保留为应用内提醒。"
        : "只有已确认的换教室提醒规则会接收本次变化事件。",
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return handleReminderError(res, error);
  }
});

router.post("/agent/reminders/:reminderId/confirmations", scheduleLimiter, requireSessionGuard, validateJsonBody(["operation", "patch", "idempotencyKey"]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const operation = String(req.body && req.body.operation || "");
    if (!["update", "delete"].includes(operation)) {
      const error = new Error("Reminder operation invalid");
      error.code = "REMINDER_OPERATION_INVALID";
      error.statusCode = 400;
      throw error;
    }
    const payload = operation === "update" ? sanitizeReminderPatch(req.body && req.body.patch) : {};
    const confirmation = defaultCourseReminderService.createConfirmation({
      principal: resolveReminderPrincipal(req),
      operation,
      reminderId: req.params.reminderId,
      payload,
      idempotencyKey: req.body && req.body.idempotencyKey,
    });
    return res.json({
      success: true,
      operation,
      reminderId: req.params.reminderId,
      confirmationProof: confirmation.token,
      expiresAt: confirmation.expiresAt,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return handleReminderError(res, error);
  }
});

router.patch("/agent/reminders/:reminderId", scheduleLimiter, requireSessionGuard, validateJsonBody(["patch", "confirmationProof", "idempotencyKey"]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const patch = sanitizeReminderPatch(req.body && req.body.patch);
    const payload = defaultCourseReminderService.update({
      principal: resolveReminderPrincipal(req),
      reminderId: req.params.reminderId,
      patch,
      confirmationToken: req.body && req.body.confirmationProof,
      idempotencyKey: req.body && req.body.idempotencyKey,
    });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleReminderError(res, error);
  }
});

router.delete("/agent/reminders/:reminderId", scheduleLimiter, requireSessionGuard, validateJsonBody(["confirmationProof", "idempotencyKey"]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const payload = defaultCourseReminderService.remove({
      principal: resolveReminderPrincipal(req),
      reminderId: req.params.reminderId,
      confirmationToken: req.body && req.body.confirmationProof,
      idempotencyKey: req.body && req.body.idempotencyKey,
    });
    return res.json(Object.assign({ serverTime: new Date().toISOString() }, payload));
  } catch (error) {
    return handleReminderError(res, error);
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
