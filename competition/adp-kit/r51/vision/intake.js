"use strict";

const { VISION_KINDS, VISION_TRUST, validateVisionObservation } = require("./contract.js");

function classifyVisionObservation(observation) {
  if (!validateVisionObservation(observation).ok) return "generic_image";
  if (observation.kind !== "generic_image") return observation.kind;
  const entityTypes = new Set(observation.entityCandidates.map((candidate) => candidate.type));
  const text = [...observation.extractedText, ...observation.observations].join(" ");
  if (entityTypes.has("course") && observation.temporalCandidates.some((t) => t.periodStart != null)) return "schedule_screenshot";
  if (entityTypes.has("classroom") && /(?:公告|停用|借用|开放)/.test(text)) return "classroom_notice";
  if (/(?:教务|选课|成绩|考试安排)/.test(text)) return "academic_system_screenshot";
  if (/(?:通知|海报|讲座|截止)/.test(text)) return "notice_poster";
  if (/(?:表格|名单|统计|排名)/.test(text) || entityTypes.size > 1) return "table_image";
  return "generic_image";
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractVisionGoalHints(observations) {
  const list = Array.isArray(observations) ? observations : [];
  const valid = list.filter((observation) => validateVisionObservation(observation).ok);
  const entities = uniqueBy(valid.flatMap((observation) => observation.entityCandidates.map((candidate) => ({ ...candidate, assetId: observation.assetId }))), (x) => `${x.type}\u0000${x.text}`);
  const temporal = uniqueBy(valid.flatMap((observation) => observation.temporalCandidates.map((candidate) => ({ ...candidate, assetId: observation.assetId }))), (x) => `${x.text}\u0000${x.date || ""}\u0000${x.weekday || ""}`);
  return {
    trust: VISION_TRUST,
    verified: false,
    assetIds: valid.map((observation) => observation.assetId),
    kinds: valid.map(classifyVisionObservation),
    entities,
    temporal,
    ambiguous: entities.length > 1,
    recoverable: valid.length === 0 || valid.every((observation) => observation.extractedText.length === 0 && observation.entityCandidates.length === 0 && observation.temporalCandidates.length === 0 && observation.observations.length === 0),
  };
}

module.exports = { classifyVisionObservation, extractVisionGoalHints };
