"use strict";
// R50.2B CampusResultEnvelope 契约门禁（2026-08-19）
// 目标：锁定 canonical public presentation contract：
//  P1 仅接受 10 个 variant（schedule/space/collaboration/risk/reschedule/ranking/
//     overview/empty/error/message）与 3 个 status（success/empty/error）；
//  P2 必填公开字段缺失即拒绝；
//  P3 紧凑匿名 fixture 可通过校验；
//  P4 规范化产物确定性：同一输入重复 sanitize/normalize 字节一致。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const KIT = path.join(__dirname, "..", "..");
const WIDGET_DIR = path.join(KIT, "r50.2", "widget");

function loadEnvelope() {
  return require(path.join(WIDGET_DIR, "envelope.js"));
}

const compactSchedule = {
  version: "1.0",
  variant: "schedule",
  status: "success",
  title: "教师003 · 第1周课表",
  subtitle: "5 条课程 · 2 个校区",
  verified: true,
  summary: "第1周共 5 条课程，周一 2 条、周三 1 条、周四 1 条、周五 1 条。",
  context: "教学周：第1周（2026-08-31 ～ 09-04）",
  sections: [
    {
      title: "课程列表",
      rows: [
        { label: "周一 第5-6节", value: "程序设计基础 · 校区A A2-301 · 14:00-15:40", badge: "第5-6节", hint: "教师003 · 2025级A班" },
      ],
    },
  ],
  actions: [
    { id: "schedule-day", type: "sys.chat", label: "只看周三", payload: { query: "查看教师003第1周周三的课" } },
  ],
  displayMeta: {},
};

test("R50.2B envelope: accepts all 10 canonical variants with compact fixtures", () => {
  const { validateEnvelope } = loadEnvelope();
  for (const variant of [
    "schedule", "space", "collaboration", "risk", "reschedule",
    "ranking", "overview", "empty", "error", "message",
  ]) {
    const status = variant === "empty" ? "empty" : variant === "error" ? "error" : "success";
    const fixture = {
      ...compactSchedule,
      variant,
      status,
      verified: variant !== "error",
    };
    const result = validateEnvelope(fixture);
    assert.equal(result.ok, true, `variant=${variant} 必须通过校验: ${JSON.stringify(result.errors)}`);
  }
});

test("R50.2B envelope: rejects unknown variant / status", () => {
  const { validateEnvelope } = loadEnvelope();
  assert.equal(validateEnvelope({ ...compactSchedule, variant: "bogus" }).ok, false);
  assert.equal(validateEnvelope({ ...compactSchedule, status: "pending" }).ok, false);
  assert.equal(validateEnvelope({ ...compactSchedule, variant: "ranking", status: "error" }).ok, false,
    "error status 只允许 empty/error/message 家族（校验器必须拒绝 success+ranking 与非法组合之外的任何漂移）");
});

test("R50.2B envelope: rejects missing required public fields", () => {
  const { validateEnvelope } = loadEnvelope();
  for (const missing of ["variant", "status", "title", "verified", "summary"]) {
    const raw = { ...compactSchedule };
    delete raw[missing];
    const result = validateEnvelope(raw);
    assert.equal(result.ok, false, `缺少 ${missing} 必须拒绝`);
  }
});

test("R50.2B envelope: accepts verified empty and recoverable error as first-class fixtures", () => {
  const { validateEnvelope } = loadEnvelope();
  const empty = validateEnvelope({
    ...compactSchedule, variant: "empty", status: "empty",
    title: "暂无已核验结果", summary: "该条件下没有课程记录。",
    sections: [], actions: [{ id: "empty-broaden", type: "sys.chat", label: "扩大范围", payload: { query: "换一个教学周再查课表" } }],
  });
  assert.equal(empty.ok, true);
  const err = validateEnvelope({
    ...compactSchedule, variant: "error", status: "error", verified: false,
    title: "查询失败，可重试", summary: "暂时无法完成查询，请稍后重试或换一种问法。",
    sections: [], actions: [{ id: "error-retry", type: "sys.chat", label: "重试", payload: { query: "再查一次" } }],
  });
  assert.equal(err.ok, true);
});

test("R50.2B envelope: deterministic normalization is byte-stable", () => {
  const { validateEnvelope, sanitizeEnvelope } = loadEnvelope();
  const raw = { ...compactSchedule, bogusInternal: { queryId: "q-1", NodeID: "n-1" } };
  assert.equal(validateEnvelope(raw).ok, false, "未知内部字段不得通过校验");
  const first = JSON.stringify(sanitizeEnvelope({ ...compactSchedule }));
  const second = JSON.stringify(sanitizeEnvelope({ ...compactSchedule }));
  assert.equal(first, second, "同一输入 sanitize 必须字节一致");
});