const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-vps.yml"), "utf8");
const deployScript = fs.readFileSync(path.join(root, "server", "scripts", "deploy-ghcr-digest.sh"), "utf8");
const envContract = fs.readFileSync(path.join(root, "docs", "github-actions-env-contract.md"), "utf8");

[
  "npm run test:server-ai-module-require",
  "npm run test:server-no-root-shared-require",
  "npm run test:server-docker-smoke",
  "npm run security:acceptance",
  "actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
].forEach((needle) => assert(workflow.includes(needle), `deploy workflow should include ${needle}`));

[
  'test -s "$ENV_FILE"',
  "compose_with_image()",
  "FOSU_ADMIN_PRIMARY=legacy",
  'FOSU_ADMIN_NEXT_WRITE_MODULES="$write_modules"',
  "node scripts/verify-ai-provider.js --mode=status",
  "sanitize()",
  "docker logs",
].forEach((needle) => assert(deployScript.includes(needle), `deploy script should include ${needle}`));

const rolloutInjection = deployScript.slice(
  deployScript.indexOf("compose_with_image()"),
  deployScript.indexOf("is_exact_image_ref()")
);
assert.ok(rolloutInjection.includes("FOSU_ADMIN_PRIMARY"));
assert.ok(rolloutInjection.includes("FOSU_ADMIN_NEXT_WRITE_MODULES"));
[
  "AI_API_KEY",
  "DEEPSEEK_API_KEY",
  "CLOUDBASE_OPENAI_API_KEY",
  "COZE_API_KEY",
  "FOSU_AI_CONFIG_ENCRYPTION_KEY",
  "ADMIN_API_TOKEN",
  "ADMIN_PASSWORD",
].forEach((name) => {
  assert.ok(!rolloutInjection.includes(name), `rollout injection must preserve, not rewrite, ${name}`);
  assert.ok(!workflow.includes(`secrets.${name}`), `workflow must not transmit persistent application secret ${name}`);
});

assert.ok(!deployScript.includes("cat > \"$ENV_FILE\""), "deployment must not replace the whole protected env file");
assert.ok(!deployScript.includes("update_rollout_env"), "deployment must leave the protected env file byte-for-byte unchanged");
assert.ok(!deployScript.includes("FOSU_STATIC_TICKET_SECRET=${"), "deprecated ticket secret must not be introduced");
assert.ok(!/set\s+-x/.test(workflow + deployScript), "workflow must not enable shell xtrace");

[
  "Repository Variables",
  "Deprecated",
  "FOSU_STATIC_TICKET_SECRET_CURRENT",
  "AI_API_KEY",
  "COZE_BOT_ID",
].forEach((needle) => assert(envContract.includes(needle), `env contract should document ${needle}`));

console.log("test-deploy-workflow-preserves-ai-env passed");
