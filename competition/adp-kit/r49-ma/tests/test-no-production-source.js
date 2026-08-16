"use strict";
// R49-MA 自动测试 4：no production source / no production modification
// 契约/代码层不得硬编码真实生产 Endpoint；不得声明修改 production 数据源；数据版本保持 competition-demo-v2
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const R49 = path.join(__dirname, "..");

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

// R49.1 例外：campus-agent-tools.adp-import.json 是用户第六步明确要求的 import-ready OpenAPI，
// 必须携带真实比赛 CloudBase endpoint 供腾讯 ADP 人工导入；test-adp-import-openapi.js 仅做断言引用。
// 其余契约/代码层仍必须 FAIL CLOSED（占位符），不得硬编码真实生产 Endpoint。
const IMPORT_ALLOWLIST = [
  "tools/openapi/campus-agent-tools.adp-import.json",
  "tests/test-adp-import-openapi.js",
];

test("契约/代码层（.js/.json）不得硬编码真实 tcloudbase 生产 Endpoint", () => {
  const files = walk(R49).filter((f) => /\.(js|json)$/.test(f));
  const hits = [];
  for (const f of files) {
    const rel = path.relative(R49, f).split(path.sep).join("/");
    if (IMPORT_ALLOWLIST.includes(rel)) continue;
    const txt = fs.readFileSync(f, "utf8");
    const urls = txt.match(/https?:\/\/[^\s"'`,}\]]+/g) || [];
    for (const u of urls) {
      if (u.includes("tcloudbase.com") || u.includes("cloud.tencent.com")) {
        hits.push(`${path.relative(R49, f)}: ${u}`);
      }
    }
  }
  assert.deepStrictEqual(hits, [], "r49-ma 契约/代码层不得硬编码真实生产 Endpoint（FAIL CLOSED）");
});

test("adapter 默认 baseUrl 为占位符（未配置真实 Endpoint 前 FAIL CLOSED）", () => {
  const adapter = require("../tools/adapter/adapter.js");
  const req = adapter.buildRestRequest("campus_schedule_query", { entityType: "class", entityName: "2025级A班" });
  assert.ok(req.url.includes("PLACEHOLDER_CAMPUS_API_BASE_URL"), "未配置 Endpoint 时必须 FAIL CLOSED");
  assert.strictEqual(adapter.isFailClosed({}), true);
});

test("openapi servers 为占位符且整体是合法 JSON", () => {
  const openapiPath = path.join(R49, "tools", "openapi", "campus-agent-tools.openapi.json");
  const spec = JSON.parse(fs.readFileSync(openapiPath, "utf8"));
  assert.ok(Array.isArray(spec.servers) && spec.servers.length > 0, "openapi 必须有 servers");
  for (const s of spec.servers) {
    assert.ok(!/tcloudbase\.com|cloud\.tencent\.com/.test(s.url), `openapi 硬编码真实 Endpoint: ${s.url}`);
  }
  assert.ok(spec.components && spec.components.securitySchemes, "openapi 必须声明安全方案");
});

test("生产数据源未被改写：workflows/application-config.json data_version 保持 competition-demo-v2", () => {
  const cfgPath = path.join(R49, "..", "workflows", "application-config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  assert.strictEqual(cfg.appVariables.data_version, "competition-demo-v2");
  assert.strictEqual(cfg.appVariables.data_mode, "anonymous");
  assert.strictEqual(cfg.mode, "标准模式");
});

test("r49-ma 不生成任何改写 production 的脚本/指令", () => {
  // 只检查可执行代码（.js），排除 tests/ 自身（测试代码必然含相关关键词）；
  // 文档中的否定约束声明（如"不修改 production 数据源"）不属于改写指令，不误伤。
  const files = walk(R49).filter((f) => f.endsWith(".js") && !f.includes(`${path.sep}tests${path.sep}`));
  const bad = [];
  for (const f of files) {
    const txt = fs.readFileSync(f, "utf8");
    if (/(writeFileSync|appendFileSync|rmSync|unlinkSync|execSync|spawnSync).*(application-config|workflows|production)|覆盖 application-config|rm -rf\s+workflows/.test(txt)) {
      bad.push(path.relative(R49, f));
    }
  }
  assert.deepStrictEqual(bad, [], "r49-ma 不得包含修改 production 的脚本/指令");
});
