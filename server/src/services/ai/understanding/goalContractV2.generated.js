// Generated from server/config/agent-capability-manifest.json. Do not edit by hand.
// Source sha256: cf5366385582400d7fc5cfef72dddd8636ec7eed9b3a115d5b9a72c43f82ba6b
// Generated at: 2026-07-27T12:23:30.938Z
// Regenerate with: npm run generate:goal-contract-v2
const CONTRACT_VERSION = "goal-contract.v2";

// Every goal id declared by the Capability Manifest (intents keys).
const GOAL_IDS = Object.freeze([
  "clarify_missing_slot",
  "get_today_courses",
  "get_tomorrow_courses",
  "get_next_course",
  "get_week_schedule",
  "get_teaching_week",
  "get_term_calendar",
  "search_empty_rooms",
  "search_continuous_empty_rooms",
  "search_school_index",
  "get_schedule_detail",
  "recommend_meeting_time",
  "diagnose_data_status",
  "explain_personal_import",
  "get_campus_weather",
  "get_course_weather_advice",
  "search_campus_place",
  "get_campus_route",
  "get_classroom_location",
  "next_course_location",
  "manage_course_reminders",
  "course_action_advice",
  "inspect_schedule_health",
  "detect_schedule_changes",
  "conversation_memory",
  "update_user_preference",
  "rag_search",
  "project_qa",
  "conversational_help",
  "generate_image",
  "campus_multi_step_advice",
  "set_current_schedule"
]);

// Entity roles a GoalContract V2 entity may address.
const ENTITY_ROLES = Object.freeze([
  "teacher",
  "class",
  "classroom",
  "course",
  "campus",
  "course_reminder",
  "preference",
  "page",
  "knowledge",
  "none"
]);

const REQUESTED_EFFECTS = Object.freeze([
  "read",
  "write",
  "navigate",
  "conversation"
]);

// goalId -> requested effect. Derived from Manifest tool operations and skill
// semantics; the generator fails rather than ship an incomplete map.
const GOAL_EFFECTS = Object.freeze({
  "clarify_missing_slot": "conversation",
  "get_today_courses": "read",
  "get_tomorrow_courses": "read",
  "get_next_course": "read",
  "get_week_schedule": "read",
  "get_teaching_week": "read",
  "get_term_calendar": "read",
  "search_empty_rooms": "read",
  "search_continuous_empty_rooms": "read",
  "search_school_index": "read",
  "get_schedule_detail": "read",
  "recommend_meeting_time": "read",
  "diagnose_data_status": "read",
  "explain_personal_import": "read",
  "get_campus_weather": "read",
  "get_course_weather_advice": "read",
  "search_campus_place": "navigate",
  "get_campus_route": "navigate",
  "get_classroom_location": "navigate",
  "next_course_location": "navigate",
  "manage_course_reminders": "write",
  "course_action_advice": "read",
  "inspect_schedule_health": "read",
  "detect_schedule_changes": "read",
  "conversation_memory": "conversation",
  "update_user_preference": "write",
  "rag_search": "read",
  "project_qa": "conversation",
  "conversational_help": "conversation",
  "generate_image": "write",
  "campus_multi_step_advice": "read",
  "set_current_schedule": "write"
});

// Frozen schema snapshot of the normalized GoalContract V2 shape. Consumed by
// tools/test-goal-contract-v2.js for schema/normalizer consistency checks.
const GOAL_CONTRACT_V2_SCHEMA = Object.freeze({
  $id: CONTRACT_VERSION,
  type: "object",
  additionalProperties: false,
  required: [
    "contractVersion",
    "goalId",
    "candidateGoals",
    "entities",
    "constraints",
    "followUpMode",
    "missingSlots",
    "ambiguity",
    "confidence",
    "provenance",
  ],
  properties: {
    contractVersion: { const: CONTRACT_VERSION },
    goalId: { enum: GOAL_IDS },
    candidateGoals: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["goalId", "confidence", "provenance"],
        properties: {
          goalId: { enum: GOAL_IDS },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          provenance: { enum: ["model", "deterministic", "rule", "fallback", "adapter"] },
        },
      },
    },
    entities: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "value", "normalizedValue", "confidence", "provenance"],
        properties: {
          role: { enum: ENTITY_ROLES },
          value: { type: "string", minLength: 1 },
          normalizedValue: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          provenance: { enum: ["model", "deterministic", "rule", "fallback", "adapter"] },
        },
      },
    },
    constraints: { type: "object" },
    followUpMode: {
      enum: [
        "none",
        "new_goal",
        "inherit_active_goal",
        "inherit_last_entity",
        "replace_constraints",
        "fill_pending_clarification",
        "correction",
      ],
    },
    missingSlots: { type: "array", maxItems: 8, items: { type: "string" } },
    ambiguity: {
      type: "object",
      additionalProperties: false,
      required: ["isAmbiguous", "reason", "candidates"],
      properties: {
        isAmbiguous: { type: "boolean" },
        reason: { type: "string" },
        candidates: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["value", "confidence"],
            properties: {
              goalId: { enum: GOAL_IDS },
              entityRole: { enum: ENTITY_ROLES },
              value: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
    requestedEffect: { enum: REQUESTED_EFFECTS },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    provenance: {
      type: "object",
      additionalProperties: false,
      required: ["source", "provider", "model", "understandingSource"],
      properties: {
        source: { enum: ["model", "deterministic", "rule", "fallback", "adapter"] },
        provider: { type: "string" },
        model: { type: "string" },
        understandingSource: { type: "string" },
      },
    },
  },
  forbiddenFields: ["toolName", "tool", "url", "route", "db", "command", "sql"],
});

module.exports = {
  CONTRACT_VERSION,
  ENTITY_ROLES,
  GOAL_CONTRACT_V2_SCHEMA,
  GOAL_EFFECTS,
  GOAL_IDS,
  REQUESTED_EFFECTS,
};
