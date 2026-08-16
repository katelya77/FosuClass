"use strict";
// R49.1 新增测试：演示用户 visitorId 唯一真源 = competition-demo-v2.json demoUsers[0].id
// 防止 user-demo-001 / demo-user-001 / visitor-demo-001 等历史漂移再次出现。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const V2_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v2.json");
const v2 = JSON.parse(fs.readFileSync(V2_PATH, "utf8"));
const demo0 = v2.demoUsers && v2.demoUsers[0];
assert.ok(demo0, "competition-demo-v2.json 必须含 demoUsers[0]");
const canonicalId = demo0.id;
const canonicalName = demo0.name;

// 当前有效 R49/CampusTools 契约与文档（只修复有效资产，不扫 R47/R48 归档）
const FILES = [
  path.join(__dirname, "..", "tools", "schemas", "agent-tools.json"),
  path.join(__dirname, "..", "tools", "openapi", "campus-agent-tools.openapi.json"),
  path.join(__dirname, "..", "tools", "openapi", "campus-agent-tools.adp-import.json"),
  path.join(__dirname, "..", "tools", "examples", "examples.md"),
  path.join(__dirname, "..", "05-TOOL-CONTRACTS.md"),
];

// 历史错误 ID（与真源不同即视为漂移）
const LEGACY_IDS = ["user-demo-001", "demo-user-001", "visitor-demo-001"];

test("competition-demo-v2 demoUsers[0] 存在且为唯一真源", () => {
  assert.ok(typeof canonicalId === "string" && canonicalId.length > 0, "demoUsers[0].id 必须是非空字符串");
  assert.ok(typeof canonicalName === "string" && canonicalName.length > 0, "demoUsers[0].name 必须是非空字符串");
});

test("R49/CampusTools 当前有效契约文档不得再出现过期 visitorId 字面量", () => {
  for (const file of FILES) {
    const raw = fs.readFileSync(file, "utf8");
    for (const legacy of LEGACY_IDS) {
      if (legacy === canonicalId) continue; // 若真源恰好等于历史值则放行
      assert.ok(
        !raw.includes(legacy),
        `${path.basename(file)} 含过期 visitorId「${legacy}」（唯一真源应为 ${canonicalId}）`,
      );
    }
  }
});

test("campus_day_plan 契约的 visitorId 语义必须指向真源", () => {
  const contract = JSON.parse(fs.readFileSync(FILES[0], "utf8"));
  const dp = contract.tools.find((t) => t.name === "campus_day_plan");
  const desc = dp.inputSchema.properties.visitorId.description;
  assert.ok(desc.includes(canonicalId), `agent-tools.json visitorId 描述应含真源 ${canonicalId}，实际：${desc}`);
});
