const STAGE_ORDER = Object.freeze([
  ["context", "context"],
  ["decision", "decision"],
  ["skill_tool", "skillTool"],
  ["verification", "verification"],
  ["response", "response"],
]);

function safeString(value, maxLength = 128) {
  return String(value == null ? "" : value).slice(0, maxLength);
}

function safeCount(value) {
  return Math.max(0, Math.min(100000, Number(value) || 0));
}

function detailsForStage(stage, output = {}) {
  if (!output || typeof output !== "object") return {};
  if (stage === "context") {
    return {
      messageCount: safeCount(output.messageCount || output.messages && output.messages.length),
      memoryCount: safeCount(output.memoryCount || output.memories && output.memories.length),
    };
  }
  if (stage === "decision") {
    return {
      executionPolicy: safeString(output.executionPolicy, 48),
      intendedProvider: safeString(output.intendedProvider, 64),
      actualFirstProvider: safeString(output.actualFirstProvider, 64),
      decisionSource: safeString(output.decisionSource, 48),
      goal: safeString(output.goal && (output.goal.name || output.goal.id) || output.goal, 100),
      selectedSkill: safeString(output.selectedSkillId || output.selectedSkill && output.selectedSkill.id, 120),
      fallbackPath: Object.freeze((Array.isArray(output.fallbackPath) ? output.fallbackPath : [])
        .slice(0, 2)
        .map((item) => safeString(item, 120))),
    };
  }
  if (stage === "skill_tool") {
    const calls = Array.isArray(output.toolCalls) ? output.toolCalls : [];
    return {
      toolCallCount: calls.length,
      toolIds: calls.slice(0, 16).map((call) => safeString(call && (call.toolId || call.toolName || call.name), 120)),
    };
  }
  if (stage === "verification") {
    return {
      ok: output.ok === true,
      errorCount: safeCount(output.errorCount || output.errors && output.errors.length),
    };
  }
  if (stage === "response") {
    return {
      responseMode: safeString(output.responseMode || output.composer || "", 64),
      answerLength: safeCount(String(output.answer || output.text || "").length),
    };
  }
  if (stage === "ui") {
    const blocks = Array.isArray(output.blocks) ? output.blocks : [];
    return {
      blockCount: blocks.length,
      blockTypes: blocks.slice(0, 24).map((block) => safeString(block && block.type, 40)),
    };
  }
  return {};
}

function stageRecord(stage, outcome, durationMs, details) {
  return {
    stage,
    owner: "@xiaofu-agent/agent-runtime",
    outcome,
    durationMs: Math.max(0, Number(durationMs) || 0),
    details: detailsForStage(stage, details),
  };
}

module.exports = {
  STAGE_ORDER,
  detailsForStage,
  stageRecord,
};
