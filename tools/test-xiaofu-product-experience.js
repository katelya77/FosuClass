#!/usr/bin/env node
/**
 * Product-experience assertions for 小佛助手 Campus Copilot UX.
 * Drives real presentation adapter + shipped WXML/WXSS/page structure.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adapter = require(path.join(root, "miniprogram/packageXiaofu/services/xiaofuPresentationAdapter.js"));
const messageActions = require(path.join(root, "miniprogram/packageXiaofu/services/xiaofuMessageActions.js"));
const conversationVm = require(path.join(root, "miniprogram/packageXiaofu/services/xiaofuConversationViewModel.js"));

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function getRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m").exec(css);
  return match ? match[1] : "";
}

const wxml = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml");
const wxss = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss");
const pageJs = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
const tokens = read("miniprogram/packageXiaofu/styles/xiaofu-tokens.wxss");
const audit = read("docs/xiaofu-agent/product-experience-audit.md");

// --- 1–3: no default feedback-row / thumbs ---
assert.ok(!/class="[^"]*feedback-row/.test(wxml), "default page must not render feedback-row");
assert.ok(!/feedback-compact/.test(wxml), "default page must not include feedback-compact");
assert.ok(!/👍/.test(wxml) && !/👎/.test(wxml), "default page must not show thumbs");
assert.ok(!/没解决/.test(wxml) || /openFeedbackReasons|feedbackReasons|反馈问题/.test(pageJs),
  "inline 没解决 buttons should not be default chrome");
assert.ok(!wxml.includes("没解决") && !wxml.includes("结果过时") && !wxml.includes("理解错误"),
  "feedback reason buttons must not be default in WXML");
assert.ok(pageJs.includes("onMessageLongPress") || pageJs.includes("showActionSheet"),
  "long-press / action sheet path must exist for feedback");
assert.ok(pageJs.includes("submitMessageFeedback") || pageJs.includes("openFeedbackReasons"),
  "feedback API path retained via long-press only");

// --- 4–6: greeting purity via adapter ---
const greeting = adapter.presentAssistantMessage({
  role: "assistant",
  content: "你好，我是小佛助手，可以帮你查课表、找空教室。",
  intentName: "conversational",
  suggestions: ["查课表", "找空教室", "你能做什么", "今天天气"],
  cards: [{ type: "generic", title: "小佛助手", subtitle: "自然对话" }],
  toolCalls: [],
  evidence: { sources: ["x"] },
  taskTrajectory: { understanding: "问候" },
}, { suggestionContext: { userText: "你好", isPlain: true } });
assert.strictEqual(greeting.isPlain || greeting.presentationMode === "plain", true, "greeting is plain");
assert.strictEqual(greeting.displayCards.length, 0, "greeting has no result cards");
assert.ok(greeting.suggestions.length <= 2, "greeting suggestions <= 2");
assert.strictEqual(greeting.showDefaultFeedback, false, "no default feedback flag");
assert.strictEqual(greeting.showToolChips, false, "no tool chips");

// --- 4b: REAL offline greeting path (must not fabricate intentName-only unit) ---
// Mock mini-program globals before requiring page module
global.wx = global.wx || {
  getStorageSync() { return ""; },
  setStorageSync() {},
  removeStorageSync() {},
  showToast() {},
  showModal() {},
  showActionSheet() {},
  vibrateShort() {},
  setClipboardData() {},
  getNetworkType({ success }) { if (success) success({ networkType: "none" }); },
  getRecorderManager() {
    return { onStart() {}, onStop() {}, onError() {}, start() {}, stop() {} };
  },
};
global.getCurrentPages = global.getCurrentPages || (() => []);
global.getApp = global.getApp || (() => ({ globalData: {} }));
global.Page = global.Page || ((config) => { global.__AI_ASSISTANT_PAGE__ = config; });

const aiAssistantService = require(path.join(root, "miniprogram/services/aiAssistantService.js"));
const pageModule = require(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js"));

// 1) Raw smalltalk builder
const smalltalk = aiAssistantService.buildSmalltalkResponse("你好", {}, { confidence: 0.9 });
assert.strictEqual(smalltalk.presentationMode, "plain", "buildSmalltalkResponse sets presentationMode plain");
assert.ok(!smalltalk.evidence, "buildSmalltalkResponse must not emit evidence chrome payload");

// 2) standardizeClientFallback (offline wrap) — the real offline greeting envelope
const standardized = aiAssistantService.standardizeClientFallback(
  smalltalk,
  "你好",
  { intent: "smalltalk", confidence: 0.9, entities: {} },
  "NETWORK_UNAVAILABLE",
  { requestId: "test-req", conversationId: "test-conv" }
);
assert.strictEqual(standardized.presentationMode, "plain", "standardizeClientFallback keeps plain for smalltalk");
assert.ok(!standardized.evidence, "standardized offline greeting has no evidence");
assert.ok(standardized.fallback === true, "offline still marks fallback for metrics");

// 3) Page makeMessage + normalizeMessagesForDisplay (shipped display path)
// intent may be string canonicalIntent after standardize — intentName must still resolve
const intentNameFromResponse = (typeof standardized.intent === "string" && standardized.intent)
  || (standardized.intent && standardized.intent.name)
  || standardized.intentName
  || (standardized.metrics && (standardized.metrics.intentName || standardized.metrics.canonicalIntent))
  || "";
const assistantRaw = pageModule.makeMessage("assistant", standardized.answer || "你好", {
  cards: standardized.cards || [],
  suggestions: standardized.suggestions || [],
  toolCalls: standardized.toolCalls || [],
  evidence: standardized.evidence,
  metrics: standardized.metrics,
  fallback: standardized.fallback === true,
  fallbackLayer: standardized.fallbackLayer || "client",
  intent: standardized.intent,
  intentName: intentNameFromResponse,
  userQuery: "你好",
  presentationMode: standardized.presentationMode || "",
});
// Old bug: intentName was "" when intent was a string — ensure resolve works
assert.ok(
  adapter.resolveIntentName(assistantRaw)
  || adapter.isPlainPresentation(Object.assign({}, assistantRaw, { userQuery: "你好" }), { lastUserText: "你好" }),
  "intent resolution or greeting user text must mark plain"
);

const displayMessages = pageModule.normalizeMessagesForDisplay([
  pageModule.makeMessage("user", "你好"),
  assistantRaw,
], {});
const shown = displayMessages[1];
assert.ok(shown, "assistant message rendered");
assert.strictEqual(shown.presentationMode, "plain", "display path presentationMode is plain");
assert.strictEqual((shown.displayCards || []).length, 0, "offline greeting: no result cards");
assert.ok(!shown.evidenceText, "offline greeting: no evidenceText");
assert.ok(!shown.fallbackBanner, "offline greeting: no 网络暂不可用 banner");
assert.ok(!shown.hasCollapsedRun, "offline greeting: no collapsed task run");
assert.ok(!(shown.taskTrajectory), "offline greeting: no task trajectory");
assert.ok((shown.suggestions || []).length <= 2, "offline greeting suggestions <= 2");

// String intent only (no intentName) — simulate pre-fix payload shape still
const stringIntentOnly = pageModule.normalizeMessagesForDisplay([
  pageModule.makeMessage("user", "你好啊"),
  pageModule.makeMessage("assistant", "嗨，我在。", {
    intent: "conversational_help",
    intentName: "",
    metrics: { intentName: "smalltalk" },
    fallback: true,
    fallbackLayer: "client",
    evidence: { source: "local-smalltalk", verified: false },
    cards: [],
    toolCalls: [],
    userQuery: "你好啊",
  }),
], {});
assert.ok(!stringIntentOnly[1].evidenceText, "string intent + metrics.intentName smalltalk: no evidence");
assert.ok(!stringIntentOnly[1].fallbackBanner, "string intent + metrics: no fallback banner");

// --- 7: consecutive identical suggestion sets avoided ---
const s1 = adapter.refineSuggestions(["查课表", "找空教室"], { userText: "你好" });
const s2 = adapter.refineSuggestions(["查课表", "找空教室"], {
  userText: "你好",
  previousSuggestionKey: adapter.suggestionKey(s1),
});
assert.ok(
  adapter.suggestionKey(s1) !== adapter.suggestionKey(s2) || s2.length === 0,
  "consecutive identical suggestion sets must be rotated or cleared"
);

// thanks: no suggestions
assert.deepStrictEqual(
  adapter.refineSuggestions(["查课表"], { userText: "谢谢" }),
  [],
  "thanks should hide suggestions"
);

// --- 8–10: header status dedupe / ≤2 actions / no large brand title ---
const header = adapter.buildHeaderViewModel({
  runtimeMode: "trial",
  statusMachine: "enhanced_ready",
  memoryMode: "session_state",
  activeConversationTitle: "新对话",
});
assert.ok(header.statusChips.length <= 1, "header chips collapsed to one composed status");
assert.ok(header.statusLine.includes("增强模式"), "enhanced mode label");
assert.ok(header.statusLine.includes("已记住上下文"), "memory folded into one line");
assert.strictEqual(header.actionCount, 2, "header action count is 2");
assert.strictEqual(header.showProductTitle, false, "no large product title");
assert.ok(wxml.includes("xiaofu-header-compact"), "compact header present");
assert.ok(wxml.includes("xiaofu-title-sr"), "product name only for a11y/sr");
assert.ok(wxml.includes("headerStatusLine") || wxml.includes("xiaofu-status-line"), "composed status line");
// Count icon action buttons in header actions block
const actionsBlock = /class="xiaofu-actions"[\s\S]*?<\/view>/.exec(wxml);
assert.ok(actionsBlock, "xiaofu-actions block exists");
const actionButtons = (actionsBlock[0].match(/<button/g) || []).length;
assert.ok(actionButtons <= 2, `header action buttons <= 2, got ${actionButtons}`);
assert.ok(!actionsBlock[0].includes(">对话<"), "no text 对话 button");
assert.ok(!actionsBlock[0].includes(">?<"), "no ? help button in header");

// --- 11–12: more menu / memory full Chinese, no truncation meta ---
assert.ok(!/max-width\s*:\s*40%/.test(wxss) || !wxss.includes(".header-menu-row-meta"),
  "header-menu-row-meta must not use max-width 40% truncation");
const metaRule = getRule(wxss, ".header-menu-row-meta");
if (metaRule) {
  assert.ok(!/max-width\s*:\s*40%/.test(metaRule), "meta max-width 40% removed");
  assert.ok(!/text-overflow\s*:\s*ellipsis/.test(metaRule) || /white-space\s*:\s*normal/.test(metaRule),
    "meta allows natural wrapping");
}
const settingsWxml = read("miniprogram/packageXiaofu/components/xiaofu-settings-sheet/index.wxml");
assert.ok(
  wxml.includes("settings-row") || wxml.includes("header-menu-row") || settingsWxml.includes("settings-row"),
  "settings sheet rows"
);
assert.ok(
  wxml.includes("仅保存在本机") || pageJs.includes("仅保存在本机") || settingsWxml.includes("仅保存在本机"),
  "full Chinese memory labels"
);
assert.strictEqual(adapter.mapMemoryStatusText("local_only", "menu"), "仅保存在本机");
assert.strictEqual(adapter.mapMemoryStatusText("session_state", "menu"), "已保存会话状态");
assert.strictEqual(adapter.mapMemoryStatusText("cloud_sync", "menu"), "已开启跨设备同步");
assert.ok(!pageJs.includes("记忆：仅本机") || pageJs.includes("仅保存在本机"),
  "old truncated 记忆： prefix style retired");

// --- 13–15: card limits ---
const single = adapter.limitDisplayCards([
  { type: "schedule", title: "今日" },
  { type: "weather", title: "天气" },
], "single_card");
assert.strictEqual(single.length, 1, "single fact ≤1 card");
const composite = adapter.limitDisplayCards([
  { type: "schedule", title: "今日" },
  { type: "weather", title: "天气" },
  { type: "room", title: "教室" },
], "composite");
assert.ok(composite.length <= 2, "composite max 2 cards");
assert.ok(adapter.limitDisplayCards([
  { type: "schedule", title: "A" },
  { type: "weather", title: "B" },
], "").length <= 1, "default product rule prefers 1 primary card");
assert.strictEqual(adapter.limitCardActions([1, 2, 3, 4], 2).length, 2, "card actions ≤2");

// --- 16–17: composer ---
assert.ok(!wxml.includes("newline-btn"), "no independent newline button");
assert.ok(!wxml.includes("onInsertNewline") || !/<button[^>]*newline/.test(wxml), "newline control removed from UI");
assert.ok(!wxml.includes("composer-note"), "no permanent composer summary note");
assert.ok(wxml.includes("composer-plus-btn") || wxml.includes("openComposerPlus"), "composer + entry");
assert.ok(/class="composer"/.test(wxml), "composer exists");
const composerRule = getRule(wxss, ".composer");
assert.ok(/position\s*:\s*fixed/.test(composerRule), "composer fixed");

// --- 18: danger confirm ---
assert.ok(pageJs.includes("clearHistory") && pageJs.includes("showModal"), "danger clear uses confirm");
assert.ok(
  wxml.includes("清空当前对话") || settingsWxml.includes("清空当前对话"),
  "danger clear entry in more menu"
);

// --- 19–20: 320px / large font safety rules present ---
assert.ok(wxss.includes("max-width: 360px") || wxss.includes("@media"), "small screen media rules exist");
const titleBlockRule = getRule(wxss, ".xiaofu-title-block");
const convPrimaryRule = getRule(wxss, ".xiaofu-conversation-primary") || getRule(wxss, ".xiaofu-conversation-sub");
assert.ok(
  /overflow\s*:\s*hidden|text-overflow\s*:\s*ellipsis|min-width\s*:\s*0/.test(titleBlockRule + convPrimaryRule),
  "title overflow protected"
);
assert.ok(/max-width\s*:\s*78%/.test(wxss) || wxml.includes("78%"), "user bubble width controlled");
const userBody = getRule(wxss, ".message-row.user .message-body");
assert.ok(/max-width\s*:\s*78%/.test(userBody), "user bubble max-width 78%");

// --- 21: sheet safe area ---
assert.ok(/safe-area-inset-bottom/.test(wxss) || /safe-area-inset-bottom/.test(tokens), "safe area tokens/styles");
assert.ok(
  wxml.includes("sheet-close-icon")
  || wxml.includes("settings-sheet")
  || settingsWxml.includes("sheet-close-icon")
  || wxml.includes("xiaofu-settings-sheet"),
  "unified sheet close icon"
);

// --- 22: avatar grouping ---
assert.strictEqual(adapter.shouldShowAssistantAvatar({ role: "assistant" }, null), true);
assert.strictEqual(adapter.shouldShowAssistantAvatar({ role: "assistant" }, { role: "assistant" }), false);
assert.strictEqual(adapter.shouldShowAssistantAvatar({ role: "assistant" }, { role: "user" }), true);
assert.ok(wxml.includes("showAvatar"), "avatar grouping bound in wxml");

// --- 23–24: no tool chips in default message area ---
assert.ok(!wxml.includes("tool-strip") && !wxml.includes("tool-chip") || !/displayToolCalls/.test(wxml),
  "default message area has no tool chip strip");
assert.ok(!wxml.includes("displayToolCalls"), "displayToolCalls not rendered");

// --- assistant plain (no heavy bubble) ---
assert.ok(wxml.includes("assistant-plain") || wxss.includes("assistant-plain"), "assistant plain style");
assert.ok(wxss.includes("assistant-plain") || /background:\s*transparent/.test(getRule(wxss, ".message-content-wrap.assistant-plain") || ""),
  "assistant content is flat");

// --- long-press / share safety ---
const shareBad = messageActions.buildShareSummary({ content: "我的学号是123密码abc" });
assert.strictEqual(shareBad.ok, false, "share blocks sensitive content");
const shareOk = messageActions.buildShareSummary({ content: "今天有 3 节课", displayCards: [{ type: "schedule", title: "今日课程" }] });
assert.strictEqual(shareOk.ok, true, "share allows campus fact summary");

// --- conversation title from greeting ---
assert.strictEqual(
  conversationVm.deriveConversationTitle([{ role: "user", content: "你好" }], "新对话"),
  "校园助手问候"
);
assert.ok(
  conversationVm.deriveConversationTitle([{ role: "user", content: "今天有什么课" }], "新对话").includes("今天"),
  "task title from first real user turn"
);

// --- tokens & audit ---
assert.ok(tokens.includes("--xf-primary") && tokens.includes("--xf-bg"), "design tokens defined");
assert.ok(wxss.includes("xiaofu-tokens.wxss"), "page imports tokens");
assert.ok(audit.includes("信息架构") || audit.includes("根因"), "audit document present");
assert.ok(audit.includes("max-width: 40%") || audit.includes("max-width"), "audit covers more-menu truncation");

// --- package hygiene: main package gate still wired ---
const pkg = JSON.parse(read("package.json"));
assert.ok(pkg.scripts["test:xiaofu-product-experience"], "npm script registered");
assert.ok(pkg.scripts["test:miniprogram-package-hygiene"], "package hygiene retained");

// public zero-model: structural invariant still referenced by agent suites
const publicGuard = fs.existsSync(path.join(root, "tools/run-agent-final-convergence-tests.js"));
assert.ok(publicGuard, "final convergence suite still present for public zero-model");

// planner/rag tests still present
assert.ok(fs.existsSync(path.join(root, "tools/run-agent-final-convergence-tests.js")));

// avatar not repeated every consecutive assistant message — logic tested above
// message area: no feedback-row — tested above

console.log("test-xiaofu-product-experience passed");
