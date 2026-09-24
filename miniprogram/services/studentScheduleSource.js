const { createFosuDirectClient } = require("./fosuDirectClient");
const personalSyncConfig = require("../config/personalSync");

const SOURCE = {
  CLIENT_DIRECT: "client-direct",
  CAMPUS_AGENT: "campus-agent",
};

function unsupported(code) {
  const error = new Error(code);
  error.code = code;
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

async function readViaCampusAgent(options) {
  const http = options && options.http;
  if (!http || typeof http.post !== "function" || typeof http.get !== "function") {
    throw unsupported("CAMPUS_AGENT_NOT_AVAILABLE");
  }
  const created = await http.post("/api/campus-sync/jobs", {
    studentId: options.studentId,
    password: options.password,
    semester: options.semester || "",
  });
  const jobId = created && (created.jobId || created.data && created.data.jobId);
  if (!jobId) throw unsupported("CAMPUS_AGENT_NOT_AVAILABLE");
  const started = Date.now();
  while (Date.now() - started < 60000) {
    const job = await http.get(`/api/campus-sync/jobs/${jobId}`);
    const status = job && (job.status || job.data && job.data.status);
    const payload = job && job.preview ? job : (job && job.data) || job;
    if (status === "completed" && payload && payload.preview) return payload.preview;
    if (status === "completed") return payload;
    if (status === "failed" || status === "expired") {
      throw unsupported((payload && payload.errorCode) || "AGENT_OFFLINE");
    }
    await sleep(1000);
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
