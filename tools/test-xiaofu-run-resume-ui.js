#!/usr/bin/env node
// P6b W4：运行恢复（agentRunShell）+ 通用 UI Block 增强（uiBlockAdapter）
// 接入 ai-assistant 页面的验收。
//
// 覆盖：
//   1. 页面源码接线：agentRunShell / uiBlockAdapter require、resumeActiveAgentRun、
//      onNetworkStatusChange  guarded 监听与注销、onLoad/onShow 调用点、
//      buildAssistantMessageFromResponse 导出。
//   2. 零伪造恢复状态：无句柄必须提前 return（结构性顺序断言），且功能层面
//      无句柄/发送中两种守卫都不会碰运行 UI。
//   3. 通用 Block 增强行为：无卡片 + 原始信封 → 推导展示卡片并回填文本；
//      已有真实卡片 → 与无信封基线逐字段一致（增强完全 no-op）；
//      无信封 → no-op；嵌套 response 信封 / errors 信封同样可推导。
//   4. buildAssistantMessageFromResponse 形状与既有导出签名完整。
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env"); // 必须先加载 wx stub

const root = path.resolve(__dirname, "..");
const pageJs = fs.readFileSync(
  path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js"),
  "utf8"
);

const pageExports = require("../miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");

let checks = 0;
function ok(cond, msg) { checks += 1; assert(cond, msg); }
function eq(actual, expected, msg) { checks += 1; assert.strictEqual(actual, expected, msg); }
function deepEq(actual, expected, msg) { checks += 1; assert.deepStrictEqual(actual, expected, msg); }

// 1. 源码接线断言
function testSourceWiring() {
  ok(pageJs.includes('require("../../../services/agentRunShell")'), "页面必须 require agentRunShell");
  ok(pageJs.includes('require("../../services/uiBlockAdapter")'), "页面必须 require uiBlockAdapter");
  ok(pageJs.includes("resumeActiveAgentRun()"), "页面必须定义 resumeActiveAgentRun");
  ok(pageJs.includes('typeof wx.onNetworkStatusChange === "function"'), "网络监听必须 guarded 注册");
  ok(pageJs.includes("wx.onNetworkStatusChange(this._networkListener)"), "必须注册网络恢复监听");
  ok(pageJs.includes("wx.offNetworkStatusChange(this._networkListener)"), "onUnload 必须注销网络监听");
  ok(pageJs.includes("if (!this.data.sending) this.resumeActiveAgentRun();"), "onShow 必须由 sending 守卫调用恢复");
  ok(pageJs.includes("buildAssistantMessageFromResponse"), "页面必须包含 buildAssistantMessageFromResponse");
  // onLoad 结尾与 onShow 各调用一次恢复
  eq(pageJs.split("this.resumeActiveAgentRun();").length - 1 >= 2, true, "onLoad/onShow 都应调用恢复");
}

// 2. 零伪造恢复状态：无句柄必须先 return，恢复文案只能出现在句柄存在之后
function testNoFabricatedResumeStatus() {
  const methodStart = pageJs.indexOf("resumeActiveAgentRun() {");
  ok(methodStart > 0, "必须存在 resumeActiveAgentRun 方法");
  const sendingGuardIdx = pageJs.indexOf("if (this.data.sending || this._resumeInFlight) return;", methodStart);
  const getActiveIdx = pageJs.indexOf("agentRunShell.shell.getActiveRun()", methodStart);
  const nullGuardIdx = pageJs.indexOf("if (!handle) return;", methodStart);
  const resumeTextIdx = pageJs.indexOf("正在恢复未完成的任务", methodStart);
  ok(sendingGuardIdx > methodStart && sendingGuardIdx < getActiveIdx, "发送中/恢复中守卫必须在读取句柄之前");
  ok(getActiveIdx > methodStart, "恢复必须读取 shell 持久句柄");
  ok(nullGuardIdx > getActiveIdx, "无句柄必须提前 return");
  ok(resumeTextIdx > nullGuardIdx, "「正在恢复」文案只能出现在句柄存在之后，无句柄绝不展示");
  // 恢复文案只能出现在 resumeActiveAgentRun 内部（两处：sendingStatusText + statusCapsuleText）
  eq(pageJs.split("正在恢复未完成的任务").length - 1, 2, "恢复文案只允许恢复路径使用");
  // 绝不重建第二个 Run：页面恢复路径不得调用 startRun/createRun
  const methodBody = pageJs.slice(methodStart, pageJs.indexOf("\n  },", methodStart));
  ok(!/startRun|createRun/.test(methodBody), "恢复路径不得重建 Run");

  // 功能层面：无句柄时调用恢复不得改变任何运行 UI 状态
  mockEnv.clearStorage();
  const page = mockEnv.createPageInstance();
  page.resumeActiveAgentRun();
  eq(page.data.sending, false, "无句柄时不得进入发送态");
  eq(page.data.liveRunVisible, false, "无句柄时不得展示 live run");
  eq(page.data.activeRunId, "", "无句柄时不得伪造 activeRunId");

  // 功能层面：发送中（active send 独占 UI）时恢复直接跳过
  const busyPage = mockEnv.createPageInstance();
  busyPage.data.sending = true;
  busyPage.resumeActiveAgentRun();
  eq(busyPage.data.liveRunVisible, false, "发送中不得被恢复覆盖 UI");
  eq(busyPage.data.sendingStatusText, "处理中", "发送中恢复跳过，状态文案不变");
}

// 3. 通用 UI Block 增强行为
function testUiBlockAugmentation() {
  // 3a. 无卡片 + 原始信封（answer + uiBlocks）→ 推导展示卡片 + 文本回填
  const augmented = pageExports.normalizeMessageForDisplay({
    id: "m-aug-raw",
    role: "assistant",
    content: "",
    cards: [],
    suggestions: [],
    timeText: "10:00",
    answer: "已整理通用清单。",
    uiBlocks: [
      { type: "text", text: "已整理通用清单。" },
      { type: "list", title: "通用清单", items: [{ title: "条目一", value: "详情一" }] },
    ],
  }, {}, null, {});
  eq(augmented.displayCards.length, 1, "空卡片消息应由通用 Block 推导出一张展示卡片");
  eq(augmented.displayCards[0].title, "通用清单", "推导卡片标题来自 list block");
  eq(augmented.cards.length, 1, "推导卡片同时进入 cards");
  eq(augmented.content, "已整理通用清单。", "空 content 应由通用文本回填");

  // 3b. 已有真实卡片 → 增强完全 no-op（与无信封基线逐字段一致）
  const realCard = { type: "list", title: "真实卡片", items: [{ title: "甲", value: "详情甲" }] };
  const baseline = pageExports.normalizeMessageForDisplay({
    id: "m-aug-base", role: "assistant", content: "这是回答",
    cards: [realCard], suggestions: [], timeText: "10:00",
  }, {}, null, {});
  const withEnvelope = pageExports.normalizeMessageForDisplay({
    id: "m-aug-base", role: "assistant", content: "这是回答",
    cards: [realCard], suggestions: [], timeText: "10:00",
    answer: "不应参与推导",
    uiBlocks: [{ type: "list", title: "不应出现", items: [{ title: "乙" }] }],
    errors: [{ code: "SHOULD_NOT_APPEAR", message: "不应出现" }],
  }, {}, null, {});
  deepEq(withEnvelope.cards, baseline.cards, "已有卡片时 cards 不得被增强改写");
  deepEq(withEnvelope.displayCards, baseline.displayCards, "已有卡片时 displayCards 不得被增强改写");
  eq(withEnvelope.content, baseline.content, "已有卡片时 content 不得被增强改写");
  eq(withEnvelope.displayCards[0].title, "真实卡片", "真实卡片保持优先");

  // 3c. 无卡片也无信封字段 → 完全 no-op
  const plain = pageExports.normalizeMessageForDisplay({
    id: "m-aug-plain", role: "assistant", content: "普通回答",
    cards: [], suggestions: [], timeText: "10:00",
  }, {}, null, {});
  eq(plain.displayCards.length, 0, "无信封消息不得产出卡片");
  eq(plain.content, "普通回答", "无信封消息 content 不变");

  // 3d. 嵌套 response 信封同样可推导（answer + cards 走信封推导路径）
  const nested = pageExports.normalizeMessageForDisplay({
    id: "m-aug-nested", role: "assistant", content: "",
    cards: [], suggestions: [], timeText: "10:00",
    response: { answer: "嵌套回答", cards: [{ title: "嵌套清单", items: [{ title: "丙" }, { title: "丁" }] }] },
  }, {}, null, {});
  eq(nested.displayCards.length, 1, "嵌套 response 信封应推导出展示卡片");
  eq(nested.displayCards[0].title, "嵌套清单", "嵌套信封卡片标题正确");
  eq(nested.content, "嵌套回答", "嵌套信封文本回填");

  // 3e. 仅 errors 的信封 → 推导错误卡片（真实错误，非伪造状态）
  const errored = pageExports.normalizeMessageForDisplay({
    id: "m-aug-err", role: "assistant", content: "",
    cards: [], suggestions: [], timeText: "10:00",
    errors: [{ code: "UPSTREAM", message: "服务调用失败" }],
  }, {}, null, {});
  eq(errored.displayCards.length, 1, "errors 信封应推导出错误卡片");
  eq(errored.cards[0].variant, "error", "推导错误卡片带 error variant");
}

// 4. buildAssistantMessageFromResponse 形状
function testBuildAssistantMessage() {
  const built = pageExports.buildAssistantMessageFromResponse({
    answer: "查询结果",
    cards: [{ type: "list", title: "课程", items: [{ title: "高数" }] }],
    suggestions: ["继续追问"],
    metrics: { intentName: "class_schedule" },
    status: "completed",
  }, { userQuery: "查班级课表" });
  eq(built.assistantMessage.role, "assistant", "消息角色为 assistant");
  eq(built.assistantMessage.content, "查询结果", "answer 进入 content");
  eq(built.assistantMessage.userQuery, "查班级课表", "发送路径保留原始提问");
  eq(built.assistantMessage.cards.length, 1, "响应卡片进入消息");
  eq(built.resolvedIntentName, "class_schedule", "intent 由 metrics 解析");
  eq(built.waitingConfirmation, false, "无 confirmReminder 不等待确认");

  const builtConfirm = pageExports.buildAssistantMessageFromResponse({
    answer: "请确认",
    cards: [{ type: "reminder", title: "确认", actions: [{ type: "confirmReminder", label: "确认" }] }],
  }, { userQuery: "" });
  eq(builtConfirm.waitingConfirmation, true, "confirmReminder 动作应识别为等待确认");
  eq(builtConfirm.assistantMessage.userQuery, "", "恢复路径无原始提问，留空");
}

// 5. 兼容模式横幅：direct_chat 如实提示「实时进度不可见」，普通消息不出现
function testCompatModeBanner() {
  const compat = pageExports.normalizeMessageForDisplay({
    id: "m-compat", role: "assistant", content: "兼容回答",
    cards: [{ type: "generic", title: "结果", items: [] }],
    suggestions: [], timeText: "10:00",
    compatMode: "direct_chat", compatReason: "protocol_unsupported",
  }, {}, null, {});
  eq(compat.fallbackBanner, "服务端版本较低 · 已用兼容模式回答，实时进度不可见",
    "direct_chat 兼容模式必须如实提示功能影响");
  const normal = pageExports.normalizeMessageForDisplay({
    id: "m-normal", role: "assistant", content: "正常回答",
    cards: [{ type: "generic", title: "结果", items: [] }],
    suggestions: [], timeText: "10:00",
  }, {}, null, {});
  eq(normal.fallbackBanner, "", "非兼容消息不得出现兼容横幅");
  const builtCompat = pageExports.buildAssistantMessageFromResponse({
    answer: "兼容回答", cards: [], status: "completed",
    compatMode: "direct_chat", compatReason: "explicit_flag",
  }, { userQuery: "hi" });
  eq(builtCompat.assistantMessage.compatMode, "direct_chat", "消息构建必须透传 compatMode");
  eq(builtCompat.assistantMessage.compatReason, "explicit_flag", "消息构建必须透传 compatReason");
}

// 6. 既有导出签名保持完整
function testExportSignatures() {
  [
    "normalizeCard",
    "normalizeCardItem",
    "normalizeMessagesForDisplay",
    "normalizeMessageForDisplay",
    "makeMessage",
    "resolveAssistantIntentName",
    "buildAssistantMessageFromResponse",
  ].forEach((name) => {
    eq(typeof pageExports[name], "function", `导出 ${name} 必须为函数`);
  });
}

function run() {
  testSourceWiring();
  testNoFabricatedResumeStatus();
  testUiBlockAugmentation();
  testBuildAssistantMessage();
  testCompatModeBanner();
  testExportSignatures();
  console.log(`test-xiaofu-run-resume-ui: PASS (${checks} checks)`);
}

run();
