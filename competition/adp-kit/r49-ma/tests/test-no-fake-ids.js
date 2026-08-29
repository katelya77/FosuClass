"use strict";
// R49-MA 自动测试 5：no fake IDs（未取得真实腾讯导出物前 FAIL CLOSED，禁止猜测 WidgetID/WorkflowID/AgentID/PluginID）
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const R49 = path.join(__dirname, "..");
const contract = require("../tools/schemas/agent-tools.json");

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

test("agent-tools.json ids 全部为 FAIL_CLOSED 占位符", () => {
  assert.ok(contract.ids, "缺 ids 块");
  assert.match(contract.ids.pluginId, /^PLACEHOLDER-.*-FAIL_CLOSED$/, `pluginId 非占位符: ${contract.ids.pluginId}`);
  for (const [k, v] of Object.entries(contract.ids.agentIds)) {
    assert.match(v, /^PLACEHOLDER-.*-FAIL_CLOSED$/, `agentIds.${k} 非占位符: ${v}`);
  }
});

test("r49-ma 全文不得出现疑似真实腾讯 ID（32 位十六进制 WidgetID/WorkflowID/AgentID）", () => {
  const files = walk(R49).filter((f) => /\.(md|js|json)$/.test(f));
  const hits = [];
  const re = /\b[0-9a-fA-F]{32}\b/;
  for (const f of files) {
    const txt = fs.readFileSync(f, "utf8");
    const lines = txt.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (re.test(line)) {
        hits.push(`${path.relative(R49, f)}:${i + 1}`);
      }
    });
  }
  assert.deepStrictEqual(hits, [], "r49-ma 不得包含疑似真实腾讯 ID（未取得真实导出物前 FAIL CLOSED）");
});

test("契约 ID 必须是占位符语义，禁止写成真实外观 ID", () => {
  const idText = JSON.stringify(contract.ids);
  assert.ok(idText.includes("FAIL_CLOSED"), "占位符必须带 FAIL_CLOSED 标记");
  assert.ok(!/\b[a-z0-9]{24}\b/.test(JSON.stringify(contract.ids)), "不得出现疑似真实 ID 的随机串");
});

test("文档中不得伪造公网 URL / PluginID / ToolID", () => {
  const files = walk(R49).filter((f) => /\.(md)$/.test(f));
  const bad = [];
  for (const f of files) {
    const txt = fs.readFileSync(f, "utf8");
    // 文档允许出现 PLACEHOLDER/占位符说明，但不得出现「已生成真实 PluginID=xxx」式伪造
    if (/PluginID\s*[:：=]\s*[A-Za-z0-9_-]{6,}/.test(txt) && !/PLACEHOLDER|FAIL_CLOSED|占位|未取得/.test(txt)) {
      bad.push(path.relative(R49, f));
    }
  }
  assert.deepStrictEqual(bad, [], "文档不得伪造 PluginID 为真实值");
});
