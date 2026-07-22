#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-reminder-credits-"));
const { planCourseReminder } = require("../server/src/services/ai/reminders/courseReminderPlanner");
const { CourseReminderService } = require("../server/src/services/ai/reminders/courseReminderService");

const principal = {
  authenticated: true,
  principalKey: "principal_subscription_credit_test",
  runtimeMode: "public",
};
const context = {
  timezone: "Asia/Shanghai",
  todayDate: "2026-07-22",
  todayWeekday: 3,
  currentTeachingWeek: 20,
  currentScheduleSummary: {
    enabled: true,
    fingerprint: "credits-schedule-v1",
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

const service = new CourseReminderService({
  dataDir: path.join(tempDir, "reminders"),
  secret: "test-reminder-credit-secret-32-bytes",
  now: () => Date.parse("2026-07-22T04:00:00.000Z"),
});

function createReminder(subscriptionStatus, suffix) {
  const plan = planCourseReminder("以后上课前20分钟提醒我", context);
  const idempotencyKey = `create-credit-${suffix}`;
  const confirmation = service.createConfirmation({
    principal,
    operation: "create",
    payload: plan,
    idempotencyKey,
  });
  return service.create({
    principal,
    confirmationToken: confirmation.token,
    idempotencyKey,
    subscriptionStatus,
  });
}

const accepted = createReminder("accept", "accepted");
assert.strictEqual(accepted.reminder.authorizationCredits, 1);

const grantInput = {
  principal,
  reminderId: accepted.reminder.id,
  subscriptionStatus: "accept",
  idempotencyKey: "grant-credit-1",
};
const granted = service.grantSubscriptionAuthorization(grantInput);
assert.strictEqual(granted.success, true);
assert.strictEqual(granted.duplicate, false);
assert.strictEqual(granted.reminder.authorizationCredits, 2);
assert.strictEqual(granted.reminder.authorizationState, "reported_granted");
assert.strictEqual(granted.reminder.channel, "wechat_subscription");

const duplicate = service.grantSubscriptionAuthorization(grantInput);
assert.strictEqual(duplicate.success, true);
assert.strictEqual(duplicate.duplicate, true);
assert.strictEqual(duplicate.reminder.authorizationCredits, 2);

assert.throws(() => service.grantSubscriptionAuthorization({
  principal,
  reminderId: accepted.reminder.id,
  subscriptionStatus: "reject",
  idempotencyKey: "grant-credit-rejected",
}), (error) => error && error.code === "REMINDER_SUBSCRIPTION_NOT_ACCEPTED");

for (let index = 2; index <= 35; index += 1) {
  service.grantSubscriptionAuthorization({
    principal,
    reminderId: accepted.reminder.id,
    subscriptionStatus: "accept",
    idempotencyKey: `grant-credit-${index}`,
  });
}
assert.strictEqual(service.get({ principal, reminderId: accepted.reminder.id }).reminder.authorizationCredits, 30);

const rejected = createReminder("reject", "rejected");
assert.strictEqual(rejected.reminder.authorizationCredits, 0);
assert.strictEqual(rejected.reminder.authorizationState, "rejected");

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("test-course-reminder-authorization-credits: PASS");
