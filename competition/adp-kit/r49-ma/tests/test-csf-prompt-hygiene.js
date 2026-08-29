"use strict";
// CSF P2 Runtime Prompt Hygiene 门禁（2026-08-19）
// H1 标题唯一化：`# 小序 · 主协调` / `# 小序 · 课程空间` / `# 小序 · 风险规划` / `# 小序 · 校园洞察`；
// H2 无 Rxx / Runtime 研发标记；
// H3 无 competition-demo-vX 标记；
// H4 无测试实体 / 固定日期（教师00X、YYYY-MM-DD）；
// H5 无固定问法路由（用户 utterance 不得作为规则）；
// H6 无内部 Widget 版本号。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const R51 = path.join(__dirname, "..", "..", "r51");
const FILES = {
  main: "prompts/main-orchestrator.r51.md",
  schedule: "prompts/schedule-space.r51.md",
  risk: "prompts/risk-planning.r51.md",
  insight: "prompts/campus-insight.r51.md",
};
const EXPECTED_TITLES = {
  main: "# 小序 · 主协调",
  schedule: "# 小序 · 课程空间",
  risk: "# 小序 · 风险规划",
  insight: "# 小序 · 校园洞察",
};

const USER_UTTERANCE_FRAGMENTS = [
  "这周上什么课", "这个月的课表", "最近几周", "调到周三下午", "看看排第一",
  "最忙的教师", "都有空吗", "一起碰头", "自习教室", "模拟一下", "风险怎么样", "接着检查风险",
];

const TEXT = {};
for (const [key, rel] of Object.entries(FILES)) {
  TEXT[key] = fs.readFileSync(path.join(R51, rel), "utf8");
}

test("H1. 标题唯一化（无研发后缀）", () => {
  for (const key of Object.keys(FILES)) {
    const firstLine = TEXT[key].split(/\r?\n/)[0].trim();
    assert.strictEqual(firstLine, EXPECTED_TITLES[key], `${key} 标题必须精确为 ${EXPECTED_TITLES[key]}`);
  }
});

test("H2. 无 Rxx / Runtime 研发标记", () => {
  for (const key of Object.keys(FILES)) {
    assert.ok(!/R\d{2,}/.test(TEXT[key]), `${key} 不得包含 Rxx 研发标记`);
    assert.ok(!/\bRuntime\b/.test(TEXT[key]), `${key} 不得包含 Runtime 标记`);
  }
});

test("H3. 无 competition-demo-vX 标记", () => {
  for (const key of Object.keys(FILES)) {
    assert.ok(!/competition-demo-v\d/i.test(TEXT[key]), `${key} 不得包含 competition-demo-vX`);
  }
});

test("H4. 无测试实体 / 固定日期", () => {
  for (const key of Object.keys(FILES)) {
    assert.ok(!/教师00\d/.test(TEXT[key]), `${key} 不得包含测试教师编号`);
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(TEXT[key]), `${key} 不得包含固定日期`);
    assert.ok(!/(张三|李四|测试|test)/.test(TEXT[key]), `${key} 不得包含测试实体`);
  }
});

test("H5. 无固定问法路由（用户 utterance 不得成为规则）", () => {
  for (const key of Object.keys(FILES)) {
    for (const fragment of USER_UTTERANCE_FRAGMENTS) {
      assert.ok(!TEXT[key].includes(fragment), `${key} 不得包含固定问法：${fragment}`);
    }
  }
});

test("H6. 无内部 Widget 版本号", () => {
  for (const key of Object.keys(FILES)) {
    assert.ok(!/校园智序结果卡-R\d+/.test(TEXT[key]), `${key} 不得包含 Widget 研发版本名`);
    assert.ok(!/widget\s+contract\s+v\d/i.test(TEXT[key]), `${key} 不得包含内部契约版本`);
  }
});