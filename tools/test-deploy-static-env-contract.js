const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-vps.yml"), "utf8");
const deployScript = fs.readFileSync(path.join(root, "server", "scripts", "deploy-ghcr-digest.sh"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const compose = fs.readFileSync(path.join(root, "server", "docker-compose.yml"), "utf8");
const rollout = JSON.parse(fs.readFileSync(path.join(root, "config", "admin-rollout-manifest.json"), "utf8"));

[
  "OPENRESTY_HOST_RUNTIME_DIR=/opt/1panel/www/sites/class.katelya.eu.org/index/static/runtime",
  "STATIC_RELEASE_SYNC_ENABLED=true",
  "RELEASE_PACK_SRC=/app/storage/public/releases",
  "OPENRESTY_STATIC_RELEASE_DIR=/openresty-static/releases",
  "OPENRESTY_STATIC_RUNTIME_DIR=/openresty-static/runtime",
  "PUBLIC_BASE_URL=https://class.katelya.eu.org/static/releases",
  "STATIC_RELEASE_KEEP_LATEST=3",
  "STATIC_RELEASE_SYNC_VERIFY_HTTP=true",
  "FOSU_RELEASE_WORKER_ENABLED=true",
  "FOSU_RELEASE_WORKER_MAX_OLD_SPACE_MB=3072",
  "FOSU_RELEASE_PRECOMPRESS=gzip",
  "FOSU_RELEASE_BROTLI_ENABLED=false",
  "FOSU_RELEASE_COMPRESSION_CONCURRENCY=1",
  "FOSU_MAINTENANCE_ENABLED=true",
  "FOSU_RELEASE_RETENTION_COUNT=3",
  "FOSU_API_MEM_LIMIT=4096m",
  "FOSU_LOG_ROTATE_SIZE_MB=10",
  "FOSU_DISK_WARNING_PERCENT=80",
  "FOSU_DISK_CRITICAL_PERCENT=90",
  "FOSU_MIN_FREE_DISK_GB=5",
  "FOSU_AUTH_BASE=https://authserver.fosu.edu.cn",
  "FOSU_APAAS_BASE=https://apaas.fosu.edu.cn",
  "FOSU_IMPORT_TIMEOUT_MS=30000",
  "FOSU_IMPORT_PREVIEW_TTL_SECONDS=600",
  "FOSU_IMPORT_USE_PLAYWRIGHT_FALLBACK=false",
  "FOSU_IMPORT_RATE_LIMIT_ENABLED=true",
  "FOSU_IMPORT_IP_RATE_LIMIT_10M=12",
].forEach((line) => assert(envExample.includes(line), `.env.example should retain ${line}`));

assert.strictEqual(rollout.admin.primary, "legacy");
assert.strictEqual(rollout.admin.nextEnabled, true);
assert.match(compose, /image:\s*ghcr\.io\/katelya77\/fosuclass-api@\$\{FOSU_API_DIGEST:\?[^}]+\}/);
assert.ok(!/^\s+build:\s*$/m.test(compose));

[
  "npm run build:miniprogram-info",
  "npm run release:preflight",
  "npm run security:acceptance",
  "npm run test:runtime-data-recreate",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10",
  'archive_name="deploy-control-${GITHUB_SHA}.tar.gz"',
  "control-files.sha256",
  'export FOSU_DEPLOY_CONTROL_DIR="$control_dir/server"',
  "GHCR_READ_TOKEN: ${{ github.token }}",
].forEach((needle) => assert(workflow.includes(needle), `deploy workflow should include ${needle}`));

[
  'test -s "$ENV_FILE"',
  "FOSU_ADMIN_PRIMARY=legacy",
  "FOSU_ADMIN_NEXT_ENABLED=true",
  'FOSU_ADMIN_NEXT_WRITE_MODULES="$write_modules"',
  'FOSU_ROLLOUT_VERSION="$rollout_version"',
  "compose_with_image \"$FOSU_API_IMAGE\" pull fosu-api",
  "compose_with_image \"$FOSU_API_IMAGE\" up -d --no-build fosu-api",
  "migrate-runtime-data.js",
  "test -d /app/data && test -w /app/data",
  "node scripts/security-postdeploy-check.js --base-url=http://127.0.0.1:3000",
  "/api/admin/publisher/receipt",
  "admin-api-token-contract=ok",
].forEach((needle) => assert(deployScript.includes(needle), `digest deploy script should include ${needle}`));

assert.ok(!workflow.includes("source: \"server/**"), "application source must no longer be SCP-deployed");
assert.ok(!workflow.includes("secrets.ADMIN_API_TOKEN"), "application secrets stay in the existing protected VPS env file");
assert.ok(!workflow.includes("secrets.ADMIN_PASSWORD"), "application secrets stay in the existing protected VPS env file");
assert.ok(!deployScript.includes("compose up -d --build"), "production deployment must not build on the VPS");
assert.ok(!deployScript.includes("update_rollout_env"), "deployment must not rewrite the protected VPS env file");
assert.ok(!deployScript.includes("DEPLOY_ENV_FILE"), "deployment must not stage a replacement for the protected VPS env file");
assert.ok(!deployScript.includes("reconcile-static-release"), "image delivery must not switch the Active Pointer");
assert.ok(!/set\s+-x/.test(workflow + deployScript), "deployment must not enable shell xtrace");

console.log("test-deploy-static-env-contract passed");
