const assert = require("assert");

process.env.AI_AGENT_ENABLED = "true";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_RUNTIME_MODE = "competition";

const agentService = require("../server/src/services/ai/agentService");

function run() {
  process.env.AI_PROVIDER_POLICY = "auto";
  assert.strictEqual(
    agentService.shouldUseExternalProvider({ name: "clarify_missing_slot" }, [], "auto"),
    false,
    "clarify should use local template in auto policy"
  );
  assert.strictEqual(
    agentService.shouldUseExternalProvider({ name: "search_school_index", slots: { q: "" } }, [{ name: "search_school_index", result: { q: "", items: [] } }], "auto"),
    false,
    "missing keyword should not call external provider"
  );
  assert.strictEqual(
    agentService.shouldUseExternalProvider({ name: "search_school_index", slots: { q: "不存在老师" } }, [{ name: "search_school_index", result: { q: "不存在老师", items: [] } }], "auto"),
    false,
    "school index should stay deterministic in auto policy"
  );
  assert.strictEqual(
    agentService.shouldUseExternalProvider({ name: "diagnose_data_status" }, [{ name: "diagnose_data_status", result: { success: true } }], "always", "competition"),
    true,
    "always policy may ask the external provider for wording while keeping deterministic cards"
  );
  assert.strictEqual(
    agentService.shouldUseExternalProvider({ name: "diagnose_data_status" }, [{ name: "diagnose_data_status", result: { success: true } }], "always", "public"),
    false,
    "public mode must not call external providers even when policy is always"
  );
  assert.strictEqual(
    agentService.shouldUseExternalProvider({ name: "recommend_meeting_time" }, [{ name: "recommend_meeting_time", result: { candidates: [{ weekday: 1 }] } }], "auto"),
    false,
    "meeting recommendation should stay local in auto policy"
  );

  process.env.AI_PROVIDER_POLICY = "tool-only";
  assert.strictEqual(
    agentService.shouldUseExternalProvider({ name: "search_empty_rooms" }, [{ name: "search_empty_rooms", result: { rooms: [{ roomName: "C7-203" }, { roomName: "C7-305" }] } }], "tool-only"),
    false,
    "tool-only should never call external provider"
  );

  process.env.AI_PROVIDER_POLICY = "always";
  assert.strictEqual(
    agentService.shouldUseExternalProvider({ name: "search_empty_rooms" }, [{ name: "search_empty_rooms", result: { rooms: [{ roomName: "C7-203" }] } }], "always", "competition"),
    true,
    "always should call external provider when agent is enabled and provider is external"
  );

  console.log("test-ai-provider-policy passed");
}

run();
