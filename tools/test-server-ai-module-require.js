const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const modules = [
  "packages/agent-protocol/index.js",
  "packages/agent-runtime/index.js",
  "packages/skill-runtime/index.js",
  "packages/tool-runtime/index.js",
  "packages/ui-schema/index.js",
  "plugins/fosu-campus/index.js",
  "apps/agent-server/index.js",
  "apps/agent-admin/index.js",
  "server/src/services/ai/toolRegistry.js",
  "server/src/services/ai/agentService.js",
  "server/src/services/ai/platformComposition.js",
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
  const dockerfile = fs.readFileSync(path.join(ROOT, "server/Dockerfile"), "utf8");
  assert.match(dockerfile, /AS\s+workspace-deps/, "Docker image must install production workspace dependencies");
  assert.match(dockerfile, /COPY\s+packages\s+\.\/packages/, "Docker image must contain generic packages");
  assert.match(dockerfile, /COPY\s+plugins\s+\.\/plugins/, "Docker image must contain injected plugins");
  assert.match(dockerfile, /COPY\s+apps\s+\.\/apps/, "Docker image must contain executable Agent apps");
  assert.match(dockerfile, /WORKDIR\s+\/app\/server/, "integrated image must execute from /app/server");
  console.log("test-server-ai-module-require passed");
}

run();
