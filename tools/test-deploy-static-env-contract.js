const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-vps.yml"), "utf-8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf-8");

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
  "FOSU_RELEASE_PRECOMPRESS=gzip",
  "FOSU_RELEASE_BROTLI_ENABLED=false",
  "FOSU_RELEASE_COMPRESSION_CONCURRENCY=1",
  "FOSU_MAINTENANCE_ENABLED=true",
  "FOSU_RELEASE_RETENTION_COUNT=3",
  "FOSU_LOG_ROTATE_SIZE_MB=10",
  "FOSU_DISK_WARNING_PERCENT=80",
  "FOSU_DISK_CRITICAL_PERCENT=90",
  "FOSU_MIN_FREE_DISK_GB=5",
].forEach((line) => {
  assert(workflow.includes(line), `deploy workflow should include ${line}`);
  assert(envExample.includes(line), `.env.example should include ${line}`);
});

[
  "FOSU_SECURITY_MODE=observe",
  "FOSU_DYNAMIC_API_SESSION_REQUIRED=false",
  "FOSU_STATIC_ACCESS_MODE=public",
  "FOSU_OPENRESTY_STATIC_SECURITY_MODE=public",
  "FOSU_SESSION_TTL_SECONDS=7200",
  "FOSU_STATIC_TICKET_TTL_SECONDS=600",
  "FOSU_DEPLOY_COMMIT_SHA=",
  "FOSU_CLIENT_BUILD_ID=",
].forEach((line) => {
  assert(envExample.includes(line), `.env.example should include ${line}`);
  const key = line.split("=")[0];
  assert(workflow.includes(`${key}=`), `deploy workflow should include ${key}`);
});

[
  'tmp_env=".env.',
  "umask 077",
  'chmod 600 "$tmp_env"',
  'mv "$tmp_env" .env',
  "sudo docker compose config >/dev/null",
  "sudo docker compose up -d --build",
  "test -d /app/storage && test -w /app/storage",
  "test -d /openresty-static/releases && test -w /openresty-static/releases",
  "test -d /openresty-static/runtime && test -w /openresty-static/runtime",
  "node scripts/reconcile-static-release.js",
  "node scripts/security-postdeploy-check.js --base-url=http://127.0.0.1:3000",
  "actions/setup-node@v4",
  "node-version: 22",
  "cache-dependency-path:",
  "npm ci",
  "npm --prefix server ci",
  "Generate miniprogram build metadata",
  "npm run build:miniprogram-info",
  "steps.build_info.outputs.client_build_id",
  "npm run security:acceptance",
  "!server/storage/**",
  "Range: bytes=0-0",
  "Deployment summary",
].forEach((needle) => {
  assert(workflow.includes(needle), `deploy workflow should include ${needle}`);
});

assert(!workflow.includes("cat << 'EOF' > .env"), "workflow must not write .env directly before validation");
assert(!/set\s+-x/.test(workflow), "workflow must not enable shell xtrace");

[
  /ADMIN_PASSWORD=(?!\$\{\{ secrets\.ADMIN_PASSWORD \}\}|YOUR_|$).+/,
  /ADMIN_TOKEN=(?!\$\{\{ secrets\.ADMIN_TOKEN \}\}|YOUR_|$).+/,
  /ADMIN_API_TOKEN=(?!\$\{\{ secrets\.ADMIN_API_TOKEN \}\}|YOUR_|$).+/,
  /FOSU_PASSWORD=(?!YOUR_|$).+/,
].forEach((pattern) => {
  assert(!pattern.test(workflow), `workflow appears to contain a hard-coded secret: ${pattern}`);
});

console.log("test-deploy-static-env-contract passed");
