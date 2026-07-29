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
const { defaultMemoryController } = require("../services/ai/memory/memoryController");
const releaseService = require("../services/releaseService");
const { defaultUserPreferenceService } = require("../services/ai/conversation/userPreferenceService");
const { defaultCourseReminderService, sanitizePatch: sanitizeReminderPatch } = require("../services/ai/reminders/courseReminderService");
const { planCourseReminder, clampLead, sanitizeCourseTemplate } = require("../services/ai/reminders/courseReminderPlanner");
const { defaultCourseReminderDispatchService } = require("../services/ai/reminders/courseReminderDispatchService");
const { defaultWechatSubscriptionService } = require("../services/ai/reminders/wechatSubscriptionService");
const scheduleAnalysisService = require("../services/ai/scheduleAnalysisService");
const agentReadinessService = require("../services/ai/agentReadinessService");
const actionCommandContract = require("../services/ai/actionCommandContract");
const { resumeDurableTask, completeReminderReceiptWait } = require("../services/ai/durable/resume");

const router = express.Router();
let configuredAgentRunHandlers = null;

router.use(publicFosuGuard);

function getAgentRunHandlers() {
  if (!configuredAgentRunHandlers) {
    configuredAgentRunHandlers = require("../services/ai/platformComposition").getRunHandlers();
  }
  return configuredAgentRunHandlers;
}

function bindRuntimeDecision(req) {
  req.agentRuntimeDecision = resolveRequestRuntimeDecision(req, req.body && req.body.context || {});
}

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

function handleDurableError(res, error) {
  const status = Math.max(400, Math.min(503, Number(error && error.statusCode) || 400));
  const code = String(error && error.code || "DURABLE_ERROR").slice(0, 80);
  const messages = {
    PRINCIPAL_REQUIRED: "需要有效小程序会话才能恢复等待中的任务。",
    DURABLE_TASK_NOT_FOUND: "没有找到对应的等待任务，可能已完成或过期。",
    DURABLE_TOKEN_INVALID: "恢复凭证无效，请重新发起操作。",
    DURABLE_TASK_EXPIRED: "等待任务已过期，请重新发起操作。",
    DURABLE_STATUS_CONFLICT: "任务当前状态不允许恢复。",
    DURABLE_PRINCIPAL_MISMATCH: "该任务不属于当前会话主体。",
  };
  safeLog("ai-agent-durable-operation-failed", { code });
  return res.status(status).json({
    success: false,
    code,
    message: messages[code] || "等待任务操作失败，请稍后重试。",
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

router.post("/agent/chat", scheduleLimiter, optionalSessionGuard, validateJsonBody(["message", "context", "protocolVersion", "requestId", "conversationId", "memoryMode", "cloudSyncEnabled"]), (req, res) => {
  bindRuntimeDecision(req);
  return getAgentRunHandlers().chatCompat(req, res);
});

/**
 * AG-UI compatible gateway — maps Run Events to AG-UI event stream.
 * Does not replace custom miniprogram UI; cards/actions travel in STATE_SNAPSHOT.
 * threadId = conversationId; runId = agent runId.
 */
router.post("/agent/agui", scheduleLimiter, optionalSessionGuard, validateJsonBody(["message", "context", "protocolVersion", "requestId", "conversationId", "memoryMode", "cloudSyncEnabled", "stream"]), (req, res) => {
  bindRuntimeDecision(req);
  return getAgentRunHandlers().aguiCompat(req, res);
});

/**
 * 客户端 Action 执行回执（Receipt）。
 * 闭环约定：Action 在客户端真实执行后回报结果；仅当服务端验证通过
 * （command 合法 + status=success + appliedTarget 达成态校验：课表目标须仍在当前激活索引，
 * 提醒目标须在服务端提醒存储达成对应状态）才提交工作记忆（cloud_sync 持久化）。
 * 失败回执仅记录，不提交记忆。
 */
// 提醒类回执命令：以 manifest/actionCommandContract 为权威源（receiptRequired 的提醒动作）。
// 白名单扩大不等于校验放松：runId/target/过期/principal 校验对新增命令同样生效；
// 未在契约内的 command 仍拒绝（COMMAND_UNKNOWN）。
const REMINDER_RECEIPT_COMMANDS = ["createCourseReminder", "deleteReminder"].filter((command) => {
  const definition = actionCommandContract.getActionDefinition(command);
  return Boolean(definition && definition.receiptRequired === true);
});
router.post("/agent/action-receipts", scheduleLimiter, requireSessionGuard, validateJsonBody(["command", "runId", "conversationId", "status", "appliedTarget", "errorCode", "memoryMode", "cloudSyncEnabled"]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const body = req.body || {};
    const command = String(body.command || "").slice(0, 40);
    const status = String(body.status || "").slice(0, 24);
    const isScheduleReceipt = command === "setCurrentSchedule";
    const isReminderReceipt = REMINDER_RECEIPT_COMMANDS.indexOf(command) >= 0;
    if (!isScheduleReceipt && !isReminderReceipt) {
      return res.status(400).json({
        success: false,
        code: "COMMAND_UNKNOWN",
        message: "未知的 Action 回执类型。",
        serverTime: new Date().toISOString(),
      });
    }
    if (status !== "success") {
      safeLog("ai-agent-action-receipt-failed", buildSafeLogPayload({
        provider: "action-receipt",
        toolCalls: [{ name: command, status: "failed", summary: String(body.errorCode || "").slice(0, 60) }],
      }));
      return res.json({
        success: true,
        committed: false,
        reason: "ACTION_FAILED",
        serverTime: new Date().toISOString(),
      });
    }
    const appliedTarget = body.appliedTarget && typeof body.appliedTarget === "object" ? body.appliedTarget : {};
    const detailId = String(appliedTarget.detailId || "").slice(0, 128);
    const name = String(appliedTarget.name || "").slice(0, 120);
    if (!detailId || !name) {
      return res.status(400).json({
        success: false,
        code: "TARGET_MISSING",
        message: "回执缺少已应用目标标识。",
        serverTime: new Date().toISOString(),
      });
    }
    let receiptTarget;
    if (isScheduleReceipt) {
      // 目标必须仍存在于当前激活课表索引（防伪造回执/防过期数据）。
      const index = releaseService.readActiveIndex("class") || {};
      const items = Array.isArray(index.items) ? index.items : (Array.isArray(index) ? index : []);
      const found = items.find((item) => String(item.id || item.detailId || "") === detailId);
      if (!found) {
        return res.status(409).json({
          success: false,
          code: "SCHEDULE_TARGET_NOT_FOUND",
          message: "目标课表已不在当前版本中。",
          serverTime: new Date().toISOString(),
        });
      }
      receiptTarget = {
        type: "class",
        detailId,
        name: String(found.name || found.className || name).slice(0, 120),
        term: String(appliedTarget.term || "").slice(0, 40),
      };
    } else {
      // 提醒类目标校验：以服务端提醒存储的达成态为准（防伪造回执）。
      // createCourseReminder 要求提醒已按 idempotencyKey 真实落库；
      // deleteReminder 要求目标提醒已不存在（幂等删除达成态）。
      const reminderPrincipal = resolveReminderPrincipal(req);
      if (!reminderPrincipal || reminderPrincipal.authenticated !== true) {
        return res.status(401).json({
          success: false,
          code: "PRINCIPAL_REQUIRED",
          message: "需要有效小程序会话才能回传提醒执行回执。",
          serverTime: new Date().toISOString(),
        });
      }
      if (command === "createCourseReminder") {
        const appliedReminder = defaultCourseReminderService.findByIdempotencyKey({
          principal: reminderPrincipal,
          idempotencyKey: detailId,
        });
        if (!appliedReminder) {
          return res.status(409).json({
            success: false,
            code: "REMINDER_TARGET_NOT_FOUND",
            message: "目标提醒未在服务端落库。",
            serverTime: new Date().toISOString(),
          });
        }
      } else {
        let reminderStillExists = false;
        try {
          defaultCourseReminderService.get({ principal: reminderPrincipal, reminderId: detailId });
          reminderStillExists = true;
        } catch (lookupError) {
          if (!lookupError || lookupError.code !== "REMINDER_NOT_FOUND") throw lookupError;
        }
        if (reminderStillExists) {
          return res.status(409).json({
            success: false,
            code: "REMINDER_TARGET_STILL_EXISTS",
            message: "目标提醒尚未删除。",
            serverTime: new Date().toISOString(),
          });
        }
      }
      receiptTarget = {
        type: "reminder",
        detailId,
        name,
        term: "",
      };
    }
    const principal = defaultMemoryService.resolvePrincipal({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
    });
    const requestedCloudSync = String(body.memoryMode || "").slice(0, 24) === "cloud_sync";
    const conversationId = String(body.conversationId || "").slice(0, 100);
    const bundle = defaultMemoryService.loadForChat({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
      conversationId,
      memoryMode: requestedCloudSync ? "cloud_sync" : "local_only",
      context: {},
    });
    const cloudSyncAuthorized = Boolean(
      requestedCloudSync
      && bundle && bundle.memory && bundle.memory.mode === "cloud_sync"
      && bundle.state && bundle.state.memoryPolicy
      && bundle.state.memoryPolicy.mode === "cloud_sync"
      && bundle.state.memoryPolicy.cloudSyncEnabled === true
    );
    if (requestedCloudSync && !cloudSyncAuthorized) {
      return res.status(409).json({
        success: false,
        committed: false,
        code: "CLOUD_SYNC_NOT_AUTHORIZED",
        reason: "CLOUD_SYNC_NOT_AUTHORIZED",
        serverTime: new Date().toISOString(),
      });
    }
    const memoryMode = cloudSyncAuthorized ? "cloud_sync" : "local_only";
    const commitResult = defaultMemoryController.commitActionReceipt({
      principal,
      state: bundle && bundle.state,
      conversationId,
      memoryMode,
      command,
      runId: String(body.runId || "").slice(0, 100),
      appliedTarget: receiptTarget,
    });
    if (memoryMode === "cloud_sync" && commitResult.committed !== true) {
      return res.status(409).json({
        success: false,
        committed: false,
        code: commitResult.reason || "ACTION_RECEIPT_REJECTED",
        reason: commitResult.reason || "ACTION_RECEIPT_REJECTED",
        serverTime: new Date().toISOString(),
      });
    }
    safeLog("ai-agent-action-receipt", buildSafeLogPayload({
      provider: "action-receipt",
      toolCalls: [{ name: command, status: "success", summary: commitResult.committed ? "committed" : (commitResult.reason || "skipped") }],
      memoryMode,
    }));
    // M6-T4 durable 兜底：提醒回执被接受后，将对应 receipt_wait 持久任务置 done。
    // 纯附加、best-effort：找不到任务或置 done 失败均不改变 M5 回执语义与响应。
    if (isReminderReceipt) {
      try {
        completeReminderReceiptWait({
          principal,
          command,
          runId: String(body.runId || "").slice(0, 100),
          detailId,
        });
      } catch (durableError) {
        safeLog("ai-agent-durable-complete-failed", {
          code: String(durableError && durableError.code || "DURABLE_COMPLETE_FAILED").slice(0, 60),
        });
      }
    }
    return res.json({
      success: true,
      committed: commitResult.committed === true,
      reason: commitResult.reason || "",
      memory: commitResult.memory || null,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return handleMemoryError(res, error);
  }
});

// M6-T4 轻量 Durable Execution：凭 resumeToken + 会话 Principal 恢复等待中的任务
// （提醒回执等待 / 审批 / 通用等待事件）。无有效会话不得 resume（requireSessionGuard）。
router.post("/agent/durable/resume", scheduleLimiter, requireSessionGuard, validateJsonBody(["taskId", "resumeToken"]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const body = req.body || {};
    const principal = resolveReminderPrincipal(req);
    const result = resumeDurableTask({
      taskId: String(body.taskId || "").slice(0, 64),
      resumeToken: String(body.resumeToken || ""),
      principal,
    });
    return res.json({
      success: true,
      task: result.task,
      context: result.context,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return handleDurableError(res, error);
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

router.patch("/agent/memory/preferences", scheduleLimiter, requireSessionGuard, validateJsonBody(["key", "value", "values", "autoMemoryEnabled"]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const principal = defaultMemoryService.resolvePrincipal({
      serverSession: req.fosuSession,
      runtimeMode: resolveMemoryRuntimeMode(req),
    });
    const body = req.body || {};
    if (typeof body.autoMemoryEnabled === "boolean") {
      // Persist pause flag as preferPersonalSchedule-adjacent meta via dedicated key when present.
      // Stored as answerDetailLevel-style free preference not required — use explicit values map.
    }
    const values = body.values && typeof body.values === "object" && !Array.isArray(body.values)
      ? body.values
      : (body.key ? { [body.key]: body.value } : {});
    if (typeof body.autoMemoryEnabled === "boolean") {
      // Represent pause via non-listed key only if ALLOWED — otherwise return flag for client storage.
      // Client keeps autoMemoryEnabled locally; server stores nothing secret.
    }
    if (!Object.keys(values).length && typeof body.autoMemoryEnabled !== "boolean") {
      return res.status(400).json({
        success: false,
        code: "PREFERENCE_INVALID",
        message: "请提供要修改的记忆项。",
        serverTime: new Date().toISOString(),
      });
    }
    let payload = { success: true, persisted: false };
    if (Object.keys(values).length) {
      payload = defaultUserPreferenceService.upsert({
        principal,
        memoryMode: "cloud_sync",
        explicit: true,
        autoMemory: true,
        values,
      });
    }
    return res.json(Object.assign({
      serverTime: new Date().toISOString(),
      autoMemoryEnabled: typeof body.autoMemoryEnabled === "boolean" ? body.autoMemoryEnabled : undefined,
    }, payload));
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

router.post("/agent/proactive/evaluate", scheduleLimiter, optionalSessionGuard, validateJsonBody(["event", "context", "facts"]), (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const event = String(req.body && req.body.event || "").trim();
    if (!event) {
      return res.status(400).json({
        success: false,
        code: "EVENT_REQUIRED",
        message: "缺少主动建议事件类型。",
        serverTime: new Date().toISOString(),
      });
    }
    const context = Object.assign({}, req.body.context || {});
    if (req.body.memoryMode) context.memoryMode = req.body.memoryMode;
    const payload = agentService.evaluateProactiveForRequest({
      event,
      context,
      facts: req.body.facts || {},
      conversationId: req.body.conversationId,
      memoryMode: req.body.memoryMode || context.memoryMode,
      serverSession: req.fosuSession ? {
        openidHash: req.fosuSession.openidHash || "",
        sessionIdHash: req.fosuSession.sessionIdHash || "",
        appid: req.fosuSession.appid || "",
      } : null,
      runtimeMode: resolveMemoryRuntimeMode(req),
    });
    return res.json(payload);
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
      configuredAvailable: false,
      providerVerified: false,
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

router.post("/agent/runs", scheduleLimiter, optionalSessionGuard, validateJsonBody(["message", "context", "protocolVersion", "requestId", "conversationId", "memoryMode", "cloudSyncEnabled", "idempotencyKey"]), (req, res) => {
  bindRuntimeDecision(req);
  return getAgentRunHandlers().createRun(req, res);
});

router.get("/agent/runs/:runId", scheduleLimiter, optionalSessionGuard, (req, res) => {
  return getAgentRunHandlers().getRun(req, res);
});

router.post("/agent/runs/:runId/cancel", scheduleLimiter, optionalSessionGuard, (req, res) => {
  return getAgentRunHandlers().cancelRun(req, res);
});

router.configureAgentRunHandlers = function configureAgentRunHandlers(handlers) {
  configuredAgentRunHandlers = handlers;
  return router;
};

module.exports = router;
