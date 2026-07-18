#!/usr/bin/env bash

set -Eeuo pipefail

CONTAINER_NAME=fosuclass-api
IMAGE_PREFIX=ghcr.io/katelya77/fosuclass-api@sha256:
CURRENT_CHECK=initialization
RESULT_EMITTED=0
ARCHITECTURE=UNKNOWN
AVAILABLE_BYTES=0
REQUIRED_BYTES=0
CURRENT_IMAGE_STATE=UNKNOWN
ROLLBACK_DIGEST="UNKNOWN (bootstrap cutover)"
CANDIDATE_DIGEST=UNKNOWN
MANIFEST_VERIFIED=false
TAR_EXTRACT_VERIFIED=false
COMPOSE_CONFIG_VERIFIED=false

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    CURRENT_CHECK="missing-${name}"
    return 1
  fi
}

for required_name in VPS_APP_DIR GHCR_READ_USERNAME GHCR_READ_TOKEN FOSU_PREFLIGHT_IMAGE FOSU_ROLLOUT_VERSION FOSU_DEPLOY_COMMIT_SHA FOSU_PREFLIGHT_COMPOSE_FILE FOSU_PREFLIGHT_COMPOSE_SHA256; do
  require_env "$required_name"
done

if [[ ! "${FOSU_ADMIN_WRITE_MODULES:-}" =~ ^$|^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$ ]]; then
  CURRENT_CHECK=admin-write-module-format
  false
fi
if [[ ! "$FOSU_ROLLOUT_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  CURRENT_CHECK=rollout-version-format
  false
fi
if [[ ! "$FOSU_DEPLOY_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  CURRENT_CHECK=deploy-commit-format
  false
fi
if [[ ! "$FOSU_PREFLIGHT_COMPOSE_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  CURRENT_CHECK=candidate-compose-fingerprint-format
  false
fi

if [[ "$VPS_APP_DIR" != /* ]]; then
  CURRENT_CHECK=absolute-app-directory
  false
fi
APP_ROOT="$(realpath -e -- "$VPS_APP_DIR")"
APP_SERVER_DIR="$APP_ROOT/server"
ENV_FILE="$APP_SERVER_DIR/.env"
EXPECTED_PREFLIGHT_COMPOSE="$APP_ROOT/.deploy-preflight/$FOSU_DEPLOY_COMMIT_SHA/server/docker-compose.yml"
COMPOSE_FILE="$(realpath -e -- "$FOSU_PREFLIGHT_COMPOSE_FILE")"
if [ "$COMPOSE_FILE" != "$EXPECTED_PREFLIGHT_COMPOSE" ]; then
  CURRENT_CHECK=candidate-compose-path
  false
fi
if [ "$(sha256sum "$COMPOSE_FILE" | awk '{print $1}')" != "$FOSU_PREFLIGHT_COMPOSE_SHA256" ]; then
  CURRENT_CHECK=candidate-compose-fingerprint
  false
fi
DEPLOY_STATE_DIR="$APP_SERVER_DIR/.deploy"
LAST_HEALTHY_IMAGE_FILE="$DEPLOY_STATE_DIR/last-healthy-image.txt"

umask 077
PREFLIGHT_TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fosu-preflight.XXXXXXXX")"
DOCKER_CONFIG_DIR="$PREFLIGHT_TEMP_ROOT/docker-config"
MOUNT_SOURCES_FILE="$PREFLIGHT_TEMP_ROOT/mount-sources.json"
MOUNT_STATES_FILE="$PREFLIGHT_TEMP_ROOT/mount-states.json"
RUNTIME_PATH_STATES_FILE="$PREFLIGHT_TEMP_ROOT/runtime-path-states.json"
mkdir -p "$DOCKER_CONFIG_DIR"
chmod 700 "$PREFLIGHT_TEMP_ROOT" "$DOCKER_CONFIG_DIR"

cleanup() {
  if [ -n "${PREFLIGHT_TEMP_ROOT:-}" ] && [ -d "$PREFLIGHT_TEMP_ROOT" ]; then
    case "$PREFLIGHT_TEMP_ROOT" in
      "${TMPDIR:-/tmp}"/fosu-preflight.*) rm -rf -- "$PREFLIGHT_TEMP_ROOT" ;;
      *) echo "refusing to remove unexpected preflight temp path" >&2 ;;
    esac
  fi
}
trap cleanup EXIT

emit_evidence() {
  local status="$1"
  local reason="$2"
  if [ "$RESULT_EMITTED" = "1" ]; then return 0; fi
  RESULT_EMITTED=1
  PREFLIGHT_STATUS="$status" \
  PREFLIGHT_REASON="$reason" \
  PREFLIGHT_ARCHITECTURE="$ARCHITECTURE" \
  PREFLIGHT_AVAILABLE_BYTES="$AVAILABLE_BYTES" \
  PREFLIGHT_REQUIRED_BYTES="$REQUIRED_BYTES" \
  PREFLIGHT_CURRENT_IMAGE_STATE="$CURRENT_IMAGE_STATE" \
  PREFLIGHT_ROLLBACK_DIGEST="$ROLLBACK_DIGEST" \
  PREFLIGHT_CANDIDATE_DIGEST="$CANDIDATE_DIGEST" \
  PREFLIGHT_ROLLOUT_VERSION="$FOSU_ROLLOUT_VERSION" \
  PREFLIGHT_ADMIN_WRITE_MODULES="${FOSU_ADMIN_WRITE_MODULES:-}" \
  PREFLIGHT_MANIFEST_VERIFIED="$MANIFEST_VERIFIED" \
  PREFLIGHT_TAR_VERIFIED="$TAR_EXTRACT_VERIFIED" \
  PREFLIGHT_COMPOSE_VERIFIED="$COMPOSE_CONFIG_VERIFIED" \
  PREFLIGHT_MOUNT_STATES_FILE="$MOUNT_STATES_FILE" \
  PREFLIGHT_RUNTIME_PATH_STATES_FILE="$RUNTIME_PATH_STATES_FILE" \
  node <<'NODE'
const fs = require("fs");
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return fallback; }
};
const evidence = {
  schemaVersion: 1,
  status: process.env.PREFLIGHT_STATUS === "SUCCESS" ? "SUCCESS" : "UNKNOWN",
  reason: process.env.PREFLIGHT_REASON,
  checkedAt: new Date().toISOString(),
  readOnlyHostPreflight: true,
  architecture: process.env.PREFLIGHT_ARCHITECTURE,
  disk: {
    availableBytes: Number(process.env.PREFLIGHT_AVAILABLE_BYTES || 0),
    requiredBytes: Number(process.env.PREFLIGHT_REQUIRED_BYTES || 0),
  },
  currentImageState: process.env.PREFLIGHT_CURRENT_IMAGE_STATE,
  rollbackDigest: process.env.PREFLIGHT_ROLLBACK_DIGEST,
  rollbackProvenance: process.env.PREFLIGHT_ROLLBACK_DIGEST.startsWith("ghcr.io/")
    ? "previously-deployed-pointer"
    : "UNKNOWN-bootstrap-cutover",
  candidateDigest: process.env.PREFLIGHT_CANDIDATE_DIGEST,
  rolloutVersion: process.env.PREFLIGHT_ROLLOUT_VERSION,
  adminWriteModules: String(process.env.PREFLIGHT_ADMIN_WRITE_MODULES || "").split(",").filter(Boolean),
  ghcrManifestVerified: process.env.PREFLIGHT_MANIFEST_VERIFIED === "true",
  tarExtractVerified: process.env.PREFLIGHT_TAR_VERIFIED === "true",
  composeConfigVerified: process.env.PREFLIGHT_COMPOSE_VERIFIED === "true",
  durableMounts: readJson(process.env.PREFLIGHT_MOUNT_STATES_FILE, []),
  runtimePathStates: readJson(process.env.PREFLIGHT_RUNTIME_PATH_STATES_FILE, {}),
};
process.stdout.write(`${JSON.stringify(evidence)}\n`);
NODE
}

on_error() {
  local status=$?
  trap - ERR
  emit_evidence UNKNOWN "$CURRENT_CHECK"
  exit "$status"
}
trap on_error ERR

CURRENT_CHECK=required-host-tools
for command_name in node tar docker realpath df du sha256sum; do command -v "$command_name" >/dev/null; done
sudo docker compose version >/dev/null

CURRENT_CHECK=arm64-architecture
ARCHITECTURE="$(uname -m)"
case "$ARCHITECTURE" in aarch64|arm64) ;; *) false ;; esac

CURRENT_CHECK=deployment-control-files
test -f "$COMPOSE_FILE"
test -s "$ENV_FILE"
test "$(stat -c '%a' "$ENV_FILE")" = "600"

CURRENT_CHECK=current-container
sudo docker inspect "$CONTAINER_NAME" > "$PREFLIGHT_TEMP_ROOT/container-inspect.json"

CURRENT_CHECK=durable-bind-mounts
PREFLIGHT_CONTAINER_INSPECT="$PREFLIGHT_TEMP_ROOT/container-inspect.json" \
PREFLIGHT_MOUNT_SOURCES="$MOUNT_SOURCES_FILE" \
PREFLIGHT_MOUNT_STATES="$MOUNT_STATES_FILE" \
node <<'NODE'
const fs = require("fs");
const path = require("path");
const record = JSON.parse(fs.readFileSync(process.env.PREFLIGHT_CONTAINER_INSPECT, "utf8"))[0];
const targets = ["/app/data", "/app/storage", "/openresty-static/releases", "/openresty-static/runtime"];
const sources = {};
const states = [];
function assertNoSymlinkComponents(candidate) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("durable bind source contains a symlink");
  }
  return fs.realpathSync(absolute);
}
for (const target of targets) {
  const matches = (record.Mounts || []).filter((entry) => entry.Destination === target);
  if (matches.length !== 1 || matches[0].Type !== "bind" || matches[0].RW !== true) throw new Error(`unsafe durable mount: ${target}`);
  const source = assertNoSymlinkComponents(matches[0].Source);
  const stat = fs.lstatSync(source);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`unsafe durable mount source: ${target}`);
  sources[target] = source;
  states.push({ target, type: "bind", access: "rw", hostPathVerified: true });
}
fs.writeFileSync(process.env.PREFLIGHT_MOUNT_SOURCES, `${JSON.stringify(sources)}\n`, { mode: 0o600 });
fs.writeFileSync(process.env.PREFLIGHT_MOUNT_STATES, `${JSON.stringify(states)}\n`, { mode: 0o600 });
NODE

DATA_SOURCE="$(node -p 'require(process.argv[1])["/app/data"]' "$MOUNT_SOURCES_FILE")"
STORAGE_SOURCE="$(node -p 'require(process.argv[1])["/app/storage"]' "$MOUNT_SOURCES_FILE")"
RELEASE_SOURCE="$(node -p 'require(process.argv[1])["/openresty-static/releases"]' "$MOUNT_SOURCES_FILE")"
STATIC_RUNTIME_SOURCE="$(node -p 'require(process.argv[1])["/openresty-static/runtime"]' "$MOUNT_SOURCES_FILE")"

CURRENT_CHECK=runtime-disk-capacity
SOURCE_BYTES="$(sudo du -sb -- "$DATA_SOURCE" | awk '{print $1}')"
AVAILABLE_BYTES="$(df -B1 --output=avail "$APP_ROOT" | tail -n 1 | tr -d '[:space:]')"
[[ "$SOURCE_BYTES" =~ ^[0-9]+$ ]]
[[ "$AVAILABLE_BYTES" =~ ^[0-9]+$ ]]
REQUIRED_BYTES=$((SOURCE_BYTES * 4 + 1073741824))
test "$AVAILABLE_BYTES" -ge "$REQUIRED_BYTES"

CURRENT_CHECK=tar-create-extract
mkdir -p "$PREFLIGHT_TEMP_ROOT/tar-source" "$PREFLIGHT_TEMP_ROOT/tar-target"
printf 'fosu-preflight\n' > "$PREFLIGHT_TEMP_ROOT/tar-source/probe.txt"
tar -czf "$PREFLIGHT_TEMP_ROOT/probe.tar.gz" -C "$PREFLIGHT_TEMP_ROOT/tar-source" .
tar -xzf "$PREFLIGHT_TEMP_ROOT/probe.tar.gz" -C "$PREFLIGHT_TEMP_ROOT/tar-target"
cmp "$PREFLIGHT_TEMP_ROOT/tar-source/probe.txt" "$PREFLIGHT_TEMP_ROOT/tar-target/probe.txt"
TAR_EXTRACT_VERIFIED=true

CURRENT_CHECK=verified-rollback-digest
CURRENT_CONFIGURED_IMAGE="$(sudo docker inspect -f '{{.Config.Image}}' "$CONTAINER_NAME")"
if [[ "$CURRENT_CONFIGURED_IMAGE" =~ ^ghcr\.io/katelya77/fosuclass-api@sha256:[0-9a-f]{64}$ ]]; then
  CURRENT_IMAGE_STATE=exact-digest
else
  CURRENT_IMAGE_STATE=local-or-mutable
fi
test -s "$LAST_HEALTHY_IMAGE_FILE"
test -f "$LAST_HEALTHY_IMAGE_FILE"
test ! -L "$LAST_HEALTHY_IMAGE_FILE"
test "$(stat -c '%a' "$LAST_HEALTHY_IMAGE_FILE")" = "600"
ROLLBACK_DIGEST="$(tr -d '\r\n' < "$LAST_HEALTHY_IMAGE_FILE")"
[[ "$ROLLBACK_DIGEST" =~ ^ghcr\.io/katelya77/fosuclass-api@sha256:[0-9a-f]{64}$ ]]
test "$CURRENT_CONFIGURED_IMAGE" = "$ROLLBACK_DIGEST"

CURRENT_CHECK=candidate-digest
CANDIDATE_DIGEST="$FOSU_PREFLIGHT_IMAGE"
[[ "$CANDIDATE_DIGEST" =~ ^ghcr\.io/katelya77/fosuclass-api@sha256:[0-9a-f]{64}$ ]]

CURRENT_CHECK=runtime-path-overrides
PREFLIGHT_CONTAINER_INSPECT="$PREFLIGHT_TEMP_ROOT/container-inspect.json" \
PREFLIGHT_PATH_STATES="$RUNTIME_PATH_STATES_FILE" \
node <<'NODE'
const fs = require("fs");
const path = require("path");
const record = JSON.parse(fs.readFileSync(process.env.PREFLIGHT_CONTAINER_INSPECT, "utf8"))[0];
const values = Object.fromEntries((record.Config.Env || []).map((entry) => {
  const index = entry.indexOf("=");
  return index < 0 ? [entry, ""] : [entry.slice(0, index), entry.slice(index + 1)];
}));
const names = [
  "FOSU_DATA_DIR", "FOSU_STORAGE_DIR", "FOSU_ASSISTANT_KB_PATH", "FOSU_AI_PROVIDER_CONFIG_PATH",
  "RELAY_DIR", "STAGING_DIR", "OPENRESTY_STATIC_RELEASE_DIR", "OPENRESTY_STATIC_RUNTIME_DIR",
  "STATIC_RELEASE_SYNC_LOCK", "STATIC_RELEASE_SYNC_STATUS_PATH",
];
const roots = ["/app/data", "/app/storage", "/openresty-static/releases", "/openresty-static/runtime"];
const states = {};
for (const name of names) {
  const raw = String(values[name] == null ? "" : values[name]).trim();
  const resolved = raw ? path.posix.resolve("/", raw) : "";
  const state = !raw ? "empty" : roots.some((root) => resolved === root || resolved.startsWith(`${root}/`)) ? "inside" : "outside";
  states[name] = state;
  if (state === "outside") throw new Error(`runtime path override escaped durable mounts: ${name}`);
}
fs.writeFileSync(process.env.PREFLIGHT_PATH_STATES, `${JSON.stringify({ currentContainer: states })}\n`, { mode: 0o600 });
NODE

CURRENT_CHECK=temporary-ghcr-auth
printf '%s' "$GHCR_READ_TOKEN" | sudo docker --config "$DOCKER_CONFIG_DIR" login ghcr.io -u "$GHCR_READ_USERNAME" --password-stdin >/dev/null
unset GHCR_READ_TOKEN

CURRENT_CHECK=ghcr-manifest
sudo docker --config "$DOCKER_CONFIG_DIR" manifest inspect "$CANDIDATE_DIGEST" > "$PREFLIGHT_TEMP_ROOT/candidate-manifest.json"
node -e '
  const value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const isArm64 = value.architecture === "arm64"
    || Array.isArray(value.manifests) && value.manifests.some((entry) => entry.platform && entry.platform.os === "linux" && entry.platform.architecture === "arm64");
  if (!isArm64) process.exit(2);
' "$PREFLIGHT_TEMP_ROOT/candidate-manifest.json"
MANIFEST_VERIFIED=true

CURRENT_CHECK=compose-config
sudo env \
  FOSU_API_DIGEST="${CANDIDATE_DIGEST##*@}" \
  FOSU_RUNTIME_DATA_HOST_DIR="$DATA_SOURCE" \
  FOSU_ADMIN_PRIMARY=legacy \
  FOSU_ADMIN_NEXT_ENABLED=true \
  FOSU_ADMIN_NEXT_WRITE_MODULES="${FOSU_ADMIN_WRITE_MODULES:-}" \
  FOSU_ROLLOUT_VERSION="$FOSU_ROLLOUT_VERSION" \
  FOSU_STARTUP_DATA_RECONCILIATION_ENABLED=false \
  docker --config "$DOCKER_CONFIG_DIR" compose --project-directory "$APP_SERVER_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --format json > "$PREFLIGHT_TEMP_ROOT/compose-config.json"
PREFLIGHT_COMPOSE_CONFIG="$PREFLIGHT_TEMP_ROOT/compose-config.json" \
PREFLIGHT_PATH_STATES="$RUNTIME_PATH_STATES_FILE" \
EXPECTED_DATA_SOURCE="$DATA_SOURCE" \
EXPECTED_STORAGE_SOURCE="$STORAGE_SOURCE" \
EXPECTED_RELEASE_SOURCE="$RELEASE_SOURCE" \
EXPECTED_RUNTIME_SOURCE="$STATIC_RUNTIME_SOURCE" \
EXPECTED_WRITE_MODULES="${FOSU_ADMIN_WRITE_MODULES:-}" \
EXPECTED_ROLLOUT_VERSION="$FOSU_ROLLOUT_VERSION" \
node <<'NODE'
const fs = require("fs");
const path = require("path");
const config = JSON.parse(fs.readFileSync(process.env.PREFLIGHT_COMPOSE_CONFIG, "utf8"));
const service = config.services && config.services["fosu-api"];
if (!service) throw new Error("compose service is missing");
const expected = new Map([
  ["/app/data", process.env.EXPECTED_DATA_SOURCE],
  ["/app/storage", process.env.EXPECTED_STORAGE_SOURCE],
  ["/openresty-static/releases", process.env.EXPECTED_RELEASE_SOURCE],
  ["/openresty-static/runtime", process.env.EXPECTED_RUNTIME_SOURCE],
]);
for (const [target, source] of expected) {
  const matches = (service.volumes || []).filter((entry) => entry && entry.target === target);
  if (matches.length !== 1 || matches[0].type !== "bind" || matches[0].read_only === true) throw new Error(`compose durable mount is unsafe: ${target}`);
  const absolute = path.resolve(matches[0].source);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`compose durable mount contains a symlink: ${target}`);
  }
  if (fs.realpathSync(matches[0].source) !== source) throw new Error(`compose durable mount changed host source: ${target}`);
}
const values = service.environment || {};
const expectedWriteModules = String(process.env.EXPECTED_WRITE_MODULES || "").split(",").filter(Boolean).sort();
const actualWriteModules = String(values.FOSU_ADMIN_NEXT_WRITE_MODULES || "").split(",").filter(Boolean).sort();
if (String(values.FOSU_ADMIN_PRIMARY) !== "legacy" || String(values.FOSU_ADMIN_NEXT_ENABLED) !== "true") {
  throw new Error("candidate compose changed the admin primary/next invariant");
}
if (JSON.stringify(actualWriteModules) !== JSON.stringify(expectedWriteModules)) throw new Error("candidate compose write modules differ from rollout manifest");
if (String(values.FOSU_ROLLOUT_VERSION) !== process.env.EXPECTED_ROLLOUT_VERSION) throw new Error("candidate compose rollout version differs from manifest");
if (String(values.FOSU_STARTUP_DATA_RECONCILIATION_ENABLED) !== "false") throw new Error("candidate configuration could mutate term, lifecycle, or Active Pointer during initialization");
const names = [
  "FOSU_DATA_DIR", "FOSU_STORAGE_DIR", "FOSU_ASSISTANT_KB_PATH", "FOSU_AI_PROVIDER_CONFIG_PATH",
  "RELAY_DIR", "STAGING_DIR", "OPENRESTY_STATIC_RELEASE_DIR", "OPENRESTY_STATIC_RUNTIME_DIR",
  "STATIC_RELEASE_SYNC_LOCK", "STATIC_RELEASE_SYNC_STATUS_PATH",
];
const roots = ["/app/data", "/app/storage", "/openresty-static/releases", "/openresty-static/runtime"];
const states = {};
for (const name of names) {
  const raw = String(values[name] == null ? "" : values[name]).trim();
  const resolved = raw ? path.posix.resolve("/", raw) : "";
  const state = !raw ? "empty" : roots.some((root) => resolved === root || resolved.startsWith(`${root}/`)) ? "inside" : "outside";
  states[name] = state;
  if (state === "outside") throw new Error(`compose runtime path override escaped durable mounts: ${name}`);
}
const existing = JSON.parse(fs.readFileSync(process.env.PREFLIGHT_PATH_STATES, "utf8"));
fs.writeFileSync(process.env.PREFLIGHT_PATH_STATES, `${JSON.stringify({ ...existing, candidateCompose: states })}\n`, { mode: 0o600 });
NODE
COMPOSE_CONFIG_VERIFIED=true

CURRENT_CHECK=complete
trap - ERR
emit_evidence SUCCESS complete
