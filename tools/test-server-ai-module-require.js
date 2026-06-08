const assert = require("assert");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const modules = [
  "server/src/services/ai/toolRegistry.js",
  "server/src/services/ai/agentService.js",
  "server/src/services/ai/activeWeekService.js",
  "server/src/routes/ai.js",
  "server/src/routes/personal.js",
];

function run() {
  const failures = [];
  modules.forEach((relativePath) => {
    try {
      require(path.join(ROOT, relativePath));
    } catch (error) {
      failures.push(`${relativePath}: ${error && error.stack || error}`);
    }
  });
  assert.strictEqual(failures.length, 0, failures.join("\n\n"));
  console.log("test-server-ai-module-require passed");
}

run();
