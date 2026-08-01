const EXECUTION_POLICIES = Object.freeze({
  DETERMINISTIC: "deterministic",
  STRICT_MODEL_FIRST: "strict_model_first",
  ADAPTIVE: "adaptive",
});

function normalizedMode(value) {
  const mode = String(value || "public").trim().toLowerCase();
  if (mode === "competition") return "trial";
  return mode === "trial" || mode === "dev" ? mode : "public";
}

function resolveExecutionPolicy(input = {}) {
  const mode = normalizedMode(input.runtimeMode);
  if (mode === "public") return EXECUTION_POLICIES.DETERMINISTIC;
  const configured = String(input.configuredPolicy || "").trim().toLowerCase();
  if (input.trusted === true && configured === EXECUTION_POLICIES.ADAPTIVE) {
    return EXECUTION_POLICIES.ADAPTIVE;
  }
  return EXECUTION_POLICIES.STRICT_MODEL_FIRST;
}

module.exports = {
  EXECUTION_POLICIES,
  resolveExecutionPolicy,
};
