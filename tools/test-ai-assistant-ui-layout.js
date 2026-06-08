const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function getRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m").exec(css);
  return match ? match[1] : "";
}

function run() {
  const wxml = read("miniprogram/pages/ai-assistant/ai-assistant.wxml");
  const wxss = read("miniprogram/pages/ai-assistant/ai-assistant.wxss");

  assert(wxml.includes("top-status-bar"), "AI page should use a compact top status bar");
  assert(!wxml.includes("assistant-hero card"), "AI page should not render the old hero card");
  assert(!wxml.includes("privacy-tip-full"), "full privacy card should not stay in the first viewport");
  assert(wxml.includes("bottom-sheet task-sheet"), "task panel should be a bottom sheet");
  assert(wxml.includes("bottom-sheet privacy-sheet"), "privacy details should be a bottom sheet");
  assert(wxml.includes("message-scroll"), "message area should remain the main content");
  assert(!/\{\{\s*card\.type\s*\}\}/.test(wxml), "WXML must not render raw card.type");

  const statusBar = getRule(wxss, ".top-status-bar");
  assert(/height\s*:\s*6[0-9]rpx/.test(statusBar), "top status bar should stay under 72rpx");

  const composer = getRule(wxss, ".composer");
  assert(/position\s*:\s*fixed/.test(composer), "composer must stay fixed");

  const sheet = getRule(wxss, ".bottom-sheet");
  assert(/position\s*:\s*fixed/.test(sheet) && /z-index\s*:\s*40/.test(sheet), "bottom sheet should overlay content");

  const page = getRule(wxss, ".ai-page");
  assert(/padding-bottom\s*:\s*(2[0-9]{2}|[3-9][0-9]{2})rpx/.test(page), "page should reserve room for fixed composer");

  console.log("test-ai-assistant-ui-layout passed");
}

run();
