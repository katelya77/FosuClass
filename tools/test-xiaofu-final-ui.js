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
assertIncludes(wxss, ".xiaofu-header-compact", "wxss");

// Product experience: NO default feedback chrome
assertNotIncludes(wxml, "feedback-compact", "wxml");
assertNotIncludes(wxml, "feedback-row", "wxml");
assertNotIncludes(wxml, "👍", "wxml");
assertNotIncludes(wxml, "👎", "wxml");
// Feedback retained via long-press path only
assertIncludes(pageJs, "onMessageLongPress", "pageJs");
assertIncludes(pageJs, "openFeedbackReasons", "pageJs");

// More sheet full-width rows (settings system component)
const settingsWxml = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/components/xiaofu-settings-sheet/index.wxml"), "utf8");
assert.ok(wxml.includes("xiaofu-settings-sheet") || settingsWxml.includes("header-menu-row"), "settings sheet wired");
assert.ok(settingsWxml.includes("settings-section") || settingsWxml.includes("header-menu-row"), "settings list structure");
assert.ok(!/\.header-menu-row-meta\s*\{[^}]*max-width\s*:\s*40%/.test(wxss), "menu meta must not truncate at 40%");

// Welcome action cards
assertIncludes(pageJs, 'title: "看今天安排"', "pageJs");
assertIncludes(pageJs, 'title: "规划自习时间"', "pageJs");

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

// Explainable trajectory
assertIncludes(wxml, "task-trajectory", "wxml");
assertIncludes(pageJs, "taskTrajectory", "pageJs");
assertIncludes(wxss, ".task-trajectory", "wxss");

// Composer stop control
assertIncludes(wxml, 'aria-label="{{sending ? \'停止\' : \'发送\'}}"', "wxml");
assertNotIncludes(wxml, "newline-btn", "wxml");
assertNotIncludes(wxml, "composer-note", "wxml");

// Generic card stripping
assertIncludes(pageJs, "isGenericAssistantCard", "pageJs");

// Presentation adapter
assertIncludes(pageJs, "xiaofuPresentationAdapter", "pageJs");

console.log("test-xiaofu-final-ui passed");
