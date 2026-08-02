const crypto = require("crypto");

const PROVIDER_EVENT_TYPES = new Set([
  "provider.selected",
  "provider.started",
  "provider.completed",
  "provider.failed",
]);

function safeText(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, max);
}

function asTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isExternalProvider(value) {
  const provider = safeText(value, 40).toLowerCase();
  return Boolean(provider) && provider !== "mock" && provider !== "none";
}

function operationalReason(value, fallback = "PROVIDER_UNVERIFIED") {
  const text = safeText(value, 240);
  if (!text) return fallback;
  const match = text.match(/(?:PROVIDER|RUNTIME|HTTP|SESSION|RUN|TOOL|MEMORY)_[A-Z0-9_]+/);
  return safeText(match ? match[0] : text, 80) || fallback;
}

function evaluateProviderDecisionProbe(input = {}) {
  const requestId = safeText(input.requestId, 96);
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const safety = payload.safety && typeof payload.safety === "object" ? payload.safety : {};
  const stages = payload.providerStages && typeof payload.providerStages === "object" ? payload.providerStages : {};
  const decisionStage = stages.understanding && typeof stages.understanding === "object"
    ? stages.understanding
    : {};
  const events = (Array.isArray(input.events) ? input.events : []).filter((event) => {
    if (!event || safeText(event.requestId, 96) !== requestId) return false;
    const stage = safeText(event.stage, 40).toLowerCase();
    return (stage === "decision" || stage === "understanding") && isExternalProvider(event.provider);
  });
  const completedEvent = events.find((event) => event.ok === true || safeText(event.status, 24).toLowerCase() === "success") || null;
  const failedEvent = events.find((event) => event.ok === false || safeText(event.status, 24).toLowerCase() === "failed") || null;
  const stageProvider = safeText(decisionStage.provider, 40);
  const completedProvider = safeText(completedEvent && completedEvent.provider, 40);
  const provider = completedProvider
    || stageProvider
    || safeText(failedEvent && failedEvent.provider, 40)
    || safeText(safety.resolvedProvider || safety.provider, 40)
    || "mock";
  const attempted = decisionStage.attempted === true
    || safety.externalProviderUsed === true
    || events.length > 0;
  const completed = decisionStage.completed === true && isExternalProvider(stageProvider);
  const durableCompletionRecorded = Boolean(completedEvent);
  const providerMismatch = completed && durableCompletionRecorded
    && stageProvider.toLowerCase() !== completedProvider.toLowerCase();
  const passed = completed && durableCompletionRecorded && !providerMismatch;
  let reasonCode = "OK";
  if (!passed) {
    if (providerMismatch) reasonCode = "PROVIDER_TRUTH_MISMATCH";
    else if (completed && !durableCompletionRecorded) reasonCode = "PROVIDER_COMPLETION_NOT_RECORDED";
    else if (!completed && durableCompletionRecorded) reasonCode = "PROVIDER_COMPLETION_NOT_REFLECTED";
    else if (failedEvent) reasonCode = operationalReason(failedEvent.reasonCode);
    else if (decisionStage.reasonCode) reasonCode = operationalReason(decisionStage.reasonCode);
    else if (safety.fallbackReason) reasonCode = operationalReason(safety.fallbackReason);
    else if (attempted) reasonCode = "PROVIDER_ATTEMPT_INCOMPLETE";
    else reasonCode = "PROVIDER_UNVERIFIED";
  }
  return Object.freeze({
    passed,
    reasonCode,
    details: Object.freeze({
      provider,
      attempted,
      completed,
      durableCompletionRecorded,
      providerMismatch,
      requestId,
    }),
  });
}

function runtimeProbeId(event) {
  const material = [event.at, event.provider, event.stage, event.kind, event.status, event.reason].join("|");
  return `probe_${crypto.createHash("sha256").update(material).digest("hex").slice(0, 20)}`;
}

function durableEvent(run, event) {
  if (!event || !PROVIDER_EVENT_TYPES.has(String(event.type || ""))) return null;
  const provider = safeText(event.provider, 40);
  if (!provider) return null;
  const type = String(event.type);
  const status = type === "provider.completed"
    ? "success"
    : (type === "provider.failed" ? "failed" : safeText(event.status || type.split(".")[1], 24));
  return {
    eventId: safeText(event.eventId || `${run.runId}:${event.sequence}`, 128),
    at: safeText(event.at, 40),
    runId: safeText(run.runId, 100),
    requestId: safeText(run.requestId, 96),
    environment: safeText(run.runtimeMode || event.runtimeMode, 16),
    provider,
    stage: safeText(event.stage, 40),
    status,
    ok: type === "provider.completed" ? true : (type === "provider.failed" ? false : null),
    reasonCode: type === "provider.failed" ? safeText(event.reasonCode || "PROVIDER_FAILED", 80) : "",
    latencyMs: Math.max(0, Math.round(Number(event.latencyMs || event.durationMs || 0) || 0)),
    kind: "run",
  };
}

function probeEvent(event) {
  if (!event || (event.kind !== "probe" && event.stage !== "probe")) return null;
  const status = safeText(event.status || (event.ok === true ? "success" : (event.ok === false ? "failed" : "started")), 24);
  return {
    eventId: runtimeProbeId(event),
    at: safeText(event.at, 40),
    runId: "",
    requestId: "",
    environment: safeText(event.environment, 16),
    provider: safeText(event.provider, 40),
    stage: safeText(event.stage || "probe", 40),
    status,
    ok: event.ok === true ? true : (event.ok === false ? false : null),
    reasonCode: event.ok === false ? safeText(event.reason || event.reasonCode || "PROVIDER_FAILED", 80) : "",
    latencyMs: Math.max(0, Math.round(Number(event.latencyMs || 0) || 0)),
    kind: "probe",
  };
}

function findLatestDurableProviderAttempt(runRecords, environment) {
  const expectedEnvironment = safeText(environment, 16).toLowerCase();
  let latest = null;
  (Array.isArray(runRecords) ? runRecords : []).forEach((run) => {
    const runEnvironment = safeText(run && (run.runtimeMode || run.environment), 16).toLowerCase();
    if (!expectedEnvironment || runEnvironment !== expectedEnvironment) return;
    (Array.isArray(run && run.events) ? run.events : []).forEach((event) => {
      const item = durableEvent(run, event);
      if (!item || !["provider.started", "provider.completed", "provider.failed"].includes(String(event.type || ""))) return;
      if (!item.provider || item.provider === "mock" || !asTime(item.at)) return;
      if (!latest || asTime(item.at) >= asTime(latest.at)) latest = item;
    });
  });
  if (!latest) return null;
  return Object.freeze({
    provider: latest.provider,
    at: latest.at,
    status: latest.status,
    stage: latest.stage,
    reasonCode: latest.reasonCode,
  });
}

function createProviderOperationsLogService(options = {}) {
  const listRunRecords = options.listRunRecords;
  const getRecentCallEvents = options.getRecentCallEvents;
  if (typeof listRunRecords !== "function") throw new TypeError("listRunRecords is required");
  if (typeof getRecentCallEvents !== "function") throw new TypeError("getRecentCallEvents is required");

  async function list(query = {}) {
    const limit = Math.max(1, Math.min(120, Number(query.limit) || 60));
    const afterMs = asTime(query.after);
    const runs = await listRunRecords();
    const durable = (Array.isArray(runs) ? runs : []).flatMap((run) => (Array.isArray(run.events) ? run.events : [])
      .map((event) => durableEvent(run, event))
      .filter(Boolean));
    const probes = (getRecentCallEvents(120) || []).map(probeEvent).filter(Boolean);
    const byId = new Map();
    durable.concat(probes).forEach((event) => {
      if (!event.eventId || afterMs && asTime(event.at) <= afterMs) return;
      byId.set(event.eventId, event);
    });
    const events = Array.from(byId.values())
      .sort((left, right) => asTime(right.at) - asTime(left.at))
      .slice(0, limit);
    const source = durable.length && probes.length
      ? "durable-run-event-store+runtime-probe"
      : (durable.length ? "durable-run-event-store" : (probes.length ? "runtime-probe" : "durable-run-event-store"));
    return {
      events,
      source,
      cursor: events.length ? events[0].at : safeText(query.after, 40),
      checkedAt: new Date().toISOString(),
    };
  }

  return Object.freeze({ list });
}

let defaultService = null;

function getDefaultService() {
  if (!defaultService) {
    const runEventService = require("./agentRunEventService");
    const providerChainService = require("./providerChainService");
    defaultService = createProviderOperationsLogService({
      listRunRecords: () => runEventService.listRunRecords(),
      getRecentCallEvents: (limit) => providerChainService.getRecentCallEvents(limit),
    });
  }
  return defaultService;
}

module.exports = {
  createProviderOperationsLogService,
  evaluateProviderDecisionProbe,
  findLatestDurableProviderAttempt,
  list(query) { return getDefaultService().list(query); },
};
