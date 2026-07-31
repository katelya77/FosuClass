const { createPlatformAdminHandlers } = require("./src/createPlatformAdminHandlers");
const { createConfigPlaneHandlers } = require("./src/createConfigPlaneHandlers");

module.exports = Object.freeze({
  createPlatformAdminHandlers,
  createConfigPlaneHandlers,
});
