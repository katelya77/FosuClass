// Generated from server/src/services/ai/runEventCatalog.js (EVENT_TYPES) + server/src/services/ai/aguiAdapter.js (EVENT_MAP). Do not edit by hand.
// Regenerate: node tools/generate-agent-event-map.js
const EVENT_TYPES = Object.freeze([
  "run.accepted",
  "request.sanitized",
  "understanding.started",
  "understanding.completed",
  "understanding.fallback",
  "intent.resolved",
  "skill.selected",
  "plan.created",
  "plan.replan",
  "planner.started",
  "planner.completed",
  "planner.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "provider.selected",
  "provider.started",
  "provider.completed",
  "provider.failed",
  "provider.shadow.started",
  "provider.shadow.completed",
  "provider.shadow.failed",
  "response.composing",
  "result.verifying",
  "run.completed",
  "run.degraded",
  "run.failed",
  "run.cancelled",
  "verification.started",
  "verification.completed"
]);

const EVENT_MAP = Object.freeze({
  "run.accepted": "RUN_STARTED",
  "request.sanitized": "STEP_STARTED",
  "understanding.started": "STEP_STARTED",
  "understanding.completed": "STEP_FINISHED",
  "understanding.fallback": "STEP_FINISHED",
  "intent.resolved": "STEP_FINISHED",
  "skill.selected": "STEP_FINISHED",
  "plan.created": "STEP_FINISHED",
  "plan.replan": "STEP_STARTED",
  "planner.started": "STEP_STARTED",
  "planner.completed": "STEP_FINISHED",
  "planner.failed": "STEP_FINISHED",
  "tool.started": "TOOL_CALL_START",
  "tool.completed": "TOOL_CALL_END",
  "tool.failed": "TOOL_CALL_END",
  "provider.selected": "STEP_STARTED",
  "provider.started": "STEP_STARTED",
  "provider.completed": "STEP_FINISHED",
  "provider.failed": "STEP_FINISHED",
  "provider.shadow.started": "STEP_STARTED",
  "provider.shadow.completed": "STEP_FINISHED",
  "provider.shadow.failed": "STEP_FINISHED",
  "response.composing": "TEXT_MESSAGE_START",
  "result.verifying": "STEP_STARTED",
  "verification.started": "STEP_STARTED",
  "verification.completed": "STEP_FINISHED",
  "run.completed": "RUN_FINISHED",
  "run.degraded": "RUN_FINISHED",
  "run.failed": "RUN_ERROR",
  "run.cancelled": "RUN_ERROR"
});

function mapRunEventType(type) {
  return EVENT_MAP[String(type || "")] || null;
}

module.exports = {
  EVENT_TYPES,
  EVENT_MAP,
  mapRunEventType,
};
