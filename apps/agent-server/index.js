const { createAgentPlatform } = require("./src/createAgentPlatform");
const { APP_SERVICE, createRunHandlers } = require("./src/createRunHandlers");

module.exports = Object.freeze({
  APP_SERVICE,
  createAgentPlatform,
  createRunHandlers,
});
