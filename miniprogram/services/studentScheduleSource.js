const { createFosuDirectClient } = require("./fosuDirectClient");

const SOURCE = {
  CLIENT_DIRECT: "client-direct",
  SERVER_RELAY: "server-relay",
  XLS: "xls",
  FUTURE_OUTBOUND_AGENT: "future-outbound-agent",
};

function unsupported(code) {
  const error = new Error(code);
  error.code = code;
  return error;
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
  const mode = options && options.mode || SOURCE.CLIENT_DIRECT;
  if (mode === SOURCE.FUTURE_OUTBOUND_AGENT) {
    throw unsupported("OUTBOUND_AGENT_NOT_IMPLEMENTED");
  }
  if (mode === SOURCE.SERVER_RELAY) {
    throw unsupported("SERVER_RELAY_NOT_DEFAULT");
  }
  if (mode !== SOURCE.CLIENT_DIRECT) {
    throw unsupported("INVALID_IMPORT_MODE");
  }
  const client = options.client || createFosuDirectClient({ transport: options.transport });
  try {
    return await client.readTimetable(options);
  } finally {
    client.clearSecrets();
  }
}

module.exports = {
  SOURCE,
  preflightPersonalNetwork,
  readPersonalTimetable,
};
