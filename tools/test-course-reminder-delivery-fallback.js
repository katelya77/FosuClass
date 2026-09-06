#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const rootTemp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-reminder-delivery-"));
process.env.FOSU_AGENT_REMINDER_SECRET = "test-reminder-delivery-secret-32";

const { planCourseReminder } = require("../server/src/services/ai/reminders/courseReminderPlanner");
const { CourseReminderService } = require("../server/src/services/ai/reminders/courseReminderService");
const { CourseReminderDispatchService } = require("../server/src/services/ai/reminders/courseReminderDispatchService");

const baseNow = Date.parse("2026-07-22T04:00:00.000Z");
const context = {
  timezone: "Asia/Shanghai",
  todayDate: "2026-07-22",
  todayWeekday: 3,
  currentTeachingWeek: 20,
  currentScheduleSummary: {
    enabled: true,
    fingerprint: "delivery-schedule-v1",
    courses: [{
      courseName: "动物解剖学",
      teacherName: "张老师",
      classroom: "B8-203",
      campus: "仙溪校区",
      weekday: 4,
      startSection: 6,
      endSection: 7,
      weeks: [20, 21, 22],
    }],
  },
};

function setup(name) {
  const principal = {
    authenticated: true,
    principalKey: `principal_delivery_${name}`,
    runtimeMode: "public",
  };
  const service = new CourseReminderService({
    dataDir: path.join(rootTemp, name),
    secret: process.env.FOSU_AGENT_REMINDER_SECRET,
    now: () => baseNow,
  });
  const plan = planCourseReminder("以后上课前20分钟提醒我", context);
  const idempotencyKey = `create-${name}`;
  const confirmation = service.createConfirmation({ principal, operation: "create", payload: plan, idempotencyKey });
  const created = service.create({
    principal,
    confirmationToken: confirmation.token,
    idempotencyKey,
    subscriptionStatus: "accept",
  });
  return { principal, service, created };
}

async function run() {
  const successScenario = setup("success");
  let successCalls = 0;
  const successDispatch = new CourseReminderDispatchService({
    reminderService: successScenario.service,
    send: async () => {
      successCalls += 1;
      return { success: true, code: "OK", retryable: false };
    },
  });
  const firstDueAt = Date.parse(successScenario.created.reminder.nextTriggerAt);
  await successDispatch.dispatchDue({ now: firstDueAt, limit: 10 });
  const afterSuccess = successScenario.service.get({
    principal: successScenario.principal,
    reminderId: successScenario.created.reminder.id,
  }).reminder;
  assert.strictEqual(successCalls, 1);
  assert.strictEqual(afterSuccess.authorizationCredits, 0);
  assert.strictEqual(afterSuccess.authorizationState, "authorization_required");
  assert.strictEqual(afterSuccess.status, "enabled");

  const secondDueAt = Date.parse(afterSuccess.nextTriggerAt);
  const secondDispatch = await successDispatch.dispatchDue({ now: secondDueAt, limit: 10 });
  assert.strictEqual(successCalls, 1, "zero-credit occurrence must not call WeChat");
  assert.strictEqual(secondDispatch.appOnlyDue, 1);
  assert.strictEqual(successScenario.service.listInAppEvents({ principal: successScenario.principal, now: secondDueAt }).items.length, 1);
  assert.strictEqual(successScenario.service.listInAppEvents({
    principal: successScenario.principal,
    now: secondDueAt + (24 * 60 * 60 * 1000),
  }).items.length, 0, "course reminders from a previous Shanghai calendar day must be pruned");

  const unauthorizedScenario = setup("unauthorized");
  const unauthorizedDispatch = new CourseReminderDispatchService({
    reminderService: unauthorizedScenario.service,
    send: async () => ({
      success: false,
      code: "WECHAT_SUBSCRIPTION_NOT_AUTHORIZED",
      retryable: false,
    }),
  });
  const unauthorizedDueAt = Date.parse(unauthorizedScenario.created.reminder.nextTriggerAt);
  await unauthorizedDispatch.dispatchDue({
    now: unauthorizedDueAt,
    limit: 10,
  });
  const afterUnauthorized = unauthorizedScenario.service.get({
    principal: unauthorizedScenario.principal,
    reminderId: unauthorizedScenario.created.reminder.id,
  }).reminder;
  assert.strictEqual(afterUnauthorized.authorizationCredits, 0);
  assert.strictEqual(afterUnauthorized.authorizationState, "authorization_required");
  assert.strictEqual(afterUnauthorized.status, "enabled");
  assert.strictEqual(unauthorizedScenario.service.listInAppEvents({ principal: unauthorizedScenario.principal, now: unauthorizedDueAt }).items.length, 1);

  const invalidTemplateDataScenario = setup("invalid-template-data");
  const invalidTemplateDataDispatch = new CourseReminderDispatchService({
    reminderService: invalidTemplateDataScenario.service,
    send: async () => ({
      success: false,
      code: "WECHAT_TEMPLATE_DATA_INVALID",
      retryable: false,
    }),
  });
  const invalidTemplateDataDueAt = Date.parse(invalidTemplateDataScenario.created.reminder.nextTriggerAt);
  await invalidTemplateDataDispatch.dispatchDue({ now: invalidTemplateDataDueAt, limit: 10 });
  const afterInvalidTemplateData = invalidTemplateDataScenario.service.get({
    principal: invalidTemplateDataScenario.principal,
    reminderId: invalidTemplateDataScenario.created.reminder.id,
  }).reminder;
  assert.strictEqual(afterInvalidTemplateData.authorizationCredits, 0);
  assert.strictEqual(afterInvalidTemplateData.authorizationState, "configuration_required");
  assert.strictEqual(invalidTemplateDataScenario.service.listInAppEvents({
    principal: invalidTemplateDataScenario.principal,
    now: invalidTemplateDataDueAt,
  }).items.length, 1);

  const retryScenario = setup("retry");
  let retryCalls = 0;
  const retryDispatch = new CourseReminderDispatchService({
    reminderService: retryScenario.service,
    send: async () => {
      retryCalls += 1;
      return { success: false, code: "WECHAT_NETWORK_ERROR", retryable: true };
    },
  });
  let retryReminder = retryScenario.created.reminder;
  let retryAttemptAt = Date.parse(retryReminder.nextTriggerAt);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    retryAttemptAt = Date.parse(retryReminder.nextTriggerAt);
    await retryDispatch.dispatchDue({ now: retryAttemptAt, limit: 10 });
    retryReminder = retryScenario.service.get({
      principal: retryScenario.principal,
      reminderId: retryReminder.id,
    }).reminder;
  }
  assert.strictEqual(retryCalls, 4);
  assert.strictEqual(retryReminder.status, "enabled");
  assert.strictEqual(retryScenario.service.listInAppEvents({ principal: retryScenario.principal, now: retryAttemptAt }).items.length, 1);
  assert.ok(retryReminder.sendLog.some((item) => item.status === "app_only" && item.code === "WECHAT_NETWORK_ERROR"));

  fs.rmSync(rootTemp, { recursive: true, force: true });
  console.log("test-course-reminder-delivery-fallback: PASS");
}

run().catch((error) => {
  fs.rmSync(rootTemp, { recursive: true, force: true });
  console.error(error && error.stack || error);
  process.exit(1);
});
