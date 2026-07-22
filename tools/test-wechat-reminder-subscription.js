#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-wechat-reminder-"));

const { WechatRecipientVault } = require("../server/src/services/ai/reminders/wechatRecipientVault");
const {
  DEFAULT_FIELD_MAP,
  WechatSubscriptionService,
  buildTemplateData,
  loadFieldMap,
  mapWechatSendError,
} = require("../server/src/services/ai/reminders/wechatSubscriptionService");

async function run() {
  assert.deepStrictEqual(DEFAULT_FIELD_MAP, {
    courseName: "thing8",
    startTime: "time15",
    duration: "thing2",
    teacherName: "thing14",
    classroom: "thing4",
  });
  assert.deepStrictEqual(loadFieldMap({
    courseName: "thing8",
    startTime: "time15",
    duration: "thing2",
    teacherName: "thing14",
    classroom: "thing4",
    campus: "thing99",
    unexpected: "thing100",
  }), DEFAULT_FIELD_MAP, "only supported template fields should be emitted");
  assert.deepStrictEqual(buildTemplateData({
    courseName: "动物解剖学",
    date: "2026-07-23",
    startTime: "13:30",
    durationText: "1小时25分钟",
    teacherName: "张老师",
    campus: "仙溪校区",
    classroom: "B8-203",
  }, DEFAULT_FIELD_MAP), {
    thing8: { value: "动物解剖学" },
    time15: { value: "2026-07-23 13:30" },
    thing2: { value: "1小时25分钟" },
    thing14: { value: "张老师" },
    thing4: { value: "仙溪校区 B8-203" },
  });

  const vault = new WechatRecipientVault({
    dataDir: path.join(tempDir, "recipients"),
    secret: "test-wechat-recipient-secret-32-bytes",
  });
  assert.strictEqual(vault.isConfigured(), true);
  const stored = vault.store({
    principalKey: "principal_wechat_a",
    openid: "oRawOpenidMustStayServerSide",
    appid: "wx-test-app",
  });
  assert.strictEqual(stored.stored, true);
  assert.strictEqual(vault.get({ principalKey: "principal_wechat_a" }).openid, "oRawOpenidMustStayServerSide");

  const rawFiles = fs.readdirSync(path.join(tempDir, "recipients"), { recursive: true })
    .filter((entry) => String(entry).endsWith(".json"))
    .map((entry) => fs.readFileSync(path.join(tempDir, "recipients", entry), "utf8"))
    .join("\n");
  assert.ok(!rawFiles.includes("oRawOpenidMustStayServerSide"));
  assert.ok(!rawFiles.includes("principal_wechat_a"));

  const unconfigured = new WechatSubscriptionService({ templateId: "" });
  const fallback = unconfigured.getCapability();
  assert.strictEqual(fallback.configured, false);
  assert.strictEqual(fallback.deliveryMode, "app_only");
  assert.strictEqual(fallback.permanentSubscription, false);

  let sentBody = null;
  const service = new WechatSubscriptionService({
    appid: "wx-test-app",
    appSecret: "server-only-secret",
    templateId: "tmpl-course-reminder",
    recipientVault: vault,
    accessTokenProvider: async () => "access-token",
    request: async (url, body) => {
      assert.ok(url.includes("message/subscribe/send"));
      sentBody = body;
      return { data: { errcode: 0, errmsg: "ok" } };
    },
  });
  const capability = service.getCapability();
  assert.strictEqual(capability.configured, true);
  assert.strictEqual(capability.templateId, "tmpl-course-reminder");
  assert.strictEqual(capability.requestMode, "one_time");
  assert.strictEqual(capability.permanentSubscription, false);

  const result = await service.sendCourseReminder({
    principalKey: "principal_wechat_a",
    reminder: {
      nextOccurrence: {
        courseName: "动物解剖学",
        startsAt: "2026-07-23T05:30:00.000Z",
        date: "2026-07-23",
        startTime: "13:30",
        endTime: "14:55",
        durationMinutes: 85,
        durationText: "1小时25分钟",
        classroom: "B8-203",
        teacherName: "张老师",
        campus: "仙溪校区",
      },
    },
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.code, "OK");
  assert.strictEqual(sentBody.touser, "oRawOpenidMustStayServerSide");
  assert.strictEqual(sentBody.template_id, "tmpl-course-reminder");
  assert.strictEqual(sentBody.page, "pages/today/today");
  assert.deepStrictEqual(sentBody.data, {
    thing8: { value: "动物解剖学" },
    time15: { value: "2026-07-23 13:30" },
    thing2: { value: "1小时25分钟" },
    thing14: { value: "张老师" },
    thing4: { value: "仙溪校区 B8-203" },
  });

  assert.deepStrictEqual(mapWechatSendError({ errcode: 43101 }), {
    success: false,
    code: "WECHAT_SUBSCRIPTION_NOT_AUTHORIZED",
    retryable: false,
  });
  assert.strictEqual(mapWechatSendError({ errcode: 45009 }).retryable, true);

  const apiSecuritySource = fs.readFileSync(
    path.join(__dirname, "../server/src/utils/apiSecurity.js"),
    "utf8"
  );
  assert.ok(apiSecuritySource.includes("storeWechatReminderRecipient"));
  assert.ok(apiSecuritySource.includes("defaultWechatRecipientVault"));

  console.log("test-wechat-reminder-subscription: PASS");
}

run().then(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
}).catch((error) => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.error(error && error.stack || error);
  process.exit(1);
});
