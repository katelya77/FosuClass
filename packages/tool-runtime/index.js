const { createToolRuntime } = require("./src/toolRuntime");
const { validateAgainstSchema } = require("./src/schemaValidator");

module.exports = Object.freeze({
  createToolRuntime,
  validateAgainstSchema,
});
