"use strict";
// CSF P6 评测双轨制测试（2026-08-19）
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const judge = require(path.join(__dirname, "..", "..", "evaluation", "dual-track", "judge.js"));
const testset = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "evaluation", "dual-track", "widget-contract-testset.json"), "utf8")
);

function run(id) {
  const c = testset.cases.find((x) => x.id === id);
  return judge.scoreResponse(c.serialized, c.expected);
}

test("DT1. 合法结果卡：A/B 双轨 pass，renderable，businessScore 满分", () => {
  const r = run("dt-01-valid-result-card");
  assert.strictEqual(r.trackA.pass, true);
  assert.strictEqual(r.trackA.score, 5);
  assert.strictEqual(r.trackB.items.widget_renderable, true);
  assert.strictEqual(r.trackB.pass, true);
  assert.strictEqual(r.verdict, "pass");
  assert.strictEqual(r.businessScore, 5);
});

test("DT2. 合法周视图：renderable（无动作也合法）", () => {
  const r = run("dt-02-valid-week-board");
  assert.strictEqual(r.trackA.pass, true);
  assert.strictEqual(r.trackB.items.widget_renderable, true);
});

test("DT3. Widget 不可渲染但业务完整：业务分不清零（renderOnlyFail）", () => {
  const r = run("dt-03-unrenderable-but-complete");
  assert.strictEqual(r.trackA.pass, true);
  assert.strictEqual(r.trackA.score, 5, "业务按内容判定，不得被渲染失败清零");
  assert.strictEqual(r.trackB.items.widget_renderable, false);
  assert.strictEqual(r.renderOnlyFail, true);
  assert.strictEqual(r.businessScore, 5);
  assert.strictEqual(r.verdict, "pass_with_presentation_issues");
});

test("DT4. 安全违规：硬门禁，业务分清零", () => {
  const r = run("dt-04-safety-violation");
  assert.strictEqual(r.trackA.items.safety, false);
  assert.strictEqual(r.trackA.pass, false);
  assert.strictEqual(r.businessScore, 0);
  assert.strictEqual(r.verdict, "fail");
});

test("DT5. 事实矛盾：硬门禁，业务分清零", () => {
  const r = run("dt-05-factual-contradiction");
  assert.strictEqual(r.trackA.items.no_contradiction, false);
  assert.strictEqual(r.trackA.pass, false);
  assert.strictEqual(r.businessScore, 0);
  assert.strictEqual(r.verdict, "fail");
});

test("DT6. 可读兜底文本：业务按内容评分，呈现不足但不清零", () => {
  const r = run("dt-06-readable-fallback");
  assert.strictEqual(r.trackA.items.recovery_on_failure, true);
  assert.strictEqual(r.trackA.pass, true);
  assert.strictEqual(r.trackB.items.readable_text, true);
  assert.strictEqual(r.trackB.items.widget_renderable, false);
  assert.ok(r.businessScore > 0, "兜底文本也有业务分");
  assert.strictEqual(r.verdict, "pass_with_presentation_issues");
});

test("DT7. 判定确定性：同一输入两次评分字节一致", () => {
  const c = testset.cases[0];
  const a = JSON.stringify(judge.scoreResponse(c.serialized, c.expected));
  const b = JSON.stringify(judge.scoreResponse(c.serialized, c.expected));
  assert.strictEqual(a, b);
});

test("DT8. 全部用例跑通且无未预期硬门禁失败", () => {
  for (const c of testset.cases) {
    const r = judge.scoreResponse(c.serialized, c.expected);
    assert.ok(r.trackA && r.trackB, c.id);
  }
});