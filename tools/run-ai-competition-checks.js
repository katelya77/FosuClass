const { spawnSync } = require("child_process");

const scripts = [
  "test:no-ai-secret-committed",
  "test:ai-agent-safety",
  "test:ai-agent-tool-routing",
  "test:ai-agent-mock-fallback",
  "test:ai-agent-card-schema",
  "test:ai-personal-context-gate",
  "test:ai-action-safety",
  "test:coze-provider-config",
  "test:ai-logo-entry",
  "test:ai-assistant-ui-layout",
  "test:ai-assistant-demo-data",
  "test:miniprogram-ai-page-entry",
  "test:miniprogram-build-entry",
  "test:wxss-selector-sanity",
];

function runScript(name) {
  console.log(`\n> npm run ${name}`);
  const result = spawnSync(`npm run ${name}`, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
    env: Object.assign({}, process.env, {
      AI_AGENT_ENABLED: process.env.AI_AGENT_ENABLED || "false",
    }),
  });
  if (result.status !== 0) {
    const error = new Error(`${name} failed`);
    error.code = "AI_COMPETITION_CHECK_FAILED";
    throw error;
  }
}

function run() {
  scripts.forEach(runScript);
  console.log("\nAI competition checks passed");
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
