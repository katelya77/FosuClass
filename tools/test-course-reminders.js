#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-course-reminders-"));
process.env.NODE_ENV = "test";
process.env.FOSU_DATA_DIR = tempDir;
process.env.FOSU_AGENT_REMINDER_SECRET = "test-course-reminder-secret-32-bytes";

const { planCourseReminder } = require("../server/src/services/ai/reminders/courseReminderPlanner");
const { CourseReminderService } = require("../server/src/services/ai/reminders/courseReminderService");
const { CourseReminderDispatchService } = require("../server/src/services/ai/reminders/courseReminderDispatchService");

const principal = {
  authenticated: true,
  principalKey: "principal_reminder_user_a",
  runtimeMode: "public",
};
const otherPrincipal = {
  authenticated: true,
  principalKey: "principal_reminder_user_b",
  runtimeMode: "public",
};

const context = {
  timezone: "Asia/Shanghai",
  todayDate: "2026-07-22",
  todayWeekday: 3,
  currentTeachingWeek: 20,
  termStartDate: "2026-03-09",
  currentScheduleSummary: {
    enabled: true,
    fingerprint: "schedule-fingerprint-1",
    courses: [
      {
        courseName: "动物解剖学",
        teacherName: "张老师",
        classroom: "B8-203",
        campus: "仙溪校区",
        weekday: 4,
        startSection: 6,
        endSection: 7,
        weeks: [20, 21],
      },
      {
        courseName: "大学英语",
        teacherName: "李老师",
        classroom: "C7-101",
        campus: "仙溪校区",
        weekday: 5,
        startSection: 1,
        endSection: 2,
        weeks: [20, 21],
      },
    ],
  },
  userPreferences: { defaultReminderLeadMinutes: 20 },
};

async function run() {
  const allCourses = planCourseReminder("以后上课前20分钟提醒我", context);
  assert.strictEqual(allCourses.success, true);
  assert.strictEqual(allCourses.operation, "create");
  assert.strictEqual(allCourses.scope, "all_courses");
  assert.strictEqual(allCourses.leadMinutes, 20);
  assert.strictEqual(allCourses.requiresConfirmation, true);
  assert.strictEqual(allCourses.timezone, "Asia/Shanghai");
  assert.strictEqual(allCourses.nextOccurrence.courseName, "动物解剖学");
  assert.strictEqual(allCourses.nextOccurrence.endTime, "14:55");
  assert.strictEqual(allCourses.nextOccurrence.durationMinutes, 85);
  assert.strictEqual(allCourses.nextOccurrence.durationText, "1小时25分钟");
  assert.strictEqual(allCourses.nextTriggerAt, "2026-07-23T05:10:00.000Z");

  const firstTomorrow = planCourseReminder("明天第一节课提前半小时通知", context);
  assert.strictEqual(firstTomorrow.scope, "date_course");
  assert.strictEqual(firstTomorrow.leadMinutes, 30);
  assert.strictEqual(firstTomorrow.courseIndex, 1);
  assert.strictEqual(firstTomorrow.targetDate, "2026-07-23");

  const roomChange = planCourseReminder("只有换教室时提醒我", context);
  assert.strictEqual(roomChange.scope, "room_change");
  assert.strictEqual(roomChange.eventDriven, true);

  const cancellation = planCourseReminder("取消周三下午的提醒", context);
  assert.strictEqual(cancellation.operation, "delete");
  assert.strictEqual(cancellation.filter.weekday, 3);
  assert.strictEqual(cancellation.filter.period, "afternoon");

  const service = new CourseReminderService({
    dataDir: path.join(tempDir, "reminders"),
    secret: process.env.FOSU_AGENT_REMINDER_SECRET,
    now: () => Date.parse("2026-07-22T04:00:00.000Z"),
  });
  const idempotencyKey = "conv-a:turn-1:create-all";
  const confirmation = service.createConfirmation({
    principal,
    operation: "create",
    payload: allCourses,
    idempotencyKey,
  });
  assert.ok(confirmation.token);
  assert.ok(confirmation.expiresAt);

  const created = service.create({
    principal,
    confirmationToken: confirmation.token,
    idempotencyKey,
    subscriptionStatus: "accept",
  });
  assert.strictEqual(created.success, true);
  assert.strictEqual(created.reminder.channel, "wechat_subscription");
  assert.strictEqual(created.reminder.authorizationState, "reported_granted");
  assert.strictEqual(created.reminder.status, "enabled");

  const duplicate = service.create({
    principal,
    confirmationToken: confirmation.token,
    idempotencyKey,
    subscriptionStatus: "accept",
  });
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(duplicate.reminder.id, created.reminder.id);
  assert.strictEqual(service.list({ principal }).items.length, 1);

  assert.throws(() => service.create({
    principal: otherPrincipal,
    confirmationToken: confirmation.token,
    idempotencyKey,
  }), (error) => error && error.code === "REMINDER_CONFIRMATION_INVALID");

  assert.throws(() => service.update({
    principal,
    reminderId: created.reminder.id,
    patch: { status: "paused" },
  }), (error) => error && error.code === "REMINDER_CONFIRMATION_REQUIRED");
  const pauseConfirmation = service.createConfirmation({
    principal,
    operation: "update",
    reminderId: created.reminder.id,
    payload: { status: "paused" },
    idempotencyKey: "pause-1",
  });
  const paused = service.update({
    principal,
    reminderId: created.reminder.id,
    patch: { status: "paused" },
    confirmationToken: pauseConfirmation.token,
    idempotencyKey: "pause-1",
  });
  assert.strictEqual(paused.reminder.status, "paused");

  const resumeConfirmation = service.createConfirmation({
    principal,
    operation: "update",
    reminderId: created.reminder.id,
    payload: { status: "enabled", leadMinutes: 25 },
    idempotencyKey: "resume-1",
  });
  const resumed = service.update({
    principal,
    reminderId: created.reminder.id,
    patch: { status: "enabled", leadMinutes: 25 },
    confirmationToken: resumeConfirmation.token,
    idempotencyKey: "resume-1",
  });
  assert.strictEqual(resumed.reminder.leadMinutes, 25);

  // Rejected subscription remains a real application-only reminder.
  const appPlan = Object.assign({}, firstTomorrow, {
    nextTriggerAt: "2026-07-22T03:59:00.000Z",
    nextOccurrence: Object.assign({}, firstTomorrow.nextOccurrence, {
      startsAt: "2026-07-22T04:20:00.000Z",
    }),
    recurrence: "once",
  });
  const appConfirmation = service.createConfirmation({
    principal,
    operation: "create",
    payload: appPlan,
    idempotencyKey: "app-only-1",
  });
  const appOnly = service.create({
    principal,
    confirmationToken: appConfirmation.token,
    idempotencyKey: "app-only-1",
    subscriptionStatus: "reject",
  });
  assert.strictEqual(appOnly.reminder.channel, "app_only");
  assert.strictEqual(appOnly.reminder.authorizationState, "rejected");

  const dispatch = new CourseReminderDispatchService({
    reminderService: service,
    send: async () => ({ success: true, code: "OK" }),
  });
  const dispatched = await dispatch.dispatchDue({ now: Date.parse("2026-07-22T04:00:00.000Z") });
  assert.strictEqual(dispatched.appOnlyDue, 1);
  assert.strictEqual(dispatched.sent, 0);
  const afterDispatch = service.get({ principal, reminderId: appOnly.reminder.id }).reminder;
  assert.ok(afterDispatch.sendLog.some((item) => item.code === "APP_ONLY_DUE"));
  assert.strictEqual(afterDispatch.status, "expired");
  const inAppInbox = service.listInAppEvents({ principal });
  assert.strictEqual(inAppInbox.success, true);
  assert.strictEqual(inAppInbox.items.length, 1);
  assert.strictEqual(inAppInbox.items[0].reminderId, appOnly.reminder.id);
  assert.strictEqual(inAppInbox.items[0].occurrence.courseName, "动物解剖学");
  assert.strictEqual(inAppInbox.items[0].kind, "course_start");
  const acknowledged = service.acknowledgeInAppEvent({
    principal,
    eventId: inAppInbox.items[0].id,
  });
  assert.strictEqual(acknowledged.success, true);
  assert.strictEqual(acknowledged.acknowledged, true);
  assert.strictEqual(service.listInAppEvents({ principal }).items.length, 0);

  // A confirmed room-change rule remains dormant until a verified classroom change arrives.
  const roomConfirmation = service.createConfirmation({
    principal,
    operation: "create",
    payload: roomChange,
    idempotencyKey: "room-change-rule-1",
  });
  const roomReminder = service.create({
    principal,
    confirmationToken: roomConfirmation.token,
    idempotencyKey: "room-change-rule-1",
    subscriptionStatus: "accept",
  });
  assert.strictEqual(roomReminder.reminder.eventDriven, true);
  assert.ok(!service.listDue({ now: Date.parse("2026-07-22T04:00:00.000Z") })
    .some((item) => item.reminder.id === roomReminder.reminder.id));

  const eventInput = {
    principal,
    idempotencyKey: "schedule-change:verified:v2",
    referenceDate: "2026-07-22",
    referenceWeekday: 3,
    referenceTeachingWeek: 20,
    change: {
      type: "modified",
      courseName: "动物解剖学",
      fields: ["classroom"],
      before: context.currentScheduleSummary.courses[0],
      after: Object.assign({}, context.currentScheduleSummary.courses[0], { classroom: "B9-301" }),
    },
  };
  const queued = service.queueScheduleChangeEvent(eventInput);
  assert.strictEqual(queued.queued, 1);
  assert.strictEqual(queued.duplicate, false);
  assert.strictEqual(queued.items[0].nextOccurrence.classroom, "B9-301");
  assert.strictEqual(queued.items[0].nextOccurrence.startTime, "13:30");
  const queuedAgain = service.queueScheduleChangeEvent(eventInput);
  assert.strictEqual(queuedAgain.queued, 0);
  assert.strictEqual(queuedAgain.duplicate, true);

  const roomDispatched = await dispatch.dispatchDue({ now: Date.parse("2026-07-22T04:00:00.000Z") });
  assert.strictEqual(roomDispatched.sent, 1);
  const roomAfterDispatch = service.get({ principal, reminderId: roomReminder.reminder.id }).reminder;
  assert.strictEqual(roomAfterDispatch.status, "enabled");
  assert.strictEqual(roomAfterDispatch.nextTriggerAt, "");
  assert.ok(roomAfterDispatch.sendLog.some((item) => item.code === "OK"));

  const deleteConfirmation = service.createConfirmation({
    principal,
    operation: "delete",
    reminderId: created.reminder.id,
    payload: {},
    idempotencyKey: "delete-1",
  });
  const removed = service.remove({
    principal,
    reminderId: created.reminder.id,
    confirmationToken: deleteConfirmation.token,
    idempotencyKey: "delete-1",
  });
  assert.strictEqual(removed.deleted, true);

  // Encrypted persistence must not reveal timetable facts or principal keys.
  const persistedText = fs.readdirSync(path.join(tempDir, "reminders"), { recursive: true })
    .filter((entry) => String(entry).endsWith(".json"))
    .map((entry) => fs.readFileSync(path.join(tempDir, "reminders", entry), "utf8"))
    .join("\n");
  assert.ok(!persistedText.includes("动物解剖学"));
  assert.ok(!persistedText.includes(principal.principalKey));

  console.log("test-course-reminders: PASS");
}

run().then(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
}).catch((error) => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.error(error && error.stack || error);
  process.exit(1);
});
