const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy-vps.yml"), "utf8");
const envContract = fs.readFileSync(path.join(ROOT, "docs", "github-actions-env-contract.md"), "utf8");

[
  "npm run test:server-ai-module-require",
  "npm run test:server-no-root-shared-require",
  "npm run test:server-docker-smoke",
  "# AI Provider",
  "append_ai_env",
  "read_existing_env_value",
  "read_runtime_env_value",
  "node -e 'const fs=require(\"fs\")",
  "storage/secure/ai-provider-config.json",
  "AI_AGENT_ENABLED",
  "AI_PROVIDER",
  "AI_PROVIDER_POLICY",
  "AI_RUNTIME_MODE",
  "AI_PROVIDER_ACTIVE_ENV",
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "CLOUDBASE_OPENAI_API_KEY",
  "CLOUDBASE_OPENAI_BASE_URL",
  "CLOUDBASE_OPENAI_TEXT_MODEL",
  "COZE_API_KEY",
  "COZE_BOT_ID",
  "DEEPSEEK_STRICT_JSON_MODE",
  "require('./src/services/ai/providerRuntimeConfigStore')",
  "require(\\\"./src/services/ai/agentService\\\")",
  "ai runtime ok",
  "node scripts/verify-ai-provider.js --mode=status",
  "actions/checkout@v6",
  "actions/setup-node@v6",
  "admin-api-token-contract=ok",
].forEach((needle) => {
  assert(workflow.includes(needle), `deploy workflow should include ${needle}`);
});

const runtimeReader = workflow.match(/read_runtime_env_value\(\)\s*\{[\s\S]*?\n            \}/);
assert(runtimeReader, "read_runtime_env_value function should exist");
assert(runtimeReader[0].includes("node -e"), "read_runtime_env_value should parse JSON with Node");
assert(!/grep\s+-E\s+"\\"/.test(runtimeReader[0]), "read_runtime_env_value must not grep JSON");

[
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "CLOUDBASE_OPENAI_API_KEY",
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

assert(!/echo\s+["']?\$\{\{\s*secrets\.(AI_API_KEY|DEEPSEEK_API_KEY|CLOUDBASE_OPENAI_API_KEY|COZE_API_KEY)\s*\}\}/.test(workflow),
  "workflow must not echo provider API keys");
assert(!/set\s+-x/.test(workflow), "workflow must not enable shell xtrace");
assert(!workflow.includes("FOSU_STATIC_TICKET_SECRET=${{ secrets.FOSU_STATIC_TICKET_SECRET }}"),
  "workflow must not write deprecated FOSU_STATIC_TICKET_SECRET");

[
  "必需 Secrets",
  "可选 Secrets",
  "Repository Variables",
  "Deprecated",
  "FOSU_STATIC_TICKET_SECRET_CURRENT",
  "AI_API_KEY",
  "COZE_BOT_ID",
].forEach((needle) => {
  assert(envContract.includes(needle), `env contract should document ${needle}`);
});

console.log("test-deploy-workflow-preserves-ai-env passed");
