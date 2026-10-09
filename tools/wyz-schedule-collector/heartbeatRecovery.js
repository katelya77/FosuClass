"use strict";
const HEARTBEAT = "/api/full-sync/v1/heartbeat";
const RETRY_DELAYS = [15000, 30000, 60000];
const COOLDOWN_MS = 300000;
function error(code, details = {}) { return Object.assign(new Error(code), { code }, details); }
function stopped() { return error("COLLECTOR_STOPPED", { retryable: false }); }
function codesOf(cause, seen = new Set()) {
  if (!cause || typeof cause !== "object" || seen.has(cause) || seen.size >= 12) return [];
  seen.add(cause);
  return [cause.code, cause.name, ...codesOf(cause.cause, seen), ...(Array.isArray(cause.errors) ? cause.errors.slice(0, 8).flatMap(item => codesOf(item, seen)) : [])].filter(value => typeof value === "string");
}
function classify(cause) {
  const codes = codesOf(cause);
  const pick = values => values.find(value => codes.includes(value));
  let transportCode;
  if ((transportCode = pick(["ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE", "ERR_TLS_HANDSHAKE_TIMEOUT"]))) return error("ORACLE_TLS_FAILED", { errorCategory: "tls", transportCode, retryable: false });
  if ((transportCode = pick(["EAI_AGAIN", "ENOTFOUND", "EAI_FAIL"]))) return error("ORACLE_DNS_FAILED", { errorCategory: "dns", transportCode, retryable: true });
  if ((transportCode = pick(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "TimeoutError"]))) return error("ORACLE_TIMEOUT", { errorCategory: "timeout", transportCode, retryable: true });
  if ((transportCode = pick(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]))) return error("ORACLE_CONNECTION_RESET", { errorCategory: "connection-reset", transportCode, retryable: true });
  if ((transportCode = pick(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"]))) return error("ORACLE_CONNECTION_FAILED", { errorCategory: "connection", transportCode, retryable: true });
  return error("ORACLE_NETWORK_FAILED", { errorCategory: "unknown-network", retryable: false });
}
function httpError(status) {
  const code = ({ 401: "ORACLE_AUTH_REJECTED", 403: "ORACLE_SIGNATURE_OR_CLOCK_REJECTED", 404: "ORACLE_AUTH_OR_ENDPOINT_REJECTED" })[status] || "ORACLE_HTTP_" + status;
  return error(code, { status, errorCategory: [401, 403, 404].includes(status) ? "authentication" : status >= 500 ? "http-server" : status === 408 ? "timeout" : status === 429 ? "http-rate-limit" : "http-client", retryable: status >= 500 || status === 408 || status === 429 });
}
function wait(ms, signal) {
  if (signal && signal.aborted) return Promise.reject(stopped());
  return new Promise((resolve, reject) => {
    const finish = () => { if (signal) signal.removeEventListener("abort", cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(stopped()); };
    if (signal) signal.addEventListener("abort", cancel, { once: true });
  });
}
function createHeartbeat(request, options = {}) {
  const now = options.now || Date.now, sleep = options.sleep || wait;
  const delays = options.delays || RETRY_DELAYS;
  const state = { mode: options.execute ? "execute" : "heartbeat-only", networkStatus: "starting", lastSuccessfulHeartbeatAt: null, consecutiveFailures: 0, consecutiveSuccesses: 0, errorCategory: null, transportCode: null, retryWaitMs: 0, lastSuccessfulConnectionMs: null };
  let hadFailure = false;
  function emit(patch) { Object.assign(state, patch); if (options.onState) options.onState({ ...state }); }
  async function heartbeat(body = { ok: true }, bounds = {}) {
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (options.signal && options.signal.aborted) throw stopped();
      if (bounds.deadline && now() >= bounds.deadline) throw error("COLLECTOR_LEASE_EXPIRED", { retryable: false });
      const started = now();
      try {
        const response = await request("POST", HEARTBEAT, body);
        if (!response || response.ok !== true) throw error("ORACLE_HEARTBEAT_REJECTED", { errorCategory: "protocol", retryable: false });
        emit({ networkStatus: state.consecutiveSuccesses + 1 >= 3 ? "healthy" : "recovering", lastSuccessfulHeartbeatAt: new Date(now()).toISOString(), consecutiveFailures: 0, consecutiveSuccesses: state.consecutiveSuccesses + 1, errorCategory: null, transportCode: null, retryWaitMs: 0, lastSuccessfulConnectionMs: Math.max(0, now() - started) });
        return response;
      } catch (caught) {
        if (options.signal && options.signal.aborted || caught.code === "COLLECTOR_STOPPED") throw stopped();
        hadFailure = true;
        const problem = caught.code && caught.code.startsWith("ORACLE_") ? caught : classify(caught);
        problem.heartbeatFailure = true;
        const delay = problem.retryable && attempt < delays.length ? delays[attempt] : 0;
        emit({ networkStatus: problem.retryable ? "degraded" : "fatal", consecutiveFailures: state.consecutiveFailures + 1, consecutiveSuccesses: 0, errorCategory: problem.errorCategory || "protocol", transportCode: problem.transportCode || null, retryWaitMs: delay });
        if (!delay) throw problem;
        const remaining = bounds.deadline ? Math.max(0, bounds.deadline - now()) : delay;
        await sleep(Math.min(delay, remaining), options.signal);
      }
    }
  }
  heartbeat.state = state;
  heartbeat.readyToClaim = () => !hadFailure || state.consecutiveSuccesses >= 3;
  heartbeat.cooldown = () => emit({ networkStatus: "degraded", retryWaitMs: COOLDOWN_MS });
  heartbeat.stopped = () => emit({ networkStatus: "stopped", retryWaitMs: 0 });
  return heartbeat;
}
function exitCode(cause) {
  if (["COLLECTOR_STOPPED"].includes(cause.code)) return 0;
  if (cause.errorCategory === "authentication") return 77;
  if (cause.retryable || ["COLLECTOR_LOCKED", "COLLECTOR_LEASE_EXPIRED", "RUN_LEASE_REJECTED"].includes(cause.code)) return 75;
  if (["ENOENT", "EACCES", "EPERM", "EROFS"].includes(cause.code)) return 78;
  if (/^(ORACLE_|COLLECTOR_(CONFIGURATION|CREDENTIALS|EXECUTION_MODE)|PRIVATE_|READ_ONLY_)/.test(cause.code || "")) return 78;
  return 1;
}
module.exports = { COOLDOWN_MS, HEARTBEAT, RETRY_DELAYS, classify, createHeartbeat, error, exitCode, httpError, stopped, wait };
