/**
 * Verification coordination: pending-clarification state machine and planner
 * outcome verification glue for chat(). Skill/tool verification itself stays in
 * skillRegistry and agentKernel; this module only shapes what chat() passes
 * into buildResponse / memory commit.
 *
 * M2-T2 addition: verifyToolResults consumes the per-tool verification
 * policies declared in agent-capability-manifest.json at runtime.
 * M2-T3 addition: verifyToolResults also runs the departure-chain cross
 * verifier over the schedule-side + route-side results of chain goals.
 */
const capabilityManifestService = require("../capabilityManifestService");
const toolResultVerifier = require("../verification/toolResultVerifier");
const departureChainVerifier = require("../verification/departureChainVerifier");
const toolExecutor = require("./toolExecutor");
const { emitChatEvent } = require("./runEventPublisher");
const { nowIso } = require("./shared");

function buildClarificationPatch(intent = {}) {
  if (!intent || intent.name !== "clarify_missing_slot") {
    return { pendingClarification: null, clearPendingClarification: false };
  }
  const slot = intent.slots && intent.slots.slot || {};
  const type = ["teacher", "classroom", "course", "class"].includes(slot.type) ? slot.type : "";
  if (!type) {
    return { pendingClarification: null, clearPendingClarification: false };
  }
  const createdAt = Date.now();
  return {
    pendingClarification: {
      intentName: "search_school_index",
      type,
      missing: slot.missing || `${type}Name`,
      createdAt,
      expiresAt: createdAt + 5 * 60 * 1000,
    },
    clearPendingClarification: false,
  };
}

function resolvePendingClarificationPatch(input = {}) {
  const intent = input.intent || {};
  const context = input.context || {};
  const pendingPatch = buildClarificationPatch(intent);
  const pendingExpiresAt = Number(context.pendingClarification && context.pendingClarification.expiresAt || 0);
  const pendingExpired = context.pendingClarificationExpired === true
    || Boolean(context.pendingClarification && pendingExpiresAt && pendingExpiresAt < Date.now());
  if (intent.name !== "clarify_missing_slot" && intent.slots && intent.slots.filledFromPendingClarification) {
    pendingPatch.clearPendingClarification = true;
  } else if (intent.name !== "clarify_missing_slot" && context.pendingClarification) {
    pendingPatch.clearPendingClarification = true;
  } else if (pendingExpired && !pendingPatch.pendingClarification) {
    pendingPatch.clearPendingClarification = true;
  }
  return pendingPatch;
}

function resolveVerificationGoalContract(execution) {
  return execution.goalContract || (execution.verification && execution.verification.goalContract) || null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * M2-T2 runtime wiring: consume the per-tool verification policies declared in
 * agent-capability-manifest.json against the executed tool results of one
 * kernel execution.
 *
 * - Only tools that declare at least one verification policy key are verified;
 *   tools without a declared policy keep their existing kernel-verification
 *   behavior unchanged (no new failure modes for undeclared tools).
 * - Emits verification.started { toolCount } and
 *   verification.completed { status, violationCount, tool? } RunEvents through
 *   options.eventInput (same emitChatEvent channel as the other chat events).
 *   Payloads carry counts and tool ids only — never raw schedule data or user
 *   text (脱敏边界).
 * - Folds the aggregate verdict into execution context, append-only:
 *   execution.toolResultVerification = { status, ok, toolCount,
 *     violationCount, violations, perTool, checkedAt };
 *   on aggregate "failed" appends { code: "TOOL_RESULT_VERIFICATION_FAILED",
 *   tool } entries to execution.verification.errors and sets
 *   execution.verification.ok = false; on aggregate "partial" sets
 *   execution.partialCompletion = true. deriveExecutionOutcome's existing
 *   verification/partial outputs therefore reflect the real checks without
 *   any field semantics changing.
 *
 * Never throws: verification must not break the chat path.
 *
 * M2-T3: when the goal is a departure-chain goal and both chain sides are
 * usable, summary.chain carries the departure-chain verdict { status, ok,
 * violations, approximateFlags } and summary.evidence.approximateFlags
 * surfaces its advisory flags; chain violations join the aggregate
 * violations/violationCount (tool: "departure_chain") under the same
 * failed/partial folding rules. The verification.completed event payload
 * shape is unchanged (counts + real tool ids only).
 *
 * @returns {{ status: "verified"|"partial"|"failed"|"skipped", ok: boolean,
 *   toolCount: number, violationCount: number, violations: Array,
 *   perTool: Object, checkedAt: string, chain?: Object, evidence?: Object }}
 */
function verifyToolResults(execution, intent, goalContract, options = {}) {
  const target = isPlainObject(execution) ? execution : {};
  const opts = isPlainObject(options) ? options : {};
  const eventInput = isPlainObject(opts.eventInput) ? opts.eventInput : {};
  const runtimeMode = String(opts.runtimeMode || target.runtimeMode || "public");
  const effectiveIntent = isPlainObject(intent) ? intent : (isPlainObject(target.intent) ? target.intent : {});
  const effectiveContract = goalContract || target.goalContract || null;

  const collectedResults = toolExecutor.collectToolResults(target.toolCalls);
  const verifiedCalls = collectedResults
    .map((item) => Object.assign({}, item, {
      policy: toolResultVerifier.normalizePolicy(capabilityManifestService.getTool(item.toolId)),
    }))
    .filter((item) => Object.keys(item.policy).length > 0);

  if (!verifiedCalls.length) {
    return {
      status: "skipped",
      ok: true,
      toolCount: 0,
      violationCount: 0,
      violations: [],
      perTool: {},
      checkedAt: nowIso(),
    };
  }

  emitChatEvent(eventInput, {
    type: "verification.started",
    runtimeMode,
    toolCount: verifiedCalls.length,
  });

  const perTool = {};
  const violations = [];
  let status = "verified";
  verifiedCalls.forEach((item) => {
    // Tool-declared deterministic legal empty state: personal-schedule tools
    // answer { success: true, needContext: true, <empty collections> } when no
    // personal schedule summary is available. The manifest emptyResultPolicy
    // codes do not cover this codeless empty shape for every tool (M2-T1
    // policy gap, marked 【疑似缺陷】 in output/agent-platform-m2-progress.md),
    // so the coordinator accepts the tool's own legal-empty marker instead of
    // letting schema checks fabricate a hard failure on a legitimate empty
    // state. Verifier semantics themselves stay untouched.
    if (item.result.success === true && item.result.needContext === true) {
      perTool[item.toolId] = { status: "empty_accepted", ok: true, violations: [] };
      return;
    }
    // Tool execution already failed upstream: the failed step, the tool.failed
    // event, and the kernel resultVerifier already adjudicate run-level
    // evidence (e.g. FACT_TOOL_EVIDENCE_REQUIRED). Content verification only
    // applies to results the tool reports as successful — re-failing the run
    // here would double-punish flows the kernel deliberately tolerates
    // (baseline: campus_multi_step_advice completes with a failed auxiliary
    // tool call). The tool is still reported as not content-verified.
    if (item.status === "failed" || item.result.success === false) {
      perTool[item.toolId] = { status: "skipped", ok: true, violations: [], reason: "tool_call_failed" };
      return;
    }
    let verdict;
    try {
      verdict = toolResultVerifier.verify({
        toolId: item.toolId,
        policy: item.policy,
        result: item.result,
        intent: effectiveIntent,
        goalContract: effectiveContract,
      });
    } catch (error) {
      // toolResultVerifier is designed to never throw; a throw is a real bug
      // and must fail closed instead of being disguised as a pass.
      verdict = {
        status: "failed",
        ok: false,
        violations: [{ code: "VERIFIER_RUNTIME_ERROR", detail: `${item.toolId}: verifier threw unexpectedly` }],
      };
    }
    const toolViolations = Array.isArray(verdict.violations) ? verdict.violations : [];
    perTool[item.toolId] = {
      status: verdict.status,
      ok: verdict.ok === true,
      violations: toolViolations,
    };
    toolViolations.forEach((violation) => {
      violations.push(Object.assign({ tool: item.toolId }, violation));
    });
    if (verdict.status === "failed") status = "failed";
    else if (verdict.status === "partial" && status !== "failed") status = "partial";
  });

  // M2-T3: departure-chain cross verification (additive). Runs only when the
  // goal is a departure-chain goal AND both the schedule-side and route-side
  // results are chain-usable; otherwise the chain verifier reports "skipped"
  // and nothing below is folded in (不误报). Chain violations fold into the
  // same aggregate with the same failed/partial rules as per-tool verdicts;
  // the chain never re-punishes results the per-tool layer already failed or
  // accepted as legal empty (perToolStatus gate inside the verifier).
  let chainVerdict = null;
  try {
    chainVerdict = departureChainVerifier.verifyDepartureChain({
      toolResults: collectedResults.map((item) => Object.assign({}, item, {
        perToolStatus: perTool[item.toolId] ? perTool[item.toolId].status : undefined,
      })),
      intent: effectiveIntent,
      goalContract: effectiveContract,
    });
  } catch (error) {
    // departureChainVerifier is designed to never throw; a throw is a real
    // bug and must fail closed instead of being disguised as a pass.
    chainVerdict = {
      status: "failed",
      ok: false,
      violations: [{ code: "CHAIN_VERIFIER_RUNTIME_ERROR", detail: "departure_chain: verifier threw unexpectedly" }],
      approximateFlags: [],
    };
  }
  const chainRan = Boolean(chainVerdict) && chainVerdict.status !== "skipped";
  if (chainRan) {
    (Array.isArray(chainVerdict.violations) ? chainVerdict.violations : []).forEach((violation) => {
      violations.push(Object.assign({ tool: departureChainVerifier.CHAIN_TOOL_LABEL }, violation));
    });
    if (chainVerdict.status === "failed") status = "failed";
    else if (chainVerdict.status === "partial" && status !== "failed") status = "partial";
  }

  const summary = {
    status,
    ok: status !== "failed",
    toolCount: verifiedCalls.length,
    violationCount: violations.length,
    violations: violations.slice(0, 16),
    perTool,
    checkedAt: nowIso(),
  };
  if (chainRan) {
    // Surface the chain verdict (including its advisory approximateFlags) so
    // the evidence is not dropped at the coordination layer.
    summary.chain = chainVerdict;
    if (Array.isArray(chainVerdict.approximateFlags) && chainVerdict.approximateFlags.length) {
      summary.evidence = {
        approximateFlags: chainVerdict.approximateFlags.map((flag) => ({ field: flag.field, label: flag.label })),
      };
    }
  }

  target.toolResultVerification = summary;
  const kernelVerification = isPlainObject(target.verification)
    ? target.verification
    : { ok: true, errors: [] };
  if (!Array.isArray(kernelVerification.errors)) kernelVerification.errors = [];
  if (status === "failed") {
    kernelVerification.ok = false;
    verifiedCalls
      .filter((item) => perTool[item.toolId].status === "failed")
      .slice(0, 4)
      .forEach((item) => {
        kernelVerification.errors.push({
          code: "TOOL_RESULT_VERIFICATION_FAILED",
          tool: item.toolId,
        });
      });
    if (chainVerdict && chainVerdict.status === "failed") {
      kernelVerification.errors.push({
        code: "TOOL_RESULT_VERIFICATION_FAILED",
        tool: departureChainVerifier.CHAIN_TOOL_LABEL,
      });
    }
  } else if (status === "partial") {
    target.partialCompletion = true;
  }
  target.verification = kernelVerification;

  const firstOffender = verifiedCalls.find((item) => perTool[item.toolId].status === "failed")
    || verifiedCalls.find((item) => perTool[item.toolId].status === "partial");
  const completedEvent = {
    type: "verification.completed",
    runtimeMode,
    status,
    violationCount: violations.length,
  };
  if (firstOffender) completedEvent.tool = firstOffender.toolId;
  emitChatEvent(eventInput, completedEvent);

  return summary;
}

module.exports = {
  buildClarificationPatch,
  resolvePendingClarificationPatch,
  resolveVerificationGoalContract,
  verifyToolResults,
};
