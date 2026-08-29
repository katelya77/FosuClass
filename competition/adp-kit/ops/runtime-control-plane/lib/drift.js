"use strict";

function add(result, bucket, code, detail, patch) {
  result[bucket].push({ code, detail, ...(patch ? { patch } : {}) });
}

function sameSet(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

function diffState(desired, current) {
  const result = { SAFE_AUTOMATABLE: [], MANUAL_CONSOLE_REQUIRED: [], BLOCKED_UNKNOWN: [] };
  if (!current || !current.observed) {
    add(result, "BLOCKED_UNKNOWN", "ADP_SNAPSHOT_UNAVAILABLE", "ADP API snapshot is not authenticated or identifiers are absent");
    return result;
  }
  const currentAgents = new Map((current.agents || []).map((x) => [x.key, x]));
  if (currentAgents.size !== desired.invariants.agentCount) add(result, "BLOCKED_UNKNOWN", "AGENT_COUNT_DRIFT", `${currentAgents.size}/${desired.invariants.agentCount}`);
  for (const agent of desired.agents) {
    const observed = currentAgents.get(agent.key);
    if (!observed) {
      add(result, "BLOCKED_UNKNOWN", "AGENT_NOT_OBSERVED", agent.key);
      continue;
    }
    if (observed.promptHash !== agent.promptHash) {
      add(result, "SAFE_AUTOMATABLE", "AGENT_PROMPT_DRIFT", agent.key, { action: "ModifyAgent", target: agent.key, updateMask: ["Instructions"] });
    }
    if (!sameSet(observed.campusTools, agent.campusTools)) {
      add(result, "SAFE_AUTOMATABLE", "AGENT_BINDING_DRIFT", agent.key, { action: "ModifyAgent", target: agent.key, updateMask: ["ToolList"] });
    }
  }
  const main = currentAgents.get("main");
  if (main && (main.campusTools || []).length > 0) add(result, "SAFE_AUTOMATABLE", "MAIN_CAMPUS_TOOL_DRIFT", "Main must have zero CampusTools");
  if (main && desired.multimodal.mainOfficialVisionToolRequired && !main.officialVisionToolBound) {
    add(result, "MANUAL_CONSOLE_REQUIRED", "MAIN_VISION_TOOL_NOT_BOUND", "Official vision tool binding requires Console proof unless a stable API schema is configured");
  }
  if (!sameSet(current.plugin && current.plugin.operationIds, desired.campusTools)) {
    add(result, "SAFE_AUTOMATABLE", "PLUGIN_TOOL_LIST_DRIFT", "CampusTools operation list differs", { action: "ModifyPlugin", target: "campus-tools", updateMask: ["ToolList"] });
  }
  if (current.widget && current.widget.name !== desired.widget.name) add(result, "MANUAL_CONSOLE_REQUIRED", "WIDGET_NAME_DRIFT", current.widget.name);
  if (current.widget && desired.widget.widgetId && current.widget.widgetId !== desired.widget.widgetId) {
    add(
      result,
      "MANUAL_CONSOLE_REQUIRED",
      "WIDGET_ID_DRIFT",
      current.widget.widgetId || "Widget ID is not observable; verify the latest real export in Console",
    );
  }
  if (current.releaseRequested || (current.app && current.app.published)) add(result, "BLOCKED_UNKNOWN", "PUBLISH_FORBIDDEN", "CreateRelease and publish are prohibited");
  if (current.legacyWorkflowActive === true) add(result, "MANUAL_CONSOLE_REQUIRED", "LEGACY_WORKFLOW_ACTIVE", "Disable legacy workflow in Console after manual verification");
  return result;
}

module.exports = { diffState };
