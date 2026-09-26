const { createFosuDirectClient } = require("./fosuDirectClient");
const personalSyncConfig = require("../config/personalSync");

const SOURCE = {
  CLIENT_DIRECT: "client-direct",
  CAMPUS_AGENT: "campus-agent",
};

const TERMINAL_SYNC_CODES = new Set([
  "INVALID_CREDENTIALS",
  "LOGIN_REJECTED",
  "EMPTY_PERSONAL_SCHEDULE",
  "STRUCTURE_CHANGED",
  "PROFILE_ID_MISMATCH",
  "SCHOOL_UNAVAILABLE",
  "CAMPUS_SYNC_DAILY_LIMIT",
  "CAMPUS_SYNC_RATE_LIMITED",
  "CAMPUS_SYNC_CONCURRENT_LIMIT",
  "CAMPUS_SYNC_BUSY",
  "CAMPUS_SYNC_MAINTENANCE",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "FOSU_SESSION_REQUIRED",
  "FOSU_SESSION_EXPIRED",
]);

function unsupported(code, extra) {
  const error = new Error(code || "UNKNOWN_SYNC_ERROR");
  error.code = code || "UNKNOWN_SYNC_ERROR";
  const payload = extra && extra.payload ? extra.payload : extra;
  if (payload && typeof payload === "object") {
    error.payload = payload;
    ["retryAfterSeconds", "dailyLimit", "dailyUsed", "dailyRemaining", "resetAt", "requestId"].forEach((key) => {
      if (payload[key] != null) error[key] = payload[key];
    });
  }
  return error;
}

function isClientDirectEnabled() {
  return personalSyncConfig.enableClientDirectSync !== false;
}

function isCampusAgentEnabled() {
  return personalSyncConfig.enableCampusAgentSync === true;
}

function getPreferredSource() {
  if (isCampusAgentEnabled()) return SOURCE.CAMPUS_AGENT;
  if (isClientDirectEnabled()) return SOURCE.CLIENT_DIRECT;
  return SOURCE.CAMPUS_AGENT;
}

function isSourceAvailable(source) {
  if (source === SOURCE.CLIENT_DIRECT) return isClientDirectEnabled();
  if (source === SOURCE.CAMPUS_AGENT) return isCampusAgentEnabled();
  return false;
}

async function preflightPersonalNetwork(options) {
  const client = options && options.client || createFosuDirectClient({ transport: options && options.transport });
  try {
    return await client.checkSchoolLink();
  } finally {
    client.clearSecrets();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function obtainFreshWxCode(options) {
  if (options && options.wxCode) return String(options.wxCode);
  const login = options && options.login;
  if (typeof login === "function") {
    const result = await login();
    return result && result.code ? String(result.code) : "";
  }
  const wxApi = typeof wx !== "undefined" ? wx : null;
  if (!wxApi || typeof wxApi.login !== "function") throw unsupported("WECHAT_PROOF_UNAVAILABLE");
  const result = await new Promise((resolve, reject) => {
    wxApi.login({
      success: (res) => resolve(res || {}),
      fail: () => reject(unsupported("WECHAT_PROOF_UNAVAILABLE")),
    });
  });
  if (!result.code) throw unsupported("WECHAT_PROOF_UNAVAILABLE");
  return String(result.code);
}

async function readViaCampusAgent(options) {
  const http = options && options.http;
  if (!http || typeof http.post !== "function" || typeof http.get !== "function") {
    throw unsupported("CAMPUS_AGENT_NOT_AVAILABLE");
  }
  const wxCode = await obtainFreshWxCode(options);
  const created = await http.post("/api/campus-sync/jobs", {
    studentId: options.studentId,
    password: options.password,
    semester: options.semester || "",
    wxCode,
  });
  const jobId = created && (created.jobId || created.data && created.data.jobId);
  if (!jobId) throw unsupported("CAMPUS_AGENT_NOT_AVAILABLE");
  const waitMs = Math.max(15000, Number(personalSyncConfig.campusSyncWaitMs || 90000));
  const started = Date.now();
  const retries = Number(options && options._campusRetries || 0);
  while (Date.now() - started < waitMs) {
    const job = await http.get(`/api/campus-sync/jobs/${jobId}`);
    const status = job && (job.status || job.data && job.data.status);
    const payload = job && job.preview ? job : (job && job.data) || job;
    if (status === "completed" && payload && payload.preview) {
      if (payload.preview && typeof payload.preview === "object") payload.preview.campusSyncJobId = jobId;
      return payload.preview;
    }
    if (status === "completed") return payload;
    if (status === "failed" || status === "expired" || status === "cancelled") {
      const code = (payload && (payload.errorCode || payload.code)) || "AGENT_OFFLINE";
      if (TERMINAL_SYNC_CODES.has(code) || retries >= 1) throw unsupported(code, payload);
      return readViaCampusAgent(Object.assign({}, options, { _campusRetries: retries + 1 }));
    }
    await sleep(1000);
  }
  if (http.post) {
    try { await http.post(`/api/campus-sync/jobs/${jobId}/cancel`, {}); } catch (error) {}
  }
  throw unsupported("TIMEOUT");
}

async function readPersonalTimetable(options) {
  const source = options && options.source || options && options.mode || getPreferredSource();
  if (source === SOURCE.CAMPUS_AGENT) {
    if (!isCampusAgentEnabled()) throw unsupported("CAMPUS_AGENT_NOT_AVAILABLE");
    return readViaCampusAgent(options);
  }
  if (source !== SOURCE.CLIENT_DIRECT) {
    throw unsupported("INVALID_IMPORT_MODE");
  }
  if (!isClientDirectEnabled()) {
    throw unsupported("FOSU_IMPORT_DISABLED");
  }
  const client = options.client || createFosuDirectClient({ transport: options.transport });
  try {
    return await client.readTimetable(options);
  } finally {
    client.clearSecrets();
  }
}

async function loadSchedulePreview(options) {
  return readPersonalTimetable(options || {});
}

module.exports = {
  SOURCE,
  getPreferredSource,
  isCampusAgentEnabled,
  isSourceAvailable,
  loadSchedulePreview,
  preflightPersonalNetwork,
  readPersonalTimetable,
};
