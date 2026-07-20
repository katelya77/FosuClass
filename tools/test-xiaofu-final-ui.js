#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const wxml = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss"), "utf8");
const pageJs = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js"), "utf8");
const mapper = fs.readFileSync(path.join(root, "miniprogram/services/agentClientErrorMapper.js"), "utf8");
const memoryClient = fs.readFileSync(path.join(root, "miniprogram/services/agentMemoryClient.js"), "utf8");

function assertIncludes(content, snippet, label) {
  assert.ok(content.includes(snippet), `${label} should include: ${snippet}`);
}

function assertNotIncludes(content, snippet, label) {
  assert.ok(!content.includes(snippet), `${label} should NOT include: ${snippet}`);
}

// Header compact: product name may exist for a11y but must not be the large primary visual title
assertIncludes(wxml, "xiaofu-header-compact", "wxml");
assertIncludes(wxml, "xiaofu-title-sr", "wxml");
assertIncludes(wxml, "xiaofu-conversation-primary", "wxml");
assertIncludes(wxml, "xiaofu-conversation-primary", "wxml");
assertIncludes(wxss, ".xiaofu-header-compact", "wxss");

// Compact feedback
assertIncludes(wxml, "feedback-compact", "wxml");
assertIncludes(wxml, 'aria-label="有帮助"', "wxml");
assertIncludes(wxml, 'aria-label="没帮助"', "wxml");
assertIncludes(wxml, "onFeedbackMore", "wxml");

// More sheet full-width rows
assertIncludes(wxml, "header-menu-row", "wxml");
assertIncludes(wxml, "header-menu-list", "wxml");
assertIncludes(wxss, ".header-menu-row", "wxss");

// Welcome action cards
assertIncludes(pageJs, 'title: "今天安排"', "pageJs");
assertIncludes(pageJs, 'title: "规划自习"', "pageJs");

// Error mapper
assertIncludes(mapper, "CONVERSATION_NOT_FOUND", "mapper");
assertIncludes(mapper, "PROVIDER_TIMEOUT", "mapper");
assertIncludes(memoryClient, "agentClientErrorMapper", "memoryClient");

// Memory switching atomicity helpers
assertIncludes(pageJs, "memorySwitching", "pageJs");
assertIncludes(pageJs, "agentClientErrorMapper", "pageJs");

// Evidence collapsed by default
assertIncludes(wxml, "evidence-collapsed", "wxml");
assertIncludes(wxml, "onToggleEvidence", "wxml");
assertIncludes(wxml, "run-compact", "wxml");

// Explainable trajectory + quick tasks collapse after chat
assertIncludes(wxml, "task-trajectory", "wxml");
assertIncludes(wxml, "showQuickTasks", "wxml");
assertIncludes(pageJs, "taskTrajectory", "pageJs");
assertIncludes(pageJs, "onToggleQuickTasks", "pageJs");
assertIncludes(wxss, ".task-trajectory", "wxss");

// Composer stop control
assertIncludes(wxml, 'aria-label="{{sending ? \'停止\' : \'发送\'}}"', "wxml");

// Generic card stripping
assertIncludes(pageJs, "isGenericAssistantCard", "pageJs");

console.log("test-xiaofu-final-ui passed");
