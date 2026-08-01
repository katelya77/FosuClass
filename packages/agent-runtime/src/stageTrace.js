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
  const contextDetails = output.contextId ? {
    contextId: safeString(output.contextId, 64),
  } : {};
  if (stage === "context") {
    return Object.assign(contextDetails, {
      schemaVersion: safeString(output.schemaVersion, 48),
      owner: safeString(output.owner, 80),
      messageCount: safeCount(output.messageCount || output.messages && output.messages.length),
      memoryCount: safeCount(output.memoryCount || output.memories && output.memories.length),
      episodeCount: safeCount(output.episodeCount || output.episodes && output.episodes.length),
      ragCount: safeCount(output.ragCount || output.rag && output.rag.length),
      tokenEstimate: safeCount(output.contextTokenEstimate),
      compressionUsed: output.compressionUsed === true,
      selectionFingerprint: safeString(output.selectionFingerprint, 80),
    });
  }
  if (stage === "decision") {
    const details = Object.assign(contextDetails, {
      executionPolicy: safeString(output.executionPolicy, 48),
      intendedProvider: safeString(output.intendedProvider, 64),
      actualFirstProvider: safeString(output.actualFirstProvider, 64),
      decisionSource: safeString(output.decisionSource, 48),
      goal: safeString(output.goal && (output.goal.name || output.goal.id) || output.goal, 100),
      selectedSkill: safeString(output.selectedSkillId || output.selectedSkill && output.selectedSkill.id, 120),
      fallbackPath: Object.freeze((Array.isArray(output.fallbackPath) ? output.fallbackPath : [])
        .slice(0, 2)
        .map((item) => safeString(item, 120))),
    });
    // Model-proposed plan skeleton summary (counts/ids only — never the
    // purpose text). Only a genuine model Decision exposes one; deterministic
    // and public paths never carry this field.
    const contractSteps = output.decisionContract && output.decisionContract.plan
      && Array.isArray(output.decisionContract.plan.steps)
      ? output.decisionContract.plan.steps
      : null;
    if (String(output.decisionSource || "") === "model" && contractSteps) {
      details.proposedPlan = Object.freeze({
        stepCount: safeCount(contractSteps.length),
        skillIds: Object.freeze(contractSteps.slice(0, 8).map((step) => safeString(step && step.skillId, 120))),
      });
    }
    // P2R Wave 2：失败分类统一落点（低基数枚举 token，非自由文本）。仅降级/失败
    // 链路的 Decision 产物携带这些字段；public deterministic 产物不含它们，
    // createAgentPlatform 的 public 剥离列表也会移除，双保险。
    if (output.failureClass) details.failureClass = safeString(output.failureClass, 48);
    if (output.fallbackReason) details.fallbackReason = safeString(output.fallbackReason, 120);
    if (Number.isFinite(output.remainingFallbackBudget)) {
      details.remainingFallbackBudget = Math.max(0, Math.min(10, Math.floor(Number(output.remainingFallbackBudget))));
    }
    return details;
  }
  if (stage === "skill_tool") {
    const calls = Array.isArray(output.toolCalls) ? output.toolCalls : [];
    const details = Object.assign(contextDetails, {
      toolCallCount: calls.length,
      toolIds: calls.slice(0, 16).map((call) => safeString(call && (call.toolId || call.toolName || call.name), 120)),
    });
    // Resolved plan truth: which skeleton/deterministic path produced the plan
    // and which rewrite reasons were applied. Public runs never expose these.
    const execution = output.execution && typeof output.execution === "object" ? output.execution : null;
    const structured = execution && execution.structuredPlan && typeof execution.structuredPlan === "object"
      ? execution.structuredPlan
      : null;
    // fail-closed：只有明确的 trial/dev 才暴露计划来源字段，runtimeMode 缺失时宁可不展示。
    if (structured && ["trial", "dev"].includes(String(execution.runtimeMode || "").toLowerCase())) {
      const steps = Array.isArray(structured.steps) ? structured.steps : [];
      details.resolvedPlan = Object.freeze({
        stepCount: safeCount(steps.length),
        skillIds: Object.freeze(steps.slice(0, 8).map((step) => safeString(step && step.skillId, 120))),
      });
      details.planSource = safeString(structured.planSource, 48);
      const reasonCounts = {};
      (Array.isArray(structured.planAdjustments) ? structured.planAdjustments : []).forEach((item) => {
        const code = safeString(item && item.reasonCode, 48);
        if (code) reasonCounts[code] = (reasonCounts[code] || 0) + 1;
      });
      if (Object.keys(reasonCounts).length) {
        details.planAdjustmentReasons = Object.freeze(reasonCounts);
      }
    }
    return details;
  }
  if (stage === "verification") {
    return Object.assign(contextDetails, {
      ok: output.ok === true,
      errorCount: safeCount(output.errorCount || output.errors && output.errors.length),
    });
  }
  if (stage === "response") {
    return Object.assign(contextDetails, {
      responseMode: safeString(output.responseMode || output.composer || "", 64),
      answerLength: safeCount(String(output.answer || output.text || "").length),
    });
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
