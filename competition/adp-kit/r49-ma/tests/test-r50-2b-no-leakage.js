"use strict";
// R50.2B 泄漏门禁（2026-08-19）
// 用户可见的 CampusResultEnvelope 不得包含：
//  queryId / dataHash / sourceTool / rankContext / temporalContext / NodeID /
//  VarBizID / token / authorization / 密钥 / 内部 URL / 原始内部协议字段。
// 校验方式：键名扫描 + 序列化值扫描（大小写不敏感、子串匹配），
// sanitizeEnvelope 必须移除内部元数据，且不得改动/编造校园事实字段。
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const KIT = path.join(__dirname, "..", "..");
const WIDGET_DIR = path.join(KIT, "r50.2", "widget");

function loadEnvelope() {
  return require(path.join(WIDGET_DIR, "envelope.js"));
}

const base = {
  version: "1.0",
  variant: "schedule",
  status: "success",
  title: "教师003 · 第1周课表",
  verified: true,
  summary: "第1周共 5 条课程。",
  sections: [],
  actions: [],
  displayMeta: {},
};

test("leakage: rejects internal keys anywhere in the envelope", () => {
  const { isClean } = loadEnvelope();
  const injections = {
    queryId: "q-20260819-abc",
    dataHash: "sha256:deadbeef",
    sourceTool: "campus_schedule_query",
    rankContext: { selectedRank: 1 },
    temporalContext: { resolvedWeek: 1 },
    NodeID: "node-01",
    VarBizID: "vbz-1",
    Authorization: "Bearer abc.def",
    internalUrl: "https://internal.example.com/api/query_schedule",
    secretKey: "sk-xxxx",
  };
  for (const [key, value] of Object.entries(injections)) {
    const raw = JSON.parse(JSON.stringify(base));
    raw[key] = value;
    const result = isClean(raw);
    assert.equal(result.ok, false, `键 ${key} 必须被判为泄漏`);
    assert.equal(result.violations.some((v) => v.field === key), true, `泄漏报告必须指出字段 ${key}`);
  }
});

test("leakage: rejects serialized values containing internal protocol material", () => {
  const { isClean } = loadEnvelope();
  const valueInjections = [
    "查询编号 q-20260819-abc 的结果",
    "dataHash sha256:deadbeef 已核验",
    "由 sourceTool=campus_schedule_query 提供",
    "rankContext 选择第 1 名",
    "temporalContext 解析为第 1 周",
    "NodeID node-01 已执行",
    "VarBizID vbz-1",
    "Authorization Bearer eyJhbGciOi",
    "内部地址 https://internal.example.com/api/query_schedule",
    "密钥 sk-xxxx1234 已配置",
  ];
  for (const text of valueInjections) {
    const raw = JSON.parse(JSON.stringify(base));
    raw.summary = text;
    const result = isClean(raw);
    assert.equal(result.ok, false, `值「${text}」必须被判为泄漏`);
  }
});

test("leakage: sanitize removes internal fields and preserves public facts", () => {
  const { sanitizeEnvelope, isClean } = loadEnvelope();
  const raw = {
    ...base,
    queryId: "q-20260819-abc",
    evidence: { dataHash: "sha256:deadbeef", verified: true },
    sections: [{ title: "课程列表", rows: [{ label: "周一 第5-6节", value: "程序设计基础 · 校区A A2-301", hint: "教师003" }] }],
    actions: [{ id: "a1", type: "sys.chat", label: "只看周三", payload: { query: "查看教师003第1周周三的课" } }],
  };
  const cleaned = sanitizeEnvelope(raw);
  assert.equal(isClean(cleaned).ok, true, "sanitize 后必须无泄漏");
  assert.equal(Object.hasOwn(cleaned, "queryId"), false);
  assert.equal(Object.hasOwn(cleaned, "evidence"), false);
  assert.equal(cleaned.title, base.title, "sanitize 不得改动公开事实");
  assert.deepStrictEqual(cleaned.sections, raw.sections, "sanitize 不得改动业务 section");
  assert.deepStrictEqual(cleaned.actions, raw.actions, "sanitize 不得改动 sys.chat action");
});

test("leakage: value scan rejects internal URLs and raw /api paths", () => {
  const { isClean } = loadEnvelope();
  for (const bad of [
    "https://localhost:3000/api/query_schedule",
    "http://127.0.0.1:8080/tools",
    "https://internal.example.com/secret",
  ]) {
    const raw = { ...base, summary: `结果 ${bad}` };
    assert.equal(isClean(raw).ok, false, `内部 URL ${bad} 必须被拒绝`);
  }
});

test("leakage: legitimate user-semantic Chinese text passes", () => {
  const { isClean } = loadEnvelope();
  const clean = {
    ...base,
    summary: "第1周共 5 条课程，周一 2 条、周三 1 条、周五 1 条。",
    sections: [{ title: "课程列表", rows: [{ label: "周一", value: "程序设计基础", hint: "14:00-15:40" }] }],
    actions: [{ id: "a1", type: "sys.chat", label: "查看第2名的课表", payload: { query: "查看排名第2的教师课表" } }],
  };
  assert.equal(isClean(clean).ok, true);
});