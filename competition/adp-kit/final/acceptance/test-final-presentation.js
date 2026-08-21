"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const KIT = path.join(__dirname, "..", "..");
const POLICY_PATH = path.join(KIT, "r51", "presentation", "final-presentation-policy.js");
const { validateWidgetPayload } = require(path.join(KIT, "widget", "native", "campus-result-unified-v1", "payload-validator.js"));

function policy() {
  return fs.existsSync(POLICY_PATH) ? require(POLICY_PATH) : null;
}

function payload(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "widget-payloads", name), "utf8"));
}

function teachingMission() {
  return {
    goal: { goalFamily: "teaching_assurance", completionCriteria: ["scheduleFacts", "riskFacts"] },
    completedCapabilities: ["SCHEDULE_DETAIL", "RISK_CHECK"],
    availableFacts: {
      scheduleFacts: { verified: true, capabilityId: "SCHEDULE_DETAIL" },
      riskFacts: { verified: true, capabilityId: "RISK_CHECK" },
    },
  };
}

test("PP1 verified dynamic result with a valid result card selects Widget", () => {
  const api = policy();
  assert.ok(api, "FinalPresentationPolicy must exist");
  const resultCard = payload("space.json");
  const result = api.selectFinalPresentation({
    responseClass: "dynamic_result", resultCard, validateResultCard: validateWidgetPayload,
  });
  assert.equal(result.mode, "widget");
  assert.equal(result.resultCard, resultCard);
});

test("PP2 compound Mission selects terminal Risk card rather than stale Schedule card", () => {
  const api = policy();
  assert.ok(api, "FinalPresentationPolicy must exist");
  const schedule = payload("schedule-week.json");
  const risk = payload("risk.json");
  const result = api.selectFinalPresentation({
    responseClass: "dynamic_result",
    mission: teachingMission(),
    capabilityToolMap: { SCHEDULE_DETAIL: "campus_schedule_query", RISK_CHECK: "campus_risk_check" },
    resultCards: { campus_schedule_query: schedule, campus_risk_check: risk },
    validateResultCard: validateWidgetPayload,
  });
  assert.equal(result.mode, "widget");
  assert.equal(result.selectedOutcome.toolName, "campus_risk_check");
  assert.equal(result.resultCard.variant, "risk");
});

test("PP3 invalid Widget payload fails closed to sanitized text derived from the same projection", () => {
  const api = policy();
  assert.ok(api, "FinalPresentationPolicy must exist");
  const invalid = { ...payload("space.json"), internal: { queryId: "secret" } };
  const result = api.selectFinalPresentation({
    responseClass: "dynamic_result",
    resultCard: invalid,
    fallbackText: "当前结果暂时无法以卡片展示。",
    validateResultCard: validateWidgetPayload,
  });
  assert.equal(result.mode, "text");
  assert.equal(result.resultCard, null);
  // fail-safe presentation contract：fallback 从同一 verified projection 派生业务内容，
  // 而不是只输出占位句、裸 JSON、schema 或内部协议。
  assert.notEqual(result.fallbackText, "当前结果暂时无法以卡片展示。");
  assert.ok(result.fallbackText.includes(invalid.title), "fallback 必须保留同一 projection 的业务标题");
  assert.ok(result.fallbackText.includes(invalid.summary), "fallback 必须保留同一 projection 的业务摘要");
  assert.doesNotMatch(result.fallbackText, /queryId|secret|\{|\}/);
  assert.doesNotMatch(result.fallbackText, /schema|version|protocol/i);
});

test("PP6 fail-safe presentation contract: bare placeholder, raw JSON and schema-only payloads are rejected to readable text", () => {
  const api = policy();
  assert.ok(api, "FinalPresentationPolicy must exist");
  // 裸 JSON / schema 碎片不是合法 result-card：必须 fail-closed 到可读文本
  const bareJson = { version: "1.0", variant: "schedule", status: "success", internal: { queryId: "q-1" } };
  const bare = api.selectFinalPresentation({
    responseClass: "dynamic_result", resultCard: bareJson, fallbackText: "当前结果暂时无法以卡片展示。",
    validateResultCard: validateWidgetPayload,
  });
  assert.equal(bare.mode, "text");
  assert.doesNotMatch(bare.fallbackText, /queryId|\{|\}/);

  // 合法 projection（即使 Widget 环境判定不可渲染）也能派生出可读业务文本
  const valid = payload("reschedule.json");
  const derived = api.fallbackFromProjection(valid, "占位");
  assert.ok(derived.includes(valid.title), "合法 projection 派生文本必须保留标题");
  assert.doesNotMatch(derived, /DecisionBundle|MissionState|sourceLessonId|mutatedData/i);
});

test("PP4 clarification and L3 confirmation never use the result Widget", () => {
  const api = policy();
  assert.ok(api, "FinalPresentationPolicy must exist");
  for (const responseClass of ["clarification", "confirmation"]) {
    const result = api.selectFinalPresentation({
      responseClass, resultCard: payload("space.json"), validateResultCard: validateWidgetPayload,
    });
    assert.equal(result.mode, "clarify");
    assert.equal(result.resultCard, null);
  }
});

test("PP5 short static knowledge uses message and ordinary chat may remain text", () => {
  const api = policy();
  assert.ok(api, "FinalPresentationPolicy must exist");
  assert.equal(api.selectFinalPresentation({ responseClass: "static_knowledge" }).mode, "message");
  assert.equal(api.selectFinalPresentation({ responseClass: "chat" }).mode, "text");
});

test("PP7 fail-safe presentation contract document is the SSOT and matches the enforced policy", () => {
  const contractPath = path.join(KIT, "final", "presentation", "PRESENTATION-CONTRACT.md");
  assert.ok(fs.existsSync(contractPath), "PRESENTATION-CONTRACT.md 必须存在");
  const text = fs.readFileSync(contractPath, "utf8");
  const api = policy();
  for (const required of [
    "verified result projection 确定性派生",
    "禁止语言模型重新编造事实",
    "Widget无法正常展示",
    "裸 JSON",
    "内部协议",
    "displayMeta.simulated",
  ]) {
    assert.ok(text.includes(required), `PRESENTATION-CONTRACT.md 必须包含：${required}`);
  }
  assert.ok(api.fallbackFromProjection, "policy 必须导出 fallbackFromProjection（同一投影派生）");
});
