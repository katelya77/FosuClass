const SYSTEM_CODES = new Set([
  "TIMEOUT",
  "AGENT_OFFLINE",
  "AUTH_PAGE_CHANGED",
  "STRUCTURE_CHANGED",
  "SCHOOL_HTTP_5XX",
  "NETWORK_FAILURE",
  "NETWORK_TIMEOUT",
  "UPSTREAM_TIMEOUT",
  "SCHOOL_SYSTEM_TIMEOUT",
]);

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function createState() {
  return {
    state: "CLOSED",
    openUntil: 0,
    failures: [],
    probes: 0,
    lastErrorCode: "",
    lastChangeAt: 0,
  };
}

const runtime = createState();

function threshold() {
  return Math.max(2, Math.floor(numberEnv("CAMPUS_SYNC_CIRCUIT_FAILURES", 6)));
}

function windowMs() {
  return Math.max(5000, numberEnv("CAMPUS_SYNC_CIRCUIT_WINDOW_MS", 120000));
}

function openMs() {
  return Math.min(120000, Math.max(30000, numberEnv("CAMPUS_SYNC_CIRCUIT_OPEN_MS", 60000)));
}

function probeLimit() {
  return Math.max(1, Math.floor(numberEnv("CAMPUS_SYNC_CIRCUIT_PROBE_LIMIT", 1)));
}

function isSystemCode(code) {
  return SYSTEM_CODES.has(String(code || ""));
}

function prune(now) {
  const min = now - windowMs();
  runtime.failures = runtime.failures.filter((stamp) => stamp >= min);
}

function open(now, code) {
  runtime.state = "OPEN";
  runtime.openUntil = now + openMs();
  runtime.probes = 0;
  runtime.lastErrorCode = String(code || runtime.lastErrorCode || "");
  runtime.lastChangeAt = now;
}

function loadState(next) {
  if (!next || typeof next !== "object") return;
  runtime.state = next.state === "OPEN" || next.state === "HALF_OPEN" ? next.state : "CLOSED";
  runtime.openUntil = Number(next.openUntil || 0) || 0;
  runtime.failures = Array.isArray(next.failures) ? next.failures.map(Number).filter((item) => item > 0).slice(-50) : [];
  runtime.probes = Number(next.probes || 0) || 0;
  runtime.lastErrorCode = String(next.lastErrorCode || "");
  runtime.lastChangeAt = Number(next.lastChangeAt || 0) || 0;
}

function exportState() {
  return {
    state: runtime.state,
    openUntil: runtime.openUntil,
    failures: runtime.failures.slice(-20),
    probes: runtime.probes,
    lastErrorCode: runtime.lastErrorCode,
    lastChangeAt: runtime.lastChangeAt,
  };
}

function allow(now) {
  const current = Number(now || Date.now());
  if (runtime.state === "OPEN" && current >= runtime.openUntil) {
    runtime.state = "HALF_OPEN";
    runtime.probes = 0;
    runtime.lastChangeAt = current;
  }
  if (runtime.state === "CLOSED") return { ok: true, probe: false };
  if (runtime.state === "OPEN") return { ok: false, probe: false, state: "OPEN" };
  if (runtime.probes >= probeLimit()) return { ok: false, probe: false, state: "HALF_OPEN" };
  runtime.probes += 1;
  return { ok: true, probe: true, state: "HALF_OPEN" };
}

function observe(code, now) {
  const current = Number(now || Date.now());
  const normalized = String(code || "");
  if (!normalized || normalized === "OK" || normalized === "COMPLETED") {
    if (runtime.state === "HALF_OPEN") {
      runtime.state = "CLOSED";
      runtime.failures = [];
      runtime.probes = 0;
      runtime.openUntil = 0;
      runtime.lastChangeAt = current;
    } else if (runtime.state === "CLOSED") {
      prune(current);
    }
    return exportState();
  }
  if (!isSystemCode(normalized)) {
    if (runtime.state === "HALF_OPEN" && runtime.probes > 0) runtime.probes -= 1;
    return exportState();
  }
  runtime.failures.push(current);
  runtime.lastErrorCode = normalized;
  prune(current);
  if (runtime.state === "HALF_OPEN" || runtime.failures.length >= threshold()) {
    open(current, normalized);
  }
  return exportState();
}

function snapshot(now) {
  const current = Number(now || Date.now());
  if (runtime.state === "OPEN" && current >= runtime.openUntil) {
    runtime.state = "HALF_OPEN";
    runtime.probes = 0;
  }
  prune(current);
  return {
    state: runtime.state,
    openUntil: runtime.openUntil || null,
    recentSystemFailures: runtime.failures.length,
    threshold: threshold(),
    windowMs: windowMs(),
    openMs: openMs(),
    probeLimit: probeLimit(),
    lastErrorCode: runtime.lastErrorCode || "",
  };
}

function resetForTests() {
  const fresh = createState();
  Object.keys(runtime).forEach((key) => {
    runtime[key] = fresh[key];
  });
}

module.exports = {
  SYSTEM_CODES,
  allow,
  exportState,
  isSystemCode,
  loadState,
  observe,
  resetForTests,
  snapshot,
};
