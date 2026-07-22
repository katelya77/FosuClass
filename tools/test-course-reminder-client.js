#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const clientPath = path.join(__dirname, "..", "miniprogram", "services", "courseReminderClient.js");
assert.ok(fs.existsSync(clientPath), "course reminder client must exist");
const source = fs.readFileSync(clientPath, "utf8");
["/api/ai/agent/reminders/capability", "/api/ai/agent/reminders", "wx.requestSubscribeMessage", "confirmationProof"].forEach((token) => {
  assert.ok(source.includes(token), `client must include ${token}`);
});
assert.ok(source.includes("/api/ai/agent/reminders/schedule-change-events"));
assert.ok(source.includes("/api/ai/agent/reminders/in-app-events"));
assert.ok(source.includes("reportScheduleChange"));
assert.ok(source.includes("sanitizeScheduleSummary"));

const client = require(clientPath);

async function run() {
  let requested = null;
  global.wx = {
    requestSubscribeMessage(options) {
      requested = options.tmplIds.slice();
      options.success({ "tmpl-course": "accept" });
    },
  };
  const accepted = await client.requestWechatSubscription({ configured: true, templateId: "tmpl-course" });
  assert.deepStrictEqual(requested, ["tmpl-course"]);
  assert.strictEqual(accepted.status, "accept");
  assert.strictEqual(accepted.channel, "wechat_subscription");
  assert.strictEqual(accepted.permanentSubscription, false);

  global.wx.requestSubscribeMessage = (options) => options.success({ "tmpl-course": "reject" });
  const rejected = await client.requestWechatSubscription({ configured: true, templateId: "tmpl-course" });
  assert.strictEqual(rejected.status, "reject");
  assert.strictEqual(rejected.channel, "app_only");
  assert.ok(rejected.disclosure.includes("应用内"));

  global.wx.requestSubscribeMessage = (options) => options.success({ "tmpl-course": "ban" });
  const banned = await client.requestWechatSubscription({ configured: true, templateId: "tmpl-course" });
  assert.strictEqual(banned.status, "ban");
  assert.strictEqual(banned.channel, "app_only");

  const unavailable = await client.requestWechatSubscription({ configured: false, templateId: "" });
  assert.strictEqual(unavailable.status, "not_requested");
  assert.strictEqual(unavailable.channel, "app_only");
  assert.ok(unavailable.disclosure.includes("未配置"));
  assert.strictEqual(typeof client.listInAppEvents, "function");
  assert.strictEqual(typeof client.acknowledgeInAppEvent, "function");
  assert.strictEqual(typeof client.grantSubscriptionAuthorization, "function");

  assert.ok(source.includes("planReminder"), "client exports planReminder");
assert.ok(source.includes("createReminderFromConfig"), "client exports createReminderFromConfig");
assert.ok(source.includes("/api/ai/agent/reminders/plans"), "client plans endpoint");
console.log("test-course-reminder-client: PASS");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
