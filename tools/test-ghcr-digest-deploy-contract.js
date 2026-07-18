const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const workflowsDir = path.join(root, ".github", "workflows");
const workflowPath = path.join(workflowsDir, "deploy-vps.yml");
const legacyPublishPath = path.join(workflowsDir, "container-publish.yml");
const deployScriptPath = path.join(root, "server", "scripts", "deploy-ghcr-digest.sh");
const preflightScriptPath = path.join(root, "server", "scripts", "preflight-ghcr-digest-deploy.sh");
const serverAppPath = path.join(root, "server", "src", "app.js");
const composePath = path.join(root, "server", "docker-compose.yml");
const rolloutPath = path.join(root, "config", "admin-rollout-manifest.json");

assert.ok(fs.existsSync(workflowPath), "the production workflow must remain discoverable as deploy-vps.yml");
assert.ok(!fs.existsSync(legacyPublishPath), "the competing main-push container publisher must be removed");
assert.ok(fs.existsSync(deployScriptPath), "the reviewed remote digest deploy script must be versioned");
assert.ok(fs.existsSync(preflightScriptPath), "the read-only production preflight must be versioned");

const workflow = fs.readFileSync(workflowPath, "utf8");
const deployScript = fs.readFileSync(deployScriptPath, "utf8");
const preflightScript = fs.readFileSync(preflightScriptPath, "utf8");
const serverApp = fs.readFileSync(serverAppPath, "utf8");
const compose = fs.readFileSync(composePath, "utf8");
const rollout = JSON.parse(fs.readFileSync(rolloutPath, "utf8"));
const workflowFiles = fs.readdirSync(workflowsDir).filter((name) => /\.ya?ml$/i.test(name));
const mainPushPublishers = workflowFiles.filter((name) => {
  const source = fs.readFileSync(path.join(workflowsDir, name), "utf8");
  return /^\s*push:\s*$/m.test(source)
    && /^\s*branches:\s*(?:\[main\]|\n\s*-\s*main\s*$)/m.test(source)
    && /docker\/build-push-action|deploy-ghcr-digest\.sh/.test(source);
});

assert.deepStrictEqual(
  mainPushPublishers,
  ["deploy-vps.yml"],
  "exactly one main-push workflow may publish or deploy the API image"
);

assert.strictEqual(rollout.admin.primary, "legacy");
assert.strictEqual(rollout.admin.nextEnabled, true);
assert.strictEqual(rollout.imageTarget, "browser", "browser remains selected until APaaS is proven Chromium-free");

[
  "concurrency:",
  "cancel-in-progress: false",
  "pull_request:",
  "preflight_only:",
  "group: fosuclass-api-${{ github.event_name == 'pull_request'",
  "verify:",
  "runtime-data-recreate:",
  "build-arm64:",
  "if: github.event_name != 'pull_request'",
  "needs: [verify, runtime-data-recreate]",
  "deploy-production:",
  "github.ref == 'refs/heads/main'",
  "production-preflight:",
  "if: always() && github.event_name != 'pull_request' && needs.verify.result == 'success'",
  "needs: [verify, build-arm64, production-preflight]",
  "needs.production-preflight.result == 'success'",
  "server/scripts/preflight-ghcr-digest-deploy.sh",
  "appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2",
  "capture_stdout: true",
  "script_path: server/scripts/preflight-ghcr-digest-deploy.sh",
  "production-preflight-${{ github.sha }}",
  "deployment-evidence-${{ github.sha }}",
  "tools/resolve-deploy-rollout.js",
  "npm run test:startup-data-reconciliation-guard",
  "runs-on: ubuntu-24.04-arm",
  "platforms: linux/arm64",
  "target: core",
  "target: browser",
  "push: true",
  "steps.core.outputs.digest",
  "steps.browser.outputs.digest",
  "git show -s --format=%cI",
  "collect_registry_evidence",
  "core-registry-evidence.json",
  "browser-registry-evidence.json",
  "compressedLayerBytes",
  "packages: write",
  "packages: read",
  "GHCR_READ_TOKEN: ${{ github.token }}",
  "GHCR_READ_USERNAME: ${{ github.actor }}",
  "FOSU_API_IMAGE: ${{ needs.build-arm64.outputs.image_ref }}",
  "envs: GHCR_READ_USERNAME,GHCR_READ_TOKEN,FOSU_API_IMAGE",
  "server/scripts/deploy-ghcr-digest.sh",
  "server/scripts/verify-runtime-persistence.js",
].forEach((needle) => {
  assert.ok(workflow.includes(needle), `production workflow must include ${needle}`);
});

assert.match(workflow, /^permissions:\s*\n\s+contents:\s*read\s*$/m, "global token permissions must be read-only");
assert.ok(!/permissions:[\s\S]{0,120}actions:\s*write/.test(workflow));
assert.ok(!/tags:[\s\S]{0,180}(?:value=)?(?:main|latest)(?:\s|$)/.test(workflow), "deployable builds must not rely on mutable main/latest tags");
assert.ok(!workflow.includes("secrets.GHCR_READ_TOKEN"), "the short-lived job token should be used for private image reads");
assert.ok(!workflow.includes("FOSU_BOOTSTRAP_ROLLBACK_IMAGE"), "an unverified configured digest must never masquerade as a healthy rollback point");
assert.ok(!workflow.includes("also_amd64"), "production delivery is ARM64-only");
for (const match of workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
  assert.match(match[1], /@[0-9a-f]{40}$/, `workflow action must be pinned to a full commit: ${match[1]}`);
}
assert.match(workflow, /production-preflight:\s*[\s\S]{0,240}if: always\(\) && github\.event_name != 'pull_request'/,
  "pull-request-controlled scripts must never receive production SSH credentials");
assert.ok(!workflow.includes("github.event.repository.updated_at"), "image creation metadata must be stable for the same commit");
assert.ok(!workflow.includes("github.event.head_commit.timestamp"), "all events must derive image creation metadata from the checked-out commit");

const localEvidenceCall = deployScript.lastIndexOf('\ncollect_local_image_evidence "$FOSU_API_IMAGE"');
const rollbackGate = deployScript.lastIndexOf('\nif ! is_exact_image_ref "$PREVIOUS_IMAGE"');
const migrationCall = deployScript.lastIndexOf('\n  run_runtime_migration_gate pre-cutover');
const sourceFreeze = deployScript.lastIndexOf('\nfreeze_authoritative_source');
const quarantineCall = deployScript.lastIndexOf('\n  quarantine_unpromoted_runtime_data');
const shadowStart = deployScript.lastIndexOf('\nstart_shadow_candidate');
const shadowSmoke = deployScript.lastIndexOf('\nsmoke_shadow_candidate');
const persistenceCapture = deployScript.lastIndexOf('\ncapture_runtime_persistence');
const candidateUp = deployScript.lastIndexOf('compose_with_image "$FOSU_API_IMAGE" up -d --no-build fosu-api');
const persistenceVerify = deployScript.lastIndexOf('\nverify_runtime_persistence_after_recreate');
assert.ok(localEvidenceCall > 0 && localEvidenceCall < rollbackGate, "old/candidate size evidence must be captured before an UNKNOWN rollback gate blocks mutation");
assert.ok(rollbackGate > 0 && rollbackGate < migrationCall, "the verified rollback digest gate must run before data migration or container replacement");
assert.ok(sourceFreeze > rollbackGate && sourceFreeze < quarantineCall, "the authoritative source must be frozen before an unpromoted target is quarantined");
assert.ok(quarantineCall < migrationCall, "a legacy-source attempt must always export into a new data generation");
assert.ok(migrationCall < shadowStart && shadowStart < shadowSmoke && shadowSmoke < candidateUp,
  "the exact candidate must pass an isolated shadow smoke before it can replace the public service");
assert.ok(persistenceCapture > migrationCall && persistenceCapture < candidateUp, "current durable state must be captured after migration evidence and before recreate");
assert.ok(candidateUp < persistenceVerify, "recreated runtime state must be verified before deployment can be recorded healthy");
assert.ok(/run_runtime_migration_gate\(\)\s*\{[\s\S]*sudo node "\$MIGRATION_SCRIPT"/.test(deployScript)
    && deployScript.includes('MIGRATION_SCRIPT="$CONTROL_SERVER_DIR/scripts/migrate-runtime-data.js"'),
  "every migration verification must use the authoritative archive/receipt reconciliation gate");

[
  "set -Eeuo pipefail",
  "EXPECTED_IMAGE_PREFIX=ghcr.io/katelya77/fosuclass-api@sha256:",
  '[[ ! "$FOSU_ROLLOUT_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]',
  "mktemp -d",
  "cleanup_docker_config",
  "docker --config \"$DOCKER_CONFIG_DIR\" login ghcr.io",
  "--password-stdin",
  "docker_with_config pull \"$FOSU_API_IMAGE\"",
  "compose_with_image \"$FOSU_API_IMAGE\" pull fosu-api",
  "compose_with_image \"$FOSU_API_IMAGE\" up -d --no-build fosu-api",
  "LAST_HEALTHY_IMAGE_FILE",
  "verified last-healthy pointer does not match the current exact digest",
  'DEPLOY_STATE_DIR="$APP_SERVER_DIR/.deploy"',
  "IMAGE_EVIDENCE_DIR",
  "collect_local_image_evidence",
  "old_uncompressed_image_bytes=",
  "candidate_uncompressed_image_bytes=",
  "docker image inspect",
  "docker image history --no-trunc",
  "rollback_to_previous_digest",
  "recover_from_failure",
  "OLD_CONTAINER_ORIGINAL_STATE",
  "restore_old_container_state",
  "OLD_DATA_MOUNT_SOURCE_REALPATH",
  "OLD_STORAGE_MOUNT_SOURCE_REALPATH",
  "OLD_OPENRESTY_RELEASE_MOUNT_SOURCE_REALPATH",
  "OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE_REALPATH",
  "inspect_old_data_mount",
  "inspect_required_durable_bind_mount",
  "old_uses_bound_runtime_target",
  "refusing to quarantine an authoritative dedicated bind without a valid bound receipt",
  "audit_container_runtime_write_paths",
  "audit_deployment_runtime_write_paths",
  "FOSU_ASSISTANT_KB_PATH",
  "FOSU_AI_PROVIDER_CONFIG_PATH",
  "RELAY_DIR",
  "STAGING_DIR",
  "OPENRESTY_STATIC_RELEASE_DIR",
  "OPENRESTY_STATIC_RUNTIME_DIR",
  "STATIC_RELEASE_SYNC_LOCK",
  "STATIC_RELEASE_SYNC_STATUS_PATH",
  "runtime_path_env:",
  "assert_host_persistence_preflight",
  "runtime_disk_required_bytes=",
  "runtime_disk_available_bytes=",
  "assertNoSymlinkComponents",
  'assertMode("runtime", runtimeRoot, 0o700)',
  'assertMode("migration-backups", backupDir, 0o700)',
  'assertMode("quarantine", quarantineDir, 0o700)',
  ".fosu-runtime-bootstrap.json",
  "has_bound_runtime_receipt",
  'QUARANTINE_DIR="$RUNTIME_ROOT/quarantine"',
  "quarantine_unpromoted_runtime_data",
  "quarantined_unpromoted_data=",
  "freeze_authoritative_source",
  "SHADOW_CONTAINER_NAME=fosuclass-api-shadow",
  'SHADOW_HEALTH_URL=""',
  'SHADOW_COMPOSE_FILE="$SHADOW_ROOT/compose.shadow.json"',
  "compose_shadow_with_image",
  "start_shadow_candidate",
  "assert_shadow_is_loopback_only",
  "smoke_shadow_candidate",
  "stop_shadow_candidate",
  "-p '127.0.0.1::3000'",
  'FOSU_RELEASE_WORKER_ENABLED=false',
  'FOSU_MAINTENANCE_ENABLED=false',
  '{ type: "bind", source: process.env.SHADOW_STORAGE_DIR, target: "/app/storage", read_only: true }',
  '{ type: "bind", source: process.env.SHADOW_RELEASE_DIR, target: "/openresty-static/releases", read_only: true }',
  '{ type: "bind", source: process.env.SHADOW_RUNTIME_DIR, target: "/openresty-static/runtime", read_only: true }',
  "trap 'on_signal TERM' TERM",
  "trap 'on_signal INT' INT",
  "trap 'on_signal HUP' HUP",
  'compose_with_image "$FOSU_API_IMAGE" ps',
  "wait_for_health",
  "/api/health",
  "/api/admin/capabilities",
  "FOSU_ADMIN_PRIMARY=legacy",
  "FOSU_ADMIN_NEXT_ENABLED=true",
  "FOSU_RUNTIME_DATA_REQUIRE_MIGRATION",
  'image_digest="${image_ref##*@}"',
  'FOSU_API_DIGEST="$image_digest"',
  'RUNTIME_ROOT="$APP_ROOT/runtime"',
  'DATA_DIR="$RUNTIME_ROOT/data"',
  'FOSU_RUNTIME_DATA_HOST_DIR="$DATA_DIR"',
  "migrate-runtime-data.js",
  ".fosu-runtime-migration.json",
  "migration-backups",
  "run_runtime_migration_gate",
  "migration-gate-",
  "archiveVerified",
  "reconcileAuthority",
  "sourceDisposition",
  "PERSISTENCE_SNAPSHOT",
  "PERSISTENCE_RESULT",
  "PERSISTENCE_ROLLBACK_RESULT",
  "verify_runtime_persistence_after_rollback",
  "write_deploy_state",
  "fs.fsyncSync",
].forEach((needle) => {
  assert.ok(deployScript.includes(needle), `remote deploy script must include ${needle}`);
});

assert.ok(!deployScript.includes("compose up -d --build"), "the VPS must never build production images");
assert.ok(!deployScript.includes("update_rollout_env"), "digest delivery must not rewrite the protected production env file");
assert.match(deployScript, /rollback_to_previous_digest\(\)\s*\(\s*set -Eeuo pipefail/,
  "rollback must remain fail-fast even when recovery diagnostics disable outer errexit");
assert.ok(!/-v "\$STORAGE_DIR:\/app\/storage:ro"/.test(deployScript),
  "shadow read-only mounts must be replaced by target in a Compose override, not merged through compose run -v");
assert.ok(!deployScript.includes('DEPLOY_STATE_DIR="$STORAGE_DIR/'), "the running application must not be able to forge the trusted rollback pointer");
assert.ok(!deployScript.includes('DATA_DIR="$APP_SERVER_DIR/data"'), "tracked server/data must never be reused as the production runtime mount");
assert.ok(!deployScript.includes('if [ -f "$DATA_DIR/.fosu-runtime-migration.json" ]'),
  "a stale marker alone must never skip a fresh export from the authoritative legacy mount");
assert.ok(deployScript.includes("previous_digest=UNKNOWN"), "local-image transitions must report an unknown rollback digest and fail closed");
assert.ok(!/if is_exact_image_ref "\$OLD_CONFIGURED_IMAGE"; then PREVIOUS_IMAGE="\$OLD_CONFIGURED_IMAGE"/.test(deployScript),
  "an exact current ref without a verified host pointer is not yet a trusted rollback digest");
assert.ok(!/(?:GHCR_READ_TOKEN|GHCR_READ_USERNAME|DOCKER_AUTH_CONFIG).*>>?\s*["']?\$?(?:tmp_env|existing_env|ENV_FILE)/.test(deployScript),
  "GHCR credentials must never be written to the application env file");
assert.ok(!/docker\s+login\s+ghcr\.io(?![\s\S]{0,120}--config)/.test(deployScript), "GHCR login must be isolated in a temporary Docker config");
assert.ok(!/release-auto|release-cutover|sync-active-release|reconcile-static-release|terms\/.*activate/.test(deployScript),
  "production image deployment must not mutate Release, Active Pointer, or term state");
assert.ok(deployScript.includes("FOSU_STARTUP_DATA_RECONCILIATION_ENABLED=false"),
  "digest deployment must suppress startup term/lifecycle/Active Pointer mutations");
assert.ok(compose.includes("FOSU_STARTUP_DATA_RECONCILIATION_ENABLED"));
assert.ok(serverApp.includes("startup-data-reconciliation-disabled") && serverApp.includes("FOSU_STARTUP_DATA_RECONCILIATION_ENABLED"),
  "the server must honor the deploy-time startup mutation guard");
assert.ok(serverApp.includes('startupDataReconciliationEnabled && process.env.STATIC_RELEASE_SYNC_ENABLED === "true"'),
  "the startup mutation guard must also suppress automatic static reconciliation");

[
  "set -Eeuo pipefail",
  "uname -m",
  "requiredBytes",
  "tar -czf",
  "docker --config \"$DOCKER_CONFIG_DIR\" manifest inspect",
  "docker --config \"$DOCKER_CONFIG_DIR\" compose",
  "last-healthy-image.txt",
  "/app/data",
  "/app/storage",
  "/openresty-static/releases",
  "/openresty-static/runtime",
  "runtimePathStates",
  'PREFLIGHT_STATUS === "SUCCESS" ? "SUCCESS" : "UNKNOWN"',
].forEach((needle) => assert.ok(preflightScript.includes(needle), `read-only host preflight must include ${needle}`));

assert.ok(preflightScript.includes('CANDIDATE_DIGEST="$FOSU_PREFLIGHT_IMAGE"'), "production preflight must require the candidate digest");
assert.ok(!preflightScript.includes('FOSU_PREFLIGHT_IMAGE:-$ROLLBACK_DIGEST'), "a missing candidate must never silently validate the current image");
assert.ok(!/docker(?:\s+--config\s+"\$DOCKER_CONFIG_DIR")?\s+(?:pull|stop|pause|unpause|start|rm)\b/.test(preflightScript),
  "production preflight must not mutate container or image state");
assert.ok(!/compose[^\n]*(?:up|down|restart|create)\b/.test(preflightScript),
  "production preflight must not mutate the compose application");

console.log(JSON.stringify({
  ok: true,
  workflow: path.relative(root, workflowPath).replace(/\\/g, "/"),
  imageTarget: rollout.imageTarget,
  mainPushPublishers,
}, null, 2));
