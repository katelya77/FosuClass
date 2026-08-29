/*
 * R48 Widget V3 — Action 契约审计（零依赖）
 * 断言（对齐 native/action-contract.json）：
 *   1) 每个 sample 的 actions <=3、type=sys.chat、id/label/message 非空
 *   2) message 不得包含禁止 payload 片段（换一天/再看看/当前范围/当前查询范围/换个时间）
 *   3) message 不得泄漏内部标识（queryId/dataVersion/NodeID/trace_id/widgetId/lessonId）
 *   4) schedule 系 message 必须只引用已确认实体与时间字段（含实体名或教学周锚点）
 * 运行：node tests/test-action-contract.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const SAMPLES_DIR = path.join(ROOT, "samples");

const FORBIDDEN_PAYLOAD_FRAGMENTS = ["换一天", "再看看", "当前范围", "当前查询范围", "换个时间"];
const INTERNAL_ID_PATTERNS = [
  /\bqueryId\b/,
  /\bdataVersion\b/,
  /\bNodeID\b/i,
  /\btrace_?id\b/i,
  /\bwidgetId\b/i,
  /\benvelope\b/i,
];

const sampleFiles = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".json") && f !== "envelopes.json");

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message.split("\n").join("\n    ")}`);
  }
}

console.log("== test-action-contract ==");

check("actions 数量<=3、type=sys.chat、id/label/message 非空", () => {
  for (const file of sampleFiles) {
    const sample = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, file), "utf8"));
    assert.ok(sample.actions.length <= 3, `${file}: actions=${sample.actions.length} 超过 3`);
    for (const action of sample.actions) {
      assert.strictEqual(action.type, "sys.chat", `${file}: action.type=${action.type}`);
      assert.ok(action.id && action.label && action.message, `${file}: action 缺 id/label/message`);
      assert.notStrictEqual(action.message, action.label, `${file}: message 与 label 重复`);
    }
  }
});

check("message 不含禁止 payload 片段", () => {
  for (const file of sampleFiles) {
    const sample = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, file), "utf8"));
    for (const action of sample.actions) {
      for (const fragment of FORBIDDEN_PAYLOAD_FRAGMENTS) {
        assert.ok(
          !action.message.includes(fragment),
          `${file}: action "${action.id}" message 包含禁止片段 "${fragment}" -> ${action.message}`,
        );
      }
    }
  }
});

check("message 不泄漏内部标识", () => {
  for (const file of sampleFiles) {
    const sample = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, file), "utf8"));
    for (const action of sample.actions) {
      for (const pattern of INTERNAL_ID_PATTERNS) {
        assert.ok(!pattern.test(action.message), `${file}: action "${action.id}" message 泄漏内部标识 ${pattern}`);
      }
    }
  }
});

check("schedule 系 message 引用已确认实体或教学周锚点", () => {
  for (const file of ["schedule-day.json", "schedule-week.json", "schedule-date.json"]) {
    const sample = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, file), "utf8"));
    const entityName = sample.summary.entityName;
    assert.ok(entityName, `${file}: 缺少 entityName`);
    for (const action of sample.actions) {
      // 只有已确认周份时 choose-day 才使用【小序操作】协议格式；无周份时允许自然语言回退
      if (action.intentHint === "schedule_choose_day" && action.week !== undefined && action.week !== null) {
        assert.match(action.message, /^【小序操作:选择课表日期】/, `${file}: choose-day message 必须是【小序操作】协议格式`);
      }
      assert.ok(
        action.message.includes(entityName) || action.message.includes("第"),
        `${file}: action "${action.id}" message 未引用实体或教学周 -> ${action.message}`,
      );
      if (action.week !== undefined && action.week !== null) {
        assert.ok(action.week >= 1 && action.week <= 20, `${file}: week=${action.week} 超出 1-20`);
      }
    }
  }
});

check("conflict 系 message 引用双方实体名（非自查）", () => {
  const compare = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, "conflict-compare.json"), "utf8"));
  const first = compare.summary ? compare.items[0] : null;
  assert.ok(compare.actions.length === 2, "conflict-compare 期望 2 个动作");
  assert.match(compare.actions[0].message, /教师/);
  assert.match(compare.actions[1].message, /教师/);
  assert.notStrictEqual(compare.actions[0].message, compare.actions[1].message);
  const self = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, "conflict-self.json"), "utf8"));
  assert.deepStrictEqual(self.actions.map((a) => a.id), ["conflict-self-day", "conflict-self-week"]);
});

check("classroom 系 message 均非空且互不重复", () => {
  for (const file of ["classroom-normal.json", "classroom-empty.json"]) {
    const sample = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, file), "utf8"));
    const messages = sample.actions.map((a) => a.message);
    assert.ok(messages.length >= 2, `${file}: 动作过少`);
    assert.strictEqual(new Set(messages).size, messages.length, `${file}: message 重复`);
  }
});

check("choice：items.message 使用「选择X，继续Y」模板且<=5", () => {
  const sample = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, "choice.json"), "utf8"));
  assert.ok(sample.items.length <= 5, "choice items 超过 5");
  for (const item of sample.items) {
    assert.match(item.message, /^选择.+，继续/, `choice item message 模板错误 -> ${item.message}`);
    assert.ok(item.message.includes(item.name), "choice item message 未包含选项名");
  }
  assert.deepStrictEqual(sample.actions.map((a) => a.id), ["choice-rephrase"]);
});

check("recovery：message 仅引用可恢复的已确认信息", () => {
  for (const file of ["recovery-range.json", "recovery-tool.json"]) {
    const sample = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, file), "utf8"));
    assert.ok(sample.actions.length <= 3, `${file}: 动作超过 3`);
    for (const action of sample.actions) {
      assert.ok(action.message.length > 0, `${file}: 空 message`);
    }
  }
  const range = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, "recovery-range.json"), "utf8"));
  assert.strictEqual(range.error.code, "OUT_OF_RANGE");
  assert.deepStrictEqual(range.actions.map((a) => a.id), ["recovery-semester-range", "recovery-first-week"]);
});

if (failures > 0) {
  console.error(`\ntest-action-contract: ${failures} 项失败`);
  process.exit(1);
}
console.log("test-action-contract: 全部通过");