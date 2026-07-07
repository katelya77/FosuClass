const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const TESTS = [
  "tools/test-ai-action-contract.js",
  "tools/test-ai-personal-sync-import-routing.js",
  "tools/test-ai-clipboard-actions.js",
  "tools/test-ai-card-default-actions.js",
  "tools/test-fosu-rag-knowledge-base.js",
  "tools/test-ai-built-in-example-matrix.js",
  "tools/test-ai-task-panel-click-flow.js",
  "tools/test-xiaofu-float-behavior.js",
];

function run() {
  TESTS.forEach((file) => {
    execFileSync(process.execPath, [path.join(ROOT, file)], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
  });
  console.log("test-ai-action-import-clipboard-float-matrix passed");
}

run();
