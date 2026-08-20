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

test("PP3 invalid Widget payload fails closed to sanitized text", () => {
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
  assert.equal(result.fallbackText, "当前结果暂时无法以卡片展示。");
  assert.doesNotMatch(result.fallbackText, /queryId|secret|\{|\}/);
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
