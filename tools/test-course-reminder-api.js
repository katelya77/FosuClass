#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

function requireServerDependency(name) {
  return require(require.resolve(name, { paths: [path.join(__dirname, "..", "server")] }));
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-reminder-api-"));
process.env.NODE_ENV = "development";
process.env.FOSU_DATA_DIR = tempDir;
process.env.FOSU_SESSION_SECRET = "test-reminder-api-session-secret";
process.env.FOSU_AGENT_REMINDER_SECRET = "test-reminder-api-encryption-secret";
process.env.FOSU_AGENT_MEMORY_SECRET = "test-reminder-api-memory-secret-32";
process.env.FOSU_DYNAMIC_API_SESSION_REQUIRED = "true";
delete process.env.WECHAT_COURSE_REMINDER_TEMPLATE_ID;
delete process.env.WECHAT_APPID;
delete process.env.WECHAT_APPSECRET;

const express = requireServerDependency("express");
const aiRouter = require("../server/src/routes/ai");
const { createSessionToken } = require("../server/src/utils/apiSecurity");
const { resolvePrincipal } = require("../server/src/services/ai/conversation/conversationPrincipalService");
const { defaultCourseReminderService } = require("../server/src/services/ai/reminders/courseReminderService");
const { planCourseReminder } = require("../server/src/services/ai/reminders/courseReminderPlanner");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, Object.assign({}, options, {
    headers: Object.assign({
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 MicroMessenger FosuClass-Test",
    }, options.headers || {}),
  }));
  return { status: response.status, data: await response.json() };
}

async function run() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/ai", aiRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const capability = await request(baseUrl, "/api/ai/agent/reminders/capability?envVersion=release");
    assert.strictEqual(capability.status, 200);
    assert.strictEqual(capability.data.permanentSubscription, false);
    assert.strictEqual(capability.data.deliveryMode, "app_only");
    assert.ok(capability.data.disclosure.includes("点击授权"));

    const session = createSessionToken({ appid: "wx-test", openid: "reminder-api-openid" });
    const headers = { "X-Fosu-Session": session.token };
    const unauthorized = await request(baseUrl, "/api/ai/agent/reminders?envVersion=release");
    assert.strictEqual(unauthorized.status, 401);

    const context = {
      todayDate: "2026-07-22",
      todayWeekday: 3,
      currentTeachingWeek: 20,
      clientTimestampMs: Date.parse("2026-07-22T04:00:00.000Z"),
      currentScheduleSummary: {
        enabled: true,
        fingerprint: "api-schedule",
        courses: [{
          courseName: "动物解剖学",
          teacherName: "张老师",
          classroom: "B8-203",
          campus: "仙溪校区",
          weekday: 4,
          startSection: 6,
          endSection: 7,
          weeks: [20, 21],
        }],
      },
    };
    const plan = planCourseReminder("以后上课前20分钟提醒我", context);
    const principal = resolvePrincipal({ serverSession: session.payload, runtimeMode: "public" });
    const idempotencyKey = "reminder-api-create-1";
    const confirmation = defaultCourseReminderService.createConfirmation({
      principal,
      operation: "create",
      payload: plan,
      idempotencyKey,
    });
    const createBody = JSON.stringify({
      confirmationProof: confirmation.token,
      idempotencyKey,
      subscriptionStatus: "reject",
    });
    const created = await request(baseUrl, "/api/ai/agent/reminders?envVersion=release", {
      method: "POST",
      headers,
      body: createBody,
    });
    assert.strictEqual(created.status, 200);
    assert.strictEqual(created.data.success, true);
    assert.strictEqual(created.data.reminder.channel, "app_only");
    assert.ok(created.data.deliveryDisclosure.includes("应用内提醒"));

    const duplicate = await request(baseUrl, "/api/ai/agent/reminders?envVersion=release", {
      method: "POST",
      headers,
      body: createBody,
    });
    assert.strictEqual(duplicate.data.duplicate, true);

    const reminderId = created.data.reminder.id;
    const granted = await request(baseUrl, `/api/ai/agent/reminders/${reminderId}/subscription-authorizations?envVersion=release`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subscriptionStatus: "accept", idempotencyKey: "reminder-api-grant-1" }),
    });
    assert.strictEqual(granted.status, 200);
    assert.strictEqual(granted.data.reminder.authorizationCredits, 1);
    assert.strictEqual(granted.data.reminder.channel, "wechat_subscription");
    const duplicateGrant = await request(baseUrl, `/api/ai/agent/reminders/${reminderId}/subscription-authorizations?envVersion=release`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subscriptionStatus: "accept", idempotencyKey: "reminder-api-grant-1" }),
    });
    assert.strictEqual(duplicateGrant.data.duplicate, true);
    assert.strictEqual(duplicateGrant.data.reminder.authorizationCredits, 1);
    const rejectedGrant = await request(baseUrl, `/api/ai/agent/reminders/${reminderId}/subscription-authorizations?envVersion=release`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subscriptionStatus: "reject", idempotencyKey: "reminder-api-grant-reject" }),
    });
    assert.strictEqual(rejectedGrant.status, 409);

    const updateKey = "reminder-api-pause-1";
    const updateConfirmation = await request(baseUrl, `/api/ai/agent/reminders/${reminderId}/confirmations?envVersion=release`, {
      method: "POST",
      headers,
      body: JSON.stringify({ operation: "update", patch: { status: "paused" }, idempotencyKey: updateKey }),
    });
    assert.strictEqual(updateConfirmation.data.success, true);
    assert.ok(updateConfirmation.data.confirmationProof);
    const paused = await request(baseUrl, `/api/ai/agent/reminders/${reminderId}?envVersion=release`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        patch: { status: "paused" },
        confirmationProof: updateConfirmation.data.confirmationProof,
        idempotencyKey: updateKey,
      }),
    });
    assert.strictEqual(paused.data.reminder.status, "paused");

    const listed = await request(baseUrl, "/api/ai/agent/reminders?envVersion=release", { headers });
    assert.strictEqual(listed.data.items.length, 1);
    assert.strictEqual(listed.data.items[0].status, "paused");

    const roomPlan = planCourseReminder("只有换教室时提醒我", context);
    const roomKey = "reminder-api-room-change-1";
    const roomProof = defaultCourseReminderService.createConfirmation({
      principal,
      operation: "create",
      payload: roomPlan,
      idempotencyKey: roomKey,
    });
    const roomCreated = await request(baseUrl, "/api/ai/agent/reminders?envVersion=release", {
      method: "POST",
      headers,
      body: JSON.stringify({
        confirmationProof: roomProof.token,
        idempotencyKey: roomKey,
        subscriptionStatus: "reject",
      }),
    });
    assert.strictEqual(roomCreated.data.reminder.eventDriven, true);

    const changedSummary = Object.assign({}, context.currentScheduleSummary, {
      fingerprint: "api-schedule-v2",
      courses: [Object.assign({}, context.currentScheduleSummary.courses[0], { classroom: "B9-301" })],
    });
    const eventResponse = await request(baseUrl, "/api/ai/agent/reminders/schedule-change-events?envVersion=release", {
      method: "POST",
      headers,
      body: JSON.stringify({
        currentScheduleSummary: changedSummary,
        baselineScheduleSummary: context.currentScheduleSummary,
        todayDate: "2026-07-22",
        todayWeekday: 3,
        currentTeachingWeek: 20,
        idempotencyKey: "api-schedule:api-schedule-v2",
      }),
    });
    assert.strictEqual(eventResponse.status, 200);
    assert.strictEqual(eventResponse.data.changed, true);
    assert.strictEqual(eventResponse.data.roomChangeCount, 1);
    assert.strictEqual(eventResponse.data.queued, 1);
    assert.strictEqual(eventResponse.data.delivery.appOnlyDue, 1);

    const inAppEvents = await request(baseUrl, "/api/ai/agent/reminders/in-app-events?envVersion=release", { headers });
    assert.strictEqual(inAppEvents.status, 200);
    assert.strictEqual(inAppEvents.data.success, true);
    assert.strictEqual(inAppEvents.data.items.length, 1);
    assert.strictEqual(inAppEvents.data.items[0].kind, "schedule_change");
    assert.strictEqual(inAppEvents.data.items[0].occurrence.classroom, "B9-301");
    const acknowledgedEvent = await request(
      baseUrl,
      `/api/ai/agent/reminders/in-app-events/${encodeURIComponent(inAppEvents.data.items[0].id)}/acknowledge?envVersion=release`,
      { method: "POST", headers, body: "{}" }
    );
    assert.strictEqual(acknowledgedEvent.status, 200);
    assert.strictEqual(acknowledgedEvent.data.acknowledged, true);
    const emptyInAppEvents = await request(baseUrl, "/api/ai/agent/reminders/in-app-events?envVersion=release", { headers });
    assert.strictEqual(emptyInAppEvents.data.items.length, 0);

    const afterEvent = await request(baseUrl, "/api/ai/agent/reminders?envVersion=release", { headers });
    const roomAfterEvent = afterEvent.data.items.find((item) => item.id === roomCreated.data.reminder.id);
    assert.ok(roomAfterEvent.sendLog.some((item) => item.code === "APP_ONLY_DUE"));
    assert.strictEqual(roomAfterEvent.status, "enabled");

    const deleteKey = "reminder-api-delete-1";
    const deleteConfirmation = await request(baseUrl, `/api/ai/agent/reminders/${reminderId}/confirmations?envVersion=release`, {
      method: "POST",
      headers,
      body: JSON.stringify({ operation: "delete", patch: {}, idempotencyKey: deleteKey }),
    });
    const removed = await request(baseUrl, `/api/ai/agent/reminders/${reminderId}?envVersion=release`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ confirmationProof: deleteConfirmation.data.confirmationProof, idempotencyKey: deleteKey }),
    });
    assert.strictEqual(removed.data.deleted, true);

    console.log("test-course-reminder-api: PASS");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().then(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
}).catch((error) => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.error(error && error.stack || error);
  process.exit(1);
});
