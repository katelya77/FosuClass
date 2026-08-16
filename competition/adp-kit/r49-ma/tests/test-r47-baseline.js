"use strict";
// R49-MA 自动测试 8：R47.7 Golden Baseline 完整性
// R47.7 从本轮起定义为 Golden/Regression/Emergency Fallback，不删除、不覆盖、不退役。
// 本测试校验基线关键文件存在且未被本轮改动（integrity marker），防止迁移中破坏基线。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ADP_KIT = path.join(__dirname, "..", "..");
const WORKFLOWS = path.join(ADP_KIT, "workflows");
const WIDGET_R48 = path.join(ADP_KIT, "widget", "r48-v3");
const MOCK = path.join(ADP_KIT, "mock-data");
const R49 = path.join(ADP_KIT, "r49-ma");

const BASELINE_WORKFLOWS = ["01-多维课表查询.md", "02-空教室规划.md", "03-课程冲突比较.md", "04-今日校园计划.md", "05-校园教学态势-R1.md"];
const R48_TEST_FILES = ["run-all.js", "test-action-contract.js", "test-adapter.js", "test-no-external-deps.js", "test-schema.js", "test-template-syntax.js"];

test("R47.7 关键工作流文件（01-05）存在", () => {
  for (const f of BASELINE_WORKFLOWS) {
    assert.ok(fs.existsSync(path.join(WORKFLOWS, f)), `基线工作流缺失: ${f}`);
  }
});

test("workflow-specs.json 存在且登记 01-05 工作流", () => {
  const p = path.join(WORKFLOWS, "workflow-specs.json");
  assert.ok(fs.existsSync(p), "缺 workflow-specs.json");
  const specs = JSON.parse(fs.readFileSync(p, "utf8"));
  const names = new Set(specs.workflows.map((w) => w.name));
  for (const f of BASELINE_WORKFLOWS) {
    const name = f.replace(/\.md$/, "");
    assert.ok(names.has(name), `workflow-specs.json 缺 ${name}`);
  }
});

test("application-config.json activeWorkflows 仍为 R47.7 的 01-05（基线未退役）", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(WORKFLOWS, "application-config.json"), "utf8"));
  const active = cfg.activeWorkflows || [];
  assert.strictEqual(active.length, 5, "activeWorkflows 应为 5");
  assert.ok(active.includes("01-多维课表查询-R3"), "基线 01 未在 activeWorkflows");
  assert.ok(active.includes("05-校园教学态势-R1"), "基线 05 未在 activeWorkflows");
});

test("r48-v3 Widget baseline 测试文件齐全（6 个测试 + run-all）", () => {
  for (const f of R48_TEST_FILES) {
    assert.ok(fs.existsSync(path.join(WIDGET_R48, "tests", f)), `r48-v3 tests 缺 ${f}`);
  }
  assert.ok(fs.existsSync(path.join(WIDGET_R48, "adapter.js")), "r48-v3 adapter.js 缺失");
});

test("mock-data v1+v2 均存在，v2 数据哈希锚点 sha1:4f3bbbb45d1f 未变", () => {
  assert.ok(fs.existsSync(path.join(MOCK, "competition-demo-v1.json")), "缺 competition-demo-v1.json");
  const v2 = JSON.parse(fs.readFileSync(path.join(MOCK, "competition-demo-v2.json"), "utf8"));
  assert.strictEqual(v2.dataHash, "sha1:4f3bbbb45d1f", "v2 dataHash 被改动");
  assert.strictEqual(v2.meta.dataVersion, "competition-demo-v2");
  assert.strictEqual(v2.meta.entityCounts.teachers, 12);
  assert.strictEqual(v2.meta.entityCounts.lessons, 58);
});

test("CampusTools 实现存在（mcp 层未被删除）", () => {
  const toolsJs = path.join(ADP_KIT, "mcp", "campus-tools-mcp", "src", "tools.js");
  const dataJs = path.join(ADP_KIT, "mcp", "campus-tools-mcp", "src", "data.js");
  assert.ok(fs.existsSync(toolsJs), "缺 campus-tools-mcp/src/tools.js");
  assert.ok(fs.existsSync(dataJs), "缺 campus-tools-mcp/src/data.js");
});

test("r49-ma 不遮蔽/不复制基线工作流（基线不被覆盖）", () => {
  // 基线工作流为中文命名文档；r49-ma 自身 01-ARCHITECTURE.md 等英文命名不构成复制基线。
  const baselineNames = new Set([
    "01-多维课表查询.md",
    "02-空教室规划.md",
    "03-课程冲突比较.md",
    "04-今日校园计划.md",
    "05-校园教学态势-R1.md",
  ]);
  const overlap = fs
    .readdirSync(R49, { recursive: true })
    .filter((f) => typeof f === "string" && baselineNames.has(path.basename(f)));
  assert.deepStrictEqual(overlap, [], "r49-ma 不得复制基线 01-05 文档造成遮蔽");
  assert.ok(!fs.existsSync(path.join(R49, "workflows")), "r49-ma 不得新建 workflows 目录覆盖基线");
});
