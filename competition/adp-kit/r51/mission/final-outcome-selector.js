"use strict";

const { CAPABILITIES } = require("./capabilities.js");

const FACT_TO_CAPABILITY = Object.freeze(Object.fromEntries(
  Object.values(CAPABILITIES).flatMap((definition) =>
    (definition.produces || []).map((factKey) => [factKey, definition.id]))
));

const FAMILY_PRIORITY = Object.freeze({
  teaching_assurance: ["rescheduleSimFacts", "riskFacts", "spaceFacts", "scheduleFacts"],
  collaboration_planning: ["groupPlanFacts", "spaceFacts", "availabilityFacts"],
  campus_operations_insight: ["riskFacts", "scheduleFacts", "rankingFacts", "spaceUtilFacts"],
  reschedule_simulation: ["rescheduleSimFacts"],
  risk_inquiry: ["riskFacts"],
  schedule_inquiry: ["scheduleFacts"],
  schedule_range_inquiry: ["scheduleFacts"],
  group_planning: ["groupPlanFacts"],
  common_availability: ["availabilityFacts"],
  space_inquiry: ["spaceFacts"],
  ranking_inquiry: ["rankingFacts"],
  overview_inquiry: ["overviewFacts"],
  space_utilization_inquiry: ["spaceUtilFacts"],
  day_planning: ["dayPlanFacts"],
});

function defaultTool(capabilityId) {
  const definition = CAPABILITIES[capabilityId];
  return definition && Array.isArray(definition.tools) ? definition.tools[0] : null;
}

function finalFactOrder(mission) {
  const goal = mission && mission.goal || {};
  const criteria = Array.isArray(goal.completionCriteria) ? goal.completionCriteria : [];
  const preferred = FAMILY_PRIORITY[goal.goalFamily] || [];
  return [
    ...preferred.filter((factKey) => criteria.includes(factKey)),
    ...criteria.slice().reverse().filter((factKey) => !preferred.includes(factKey)),
  ];
}

function selectFinalOutcome(mission, capabilityToolMap = {}) {
  const completed = Array.isArray(mission && mission.completedCapabilities) ? mission.completedCapabilities : [];
  if (completed.length === 0) return null;
  const availableFacts = mission && mission.availableFacts && typeof mission.availableFacts === "object"
    ? mission.availableFacts : null;
  const factKeys = finalFactOrder(mission);

  for (const factKey of factKeys) {
    const fact = availableFacts && availableFacts[factKey];
    if (!fact || fact.verified !== true) continue;
    const capabilityId = fact.capabilityId || FACT_TO_CAPABILITY[factKey];
    if (!capabilityId || !completed.includes(capabilityId)) continue;
    const toolName = capabilityToolMap[capabilityId] || defaultTool(capabilityId);
    if (toolName) return { capabilityId, factKey, toolName };
  }

  // Compatibility for historical call sites that did not retain fact records.
  if (!availableFacts || Object.keys(availableFacts).length === 0) {
    const priorityCapabilities = factKeys.map((factKey) => FACT_TO_CAPABILITY[factKey]).filter(Boolean);
    const capabilityId = priorityCapabilities.find((id) => completed.includes(id)) || completed[completed.length - 1];
    const toolName = capabilityToolMap[capabilityId] || defaultTool(capabilityId);
    if (toolName) return { capabilityId, factKey: null, toolName };
  }

  // A lower-priority verified fact remains usable when a terminal fact exists but is unverified.
  if (availableFacts) {
    for (const [factKey, fact] of Object.entries(availableFacts)) {
      if (!fact || fact.verified !== true) continue;
      const capabilityId = fact.capabilityId || FACT_TO_CAPABILITY[factKey];
      if (!capabilityId || !completed.includes(capabilityId)) continue;
      const toolName = capabilityToolMap[capabilityId] || defaultTool(capabilityId);
      if (toolName) return { capabilityId, factKey, toolName };
    }
  }
  return null;
}

module.exports = { FACT_TO_CAPABILITY, FAMILY_PRIORITY, finalFactOrder, selectFinalOutcome };

