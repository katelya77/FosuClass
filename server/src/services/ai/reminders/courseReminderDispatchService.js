const { defaultCourseReminderService, RETRY_DELAYS_MS } = require("./courseReminderService");
const { defaultWechatSubscriptionService } = require("./wechatSubscriptionService");

class CourseReminderDispatchService {
  constructor(options = {}) {
    this.reminderService = options.reminderService || defaultCourseReminderService;
    this.send = typeof options.send === "function"
      ? options.send
      : (payload) => defaultWechatSubscriptionService.sendCourseReminder(payload);
    this.running = false;
  }

  async dispatchDue(input = {}) {
    if (this.running) return { success: true, skipped: true, reason: "dispatch_in_progress", due: 0, sent: 0 };
    this.running = true;
    const now = Number(input.now || Date.now());
    const result = { success: true, due: 0, sent: 0, failed: 0, retried: 0, appOnlyDue: 0 };
    try {
      const due = this.reminderService.listDue({ now, limit: input.limit || 50 });
      result.due = due.length;
      for (const item of due) {
        const reminder = item.reminder || {};
        let sendResult;
        const authorizationCredits = Math.max(0, Number(reminder.authorizationCredits || 0) || 0);
        if (reminder.channel !== "wechat_subscription"
          || reminder.authorizationState !== "reported_granted"
          || authorizationCredits < 1) {
          sendResult = { success: false, code: "APP_ONLY_DUE", retryable: false };
          result.appOnlyDue += 1;
        } else {
          try {
            sendResult = await this.send({ principalKey: item.principalKey, reminder });
          } catch (error) {
            sendResult = {
              success: false,
              code: String(error && error.code || "WECHAT_SEND_FAILED").slice(0, 80),
              retryable: error && error.retryable !== false,
            };
          }
          if (sendResult && sendResult.success === true) {
            result.sent += 1;
          } else if (sendResult && sendResult.retryable !== false) {
            if (Number(reminder.attempts || 0) >= RETRY_DELAYS_MS.length) {
              sendResult = Object.assign({}, sendResult, { fallbackToApp: true });
              result.failed += 1;
              result.appOnlyDue += 1;
            } else {
              result.retried += 1;
            }
          } else {
            sendResult = Object.assign({}, sendResult, { fallbackToApp: true });
            result.failed += 1;
            result.appOnlyDue += 1;
          }
        }
        this.reminderService.recordDispatch({
          principalKey: item.principalKey,
          reminderId: reminder.id,
          result: sendResult,
          now,
        });
      }
      this.reminderService.pruneExpired({ now });
      return result;
    } finally {
      this.running = false;
    }
  }

  schedule(options = {}) {
    if (String(process.env.FOSU_COURSE_REMINDER_DISPATCH_ENABLED || "false").toLowerCase() !== "true") {
      return { enabled: false, interval: null };
    }
    const intervalMs = Math.max(30000, Number(options.intervalMs || process.env.FOSU_COURSE_REMINDER_DISPATCH_INTERVAL_MS || 60000) || 60000);
    const interval = setInterval(() => {
      this.dispatchDue().catch(() => {});
    }, intervalMs);
    if (interval.unref) interval.unref();
    return { enabled: true, interval };
  }
}

const defaultCourseReminderDispatchService = new CourseReminderDispatchService();

module.exports = {
  CourseReminderDispatchService,
  defaultCourseReminderDispatchService,
};
