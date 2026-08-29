"use strict";
// CSF P4 personal-bridge 测试（2026-08-19）
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const bridge = require(path.join(__dirname, "..", "..", "personal-bridge", "bridge.js"));

test("P1. 写操作意图分类：import/bind/resync/change_source 需确认", () => {
  for (const [text, intent] of [
    ["帮我导入课表", "import"],
    ["绑定学号账号", "bind"],
    ["重新同步一下课表", "resync"],
    ["换个来源导入", "change_source"],
  ]) {
    const r = bridge.classifyPersonalScheduleIntent(text);
    assert.strictEqual(r.intent, intent, text);
    assert.strictEqual(r.requiresConfirm, true, text + " 必须要求确认");
  }
});

test("P2. 只读意图分类：status 不需确认", () => {
  for (const [text, intent] of [
    ["我的课表同步了吗", "status"],
    ["有没有绑定账号", "status"],
    ["导入状态怎么样", "status"],
  ]) {
    const r = bridge.classifyPersonalScheduleIntent(text);
    assert.strictEqual(r.intent, intent, text);
    assert.strictEqual(r.requiresConfirm, false, text + " 只读不需确认");
  }
});

test("P3. 无关/空输入 → intent=null，不伪造动作", () => {
  assert.strictEqual(bridge.classifyPersonalScheduleIntent("查一下空教室").intent, null);
  assert.strictEqual(bridge.classifyPersonalScheduleIntent("").intent, null);
  assert.strictEqual(bridge.classifyPersonalScheduleIntent(null).intent, null);
});

test("P4. 写操作消息：要求确认、指向小程序端、绝不宣称已导入", () => {
  for (const intent of bridge.PERSONAL_SYNC_WRITE_INTENTS) {
    const msg = bridge.buildBridgeMessage(intent);
    assert.strictEqual(msg.ok, false);
    assert.strictEqual(msg.requiresConfirm, true, intent);
    assert.ok(msg.text.includes("确认"), intent + " 必须要求确认");
    assert.ok(msg.text.includes("个人同步"), intent + " 必须指向小程序端个人同步页");
    assert.ok(!/已导入|已同步|成功/.test(msg.text), intent + " 不得宣称已导入/已同步/成功");
  }
});

test("P5. 状态查询诚实：不伪造绑定状态", () => {
  const unknown = bridge.buildBridgeMessage("status");
  assert.strictEqual(unknown.readOnly, true);
  assert.ok(unknown.text.includes("无法直接读取"), "未核验时必须如实说明");
  assert.ok(unknown.text.includes("小程序端"), "必须引导到小程序端");
  const bound = bridge.buildBridgeMessage("status", { hasBound: true });
  assert.ok(bound.text.includes("已绑定"), "hasBound=true 时如实转述");
  assert.ok(bound.text.includes("以小程序端为准"), "仍声明以小程序端为准");
});

test("P6. 消息零凭据 / 零内部信息", () => {
  for (const intent of bridge.ALL_INTENTS) {
    const msg = bridge.buildBridgeMessage(intent);
    assert.ok(!/(密码|口令|token|cookie|session|密钥)/i.test(msg.text), intent + " 不得含凭据字样");
    assert.ok(!/api\//.test(msg.text), intent + " 不得含内部 API 路径");
    assert.ok(!/https?:\/\//.test(msg.text), intent + " 不得含内部 URL");
  }
});

test("P7. 权限映射：写= L3，状态= L1", () => {
  for (const intent of bridge.PERSONAL_SYNC_WRITE_INTENTS) {
    assert.strictEqual(bridge.resolveAuthority(intent), "L3", intent);
  }
  assert.strictEqual(bridge.resolveAuthority("status"), "L1");
});

test("P8. 未知意图给出通用引导且不产生副作用", () => {
  const msg = bridge.buildBridgeMessage("other");
  assert.strictEqual(msg.ok, false);
  assert.ok(msg.text.includes("个人同步"));
  assert.ok(!/正在执行|开始导入/.test(msg.text));
});