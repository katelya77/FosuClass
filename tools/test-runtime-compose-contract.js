const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dockerfile = fs.readFileSync(path.join(root, "server", "Dockerfile"), "utf8");
const productionCompose = fs.readFileSync(path.join(root, "server", "docker-compose.yml"), "utf8");
const developmentComposePath = path.join(root, "server", "docker-compose.dev.yml");
const dockerignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");
const rollout = JSON.parse(fs.readFileSync(path.join(root, "config", "admin-rollout-manifest.json"), "utf8"));

assert.ok(!/^\s+build:\s*$/m.test(productionCompose), "production compose must never build on the VPS");
assert.match(productionCompose, /image:\s*ghcr\.io\/katelya77\/fosuclass-api@\$\{FOSU_API_DIGEST:\?[^}]+\}/, "production registry and digest separator must be fixed by Compose");
assert.ok(!productionCompose.includes("FOSU_API_IMAGE"), "production must not accept an arbitrary registry or mutable tag");
assert.match(productionCompose, /\$\{FOSU_RUNTIME_DATA_HOST_DIR:\?[^}]+\}:\/app\/data/, "production must bind-mount an explicit dedicated runtime data directory");
assert.ok(!/^\s*-\s*\.\/data:\/app\/data\s*$/m.test(productionCompose), "production must not reuse the SCP-populated server/data source directory");
assert.match(productionCompose, /\.\/storage:\/app\/storage/, "production must keep storage durable");
assert.match(productionCompose, /FOSU_DATA_DIR:\s*\/app\/data/);
assert.match(productionCompose, /FOSU_SEED_DATA_DIR:\s*\/app\/seed-data/);
assert.match(productionCompose, /FOSU_RUNTIME_DATA_REQUIRE_MIGRATION:\s*"true"/);
assert.match(productionCompose, /FOSU_ADMIN_PRIMARY:\s*\$\{FOSU_ADMIN_PRIMARY:-legacy\}/);
assert.match(productionCompose, /FOSU_ADMIN_NEXT_ENABLED:\s*\$\{FOSU_ADMIN_NEXT_ENABLED:-true\}/);

assert.ok(fs.existsSync(developmentComposePath), "local builds must live in a separate development compose file");
const developmentCompose = fs.readFileSync(developmentComposePath, "utf8");
assert.match(developmentCompose, /^\s+build:\s*$/m, "development compose may retain the local build path");

assert.match(dockerfile, /FROM\s+runtime-common\s+AS\s+core/);
assert.match(dockerfile, /FROM\s+runtime-common\s+AS\s+browser/);
assert.match(dockerfile, /COPY\s+server\/data\/ai\s+\.\/seed-data\/ai/);
assert.ok(!/COPY\s+server\/data\s+\.\/data/.test(dockerfile), "mutable runtime data must not be baked into the image");
assert.match(dockerfile, /FOSU_DATA_DIR=\/app\/data/);
assert.match(dockerfile, /FOSU_SEED_DATA_DIR=\/app\/seed-data/);
assert.match(dockerfile, /scripts\/start-runtime\.js/);

assert.match(dockerignore, /^server\/data\/\*\*$/m, "root build context must exclude runtime data by default");
assert.match(dockerignore, /^!server\/data\/ai\/\*\*$/m, "only curated AI seed data may re-enter the image context");
assert.strictEqual(rollout.imageTarget, "browser", "browser stays selected until APaaS import is proven Chromium-independent");

console.log(JSON.stringify({ ok: true, productionBuildDisabled: true, imageTarget: rollout.imageTarget }, null, 2));
