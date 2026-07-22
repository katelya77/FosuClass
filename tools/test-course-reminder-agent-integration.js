#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-reminder-agent-"));
process.env.NODE_ENV = "test";
process.env.AI_RUNTIME_MODE = "public";
process.env.AI_AGENT_ENABLED = "false";
process.env.FOSU_DATA_DIR = tempDir;
process.env.FOSU_AGENT_REMINDER_SECRET = "test-agent-reminder-secret-32-bytes";
process.env.FOSU_AGENT_MEMORY_SECRET = "test-agent-memory-secret-32-bytes";

const manifest = require("../server/config/agent-capability-manifest.json");
const toolRegistry = require("../server/src/services/ai/toolRegistry");
const agentService = require("../server/src/services/ai/agentService");
const { defaultCourseReminderService } = require("../server/src/services/ai/reminders/courseReminderService");
const { resolvePrincipal } = require("../server/src/services/ai/conversation/conversationPrincipalService");

const serverSession = {
  openidHash: "reminder-integration-openid-hash",
  sessionIdHash: "reminder-integration-session-hash",
  appid: "wx-test",
};

const context = {
  timezone: "Asia/Shanghai",
  todayDate: "2026-07-22",
  todayWeekday: 3,
  currentTeachingWeek: 20,
  clientTimestampMs: Date.parse("2026-07-22T04:00:00.000Z"),
  currentScheduleSummary: {
    enabled: true,
    fingerprint: "schedule-agent-fingerprint",
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
  userPreferences: { defaultReminderLeadMinutes: 20 },
};

function assertToolContract(name, operation, requiresConfirmation) {
  const tool = manifest.tools[name];
  assert.ok(tool, `${name} must be declared in capability manifest`);
  assert.strictEqual(tool.operation, operation);
  assert.ok(tool.inputSchema && tool.inputSchema.type === "object");
  assert.ok(Array.isArray(tool.runtimeModes) && tool.runtimeModes.includes("public"));
  assert.ok(Number(tool.timeoutMs) > 0);
  assert.ok(Array.isArray(tool.errorCodes) && tool.errorCodes.length > 0);
  if (requiresConfirmation) assert.strictEqual(tool.confirmation, "required");
}

async function run() {
  assertToolContract("create_course_reminder", "write", true);
  assertToolContract("update_course_reminder", "write", true);
  assertToolContract("delete_course_reminder", "write", true);
  assertToolContract("list_course_reminders", "read", false);

  const intent = toolRegistry.resolveIntent("以后上课前20分钟提醒我", context);
  assert.strictEqual(intent.name, "manage_course_reminders");
  const plan = toolRegistry.buildPlanForIntent(intent, "以后上课前20分钟提醒我", context);
  assert.strictEqual(plan[0].toolName, "create_course_reminder");

  const response = await agentService.chat({
    message: "以后上课前20分钟提醒我",
    conversationId: "conv-reminder-integration",
    protocolVersion: "agent.v2",
    runtimeMode: "public",
    context,
    serverSession,
  });
  assert.strictEqual(response.success, true);
  assert.strictEqual(response.externalProviderUsed, false);
  assert.strictEqual(response.intent.name || response.intent, "manage_course_reminders");
  assert.ok(response.steps.some((item) => item.tool === "create_course_reminder"));
  assert.ok(!JSON.stringify(response.toolCalls).includes("confirmationProof"), "confirmation capability must stay out of tool observations");
  const reminderCard = response.cards.find((card) => card.type === "reminder");
  assert.ok(reminderCard, "reminder confirmation card required");
  const confirmAction = reminderCard.actions.find((action) => action.type === "confirmReminder");
  assert.ok(confirmAction, "confirmReminder action required");
  // One-tap create: no secondary modal; lead/scope drive client configure path.
  assert.strictEqual(Number(confirmAction.payload.leadMinutes), 20);
  assert.ok(confirmAction.payload.scope);
  assert.ok(confirmAction.payload.confirmationProof, "proof still attached as fallback");
  assert.ok(confirmAction.payload.idempotencyKey);

  const principal = resolvePrincipal({ serverSession, runtimeMode: "public" });
  assert.strictEqual(defaultCourseReminderService.list({ principal }).items.length, 0, "planning must not write");

  const created = defaultCourseReminderService.create({
    principal,
    confirmationToken: confirmAction.payload.confirmationProof,
    idempotencyKey: confirmAction.payload.idempotencyKey,
    subscriptionStatus: "reject",
  });
  const duplicate = defaultCourseReminderService.create({
    principal,
    confirmationToken: confirmAction.payload.confirmationProof,
    idempotencyKey: confirmAction.payload.idempotencyKey,
    subscriptionStatus: "reject",
  });
  assert.strictEqual(created.reminder.channel, "app_only");
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(defaultCourseReminderService.list({ principal }).items.length, 1);

  console.log("test-course-reminder-agent-integration: PASS");
}

run().then(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
}).catch((error) => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.error(error && error.stack || error);
  process.exit(1);
});
