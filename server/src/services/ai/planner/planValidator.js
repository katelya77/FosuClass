/**
 * Validates planner output against skill/tool whitelist and runtime policy.
 */

const capabilityManifestService = require("../capabilityManifestService");
const { MAX_STEPS, normalizePlan, REASON_CODES } = require("./planSchema");

function codedError(code, message, extra = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function validatePlan(planInput, options = {}) {
  const rawStepCount = Array.isArray(planInput && planInput.steps) ? planInput.steps.length : 0;
  if (rawStepCount > MAX_STEPS) {
    throw codedError("PLAN_STEP_LIMIT_EXCEEDED", `Plan exceeds ${MAX_STEPS} steps`, {
      maxSteps: MAX_STEPS,
      actual: rawStepCount,
    });
  }
  const plan = normalizePlan(planInput);
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(options.runtimeMode || "public");
  const skill = options.skill || null;
  const allowedTools = new Set(
    (options.allowedTools
      || (skill && skill.allowedTools)
      || Object.keys(capabilityManifestService.getManifest().tools || {})
    ).map(String)
  );

  if (plan.steps.length > MAX_STEPS) {
    throw codedError("PLAN_STEP_LIMIT_EXCEEDED", `Plan exceeds ${MAX_STEPS} steps`, {
      maxSteps: MAX_STEPS,
      actual: plan.steps.length,
    });
  }

  plan.steps.forEach((step) => {
    if (!step.toolName) {
      throw codedError("PLAN_STEP_INVALID", "Plan step missing toolName");
    }
    if (!allowedTools.has(step.toolName)) {
      throw codedError("TOOL_NOT_ALLOWED_FOR_SKILL", `Tool ${step.toolName} is not allowed`, {
        toolName: step.toolName,
      });
    }
    // Only enforce runtime allowlist for tools registered in the capability manifest.
    // Test doubles / custom tools may exist only on the skill allowlist.
    const manifestTool = capabilityManifestService.getManifest().tools
      && capabilityManifestService.getManifest().tools[step.toolName];
    if (manifestTool && !capabilityManifestService.isToolAllowedForRuntime(step.toolName, runtimeMode)) {
      throw codedError("TOOL_NOT_ALLOWED_FOR_RUNTIME", `Tool ${step.toolName} not available in ${runtimeMode}`, {
        toolName: step.toolName,
      });
    }
    if (!REASON_CODES.includes(step.reasonCode)) {
      throw codedError("PLAN_REASON_INVALID", `Invalid reasonCode ${step.reasonCode}`);
    }
    // Forbid raw DB / admin / arbitrary URL generation via planner args.
    const argsText = JSON.stringify(step.args || {});
    if (/mongodb|sql\s*select|DROP\s+TABLE|admin[_-]?token|Bearer\s+/i.test(argsText)) {
      throw codedError("PLAN_ARGS_FORBIDDEN", "Plan args contain forbidden patterns");
    }
  });

  if (plan.needsClarification && !plan.clarification) {
    throw codedError("PLAN_CLARIFICATION_INVALID", "needsClarification requires clarification object");
  }

  return plan;
}

module.exports = {
  codedError,
  validatePlan,
};
