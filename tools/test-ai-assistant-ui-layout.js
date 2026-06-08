const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRule(css, selector) {
  const match = new RegExp(`${escapeRegex(selector)}\\s*\\{([\\s\\S]*?)\\}`, "m").exec(css);
  return match ? match[1] : "";
}

function hasDecl(rule, prop, valuePattern) {
  return new RegExp(`${escapeRegex(prop)}\\s*:\\s*${valuePattern}`, "i").test(rule);
}

function check(condition, message, suggestion) {
  assert(condition, `${message}\n修复建议：${suggestion}`);
}

function run() {
  const wxml = read("miniprogram/pages/ai-assistant/ai-assistant.wxml");
  const wxss = read("miniprogram/pages/ai-assistant/ai-assistant.wxss");

  check(wxml.includes("hero-top") && wxml.includes("hero-meta-row"),
    "AI hero must use a two-row layout.",
    "保留 hero-top 放 logo/标题/清空，provider 与工具状态放入 hero-meta-row。");
  check(!wxml.includes("provider-pill") && !wxml.includes("history-clear"),
    "provider-pill/history-clear should not compete with hero-title in the old hero row.",
    "移除旧 hero-actions/provider-pill/history-clear 结构，使用 hero-status-chip 与 hero-clear-mini。");

  const heroCopy = getRule(wxss, ".hero-copy");
  check(hasDecl(heroCopy, "flex", "1") &&
    hasDecl(heroCopy, "min-width", "0") &&
    hasDecl(heroCopy, "overflow", "hidden"),
    ".hero-copy must allow the title to shrink safely.",
    "在 .hero-copy 中设置 flex: 1; min-width: 0; overflow: hidden;");

  const heroTitle = getRule(wxss, ".hero-title");
  check(hasDecl(heroTitle, "white-space", "nowrap") &&
    hasDecl(heroTitle, "text-overflow", "ellipsis") &&
    hasDecl(heroTitle, "overflow", "hidden"),
    ".hero-title must be single-line ellipsis.",
    "在 .hero-title 中设置 white-space: nowrap; overflow: hidden; text-overflow: ellipsis;");

  const heroDesc = getRule(wxss, ".hero-desc");
  check(/-webkit-line-clamp\s*:\s*2/.test(heroDesc) || /line-clamp\s*:\s*2/.test(heroDesc),
    ".hero-desc must clamp to two lines.",
    "在 .hero-desc 中加入 -webkit-line-clamp: 2 和 -webkit-box-orient: vertical;");

  check(/privacy-tip[^>]*wx:if="\{\{privacyExpanded\}\}"/.test(wxml) && wxml.includes("privacy-compact"),
    "privacy full card must be conditional and have a compact state.",
    "完整隐私卡使用 wx:if 绑定 privacyExpanded，折叠状态使用 privacy-compact。");

  const assistantBody = getRule(wxss, ".message-row.assistant .message-body");
  check(/(?:width|max-width)\s*:\s*calc\(100%\s*-\s*64rpx\)/.test(assistantBody),
    "assistant message body must have its own width/max-width rule.",
    "为 .message-row.assistant .message-body 设置 width/max-width: calc(100% - 64rpx);");

  check(!/\{\{\s*card\.type\s*\}\}/.test(wxml),
    "WXML must not render raw card.type.",
    "在 JS 中生成 card.typeLabel，WXML 只渲染中文 label。");

  const composer = getRule(wxss, ".composer");
  const aiPage = getRule(wxss, ".ai-page");
  check(hasDecl(composer, "position", "fixed"),
    "composer must stay fixed at the bottom.",
    "保留 .composer { position: fixed; bottom: 0; }。");
  check(/padding\s*:[^;]*210rpx/.test(aiPage) || /padding-bottom\s*:\s*(2[0-9]{2}|[3-9][0-9]{2})rpx/.test(aiPage),
    "ai-page must reserve enough bottom padding for fixed composer.",
    "为 .ai-page 预留约 210rpx 底部 padding，避免最后一条消息被遮挡。");

  console.log("test-ai-assistant-ui-layout passed");
}

run();
