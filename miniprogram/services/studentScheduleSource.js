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
  if (isClientDirectEnabled()) return SOURCE.CLIENT_DIRECT;
  if (isCampusAgentEnabled()) return SOURCE.CAMPUS_AGENT;
  return SOURCE.CLIENT_DIRECT;
}

function isSourceAvailable(source) {
  if (source === SOURCE.CLIENT_DIRECT) return isClientDirectEnabled();
  if (source === SOURCE.CAMPUS_AGENT) return false;
  return false;
}

async function preflightPersonalNetwork(options) {
  const client = options && options.client || createFosuDirectClient({ transport: options && options.transport });
  try {
    return await client.preflight();
  } finally {
    client.clearSecrets();
  }
}

async function readPersonalTimetable(options) {
  const source = options && options.source || options && options.mode || getPreferredSource();
  if (source === SOURCE.CAMPUS_AGENT) {
    throw unsupported("CAMPUS_AGENT_NOT_AVAILABLE");
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
  const source = options && options.source || getPreferredSource();
  if (source === SOURCE.CAMPUS_AGENT || !isClientDirectEnabled()) {
    throw unsupported("CAMPUS_AGENT_NOT_AVAILABLE");
  }
  return readPersonalTimetable(Object.assign({}, options, { source: SOURCE.CLIENT_DIRECT }));
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
