#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

const settingsWxml = read("miniprogram/pages/settings/settings.wxml");
const settingsJs = read("miniprogram/pages/settings/settings.js");
const assistantJs = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
const assistantWxss = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss");

assert.match(settingsWxml, /bindtap="goSmartCourseReminders"/);
assert.match(settingsWxml, /课程提醒/);
assert.match(settingsWxml, /上课前提醒、微信通知/);
assert.match(settingsJs, /goSmartCourseReminders\(\)[\s\S]*panel=reminders/);
assert.match(assistantJs, /options\s*&&\s*options\.panel/);
assert.match(assistantJs, /panelName\s*===\s*["']reminders["']/);
assert.match(assistantWxss, /\.message-scroll\s*\{[\s\S]*?width:\s*100%/);
assert.match(assistantWxss, /\.empty-welcome\s*\{[\s\S]*?width:\s*100%/);
assert.match(assistantWxss, /button\.proactive-insight\s*\{[\s\S]*?max-width:\s*none/);
assert.match(assistantWxss, /\.agent-status-capsule\s*\{[\s\S]*?width:\s*100%/);

console.log("test-xiaofu-full-width-reminder-entry: PASS");
