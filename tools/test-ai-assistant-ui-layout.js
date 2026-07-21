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
  const wxml = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml");
  const wxss = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss");

  assert(wxml.includes("xiaofu-header"), "AI page should use the Xiaofu light header");
  assert(
    (wxml.includes("xiaofu-title") || wxml.includes("xiaofu-conversation-primary") || wxml.includes("xiaofu-header-compact"))
    && (wxml.includes("xiaofu-status") || wxml.includes("xiaofu-chip") || wxml.includes("statusChips")),
    "header title and compact status should render"
  );
  assert(!wxml.includes("xiaofu-subtitle"), "header should not keep the old long subtitle");
  assert(wxml.includes("openHeaderMenu"), "clear action should move into the more menu");
  assert(
    wxml.includes("header-menu-sheet") || wxml.includes("xiaofu-settings-sheet"),
    "more menu should render as a bottom sheet"
  );
  assert(
    wxml.includes("清空当前对话")
    || wxml.includes("记忆")
    || wxml.includes("xiaofu-settings-sheet"),
    "more menu should contain clear/memory actions"
  );
  assert(!/class="xiaofu-[^"]*clear/.test(wxml), "clear button should not live in the fixed header");
  assert(
    wxml.includes("weather-card") || wxml.includes("xiaofu-result-card"),
    "weather responses should use a dedicated weather card component"
  );
  assert(!wxml.includes("assistant-hero card"), "AI page should not render the old hero card");
  assert(!wxml.includes("privacy-tip-full"), "full privacy card should not stay in the first viewport");
  assert(wxml.includes("bottom-sheet task-sheet"), "task panel should be a bottom sheet");
  assert(!wxml.includes("quick-task-row"), "dialog/task switch should not share the quick chip row");
  assert(wxml.includes("bottom-sheet privacy-sheet"), "privacy details should be a bottom sheet");
  assert(wxml.includes("message-scroll"), "message area should remain the main content");
  assert(wxml.includes("xiaofu-agent-run"), "agent run component should be consumed");
  assert(
    wxml.includes("headerStatusLine") || wxml.includes("statusChips") || wxml.includes("xiaofu-status-line") || wxml.includes("xiaofu-chip"),
    "connection/readiness status should be data-driven"
  );
  assert(!wxml.includes("feedback-row"), "default feedback-row must be removed");
  assert(!wxml.includes("newline-btn"), "independent newline button must be removed");
  assert(wxml.includes("小佛助手") || wxml.includes("xiaofu-header-compact"), "assistant branding or compact header");
  assert(wxml.includes("xiaofu-conversation-sub") || wxml.includes("activeConversationTitle"), "conversation subtitle row");
  assert(!wxml.includes(">在线<"), "online status must not be hardcoded");
  assert(!/\{\{\s*card\.type\s*\}\}/.test(wxml), "WXML must not render raw card.type");

  const header = getRule(wxss, ".xiaofu-header");
  const compactHeader = getRule(wxss, ".xiaofu-header-compact");
  assert(
    /min-height\s*:\s*(6[0-9]|7[0-9]|8[0-9]|9[0-9]|10[0-2]|11[0-2])rpx|height\s*:\s*(6[0-9]|7[0-9]|8[0-9]|9[0-9]|10[0-2]|11[0-2])rpx/.test(header)
      || /min-height\s*:\s*(6[0-9]|7[0-9]|8[0-9]|9[0-9]|10[0-2]|11[0-2])rpx/.test(compactHeader)
      || /max-height\s*:\s*112rpx/.test(header + compactHeader),
    "Xiaofu header should stay compact"
  );
  assert(/z-index\s*:\s*3[0-9]/.test(header), "Xiaofu header should stay above messages without covering sheets");
  assert(/display\s*:\s*flex/.test(header), "Xiaofu header should use a stable three-column flex row");
  assert(/gap\s*:\s*(1[0-2])rpx/.test(header) || /gap\s*:\s*10rpx/.test(compactHeader), "header should reserve space between avatar, title, and actions");

  const titleBlock = getRule(wxss, ".xiaofu-title-block");
  assert(/flex\s*:\s*1\s+1\s+auto/.test(titleBlock), "header title column should take remaining width");
  assert(/min-width\s*:\s*0/.test(titleBlock), "header title column should be allowed to shrink safely");

  const actions = getRule(wxss, ".xiaofu-actions");
  assert(/flex\s*:\s*0\s+0\s+1[12]0rpx/.test(actions), "header actions should reserve a fixed compact column");

  const titleLine = getRule(wxss, ".xiaofu-title-line");
  assert(/white-space\s*:\s*nowrap/.test(titleLine), "header title should never wrap");

  const iconButton = getRule(wxss, ".xiaofu-icon-btn");
  assert(/width\s*:\s*5[0-9]rpx/.test(iconButton) && /height\s*:\s*5[0-9]rpx/.test(iconButton), "header icons should have equal compact tap areas");

  const composer = getRule(wxss, ".composer");
  assert(/position\s*:\s*fixed/.test(composer), "composer must stay fixed");

  const sheet = getRule(wxss, ".bottom-sheet");
  assert(/position\s*:\s*fixed/.test(sheet) && /z-index\s*:\s*40/.test(sheet), "bottom sheet should overlay content");
  assert(/max-height\s*:\s*72vh/.test(sheet), "bottom sheet should not exceed 72vh");

  const aiJs = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
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
