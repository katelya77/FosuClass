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
  assert(wxml.includes("xiaofu-title") && wxml.includes("xiaofu-status"), "header title and compact status should render");
  assert(!wxml.includes("xiaofu-subtitle"), "header should not keep the old long subtitle");
  assert(wxml.includes("openHeaderMenu"), "clear action should move into the more menu");
  assert(wxml.includes("header-menu-sheet"), "more menu should render as a bottom sheet");
  assert(wxml.includes("清空记录"), "more menu should contain clear history action");
  assert(!/class="xiaofu-[^"]*clear/.test(wxml), "clear button should not live in the fixed header");
  assert(wxml.includes("weather-card"), "weather responses should use a dedicated weather card");
  assert(!wxml.includes("assistant-hero card"), "AI page should not render the old hero card");
  assert(!wxml.includes("privacy-tip-full"), "full privacy card should not stay in the first viewport");
  assert(wxml.includes("bottom-sheet task-sheet"), "task panel should be a bottom sheet");
  assert(wxml.includes("ai-mode-row"), "dialog/task switch should live in a dedicated mode row");
  assert(!wxml.includes("quick-task-row"), "dialog/task switch should not share the quick chip row");
  assert(wxml.includes("bottom-sheet privacy-sheet"), "privacy details should be a bottom sheet");
  assert(wxml.includes("message-scroll"), "message area should remain the main content");
  assert(!/\{\{\s*card\.type\s*\}\}/.test(wxml), "WXML must not render raw card.type");

  const header = getRule(wxss, ".xiaofu-header");
  assert(/height\s*:\s*8[0-8]rpx/.test(header), "Xiaofu header should stay within 88rpx");
  assert(/z-index\s*:\s*3[0-9]/.test(header), "Xiaofu header should stay above messages without covering sheets");
  assert(/display\s*:\s*flex/.test(header), "Xiaofu header should use a stable three-column flex row");
  assert(/gap\s*:\s*12rpx/.test(header), "header should reserve space between avatar, title, and actions");

  const titleBlock = getRule(wxss, ".xiaofu-title-block");
  assert(/flex\s*:\s*1\s+1\s+auto/.test(titleBlock), "header title column should take remaining width");
  assert(/min-width\s*:\s*0/.test(titleBlock), "header title column should be allowed to shrink safely");

  const actions = getRule(wxss, ".xiaofu-actions");
  assert(/flex\s*:\s*0\s+0\s+110rpx/.test(actions), "header actions should reserve a fixed compact column");

  const modeRow = getRule(wxss, ".ai-mode-row");
  assert(/justify-content\s*:\s*center/.test(modeRow), "mode switch should be centered");

  const segment = getRule(wxss, ".quick-nav-segment");
  assert(/overflow\s*:\s*hidden/.test(segment), "mode switch should not leak residual blocks");
  assert(/width\s*:\s*18[0-9]rpx/.test(segment), "mode switch should keep a compact capsule width");

  const titleLine = getRule(wxss, ".xiaofu-title-line");
  assert(/white-space\s*:\s*nowrap/.test(titleLine), "header title should never wrap");

  const iconButton = getRule(wxss, ".xiaofu-icon-btn");
  assert(/width\s*:\s*5[0-9]rpx/.test(iconButton) && /height\s*:\s*5[0-9]rpx/.test(iconButton), "header icons should have equal compact tap areas");

  const composer = getRule(wxss, ".composer");
  assert(/position\s*:\s*fixed/.test(composer), "composer must stay fixed");

  const sheet = getRule(wxss, ".bottom-sheet");
  assert(/position\s*:\s*fixed/.test(sheet) && /z-index\s*:\s*40/.test(sheet), "bottom sheet should overlay content");
  assert(/max-height\s*:\s*72vh/.test(sheet), "bottom sheet should not exceed 72vh");

  const aiJs = read("miniprogram/pages/ai-assistant/ai-assistant.js");
  assert(aiJs.includes("已获取天气数据"), "weather evidence should use weather label");
  assert(aiJs.includes("已核验课表数据"), "schedule evidence should keep schedule label");
  assert(aiJs.includes("已查询校园地图"), "map evidence should use map label");
  assert(aiJs.includes("已核验教室占用"), "empty classroom evidence should use occupancy label");
  assert(aiJs.includes("normalizeWeatherPayload"), "weather card payload should be normalized for display");

  const page = getRule(wxss, ".ai-page");
  assert(/padding-bottom\s*:\s*(2[0-9]{2}|[3-9][0-9]{2})rpx/.test(page), "page should reserve room for fixed composer");

  console.log("test-ai-assistant-ui-layout passed");
}

run();
