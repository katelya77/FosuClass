#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexWxml = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxml"), "utf8");
const switcherWxss = fs.readFileSync(path.join(root, "miniprogram/components/week-switcher/index.wxss"), "utf8");

const knowledgeIndex = indexWxml.indexOf('class="daily-knowledge');
const emptyIndex = indexWxml.indexOf('class="empty-schedule-card');
const scheduleIndex = indexWxml.indexOf('class="schedule card" wx:else');
const switcherIndex = indexWxml.indexOf("<week-switcher");

assert.ok(knowledgeIndex >= 0, "home should render the optional daily knowledge card");
assert.ok(emptyIndex > knowledgeIndex, "daily knowledge must stay outside the schedule if/else branch");
assert.ok(scheduleIndex > emptyIndex, "bound schedule must remain the else branch of the empty state");
assert.ok(switcherIndex > scheduleIndex, "bound schedule must keep the week switcher");
assert.ok(
  /:host\s*\{[\s\S]*?display:\s*block;[\s\S]*?width:\s*100%;[\s\S]*?\}/.test(switcherWxss),
  "week switcher host must reserve full flex width instead of collapsing"
);

console.log("test-home-schedule-daily-knowledge-regression passed");
