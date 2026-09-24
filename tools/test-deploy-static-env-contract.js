const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-vps.yml"), "utf-8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf-8");
const dockerfile = fs.readFileSync(path.join(root, "server", "Dockerfile"), "utf-8");

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
  "FOSU_IMPORT_PREVIEW_TTL_SECONDS=600",
  "FOSU_IMPORT_RATE_LIMIT_ENABLED=true",
  "FOSU_IMPORT_IP_RATE_LIMIT_10M=12",
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
  "FOSU_IMPORT_ENABLE=true",
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
  "actions/setup-node@v6",
  "actions/checkout@v6",
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
  "ADMIN_API_TOKEN=${{ secrets.ADMIN_API_TOKEN }}",
  "admin-api-token-contract=ok",
  "/api/admin/publisher/receipt",
  "Deployment summary",
].forEach((needle) => {
  assert(workflow.includes(needle), `deploy workflow should include ${needle}`);
});

assert(workflow.includes('["ADMIN_API_TOKEN"]="${{ secrets.ADMIN_API_TOKEN }}"'), "ADMIN_API_TOKEN should be a required deploy secret");
assert(!workflow.includes("ADMIN_API_TOKEN is not configured. The server will derive one from ADMIN_PASSWORD."), "deploy must not allow derived production ADMIN_API_TOKEN");

assert(!workflow.includes("cat << 'EOF' > .env"), "workflow must not write .env directly before validation");
assert(!/set\s+-x/.test(workflow), "workflow must not enable shell xtrace");

const dockerfileLines = dockerfile.split(/\r?\n/);
assert(
  !dockerfileLines.some((line) => /\bapk add\b.*\bcurl\b/.test(line) || /^\s*curl(?:\s|\\|$)/.test(line)),
  "runtime image must not install curl for deployment smoke tests",
);

assert(
  !/^\s*sudo docker exec[^\r\n]*\bcurl\b/m.test(workflow),
  "container smoke tests must not depend on curl",
);
assert(
  /^\s*sudo docker exec "\$CONTAINER_NAME" node -e /m.test(workflow),
  "admin token smoke must use the container's Node runtime",
);

const tokenSmokeStart = workflow.indexOf("process.env.ADMIN_API_TOKEN");
const tokenSmokeEnd = workflow.indexOf('echo "admin-api-token-contract=ok"', tokenSmokeStart);
assert(tokenSmokeStart >= 0 && tokenSmokeEnd > tokenSmokeStart, "admin token Node smoke block must be present");
const tokenSmoke = workflow.slice(tokenSmokeStart, tokenSmokeEnd);
[
  'fetch("http://127.0.0.1:3000/api/admin/publisher/receipt"',
  '"X-Admin-Token":t',
  "r.status!==200",
  "b?.success!==true",
  'if(!t)fail("empty ADMIN_API_TOKEN")',
].forEach((needle) => {
  assert(tokenSmoke.includes(needle), `admin token Node smoke should include ${needle}`);
});
assert(!/console\.(?:log|error)\s*\(\s*token\s*\)/.test(tokenSmoke), "admin token smoke must not print the token");
assert(!workflow.includes("/tmp/fosu-admin-token-contract.json"), "admin token smoke must not leave a temporary response file");
assert(!/(?:release|terms?|active[-_ ]?pointer)/i.test(tokenSmoke), "admin token smoke must not touch Release, Term, or Active Pointer");

const remoteDeployScriptMatch = workflow.replace(/\r/g, "").match(/          script: \|\n([\s\S]*?)(?=\n      - name: Show Deployment Info)/);
assert(remoteDeployScriptMatch, "remote deploy script block must be present");
const remoteDeployScript = remoteDeployScriptMatch[1].replace(/^ {12}/gm, "");
assert(
  remoteDeployScript.length <= 20_750,
  `remote deploy script must stay below the GitHub Actions expression limit (got ${remoteDeployScript.length} characters)`,
);

// Deploy guard must be wired as an SCP-shipped script (keeps the inline script
// under the expression limit and the logic lintable). pre runs before the
// deploy mutates anything; post records version markers only after the health
// gates and summary.
assert(workflow.includes("scripts/deploy-guard.sh pre "), "deploy workflow must invoke the pre-deploy backup guard");
assert(workflow.includes("scripts/deploy-guard.sh post "), "deploy workflow must invoke the post-deploy version record");
assert(
  fs.existsSync(path.join(root, "server", "scripts", "deploy-guard.sh")),
  "deploy-guard.sh must exist in the repo (SCP uploads server/**)",
);
const deployGuard = fs.readFileSync(path.join(root, "server", "scripts", "deploy-guard.sh"), "utf8");
assert(
  deployGuard.includes('sudo docker pause "$CONTAINER_NAME"'),
  "pre-deploy storage backup must pause the live writer for a consistent archive",
);
assert(
  deployGuard.includes('sudo docker unpause "$CONTAINER_NAME"'),
  "pre-deploy storage backup must always resume the paused container",
);
assert(
  deployGuard.includes("trap resume_container EXIT INT TERM HUP"),
  "pre-deploy storage backup must resume the container after interruption or failure",
);
assert(
  remoteDeployScript.indexOf("deploy-guard.sh pre ") < remoteDeployScript.indexOf("docker compose up -d --build"),
  "pre-deploy backup must run before docker compose up",
);
assert(
  remoteDeployScript.indexOf("deploy-guard.sh post ") > remoteDeployScript.indexOf("Deployment summary"),
  "post-deploy version record must run only after the health gates and summary",
);

// server/Dockerfile builds with the monorepo root as build context
// (server/docker-compose.yml build.context: ..), so the SCP upload must place
// the workspace sources and root manifests next to server/ on the VPS.
[
  "packages/**",
  "plugins/**",
  "apps/**",
  "package.json",
  "package-lock.json",
].forEach((needle) => {
  const scpStep = workflow.slice(workflow.indexOf("Upload server/ directory via SCP"), workflow.indexOf("SSH Remote Deploy & Health Check"));
  assert(scpStep.includes(needle), `SCP upload must include ${needle} (root build context)`);
});

assert(!workflow.includes("admin-web/**"), "deploy must not SCP admin-web");
assert(!workflow.includes("FOSU_ADMIN_NEXT_ENABLED="), "deploy must not configure the retired Admin Next UI");
assert(!workflow.includes("FOSU_ADMIN_PRIMARY="), "deploy must not configure a retired primary UI switch");
[
  "/api/admin/ui-mode",
  "/admin-next/sync",
  "/admin-legacy/sync",
  "/app/public/admin-app",
].forEach((needle) => assert(remoteDeployScript.includes(needle), `legacy-only deploy smoke should include ${needle}`));
assert(
  workflow.includes("FOSU_ADMIN_NEXT_WRITE_MODULES=content,feedback,audit,backups"),
  "production writes must remain limited to the proven Phase B modules",
);
assert(
  !workflow.includes("FOSU_ADMIN_NEXT_WRITE_MODULES=content,feedback,audit,backups,catalog,quality,settings"),
  "Catalog, Quality, and Settings production writes must remain disabled",
);

[
  /^\s*ADMIN_PASSWORD=(?!\$\{\{ secrets\.ADMIN_PASSWORD \}\}|YOUR_|$).+/m,
  /^\s*ADMIN_TOKEN=(?!\$\{\{ secrets\.ADMIN_TOKEN \}\}|YOUR_|$).+/m,
  /^\s*ADMIN_API_TOKEN=(?!\$\{\{ secrets\.ADMIN_API_TOKEN \}\}|YOUR_|$).+/m,
  /^\s*FOSU_PASSWORD=(?!YOUR_|$).+/m,
].forEach((pattern) => {
  assert(!pattern.test(workflow), `workflow appears to contain a hard-coded secret: ${pattern}`);
});

console.log("test-deploy-static-env-contract passed");
