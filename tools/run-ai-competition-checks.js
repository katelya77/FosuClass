const { spawnSync } = require("child_process");

const scripts = [
  "test:no-ai-secret-committed",
  "test:server-ai-module-require",
  "test:server-no-root-shared-require",
  "test:deploy-workflow-preserves-ai-env",
  "test:cloudbase-ai-router",
  "test:ai-local-time-section",
  "test:ai-today-active-week",
  "test-ai-today-consistency-with-page",
  "test:ai-today-card-no-inactive-render",
  "test:ai-context-week-fields",
  "test:ai-clarify-missing-slot",
  "test:ai-tabbar-deeplink",
  "test:ai-tool-chain",
  "test:ai-provider-policy",
  "test:ai-generated-payload-contract",
  "test:ai-factual-card-authority",
  "test:ai-recommendation-future-slots",
  "test:ai-recommendation-week-aware",
  "test:ai-auto-policy-tool-local",
  "test:ai-clarification-followup",
  "test:ai-periodic-data-isolation",
  "test:miniprogram-duplicate-symbols",
  "test:miniprogram-compile-preflight",
  "test:runtime-pointer",
  "test:teaching-calendar",
  "test:semester-readiness-explain",
  "test:miniprogram-calendar-fallback",
  "test:ai-no-object-object-render",
  "test:ai-recommendation-copy",
  "test:ai-project-qa-provider",
  "test:ai-provider-status-explain",
  "test:ai-provider-runtime-config-store",
  "test:ai-provider-bad-request-diagnosis",
  "test:ai-empty-result-copywriting",
  "test:ai-more-tasks-panel",
  "test:ai-agent-metrics",
  "test:ai-agent-operations",
  "test:ai-agent-safety",
  "test:ai-agent-tool-routing",
  "test:ai-agent-mock-fallback",
  "test:ai-agent-card-schema",
  "test:ai-agent-protocol-v1",
  "test:ai-provider-chain-v1",
  "test:ai-weather-cache",
  "test:ai-user-preferences",
  "test:admin-theme-system",
  "test:ai-personal-context-gate",
  "test:personal-routes-xls-only-server",
  "test:term-config-runtime",
  "test:ai-term-config-context",
  "test:miniprogram-package-hygiene",
  "test:ai-action-safety",
  "test:coze-provider-config",
  "test:ai-logo-entry",
  "test:ai-assistant-ui-layout",
  "test:ai-assistant-minimal-ui",
  "test:ai-quick-actions-behavior",
  "test:ai-task-sheet-groups",
  "test:ai-card-polish-contract",
  "test:ai-assistant-unused-selector",
  "test:deepseek-provider-json-text-modes",
  "test:ai-message-retry-replace",
  "test:ai-assistant-demo-data",
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
