const NEVER_RETRY = new Set([
  "INVALID_CREDENTIALS",
  "LOGIN_REJECTED",
  "INTERACTIVE_CHALLENGE_REQUIRED",
  "CAPTCHA_REQUIRED",
  "RISK_CONTROL_REQUIRED",
  "PROFILE_ID_MISMATCH",
  "STRUCTURE_CHANGED",
  "AUTH_PAGE_CHANGED",
  "LOGIN_PAGE_CHANGED",
]);

const RETRY_PAUSE_MS = 250;

function methodOf(spec) {
  return String(spec && spec.method || "GET").toUpperCase();
}

function networkRetryable(error) {
  const code = String(error && (error.code || error.errno) || "");
  if (!code) return false;
  if (code === "DIRECT_NETWORK_ERROR") return true;
  if (/TIMEOUT/i.test(code)) return true;
  return /^(ECONNRESET|ECONNABORTED|ENOTFOUND|EAI_AGAIN|EPIPE|ETIMEDOUT)$/i.test(code);
}

function canRetrySchoolGet(spec, error, statusCode) {
  if (!spec || spec._retried) return false;
  if (methodOf(spec) !== "GET") return false;
  const stage = String(spec.stage || "");
  if (stage === "profile-fetch" || stage === "login-post" || stage === "captcha-check" || stage === "semester-switch") return false;
  const code = String(error && error.code || "");
  if (NEVER_RETRY.has(code)) return false;
  if (error) return networkRetryable(error);
  const status = Number(statusCode || 0);
  return status >= 500 && status <= 599;
}

function retryMatrix() {
  return {
    never: Array.from(NEVER_RETRY),
    onceForIdempotentGet: ["ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "DIRECT_NETWORK_ERROR", "TIMEOUT", "HTTP_5XX"],
    neverMethod: ["POST", "PUT", "PATCH", "DELETE"],
    pauseMs: RETRY_PAUSE_MS,
    loginPost: "never",
    profileGet: "soft-fail-without-retry",
  };
}

module.exports = {
  NEVER_RETRY,
  RETRY_PAUSE_MS,
  canRetrySchoolGet,
  retryMatrix,
};
