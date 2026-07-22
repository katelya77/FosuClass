#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}
function includes(source, token, label) {
  assert.ok(source.includes(token), `${label} must include ${token}`);
}

const pageJs = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
const pageWxml = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml");
const pageJson = JSON.parse(read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.json"));
const reminderClient = read("miniprogram/services/courseReminderClient.js");
const sheetJs = read("miniprogram/packageXiaofu/components/xiaofu-reminder-sheet/index.js");
const sheetWxml = read("miniprogram/packageXiaofu/components/xiaofu-reminder-sheet/index.wxml");
const sheetWxss = read("miniprogram/packageXiaofu/components/xiaofu-reminder-sheet/index.wxss");

assert.strictEqual(pageJson.usingComponents["xiaofu-reminder-sheet"], "/packageXiaofu/components/xiaofu-reminder-sheet/index");
includes(pageWxml, "<xiaofu-reminder-sheet", "assistant page");
includes(pageWxml, "createReminderFromPlus", "assistant + menu");
includes(pageWxml, "openRemindersFromPlus", "assistant + menu");
includes(pageWxml, "viewNextCourseFromPlus", "assistant + menu");
includes(pageWxml, "findEmptyRoomFromPlus", "assistant + menu");
includes(pageJs, "requestWechatSubscription", "assistant authorization flow");
includes(reminderClient, "wx.requestSubscribeMessage", "reminder client authorization flow");
includes(pageJs, "confirmReminder", "assistant action handler");
includes(pageJs, "manageReminders", "assistant action handler");
includes(pageJs, "performReminderConfirmation", "assistant confirmation flow");
includes(pageJs, "refreshInAppReminders", "assistant in-app reminder inbox");
includes(pageJs, "acknowledgeInAppReminder", "assistant in-app reminder acknowledgement");
includes(pageWxml, "in-app-reminder-banner", "assistant in-app reminder banner");
includes(pageWxml, "应用内提醒", "assistant in-app reminder disclosure");
includes(sheetJs, "requestOperationConfirmation", "reminder sheet");
includes(sheetJs, "updateReminder", "reminder sheet");
includes(sheetJs, "deleteReminder", "reminder sheet");
includes(sheetJs, "onGrantSubscription", "reminder sheet service-notification grant");
includes(sheetJs, "grantSubscriptionAuthorization", "reminder sheet grant API");
includes(sheetJs, "authorizationCredits", "reminder sheet credit state");
includes(sheetJs, "暂停", "reminder sheet behavior");
includes(sheetWxml, "微信服务通知", "reminder sheet service-notification copy");
includes(sheetWxml, "补充微信授权", "reminder sheet authorization action");
includes(sheetWxml, "修改时间", "reminder sheet UI");
includes(sheetWxml, "删除", "reminder sheet UI");
includes(sheetWxss, "env(safe-area-inset-bottom)", "reminder safe area");
includes(sheetWxss, "prefers-color-scheme: dark", "reminder dark mode");
includes(sheetWxss, "prefers-reduced-motion: reduce", "reminder reduced motion");
assert.ok(!/TODO|占位|coming soon/i.test(`${sheetJs}\n${sheetWxml}`));

console.log("test-course-reminder-ui: PASS");
