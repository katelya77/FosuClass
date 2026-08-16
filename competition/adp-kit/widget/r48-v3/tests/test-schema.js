/*
 * R48 Widget V3 — Schema 校验测试（零依赖）
 * 断言：
 *   1) samples/*.json（13 个）全部通过 viewmodel-schema.json（统一 ViewModel 契约）
 *   2) 每个 sample 的 cardType 与预期一致
 *   3) 各 widget 的 default.json 通过对应 widget schema.json
 * 运行：node tests/test-schema.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { validateSchema } = require("./schema-utils.js");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

const viewmodelSchema = readJson("viewmodel-schema.json");

const SAMPLE_WIDGET = {
  "schedule-day": "schedule",
  "schedule-week": "schedule",
  "schedule-date": "schedule",
  "classroom-normal": "classroom",
  "classroom-empty": "classroom",
  "conflict-compare": "conflict",
  "conflict-self": "conflict",
  "conflict-safe": "conflict",
  "day-plan": "day_plan",
  "campus-overview": "campus_overview",
  "choice": "choice",
  "recovery-range": "recovery",
  "recovery-tool": "recovery",
};

const WIDGET_DIRS = ["schedule", "classroom", "conflict", "day-plan", "campus-overview", "choice", "recovery"];

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

console.log("== test-schema ==");

check("samples 全部通过 viewmodel-schema.json", () => {
  const samplesDir = path.join(ROOT, "samples");
  const files = fs.readdirSync(samplesDir).filter((f) => f.endsWith(".json") && f !== "envelopes.json");
  assert.strictEqual(files.length, 13, `期望 13 个样例，实际 ${files.length}`);
  for (const file of files) {
    const sample = JSON.parse(fs.readFileSync(path.join(samplesDir, file), "utf8"));
    const errors = validateSchema(viewmodelSchema, sample);
    assert.deepStrictEqual(errors, [], `${file} 违反 viewmodel-schema: ${errors[0] || ""}`);
  }
});

check("每个 sample 的 cardType 与预期一致", () => {
  const samplesDir = path.join(ROOT, "samples");
  for (const [file, cardType] of Object.entries(SAMPLE_WIDGET)) {
    const sample = JSON.parse(fs.readFileSync(path.join(samplesDir, `${file}.json`), "utf8"));
    assert.strictEqual(sample.cardType, cardType, `${file}: cardType=${sample.cardType}, 期望 ${cardType}`);
    assert.strictEqual(sample.schemaVersion, "campus-widget/v3", `${file}: schemaVersion 错误`);
  }
});

check("每个 sample 的 dataVersion / evidence.verified 一致性", () => {
  const samplesDir = path.join(ROOT, "samples");
  for (const [file, cardType] of Object.entries(SAMPLE_WIDGET)) {
    const sample = JSON.parse(fs.readFileSync(path.join(samplesDir, `${file}.json`), "utf8"));
    if (sample.success) {
      assert.strictEqual(sample.evidence.verified, true, `${file}: 成功状态必须 verified=true`);
      assert.strictEqual(sample.dataVersion, "competition-demo-v1", `${file}: dataVersion 错误`);
    } else {
      assert.strictEqual(sample.interaction.waitForUser, true, `${file}: 失败状态必须 waitForUser=true`);
      assert.ok(sample.error && sample.error.code, `${file}: 失败状态必须携带 error.code`);
    }
    if (cardType === "choice" || cardType === "recovery") {
      assert.strictEqual(sample.success, false, `${file}: ${cardType} 必须是 success=false`);
    } else {
      assert.strictEqual(sample.success, true, `${file}: ${cardType} 必须是 success=true`);
    }
  }
});

check("全部 widget default.json 通过对应 widget schema.json", () => {
  for (const dir of WIDGET_DIRS) {
    const schema = readJson(`${dir}/schema.json`);
    const def = readJson(`${dir}/default.json`);
    const errors = validateSchema(schema, def);
    assert.deepStrictEqual(errors, [], `${dir}/default.json 违反 ${dir}/schema.json: ${errors[0] || ""}`);
  }
});

check("widget schema 的 actions 均约束 type=sys.chat 且 maxItems<=3", () => {
  for (const dir of WIDGET_DIRS) {
    const schema = readJson(`${dir}/schema.json`);
    const actions = schema.properties.actions;
    assert.ok(actions, `${dir}: 缺少 actions 属性定义`);
    assert.ok(actions.maxItems !== undefined && actions.maxItems <= 3, `${dir}: actions 必须 maxItems<=3`);
    assert.strictEqual(actions.items.properties.type.const, "sys.chat", `${dir}: actions[].type 必须 const sys.chat`);
  }
});

check("viewmodel-schema 覆盖全部 7 个 cardType", () => {
  assert.deepStrictEqual(
    viewmodelSchema.properties.cardType.enum,
    ["schedule", "classroom", "conflict", "day_plan", "campus_overview", "choice", "recovery"],
    "cardType enum 必须为 7 个 Canonical Widget",
  );
  assert.strictEqual(viewmodelSchema.properties.schemaVersion.const, "campus-widget/v3");
  assert.strictEqual(viewmodelSchema.properties.dataVersion.const, "competition-demo-v1");
});

if (failures > 0) {
  console.error(`\ntest-schema: ${failures} 项失败`);
  process.exit(1);
}
console.log("test-schema: 全部通过");