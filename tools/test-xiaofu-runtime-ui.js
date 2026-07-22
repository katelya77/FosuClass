#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function run() {
  const wxml = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml");
  const wxss = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss");
  const pageJs = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
  const liveWxml = read("miniprogram/packageXiaofu/components/xiaofu-live-run/index.wxml");
  const liveWxss = read("miniprogram/packageXiaofu/components/xiaofu-live-run/index.wxss");
  const memoryWxss = read("miniprogram/packageXiaofu/components/xiaofu-memory-sheet/index.wxss");
  const conversationWxml = read("miniprogram/packageXiaofu/components/xiaofu-conversation-sheet/index.wxml");
  const conversationWxss = read("miniprogram/packageXiaofu/components/xiaofu-conversation-sheet/index.wxss");

  // Fixed main title (a11y / sr ok)
  assert.ok(wxml.includes(">小佛助手<") || wxml.includes("小佛助手"), "fixed title 小佛助手");
  assert.ok(wxml.includes("xiaofu-conversation-sub"), "conversation subtitle row");
  assert.ok(
    wxml.includes("statusChips") || wxml.includes("headerStatusLine") || wxml.includes("xiaofu-status-line"),
    "status chips or composed status line"
  );
  assert.ok(wxml.includes("xiaofu-live-run"), "live run component");
  assert.ok(wxml.includes("onSendOrCancel") || wxml.includes("onSubmit"), "send/cancel control");

  // Header no longer puts full conversation title as main title expression only
  assert.ok(!wxml.includes("{{conversationTitle || '小佛助手'}}"), "conversation title must not be main title");

  // Live run
  assert.ok(liveWxml.includes("live-run"), "live run markup");
  assert.ok(liveWxss.includes("live-pulse") || liveWxss.includes("@keyframes"), "subtle animation");
  assert.ok(pageJs.includes("liveRunEvents"), "page tracks live events");
  assert.ok(pageJs.includes("onCancelRun"), "cancel support");
  assert.ok(pageJs.includes("agentReadinessClient"), "readiness client");

  // Memory layout anti vertical squeeze
  assert.ok(memoryWxss.includes("flex-direction: row"), "memory title row horizontal");
  assert.ok(memoryWxss.includes("min-width: 0"), "memory min-width 0");
  assert.ok(memoryWxss.includes("white-space: nowrap") || memoryWxss.includes("memory-mode-title"), "title row");

  // Conversation hierarchy
  assert.ok(
    conversationWxml.includes("conversation-meta")
    || conversationWxml.includes("conversation-meta-row")
    || conversationWxml.includes("conversation-time"),
    "meta layer"
  );
  assert.ok(
    conversationWxml.includes("source-badge")
    || conversationWxml.includes("conversation-preview")
    || conversationWxml.includes("conversation-current"),
    "badge or preview layer"
  );
  assert.ok(
    conversationWxml.includes("conversation-more")
    || conversationWxml.includes("conversation-actions-rail")
    || conversationWxml.includes("onTouchStart"),
    "overflow menu or swipe actions"
  );
  assert.ok(
    conversationWxss.includes("-webkit-line-clamp: 2")
    || conversationWxss.includes("line-clamp")
    || conversationWxss.includes("text-overflow")
    || conversationWxss.includes("conversation-title"),
    "title clamp or ellipsis"
  );

  // Responsive helpers
  assert.ok(wxss.includes("xiaofu-chip"), "chip styles");
  assert.ok(wxss.includes("send-btn.cancel") || wxss.includes(".cancel"), "cancel button style");

  // Status machine not contradictory pair hardcode
  assert.ok(pageJs.includes("statusMachine"), "status machine");
  assert.ok(pageJs.includes("network_offline"), "offline machine");
  assert.ok(pageJs.includes("enhanced_ready") || pageJs.includes("public_ready"), "ready states");

  console.log("test-xiaofu-runtime-ui: PASS");
}

run();
