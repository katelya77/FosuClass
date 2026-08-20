"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const KIT = path.join(__dirname, "..", "..");
const VIEW = require(path.join(KIT, "r50.2", "widget", "view-model.js"));

function selector() {
  return require(path.join(KIT, "r51", "mission", "final-outcome-selector.js"));
}

const CAP_TO_TOOL = {
  SCHEDULE_DETAIL: "campus_schedule_query",
  RISK_CHECK: "campus_risk_check",
  COMMON_AVAILABILITY: "campus_common_free_time_query",
  GROUP_PLANNING: "campus_group_plan",
  TEACHER_LOAD_RANKING: "campus_teacher_load_query",
};

function fact(capabilityId, verified = true) {
  return { capabilityId, verified };
}

test("FO1 completed risk is terminal for teaching assurance even if stale schedule was appended later", () => {
  const mission = {
    goal: { goalFamily: "teaching_assurance", completionCriteria: ["scheduleFacts", "riskFacts"] },
    completedCapabilities: ["RISK_CHECK", "SCHEDULE_DETAIL"],
    availableFacts: { scheduleFacts: fact("SCHEDULE_DETAIL"), riskFacts: fact("RISK_CHECK") },
  };
  const selected = selector().selectFinalOutcome(mission, CAP_TO_TOOL);
  assert.deepEqual(selected, { capabilityId: "RISK_CHECK", factKey: "riskFacts", toolName: "campus_risk_check" });
});

test("FO2 unverified risk cannot displace the last verified completed outcome", () => {
  const mission = {
    goal: { goalFamily: "teaching_assurance", completionCriteria: ["scheduleFacts", "riskFacts"] },
    completedCapabilities: ["SCHEDULE_DETAIL", "RISK_CHECK"],
    availableFacts: { scheduleFacts: fact("SCHEDULE_DETAIL"), riskFacts: fact("RISK_CHECK", false) },
  };
  assert.deepEqual(selector().selectFinalOutcome(mission, CAP_TO_TOOL), {
    capabilityId: "SCHEDULE_DETAIL", factKey: "scheduleFacts", toolName: "campus_schedule_query",
  });
});

test("FO3 collaboration chooses completed group plan over intermediate availability", () => {
  const mission = {
    goal: { goalFamily: "collaboration_planning", completionCriteria: ["availabilityFacts", "groupPlanFacts"] },
    completedCapabilities: ["GROUP_PLANNING", "COMMON_AVAILABILITY"],
    availableFacts: { availabilityFacts: fact("COMMON_AVAILABILITY"), groupPlanFacts: fact("GROUP_PLANNING") },
  };
  assert.equal(selector().selectFinalOutcome(mission, CAP_TO_TOOL).capabilityId, "GROUP_PLANNING");
});

test("FO4 mission projection uses selector result, so a stale schedule card cannot cover final risk", () => {
  const mission = {
    goal: { goalFamily: "teaching_assurance", completionCriteria: ["scheduleFacts", "riskFacts"] },
    completedCapabilities: ["RISK_CHECK", "SCHEDULE_DETAIL"],
    availableFacts: { scheduleFacts: fact("SCHEDULE_DETAIL"), riskFacts: fact("RISK_CHECK") },
  };
  const toolResults = { campus_schedule_query: { marker: "schedule" }, campus_risk_check: { marker: "risk" } };
  const buildEnvelope = (raw) => ({
    ok: true,
    envelope: {
      version: "1.0", variant: raw.marker, status: "success", title: raw.marker === "risk" ? "教学风险" : "课表",
      subtitle: "", verified: true, summary: "已核验", context: "", sections: [], actions: [], displayMeta: {},
    },
  });
  const result = VIEW.projectMissionFinalViewModel(mission, toolResults, CAP_TO_TOOL, buildEnvelope);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.viewModel.variant, "risk");
  assert.equal(result.viewModel.title, "教学风险");
});

test("FO5 selector is deterministic under completed-capability order changes", () => {
  const base = {
    goal: { goalFamily: "teaching_assurance", completionCriteria: ["scheduleFacts", "riskFacts"] },
    availableFacts: { scheduleFacts: fact("SCHEDULE_DETAIL"), riskFacts: fact("RISK_CHECK") },
  };
  const a = selector().selectFinalOutcome({ ...base, completedCapabilities: ["SCHEDULE_DETAIL", "RISK_CHECK"] }, CAP_TO_TOOL);
  const b = selector().selectFinalOutcome({ ...base, completedCapabilities: ["RISK_CHECK", "SCHEDULE_DETAIL"] }, CAP_TO_TOOL);
  assert.deepEqual(a, b);
});
