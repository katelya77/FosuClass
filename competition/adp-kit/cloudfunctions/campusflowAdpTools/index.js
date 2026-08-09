"use strict";

const path = require("path");

// CloudBase managed-runtime HTTP Functions must listen on port 9000.
process.env.PORT = "9000";
process.env.CAMPUS_DATA_PATH = path.join(__dirname, "mock-data", "competition-demo-v1.json");

// The managed competition endpoint must fail closed. The reusable MCP service
// may run without auth for local development, but this deployment wrapper may
// never become public merely because an environment variable was removed.
if (!process.env.CAMPUS_API_TOKEN) {
  throw new Error("CAMPUS_API_TOKEN is required for the competition HTTP Function");
}
process.env.CAMPUS_API_AUTH_MODE = "token";

const { loadDataset } = require("./src/data");
const { server } = require("./src/server");

// Fail closed during cold start if the bundled data is missing or not a
// competition-demo-* dataset. No production fallback exists.
const { dataVersion, dataHash } = loadDataset();

server.listen(9000, () => {
  console.log(JSON.stringify({
    event: "campusflow_http_function_started",
    port: 9000,
    dataVersion,
    dataHash,
  }));
});
