const { buildNotification, buildRequest, codedError, parseSseMessages, unwrapResponse } = require("./src/jsonRpc");
const { createMcpRuntime } = require("./src/mcpRuntime");
const { createMcpPublicationAdapter } = require("./src/mcpPublicationAdapter");
const transports = require("./src/transports");

module.exports = Object.freeze({
  buildNotification,
  buildRequest,
  codedError,
  createMcpPublicationAdapter,
  createMcpRuntime,
  parseSseMessages,
  postJsonRpc: transports.postJsonRpc,
  stdioJsonRpc: transports.stdioJsonRpc,
  unwrapResponse,
  validateServerUrl: transports.validateServerUrl,
});
