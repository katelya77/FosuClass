// Action Command Bus 安全测试
// 覆盖：白名单绕过 / 任意 URL / 未确认写操作 / runtime 限制 / 卡片映射 / 服务端校验层
// 运行: node tools/test-xiaofu-action-bus.js

const assert = require("assert");
const path = require("path");

const root = path.join(__dirname, "..");
const { createActionBus } = require(path.join(root, "miniprogram/packageXiaofu/services/xiaofuActionBus.js"));
const actionCommandContract = require(path.join(root, "server/src/services/ai/actionCommandContract.js"));
const agentProtocol = require(path.join(root, "server/src/services/ai/agentProtocol.js"));

// ---------- 测试工具 ----------
function createMockWx() {
  const calls = [];
  return {
    calls,
    navigateTo(options) { calls.push({ api: "navigateTo", options }); },
    switchTab(options) { calls.push({ api: "switchTab", options }); },
    setClipboardData(options) { calls.push({ api: "setClipboardData", options }); },
    requestSubscribeMessage(options) { calls.push({ api: "requestSubscribeMessage", options }); },
  };
}

function createMockContext(overrides = {}) {
  const calls = [];
  return {
    calls,
    openSheet(sheet) { calls.push({ handler: "openSheet", sheet }); },
    fillComposer(text) { calls.push({ handler: "fillComposer", text }); },
    fillForm(form, fields) { calls.push({ handler: "fillForm", form, fields }); },
    confirmWrite(input, confirmationRequest) { calls.push({ handler: "confirmWrite", input, confirmationRequest }); },
    retry(taskId) { calls.push({ handler: "retry", taskId }); },
    resolveSubscribeTemplateIds(scene) {
      return scene === "course_reminder" ? ["tmpl-course-1"] : [];
    },
    ...overrides,
  };
}

const WHITE_URL = "/pages/empty-room/empty-room";
const TAB_URL = "/pages/school/school";
const EVIL_URL = "https://evil.example.com/steal";
const EVIL_PAGE = "/pages/hack/hack";

// ---------- 小程序端：navigate ----------
{
  const wxMock = createMockWx();
  const bus = createActionBus({ wx: wxMock, context: createMockContext() });
  const result = bus.execute({ command: "navigate", input: { url: WHITE_URL, params: { from: "assistant" } } });
  assert.strictEqual(result.executed, true, "合法 navigate 应执行");
  assert.strictEqual(wxMock.calls[0].api, "navigateTo");
  assert.ok(wxMock.calls[0].options.url.includes("from=assistant"), "params 应拼成 query");
}

{
  const wxMock = createMockWx();
  const bus = createActionBus({ wx: wxMock, context: createMockContext() });
  const result = bus.execute({ command: "navigate", input: { url: TAB_URL } });
  assert.strictEqual(result.executed, true);
  assert.strictEqual(wxMock.calls[0].api, "switchTab", "tabBar 页面必须走 switchTab");
  assert.ok(!wxMock.calls[0].options.url.includes("?"), "switchTab 不允许携带 query");
}

{
  const wxMock = createMockWx();
  const bus = createActionBus({ wx: wxMock, context: createMockContext() });
  [EVIL_URL, EVIL_PAGE, WHITE_URL + "-evil", "/pages/today/today.evil"].forEach((url) => {
    const result = bus.execute({ command: "navigate", input: { url } });
    assert.strictEqual(result.executed, false, `任意 URL 必须拒绝: ${url}`);
    assert.strictEqual(result.reason, "NAVIGATE_URL_NOT_WHITELISTED");
  });
  assert.strictEqual(wxMock.calls.length, 0, "被拒绝的跳转不得调用任何 wx API");
}

// ---------- 小程序端：白名单枚举 ----------
{
  const bus = createActionBus({ wx: createMockWx(), context: createMockContext() });
  const sheetResult = bus.execute({ command: "openSheet", input: { sheet: "admin_panel" } });
  assert.ok(["SHEET_NOT_WHITELISTED", "INPUT_ENUM_sheet"].includes(sheetResult.reason), sheetResult.reason);
  const formResult = bus.execute({ command: "fillForm", input: { form: "password_change", fields: {} } });
  assert.ok(["FORM_NOT_WHITELISTED", "INPUT_ENUM_form"].includes(formResult.reason), formResult.reason);
  const sceneResult = bus.execute({ command: "requestSubscribe", input: { scene: "marketing_push" } });
  assert.ok(["SCENE_NOT_WHITELISTED", "INPUT_ENUM_scene"].includes(sceneResult.reason), sceneResult.reason);
  assert.strictEqual(bus.execute({ command: "deleteEverything", input: {} }).reason, "COMMAND_UNKNOWN");
}

// ---------- 小程序端：写操作确认闸门 ----------
{
  const context = createMockContext();
  const bus = createActionBus({ wx: createMockWx(), context });
  const pending = bus.execute({
    command: "confirmWrite",
    input: { intent: "create_reminder", summary: "明天 8:00 高等数学提醒" },
    confirmationRequest: { title: "创建提醒", summary: "明天 8:00 高等数学提醒" },
  });
  assert.strictEqual(pending.executed, false, "未确认写操作不得执行");
  assert.strictEqual(pending.confirmationRequired, true);
  assert.strictEqual(context.calls.length, 0, "未确认时不得触碰 confirmWrite handler");

  const confirmed = bus.execute(
    {
      command: "confirmWrite",
      input: { intent: "create_reminder", summary: "明天 8:00 高等数学提醒" },
      confirmationRequest: { title: "创建提醒", summary: "明天 8:00 高等数学提醒" },
    },
    { confirmed: true }
  );
  assert.strictEqual(confirmed.executed, true, "确认后才允许执行");
  assert.strictEqual(context.calls[0].handler, "confirmWrite");
}

{
  const context = createMockContext();
  const wxMock = createMockWx();
  const bus = createActionBus({ wx: wxMock, context });
  const pending = bus.execute({ command: "requestSubscribe", input: { scene: "course_reminder" } });
  assert.strictEqual(pending.confirmationRequired, true, "订阅请求也需要确认闸门");
  assert.strictEqual(wxMock.calls.length, 0);

  const confirmed = bus.execute({ command: "requestSubscribe", input: { scene: "course_reminder" } }, { confirmed: true });
  assert.strictEqual(confirmed.executed, true);
  assert.strictEqual(wxMock.calls[0].api, "requestSubscribeMessage");
  assert.deepStrictEqual(wxMock.calls[0].options.tmplIds, ["tmpl-course-1"]);
}

// ---------- 小程序端：读类 Action ----------
{
  const context = createMockContext();
  const wxMock = createMockWx();
  const bus = createActionBus({ wx: wxMock, context });

  assert.strictEqual(bus.execute({ command: "fillComposer", input: { text: "明天有什么课？" } }).executed, true);
  assert.strictEqual(context.calls[0].handler, "fillComposer");

  assert.strictEqual(bus.execute({ command: "fillForm", input: { form: "reminder_create", fields: { title: "复习" } } }).executed, true);

  assert.strictEqual(bus.execute({ command: "copy", input: { text: "课表链接" } }).executed, true);
  assert.strictEqual(wxMock.calls[0].api, "setClipboardData");

  assert.strictEqual(bus.execute({ command: "retry", input: { taskId: "task-1234" } }).executed, true);

  const longText = "x".repeat(501);
  assert.strictEqual(
    bus.execute({ command: "fillComposer", input: { text: longText } }).reason,
    "INPUT_TOO_LONG_text",
    "超长输入必须拒绝"
  );
}

// ---------- 小程序端：runtime 与卡片映射 ----------
{
  const bus = createActionBus({ wx: createMockWx(), context: createMockContext() });
  const result = bus.execute(
    { command: "navigate", input: { url: WHITE_URL } },
    { runtimeMode: "nonexistent_mode" }
  );
  assert.strictEqual(result.reason, "RUNTIME_NOT_ALLOWED", "非法 runtime 必须拒绝");

  assert.strictEqual(bus.resolveCardAction("confirmReminder"), "confirmWrite");
  assert.strictEqual(bus.resolveCardAction("switchTab"), "navigate");
  assert.strictEqual(bus.resolveCardAction("ask"), null, "协议层特殊类型返回 null");
  assert.strictEqual(bus.resolveCardAction("not_a_card_action"), null, "未知卡片类型返回 null");
}

// ---------- 服务端：actionCommandContract ----------
{
  const ok = actionCommandContract.validateCommandInput("navigate", { url: WHITE_URL });
  assert.strictEqual(ok.ok, true);

  assert.strictEqual(
    actionCommandContract.validateCommandInput("navigate", { url: EVIL_URL }).reason,
    "NAVIGATE_URL_NOT_WHITELISTED"
  );
  assert.strictEqual(
    actionCommandContract.validateCommandInput("copy", {}).reason,
    "INPUT_MISSING_text"
  );
  assert.strictEqual(actionCommandContract.isCommandKnown("rm_rf"), false);
  assert.strictEqual(actionCommandContract.isAllowedPageUrl(EVIL_PAGE), false);
  assert.strictEqual(actionCommandContract.isAllowedPageUrl("/packageXiaofu/pages/ai-assistant/ai-assistant"), true);
}

{
  // 写操作缺确认请求 → 整条丢弃（防止裸写指令下泄）
  const commands = actionCommandContract.stableActionCommands([
    { command: "confirmWrite", input: { intent: "create_reminder", summary: "明天提醒" } },
    { command: "navigate", input: { url: WHITE_URL }, label: "查看" },
  ], "public");
  assert.strictEqual(commands.length, 1, "缺确认请求的写命令必须被丢弃");
  assert.strictEqual(commands[0].command, "navigate");

  // 带确认请求的写命令 → 保留，confirmation 标记随下发
  const withConfirm = actionCommandContract.stableActionCommands([
    {
      command: "confirmWrite",
      label: "创建提醒",
      input: { intent: "create_reminder", summary: "明天提醒" },
      confirmationRequest: { title: "创建提醒", summary: "明天 8:00 高数", danger: true },
    },
  ], "public");
  assert.strictEqual(withConfirm.length, 1);
  assert.strictEqual(withConfirm[0].confirmation, "required");
  assert.strictEqual(withConfirm[0].confirmationRequest.danger, true);

  // 超量截断 + 未知 command 丢弃
  const overflow = actionCommandContract.stableActionCommands(
    Array.from({ length: 6 }, (_, index) => ({ command: "copy", input: { text: `t${index}` } })),
    "public"
  );
  assert.strictEqual(overflow.length, 4, "响应最多携带 4 条 Action Command");

  assert.strictEqual(
    actionCommandContract.stableActionCommands([{ command: "evil", input: {} }], "public").length,
    0
  );
  assert.strictEqual(
    actionCommandContract.stableActionCommands([{ command: "navigate", input: { url: WHITE_URL } }], "unknown_mode").length,
    0,
    "runtime 不允许的命令必须丢弃"
  );
}

// ---------- 服务端：buildV2Response 集成 ----------
{
  const response = agentProtocol.buildV2Response({
    runtimeMode: "public",
    intent: { name: "conversational_help", slots: {} },
    answer: "已为你准备好",
    actions: [
      { command: "navigate", label: "查看课表", input: { url: WHITE_URL } },
      { command: "navigate", label: "恶意跳转", input: { url: EVIL_URL } },
      { command: "confirmWrite", input: { intent: "x", summary: "缺确认请求" } },
    ],
  });
  assert.ok(Array.isArray(response.actions), "v2 响应必须携带 actions 字段");
  assert.strictEqual(response.actions.length, 1, "只有合法命令能进入响应");
  assert.strictEqual(response.actions[0].command, "navigate");
  assert.strictEqual(response.actions[0].input.url, WHITE_URL);

  const empty = agentProtocol.buildV2Response({ runtimeMode: "public", intent: { name: "conversational_help" } });
  assert.deepStrictEqual(empty.actions, [], "无 actions 输入时输出空数组（向后兼容）");
}

console.log("test-xiaofu-action-bus passed");
