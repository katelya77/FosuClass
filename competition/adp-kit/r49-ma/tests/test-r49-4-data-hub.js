"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DATA_HUB = path.join(__dirname, "..", "data-hub");
const FIXTURE = path.join(__dirname, "fixtures", "synthetic-legacy-timetable.json");

const parseWeekExpression = require(path.join(DATA_HUB, "week-expression.js")).parseWeekExpression;
const validateCanonicalEvent = require(path.join(DATA_HUB, "validator.js")).validateCanonicalEvent;
const detectSource = require(path.join(DATA_HUB, "source-detector.js")).detectSource;
const qzAdapter = require(path.join(DATA_HUB, "adapters", "portal-family-qz-legacy.js"));
const baseAdapter = require(path.join(DATA_HUB, "adapters", "base-adapter.js"));
const providerCapabilities = JSON.parse(
  fs.readFileSync(path.join(DATA_HUB, "provider-capabilities.json"), "utf8")
);
const canonicalSchema = JSON.parse(
  fs.readFileSync(path.join(DATA_HUB, "canonical-schema.json"), "utf8")
);
const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

const REAL_SCHOOL_DENYLIST = ["佛山", "fosu", "佛大"];
const PRIVATE_VALUE_DENYLIST = ["教师009", "T09", "教师011"];

function assertRejected(result, needle, label) {
  assert.strictEqual(result.ok, false, `${label} 应被拒绝`);
  assert.ok(result.errors && result.errors.length > 0, `${label} 应返回错误明细`);
  if (needle) {
    assert.ok(
      result.errors.some((e) => e.includes(needle)),
      `${label} 错误信息应包含「${needle}」，实际：${JSON.stringify(result.errors)}`
    );
  }
}

test("契约 1：周次表达式解析（区间/列表/单双周）", () => {
  assert.deepStrictEqual(parseWeekExpression("1-4周"), [1, 2, 3, 4]);
  assert.deepStrictEqual(parseWeekExpression("1,3,5周"), [1, 3, 5]);
  assert.deepStrictEqual(parseWeekExpression("1-8周(单)"), [1, 3, 5, 7]);
  assert.deepStrictEqual(parseWeekExpression("2-8周(双)"), [2, 4, 6, 8]);
  assert.deepStrictEqual(parseWeekExpression("第1-4周"), [1, 2, 3, 4]);
  assert.deepStrictEqual(parseWeekExpression("第2,4,6周"), [2, 4, 6]);
  assert.deepStrictEqual(parseWeekExpression("1-16周"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.throws(() => parseWeekExpression("0-4周"), /1\.\.20/);
  assert.throws(() => parseWeekExpression("1-21周"), /1\.\.20/);
  assert.throws(() => parseWeekExpression(""), /无法解析/);
  assert.throws(() => parseWeekExpression("5-2周"), /start.*end|end.*start/);
});

test("契约 2：规范化事件校验（必填/边界/反向区间/置信度/未知命名空间）", () => {
  const valid = {
    namespace: "synthetic-example",
    semesterId: "semester-example-2026-1",
    course: { name: "示例课程A" },
    teachers: ["教师A01"],
    classes: ["2026级示例1班"],
    location: { campus: "校区A", room: "A1-101" },
    weekday: 1,
    periodStart: 1,
    periodEnd: 2,
    weeks: [1, 2, 3, 4],
    source: { providerFamily: "portal-family-qz-legacy", sourceType: "xls-legacy", importedAt: "2026-01-01T00:00:00.000Z", confidence: 1.0 },
  };
  assert.deepStrictEqual(validateCanonicalEvent(valid), { ok: true });

  assertRejected(validateCanonicalEvent({ ...valid, weeks: [] }), "weeks", "空 weeks");
  assertRejected(validateCanonicalEvent({ ...valid, weekday: 0 }), "weekday", "weekday=0");
  assertRejected(validateCanonicalEvent({ ...valid, weekday: 8 }), "weekday", "weekday=8");
  assertRejected(validateCanonicalEvent({ ...valid, periodStart: 3, periodEnd: 2 }), "period", "反向节次");
  assertRejected(validateCanonicalEvent({ ...valid, source: { ...valid.source, confidence: 1.5 } }), "confidence", "confidence>1");
  assertRejected(validateCanonicalEvent({ ...valid, source: { ...valid.source, confidence: -0.1 } }), "confidence", "confidence<0");
  assertRejected(validateCanonicalEvent({ ...valid, namespace: "unknown-school-xyz" }), "namespace", "未知命名空间");
  assertRejected(validateCanonicalEvent({ ...valid, course: {} }), "course.name", "缺 course.name");
  assertRejected(validateCanonicalEvent({ ...valid, teachers: [] }), "teachers", "空 teachers");
  assertRejected(validateCanonicalEvent({}), "必填", "空事件");
});

test("契约 3：canonical-schema.json 与 validator 对齐（required 字段一致 + 同一组非法样例均拒绝）", () => {
  const schemaRequired = canonicalSchema.required;
  for (const field of ["namespace", "semesterId", "course", "teachers", "classes", "location", "weekday", "periodStart", "periodEnd", "weeks", "source"]) {
    assert.ok(schemaRequired.includes(field), `canonical-schema 必须声明必填字段 ${field}`);
  }
  assert.ok(Array.isArray(canonicalSchema.properties.namespace.enum), "namespace 必须为 enum");
  assert.ok(canonicalSchema.properties.namespace.enum.includes("synthetic-example"), "enum 必须含 synthetic-example");
  assert.ok(canonicalSchema.properties.weekday.maximum === 7 && canonicalSchema.properties.weekday.minimum === 1, "weekday 必须限制 1..7");
  assert.strictEqual(canonicalSchema.properties.source.properties.confidence.maximum, 1, "confidence 上限必须为 1");
});

test("契约 4：源检测器返回中性描述符（OLE2/BIFF magic，绝不输出学校身份）", () => {
  const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

  const legacy = detectSource({ filename: "timetable.xls", bytes: ole2 });
  assert.strictEqual(legacy.family, "portal-family-qz-legacy", "OLE2 必须识别为 qz-legacy 家族");
  assert.strictEqual(legacy.kind, "xls-legacy");
  assert.ok(legacy.confidence > 0.5, "OLE2 命中应高置信");

  const xlsx = detectSource({ filename: "timetable.xlsx", bytes: zip });
  assert.strictEqual(xlsx.family, "xlsx-generic");

  const csv = detectSource({ filename: "timetable.csv", bytes: null });
  assert.strictEqual(csv.family, "csv-generic");

  const unknown = detectSource({ filename: "", bytes: Buffer.from([0x00, 0x01]) });
  assert.strictEqual(unknown.family, "unknown");
  assert.ok(unknown.confidence <= 1 && unknown.confidence >= 0, "未知源置信度必须 ∈ 0..1");

  for (const d of [legacy, xlsx, csv, unknown]) {
    assert.ok(!("school" in d), "源描述符不得携带学校身份");
    assert.ok(!REAL_SCHOOL_DENYLIST.some((s) => JSON.stringify(d).includes(s)), "源描述符不得泄漏学校名");
  }
});

test("契约 5：base-adapter 接口 + qz-legacy 适配器 fail-closed", () => {
  const a = new baseAdapter.BaseAdapter({ id: "base-test", name: "base" });
  assert.strictEqual(a.id, "base-test");
  assert.deepStrictEqual(a.validateInput({}), { ok: true }, "base 默认不限制输入形状");
  assert.deepStrictEqual(a.adapt({}), { ok: false, errors: ["not implemented"] }, "base.adapt 必须 fail-closed");

  assert.strictEqual(qzAdapter.id, "portal-family-qz-legacy", "适配器 id 契约");
  const noWorksheet = qzAdapter.adapt({});
  assert.strictEqual(noWorksheet.ok, false, "无 worksheet 结构必须 fail closed");
  assert.ok(noWorksheet.errors.some((e) => e.includes("worksheets")), "错误必须说明缺 worksheets");
});

test("契约 6：synthetic 中性课表 → 规范化事件（匿名导入、逐周展开、失败行上报）", () => {
  const result = qzAdapter.adapt(fixture);
  assert.strictEqual(result.ok, true, `适配失败：${JSON.stringify(result.errors)}`);
  assert.ok(result.events.length >= 4, `应至少产出 4 条规范化事件，实际 ${result.events.length}`);
  assert.ok(Array.isArray(result.skipped), "应有 skipped 上报");

  const byCourse = Object.fromEntries(result.events.map((e) => [e.course.name, e]));
  assert.ok(byCourse["示例课程A"], "应含示例课程A");
  assert.ok(byCourse["示例课程B"], "应含示例课程B");
  assert.ok(byCourse["示例课程C"], "应含示例课程C");
  assert.ok(byCourse["示例课程D"], "应含示例课程D");

  assert.deepStrictEqual(byCourse["示例课程A"].weeks, parseWeekExpression("1-16周"), "1-16周 必须逐周展开");
  assert.deepStrictEqual(byCourse["示例课程B"].weeks, [1, 3, 5, 7], "单周周次");
  assert.deepStrictEqual(byCourse["示例课程C"].weeks, [2, 4, 6, 8], "双周周次");
  assert.deepStrictEqual(byCourse["示例课程D"].weeks, [2, 4, 6], "列表周次");
  assert.strictEqual(byCourse["示例课程D"].weekday, 7, "「日」必须映射为 7");

  for (const e of result.events) {
    assert.deepStrictEqual(validateCanonicalEvent(e), { ok: true }, "适配产出必须全部通过校验");
    assert.strictEqual(e.source.providerFamily, "portal-family-qz-legacy");
    assert.strictEqual(e.source.sourceType, "xls-legacy");
    assert.ok(e.source.confidence >= 0 && e.source.confidence <= 1);
    assert.ok(e.teachers.length > 0 && e.classes.length > 0, "必须解析出教师与班级");
    assert.ok(e.location && e.location.campus && e.location.room, "必须解析出校区与教室");
  }
});

test("契约 7：provider-capabilities.json 中立能力清单（非凭据、非原始导入）", () => {
  assert.strictEqual(providerCapabilities.version, "R49.4");
  assert.ok(providerCapabilities.families["portal-family-qz-legacy"], "必须登记 qz-legacy 家族");
  assert.ok(providerCapabilities.families["portal-family-qz-legacy"].detectMagic.includes("ole2"), "qz-legacy 必须能识别 OLE2");
  assert.strictEqual(providerCapabilities.families["portal-family-qz-legacy"].parseWeeks, true);
  assert.strictEqual(providerCapabilities.families["portal-family-qz-legacy"].normalizeToCanonical, true);
  assert.strictEqual(providerCapabilities.families["portal-family-qz-legacy"].credentialed, false, "不得要求凭据");
  assert.strictEqual(providerCapabilities.families["portal-family-qz-legacy"].rawImportAllowed, false, "不得允许原始导入进提交产物");
  assert.strictEqual(providerCapabilities.families["portal-family-qz-legacy"].privacy, "anonymous-only");
});

test("契约 8：R49.4 数据枢纽 fixture/产出必须中性（绝无真实学校/个人标识）", () => {
  const result = qzAdapter.adapt(fixture);
  const allText = JSON.stringify(fixture) + JSON.stringify(result.events) + JSON.stringify(providerCapabilities);
  assert.ok(allText.includes("示例"), "fixture 必须使用示例命名");
  for (const needle of REAL_SCHOOL_DENYLIST) {
    assert.ok(!allText.includes(needle), `不得出现真实学校标识：${needle}`);
  }
  for (const needle of PRIVATE_VALUE_DENYLIST) {
    assert.ok(!allText.includes(needle), `不得拷贝真实上传值：${needle}`);
  }
});
