const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy-vps.yml"), "utf8");

[
  "npm run test:server-ai-module-require",
  "npm run test:server-no-root-shared-require",
  "npm run test:server-docker-smoke",
  "# AI Provider",
  "append_ai_env",
  "read_existing_env_value",
  "read_runtime_env_value",
  "storage/secure/ai-provider-config.json",
  "AI_AGENT_ENABLED",
  "AI_PROVIDER",
  "AI_PROVIDER_POLICY",
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "COZE_API_KEY",
  "COZE_BOT_ID",
  "node scripts/verify-ai-provider.js --mode=status",
].forEach((needle) => {
  assert(workflow.includes(needle), `deploy workflow should include ${needle}`);
});

[
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "COZE_API_KEY",
  "Authorization: Bearer",
  "token|password|secret|key",
].forEach((needle) => {
  const sanitizeBlock = workflow.slice(workflow.indexOf("sanitize()"), workflow.indexOf("on_error()"));
  assert(sanitizeBlock.includes(needle), `sanitize should cover ${needle}`);
});

[
  "docker compose ps",
  "docker inspect",
  ".State.Health.Log",
  "docker logs",
  "docker compose logs",
  "ss -lntp",
].forEach((needle) => {
  assert(workflow.includes(needle), `on_error diagnostics should include ${needle}`);
});

assert(!/echo\s+["']?\$\{\{\s*secrets\.(AI_API_KEY|DEEPSEEK_API_KEY|COZE_API_KEY)\s*\}\}/.test(workflow),
  "workflow must not echo provider API keys");
assert(!/set\s+-x/.test(workflow), "workflow must not enable shell xtrace");

console.log("test-deploy-workflow-preserves-ai-env passed");
