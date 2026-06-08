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

  assert(wxml.includes("xiaofu-header"), "AI page should use the Xiaofu light header");
  assert(wxml.includes("xiaofu-title") && wxml.includes("xiaofu-subtitle"), "header title and subtitle should render");
  assert(!wxml.includes("assistant-hero card"), "AI page should not render the old hero card");
  assert(!wxml.includes("privacy-tip-full"), "full privacy card should not stay in the first viewport");
  assert(wxml.includes("bottom-sheet task-sheet"), "task panel should be a bottom sheet");
  assert(wxml.includes("bottom-sheet privacy-sheet"), "privacy details should be a bottom sheet");
  assert(wxml.includes("message-scroll"), "message area should remain the main content");
  assert(!/\{\{\s*card\.type\s*\}\}/.test(wxml), "WXML must not render raw card.type");

  const header = getRule(wxss, ".xiaofu-header");
  assert(/height\s*:\s*8[0-8]rpx/.test(header), "Xiaofu header should stay within 88rpx");

  const composer = getRule(wxss, ".composer");
  assert(/position\s*:\s*fixed/.test(composer), "composer must stay fixed");

  const sheet = getRule(wxss, ".bottom-sheet");
  assert(/position\s*:\s*fixed/.test(sheet) && /z-index\s*:\s*40/.test(sheet), "bottom sheet should overlay content");
  assert(/max-height\s*:\s*72vh/.test(sheet), "bottom sheet should not exceed 72vh");

  const page = getRule(wxss, ".ai-page");
  assert(/padding-bottom\s*:\s*(2[0-9]{2}|[3-9][0-9]{2})rpx/.test(page), "page should reserve room for fixed composer");

  console.log("test-ai-assistant-ui-layout passed");
}

run();
