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
const conversationJs = read("miniprogram/packageXiaofu/components/xiaofu-conversation-sheet/index.js");
const conversationWxml = read("miniprogram/packageXiaofu/components/xiaofu-conversation-sheet/index.wxml");
const conversationWxss = read("miniprogram/packageXiaofu/components/xiaofu-conversation-sheet/index.wxss");
const settingsWxml = read("miniprogram/packageXiaofu/components/xiaofu-settings-sheet/index.wxml");

assert.strictEqual(pageJson.usingComponents["xiaofu-reminder-sheet"], "/packageXiaofu/components/xiaofu-reminder-sheet/index");
includes(pageWxml, "<xiaofu-reminder-sheet", "assistant page");
includes(pageWxml, "open-create", "assistant reminder open-create");
includes(pageWxml, "createReminderFromPlus", "assistant + menu");
includes(pageWxml, "openRemindersFromPlus", "assistant + menu");
includes(pageWxml, "viewNextCourseFromPlus", "assistant + menu");
includes(pageWxml, "findEmptyRoomFromPlus", "assistant + menu");
includes(pageJs, "requestWechatSubscription", "assistant authorization flow");
includes(pageJs, "reminderSheetOpenCreate", "assistant create config mode");
includes(pageJs, "createReminderFromPlus", "assistant create entry");
includes(reminderClient, "wx.requestSubscribeMessage", "reminder client authorization flow");
includes(reminderClient, "planReminder", "reminder client plan API");
includes(reminderClient, "createReminderFromConfig", "reminder client config create");
includes(pageJs, "confirmReminder", "assistant action handler");
includes(pageJs, "manageReminders", "assistant action handler");
includes(pageJs, "performReminderConfirmation", "assistant confirmation flow");
includes(pageJs, "refreshInAppReminders", "assistant in-app reminder inbox");
includes(pageJs, "acknowledgeInAppReminder", "assistant in-app reminder acknowledgement");
includes(pageJs, "配置课程提醒", "assistant reminder failure recovery");
includes(pageJs, "待命 · 校园工具可用", "assistant quieter degraded status");
includes(pageWxml, "in-app-reminder-banner", "assistant in-app reminder banner");
includes(pageWxml, "应用内提醒", "assistant in-app reminder disclosure");
includes(pageWxml, "个人课表授权", "assistant privacy rename");
includes(settingsWxml, "个人课表授权", "settings privacy rename");
includes(sheetJs, "requestOperationConfirmation", "reminder sheet");
includes(sheetJs, "updateReminder", "reminder sheet");
includes(sheetJs, "deleteReminder", "reminder sheet");
includes(sheetJs, "createReminderFromConfig", "reminder sheet config create");
includes(sheetJs, "onGrantSubscription", "reminder sheet service-notification grant");
includes(sheetJs, "grantSubscriptionAuthorization", "reminder sheet grant API");
includes(sheetJs, "authorizationCredits", "reminder sheet credit state");
includes(sheetJs, "暂停", "reminder sheet behavior");
includes(sheetWxml, "配置课程提醒", "reminder create wizard title");
includes(sheetWxml, "提前提醒", "reminder lead picker");
includes(sheetWxml, "一键创建并授权微信通知", "reminder one-tap create");
includes(pageJs, "performReminderCreateFromConfig", "assistant one-tap configure create");
includes(conversationWxss, "conversation-swipe-edge", "conversation swipe shadow affordance");
includes(conversationWxml, "conversation-swipe-hint", "conversation swipe hint");
includes(sheetWxml, "微信服务通知", "reminder sheet service-notification copy");
includes(sheetWxml, "补充微信授权", "reminder sheet authorization action");
includes(sheetWxml, "修改时间", "reminder sheet UI");
includes(sheetWxml, "删除", "reminder sheet UI");
includes(sheetWxss, "env(safe-area-inset-bottom)", "reminder safe area");
includes(sheetWxss, "prefers-color-scheme: dark", "reminder dark mode");
includes(sheetWxss, "prefers-reduced-motion: reduce", "reminder reduced motion");
includes(conversationJs, "onTouchStart", "conversation swipe");
includes(conversationJs, "openSwipeId", "conversation swipe state");
includes(conversationWxml, "conversation-actions-rail", "conversation swipe actions");
includes(conversationWxml, "删除", "conversation delete action");
includes(conversationWxss, "translateX(-420rpx)", "conversation swipe transform");
assert.ok(!/TODO|占位|coming soon/i.test(`${sheetJs}\n${sheetWxml}`));

console.log("test-course-reminder-ui: PASS");
