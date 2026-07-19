const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dockerfile = fs.readFileSync(path.join(root, "server", "Dockerfile"), "utf8");
const productionCompose = fs.readFileSync(path.join(root, "server", "docker-compose.yml"), "utf8");
const developmentComposePath = path.join(root, "server", "docker-compose.dev.yml");
const dockerignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");
const rollout = JSON.parse(fs.readFileSync(path.join(root, "server", "config", "admin-rollout-manifest.json"), "utf8"));

assert.match(productionCompose, /^\s+build:\s*$/m, "current SCP deployment must retain its VPS build fallback");
assert.match(productionCompose, /image:\s*\$\{FOSU_API_IMAGE:-fosuclass-api:local\}/, "current deployment must retain its compatible local image default");
assert.ok(!productionCompose.includes("FOSU_API_DIGEST"), "digest-only activation is deferred to the delivery PR");
assert.ok(!productionCompose.includes("FOSU_RUNTIME_DATA_HOST_DIR"), "first runtime-data bind activation is deferred");
assert.ok(!/^\s*-\s*\.\/data:\/app\/data\s*$/m.test(productionCompose), "production must not activate a new empty data bind");
assert.match(productionCompose, /\.\/storage:\/app\/storage/, "production must keep storage durable");
assert.ok(!productionCompose.includes("FOSU_RUNTIME_DATA_REQUIRE_MIGRATION"), "production must not require an unperformed first migration");
assert.ok(!productionCompose.includes("FOSU_ADMIN_PRIMARY"), "retired primary UI switch must stay removed");
assert.ok(!productionCompose.includes("FOSU_ADMIN_NEXT_ENABLED"), "retired Admin Next flag must stay removed");

assert.ok(fs.existsSync(developmentComposePath), "local builds must live in a separate development compose file");
const developmentCompose = fs.readFileSync(developmentComposePath, "utf8");
assert.match(developmentCompose, /^\s+build:\s*$/m, "development compose may retain the local build path");
assert.match(developmentCompose, /^\s+target:\s*browser\s*$/m, "development keeps the browser-safe image target");

assert.match(dockerfile, /FROM\s+runtime-common\s+AS\s+core/);
assert.match(dockerfile, /FROM\s+runtime-common\s+AS\s+browser/);
assert.match(dockerfile, /COPY\s+server\/data\s+\.\/data/, "compatible image must retain the current seed layout until migration activation");
assert.match(dockerfile, /FOSU_DATA_DIR=\/app\/data/);
assert.match(dockerfile, /CMD\s+\["node",\s*"src\/app\.js"\]/, "production must not require runtime bootstrap before the delivery PR");

assert.match(dockerignore, /^server\/data\/backups$/m, "committed seed data remains in the compatible build context while backup noise stays out");
assert.ok(!/^server\/data\/\*\*$/m.test(dockerignore), "compatible build must not exclude the current seed layout");
for (const relativePath of [
  "server/scripts/bootstrap-runtime-data.js",
  "server/scripts/migrate-runtime-data.js",
  "server/scripts/verify-runtime-persistence.js",
]) {
  assert.ok(fs.existsSync(path.join(root, relativePath)), `${relativePath} must remain prepared for the delivery PR`);
}
assert.strictEqual(rollout.imageTarget, "browser", "browser stays selected until APaaS import is proven Chromium-independent");
assert.deepStrictEqual(rollout.admin, { primary: "legacy", nextEnabled: false }, "rollout manifest must describe the Legacy-only admin");

console.log(JSON.stringify({
  ok: true,
  productionDeploymentMode: "scp-local-build",
  runtimeDataActivation: "deferred",
  imageTarget: rollout.imageTarget,
}, null, 2));
