/**
 * 课程提醒客户端。
 * 微信订阅授权只能在用户点击确认后调用；服务端确认凭证只在当前操作内存中使用。
 */
const http = require("../utils/request");
const agentClientErrorMapper = require("./agentClientErrorMapper");
const scheduleChangeTracker = require("./scheduleChangeTracker");

function safeText(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max || 160);
}

function envVersion() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
    return safeText(info && info.miniProgram && info.miniProgram.envVersion || "release", 20) || "release";
  } catch (error) {
    return "release";
  }
}

function withEnv(path) {
  const joiner = path.indexOf("?") >= 0 ? "&" : "?";
  return `${path}${joiner}envVersion=${encodeURIComponent(envVersion())}`;
}

function options(extra) {
  return Object.assign({
    showLoading: false,
    silentError: true,
    timeout: 12000,
    retries: 1,
    dedupe: false,
  }, extra || {});
}

function mapFailure(error, fallbackCode) {
  const code = safeText(error && (error.code || error.errorCode) || fallbackCode, 80);
  const mapped = agentClientErrorMapper.mapAgentError({
    code,
    message: error && (error.message || error.error || error.errMsg),
  }, "提醒操作失败，请稍后重试");
  return { success: false, code: mapped.code, error: mapped.userMessage };
}

async function getCapability() {
  try {
    const response = await http.get(withEnv("/api/ai/agent/reminders/capability"), {}, options());
    if (!response || response.success === false) return mapFailure(response, "REMINDER_CAPABILITY_FAILED");
    return Object.assign({ success: true }, response);
  } catch (error) {
    return mapFailure(error, "REMINDER_CAPABILITY_FAILED");
  }
}

async function listReminders() {
  try {
    const response = await http.get(withEnv("/api/ai/agent/reminders"), {}, options());
    if (!response || response.success === false) return Object.assign({ items: [] }, mapFailure(response, "REMINDER_LIST_FAILED"));
    return { success: true, items: Array.isArray(response.items) ? response.items : [] };
  } catch (error) {
    return Object.assign({ items: [] }, mapFailure(error, "REMINDER_LIST_FAILED"));
  }
}

async function listInAppEvents(limit) {
  const count = Math.min(20, Math.max(1, Number(limit || 10) || 10));
  try {
    const response = await http.get(
      withEnv(`/api/ai/agent/reminders/in-app-events?limit=${count}`),
      {},
      options({ retries: 0, timeout: 8000 })
    );
    if (!response || response.success === false) {
      return Object.assign({ items: [] }, mapFailure(response, "IN_APP_REMINDER_LIST_FAILED"));
    }
    return {
      success: true,
      items: Array.isArray(response.items) ? response.items : [],
      disclosure: safeText(response.disclosure, 200),
    };
  } catch (error) {
    return Object.assign({ items: [] }, mapFailure(error, "IN_APP_REMINDER_LIST_FAILED"));
  }
}

async function acknowledgeInAppEvent(eventId) {
  const normalizedId = encodeURIComponent(safeText(eventId, 80));
  if (!normalizedId) return { success: false, code: "IN_APP_REMINDER_EVENT_INVALID", error: "提醒事件无效" };
  try {
    const response = await http.post(
      withEnv(`/api/ai/agent/reminders/in-app-events/${normalizedId}/acknowledge`),
      {},
      options({ retries: 0, timeout: 8000 })
    );
    if (!response || response.success === false) return mapFailure(response, "IN_APP_REMINDER_ACK_FAILED");
    return Object.assign({ success: true }, response);
  } catch (error) {
    return mapFailure(error, "IN_APP_REMINDER_ACK_FAILED");
  }
}


async function planReminder(input) {
  const source = input || {};
  try {
    const response = await http.post(withEnv("/api/ai/agent/reminders/plans"), {
      leadMinutes: Math.max(5, Math.min(180, Number(source.leadMinutes || 20) || 20)),
      scope: safeText(source.scope, 32) || "all_courses",
      idempotencyKey: safeText(source.idempotencyKey, 160),
      currentScheduleSummary: source.currentScheduleSummary && typeof source.currentScheduleSummary === "object"
        ? source.currentScheduleSummary
        : { enabled: false, courses: [] },
      todayDate: safeText(source.todayDate, 10),
      todayWeekday: Math.max(1, Math.min(7, Number(source.todayWeekday || 1) || 1)),
      currentTeachingWeek: Math.max(0, Number(source.currentTeachingWeek || 0) || 0),
      clientTimestampMs: Number(source.clientTimestampMs || Date.now()) || Date.now(),
    }, options({ retries: 0, timeout: 15000 }));
    if (!response || response.success === false) return mapFailure(response, "REMINDER_PLAN_FAILED");
    return Object.assign({ success: true }, response);
  } catch (error) {
    return mapFailure(error, "REMINDER_PLAN_FAILED");
  }
}

async function createReminderFromConfig(input) {
  const source = input || {};
  const planResult = await planReminder(source);
  if (!planResult.success) return planResult;
  const subscription = source.subscriptionStatus
    ? { status: safeText(source.subscriptionStatus, 32) }
    : await requestWechatSubscription(source.capability || await getCapability());
  const createResult = await createReminder({
    confirmationProof: planResult.confirmationProof,
    idempotencyKey: safeText(source.idempotencyKey, 160) || makeIdempotencyKey("create", "config"),
    subscriptionStatus: subscription.status || "not_requested",
  });
  if (!createResult.success) return createResult;
  return Object.assign({}, createResult, {
    plan: planResult.plan || null,
    subscription,
  });
}

async function createReminder(input) {
  const source = input || {};
  try {
    const response = await http.post(withEnv("/api/ai/agent/reminders"), {
      confirmationProof: safeText(source.confirmationProof, 8000),
      idempotencyKey: safeText(source.idempotencyKey, 160),
      subscriptionStatus: safeText(source.subscriptionStatus, 32) || "not_requested",
    }, options({ retries: 0, timeout: 15000 }));
    if (!response || response.success === false) return mapFailure(response, "REMINDER_CREATE_FAILED");
    return Object.assign({ success: true }, response);
  } catch (error) {
    return mapFailure(error, "REMINDER_CREATE_FAILED");
  }
}

async function grantSubscriptionAuthorization(input) {
  const source = input || {};
  const reminderId = encodeURIComponent(safeText(source.reminderId, 80));
  if (!reminderId) return { success: false, code: "REMINDER_NOT_FOUND", error: "提醒不存在" };
  try {
    const response = await http.post(
      withEnv(`/api/ai/agent/reminders/${reminderId}/subscription-authorizations`),
      {
        subscriptionStatus: safeText(source.subscriptionStatus, 32),
        idempotencyKey: safeText(source.idempotencyKey, 160),
      },
      options({ retries: 1, timeout: 12000, dedupe: true })
    );
    if (!response || response.success === false) return mapFailure(response, "REMINDER_SUBSCRIPTION_GRANT_FAILED");
    return Object.assign({ success: true }, response);
  } catch (error) {
    return mapFailure(error, "REMINDER_SUBSCRIPTION_GRANT_FAILED");
  }
}

async function requestOperationConfirmation(input) {
  const source = input || {};
  const reminderId = encodeURIComponent(safeText(source.reminderId, 80));
  try {
    const response = await http.post(withEnv(`/api/ai/agent/reminders/${reminderId}/confirmations`), {
      operation: safeText(source.operation, 16),
      patch: source.patch && typeof source.patch === "object" ? source.patch : {},
      idempotencyKey: safeText(source.idempotencyKey, 160),
    }, options({ retries: 0 }));
    if (!response || response.success === false) return mapFailure(response, "REMINDER_CONFIRMATION_FAILED");
    return Object.assign({ success: true }, response);
  } catch (error) {
    return mapFailure(error, "REMINDER_CONFIRMATION_FAILED");
  }
}

async function updateReminder(input) {
  const source = input || {};
  const reminderId = encodeURIComponent(safeText(source.reminderId, 80));
  try {
    const response = await http.request(withEnv(`/api/ai/agent/reminders/${reminderId}`), "PATCH", {
      patch: source.patch && typeof source.patch === "object" ? source.patch : {},
      confirmationProof: safeText(source.confirmationProof, 8000),
      idempotencyKey: safeText(source.idempotencyKey, 160),
    }, options({ retries: 0 }));
    if (!response || response.success === false) return mapFailure(response, "REMINDER_UPDATE_FAILED");
    return Object.assign({ success: true }, response);
  } catch (error) {
    return mapFailure(error, "REMINDER_UPDATE_FAILED");
  }
}

async function deleteReminder(input) {
  const source = input || {};
  const reminderId = encodeURIComponent(safeText(source.reminderId, 80));
  try {
    const response = await http.request(withEnv(`/api/ai/agent/reminders/${reminderId}`), "DELETE", {
      confirmationProof: safeText(source.confirmationProof, 8000),
      idempotencyKey: safeText(source.idempotencyKey, 160),
    }, options({ retries: 0 }));
    if (!response || response.success === false) return mapFailure(response, "REMINDER_DELETE_FAILED");
    return Object.assign({ success: true }, response);
  } catch (error) {
    return mapFailure(error, "REMINDER_DELETE_FAILED");
  }
}

function sanitizeScheduleSummary(value) {
  return scheduleChangeTracker.sanitizeSummary(value) || { enabled: false, fingerprint: "", courses: [] };
}

async function reportScheduleChange(input) {
  const source = input && typeof input === "object" ? input : {};
  const currentScheduleSummary = sanitizeScheduleSummary(source.currentScheduleSummary);
  const baselineScheduleSummary = sanitizeScheduleSummary(source.baselineScheduleSummary);
  if (!currentScheduleSummary.enabled || !baselineScheduleSummary.enabled) {
    return { success: false, code: "SCHEDULE_CHANGE_CONTEXT_REQUIRED", error: "缺少可核验的课表变化摘要" };
  }
  try {
    const response = await http.post(withEnv("/api/ai/agent/reminders/schedule-change-events"), {
      currentScheduleSummary,
      baselineScheduleSummary,
      todayDate: safeText(source.todayDate, 10),
      todayWeekday: Math.max(1, Math.min(7, Number(source.todayWeekday || 1) || 1)),
      currentTeachingWeek: Math.max(0, Number(source.currentTeachingWeek || 0) || 0),
      idempotencyKey: safeText(source.idempotencyKey, 120),
    }, options({ retries: 0, timeout: 15000, dedupe: true }));
    if (!response || response.success === false) return mapFailure(response, "SCHEDULE_CHANGE_REPORT_FAILED");
    return Object.assign({ success: true }, response);
  } catch (error) {
    return mapFailure(error, "SCHEDULE_CHANGE_REPORT_FAILED");
  }
}

function requestWechatSubscription(capability) {
  const source = capability || {};
  if (!source.configured || !safeText(source.templateId, 160)) {
    return Promise.resolve({
      status: "not_requested",
      channel: "app_only",
      permanentSubscription: false,
      disclosure: "微信订阅模板未配置，已使用应用内提醒。",
    });
  }
  if (typeof wx === "undefined" || typeof wx.requestSubscribeMessage !== "function") {
    return Promise.resolve({
      status: "not_requested",
      channel: "app_only",
      permanentSubscription: false,
      disclosure: "当前环境不支持微信订阅授权，已使用应用内提醒。",
    });
  }
  const templateId = safeText(source.templateId, 160);
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success(result) {
        const status = safeText(result && result[templateId], 32).toLowerCase();
        const accepted = status === "accept";
        resolve({
          status: accepted ? "accept" : (status === "ban" ? "ban" : "reject"),
          channel: accepted ? "wechat_subscription" : "app_only",
          permanentSubscription: false,
          disclosure: accepted
            ? "已获得本次订阅授权；后续提醒仍受微信平台的一次性订阅规则限制。"
            : "未获得本次微信订阅授权，已保留应用内提醒。",
        });
      },
      fail() {
        resolve({
          status: "not_requested",
          channel: "app_only",
          permanentSubscription: false,
          disclosure: "订阅授权未完成，已保留应用内提醒。",
        });
      },
    });
  });
}

function makeIdempotencyKey(operation, reminderId) {
  const random = Math.random().toString(36).slice(2, 10);
  return `reminder-ui:${safeText(operation, 16)}:${safeText(reminderId, 48)}:${Date.now()}:${random}`.slice(0, 160);
}

module.exports = {
  acknowledgeInAppEvent,
  createReminder,
  createReminderFromConfig,
  planReminder,
  deleteReminder,
  getCapability,
  grantSubscriptionAuthorization,
  listInAppEvents,
  listReminders,
  makeIdempotencyKey,
  requestOperationConfirmation,
  reportScheduleChange,
  requestWechatSubscription,
  sanitizeScheduleSummary,
  updateReminder,
};
