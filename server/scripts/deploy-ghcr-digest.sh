#!/usr/bin/env bash

set -Eeuo pipefail

EXPECTED_IMAGE_PREFIX=ghcr.io/katelya77/fosuclass-api@sha256:
CONTAINER_NAME=fosuclass-api
HEALTH_URL=http://127.0.0.1:18318/api/health
CAPABILITIES_URL=http://127.0.0.1:18318/api/admin/capabilities
SHADOW_CONTAINER_NAME=fosuclass-api-shadow
SHADOW_HOST_PORT=""
SHADOW_HEALTH_URL=""

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "missing required deploy value: ${name}" >&2
    exit 1
  fi
}

for required_name in VPS_APP_DIR GHCR_READ_USERNAME GHCR_READ_TOKEN FOSU_API_IMAGE FOSU_IMAGE_TARGET FOSU_ROLLOUT_VERSION FOSU_DEPLOY_COMMIT_SHA; do
  require_env "$required_name"
done

if [[ ! "$FOSU_API_IMAGE" =~ ^ghcr\.io/katelya77/fosuclass-api@sha256:[0-9a-f]{64}$ ]]; then
  echo "candidate image is not an exact FosuClass GHCR digest" >&2
  exit 1
fi
if [ "$FOSU_IMAGE_TARGET" != "core" ] && [ "$FOSU_IMAGE_TARGET" != "browser" ]; then
  echo "rollout image target must be core or browser" >&2
  exit 1
fi
if [[ ! "$FOSU_ROLLOUT_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "rollout version format is invalid" >&2
  exit 1
fi
if [[ ! "${FOSU_ADMIN_WRITE_MODULES:-}" =~ ^$|^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$ ]]; then
  echo "admin write module list format is invalid" >&2
  exit 1
fi
if [[ ! "$FOSU_DEPLOY_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "deploy commit must be a full Git SHA" >&2
  exit 1
fi

if [[ "$VPS_APP_DIR" != /* ]]; then
  echo "VPS_APP_DIR must be an absolute path" >&2
  exit 1
fi
APP_ROOT="$(realpath -e -- "$VPS_APP_DIR")"
if [ ! -d "$APP_ROOT" ]; then
  echo "resolved VPS_APP_DIR is not a directory" >&2
  exit 1
fi
APP_SERVER_DIR="$APP_ROOT/server"
ENV_FILE="$APP_SERVER_DIR/.env"
if [ -n "${FOSU_DEPLOY_CONTROL_DIR:-}" ]; then
  if [[ "$FOSU_DEPLOY_CONTROL_DIR" != /* ]]; then
    echo "FOSU_DEPLOY_CONTROL_DIR must be absolute" >&2
    exit 1
  fi
  CONTROL_SERVER_DIR="$(realpath -e -- "$FOSU_DEPLOY_CONTROL_DIR")"
  if [ "$CONTROL_SERVER_DIR" != "$APP_ROOT/.deploy-control/$FOSU_DEPLOY_COMMIT_SHA/server" ]; then
    echo "deploy control directory is outside the commit-bound immutable control root" >&2
    exit 1
  fi
else
  CONTROL_SERVER_DIR="$APP_SERVER_DIR"
fi
COMPOSE_FILE="$CONTROL_SERVER_DIR/docker-compose.yml"
MIGRATION_SCRIPT="$CONTROL_SERVER_DIR/scripts/migrate-runtime-data.js"
PERSISTENCE_SCRIPT="$CONTROL_SERVER_DIR/scripts/verify-runtime-persistence.js"
RUNTIME_ROOT="$APP_ROOT/runtime"
DATA_DIR="$RUNTIME_ROOT/data"
STORAGE_DIR="$APP_SERVER_DIR/storage"
MIGRATION_BACKUP_DIR="$RUNTIME_ROOT/migration-backups"
QUARANTINE_DIR="$RUNTIME_ROOT/quarantine"
# Host-only control-plane state: /app/storage is writable by the application,
# so it cannot be trusted as the provenance source for a rollback digest.
DEPLOY_STATE_DIR="$APP_SERVER_DIR/.deploy"
LAST_HEALTHY_IMAGE_FILE="$DEPLOY_STATE_DIR/last-healthy-image.txt"
IMAGE_EVIDENCE_DIR="$DEPLOY_STATE_DIR/evidence"
DEPLOY_ATTEMPT_ID="${FOSU_DEPLOY_COMMIT_SHA}-$(date -u +%Y%m%dT%H%M%SZ)"
SHADOW_ROOT="$RUNTIME_ROOT/shadow/$DEPLOY_ATTEMPT_ID"
SHADOW_DATA_DIR="$SHADOW_ROOT/data"
SHADOW_COMPOSE_FILE="$SHADOW_ROOT/compose.shadow.json"
PERSISTENCE_SNAPSHOT="$IMAGE_EVIDENCE_DIR/${DEPLOY_ATTEMPT_ID}-persistence-before.json"
PERSISTENCE_RESULT="$IMAGE_EVIDENCE_DIR/${DEPLOY_ATTEMPT_ID}-persistence-after.json"
PERSISTENCE_ROLLBACK_RESULT="$IMAGE_EVIDENCE_DIR/${DEPLOY_ATTEMPT_ID}-persistence-rollback.json"
DEPLOYMENT_STARTED=0
OLD_CONTAINER_STOPPED=0
PREVIOUS_IMAGE=""
OLD_CONFIGURED_IMAGE=""
OLD_IMAGE_ID=""
OLD_ADMIN_WRITE_MODULES=""
OLD_ROLLOUT_VERSION=""
OLD_CONTAINER_ORIGINAL_STATE="absent"
OLD_DATA_MOUNT_TYPE=""
OLD_DATA_MOUNT_SOURCE=""
OLD_DATA_MOUNT_SOURCE_REALPATH=""
OLD_STORAGE_MOUNT_SOURCE=""
OLD_STORAGE_MOUNT_SOURCE_REALPATH=""
OLD_OPENRESTY_RELEASE_MOUNT_SOURCE=""
OLD_OPENRESTY_RELEASE_MOUNT_SOURCE_REALPATH=""
OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE=""
OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE_REALPATH=""
OLD_USES_BOUND_RUNTIME_TARGET=0

cd "$APP_SERVER_DIR"
test -f "$COMPOSE_FILE"
test -s "$ENV_FILE"
test -f "$MIGRATION_SCRIPT"
test -f "$PERSISTENCE_SCRIPT"
command -v node >/dev/null
command -v tar >/dev/null

umask 077
DOCKER_CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fosu-ghcr.XXXXXXXX")"
chmod 700 "$DOCKER_CONFIG_DIR"

cleanup_docker_config() {
  if [ -n "${DOCKER_CONFIG_DIR:-}" ] && [ -d "$DOCKER_CONFIG_DIR" ]; then
    case "$DOCKER_CONFIG_DIR" in
      "${TMPDIR:-/tmp}"/fosu-ghcr.*) rm -rf -- "$DOCKER_CONFIG_DIR" ;;
      *) echo "refusing to remove unexpected Docker config path" >&2 ;;
    esac
  fi
}

cleanup_shadow_candidate() {
  if ! sudo docker inspect "$SHADOW_CONTAINER_NAME" >/dev/null 2>&1; then
    return 0
  fi
  local role
  role="$(sudo docker inspect -f '{{index .Config.Labels "com.fosuclass.deploy.role"}}' "$SHADOW_CONTAINER_NAME" 2>/dev/null || true)"
  if [ "$role" != "shadow" ]; then
    echo "refusing to remove an untrusted container named ${SHADOW_CONTAINER_NAME}" >&2
    return 1
  fi
  sudo docker rm -f "$SHADOW_CONTAINER_NAME" >/dev/null
}

cleanup_shadow_data() {
  if [ ! -e "$SHADOW_ROOT" ]; then
    return 0
  fi
  case "$SHADOW_ROOT" in
    "$RUNTIME_ROOT"/shadow/*) sudo rm -rf -- "$SHADOW_ROOT" ;;
    *) echo "refusing to remove unexpected shadow data path" >&2; return 1 ;;
  esac
}

cleanup_deploy_temporary_state() {
  cleanup_shadow_candidate || true
  cleanup_shadow_data || true
  cleanup_docker_config
}
trap cleanup_deploy_temporary_state EXIT

sanitize() {
  sed -E \
    -e 's/(password|token|secret|authorization)[=: ]+[^[:space:]]+/\1=***/gi' \
    -e 's/(gh[opsu]_[A-Za-z0-9_]+)/***/g'
}

docker_with_config() {
  sudo docker --config "$DOCKER_CONFIG_DIR" "$@"
}

compose_with_image() {
  local image_ref="$1"
  local image_digest="${image_ref##*@}"
  local write_modules="${DEPLOY_COMPOSE_WRITE_MODULES-${FOSU_ADMIN_WRITE_MODULES:-}}"
  local rollout_version="${DEPLOY_COMPOSE_ROLLOUT_VERSION-${FOSU_ROLLOUT_VERSION}}"
  shift
  sudo env \
    FOSU_API_IMAGE="$image_ref" \
    FOSU_API_DIGEST="$image_digest" \
    FOSU_RUNTIME_DATA_HOST_DIR="$DATA_DIR" \
    FOSU_ADMIN_PRIMARY=legacy \
    FOSU_ADMIN_NEXT_ENABLED=true \
    FOSU_ADMIN_NEXT_WRITE_MODULES="$write_modules" \
    FOSU_ROLLOUT_VERSION="$rollout_version" \
    FOSU_STARTUP_DATA_RECONCILIATION_ENABLED=false \
    docker --config "$DOCKER_CONFIG_DIR" compose --project-directory "$APP_SERVER_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

compose_shadow_with_image() {
  local image_ref="$1"
  local image_digest="${image_ref##*@}"
  local write_modules="${DEPLOY_COMPOSE_WRITE_MODULES-${FOSU_ADMIN_WRITE_MODULES:-}}"
  local rollout_version="${DEPLOY_COMPOSE_ROLLOUT_VERSION-${FOSU_ROLLOUT_VERSION}}"
  shift
  sudo env \
    FOSU_API_IMAGE="$image_ref" \
    FOSU_API_DIGEST="$image_digest" \
    FOSU_RUNTIME_DATA_HOST_DIR="$DATA_DIR" \
    FOSU_ADMIN_PRIMARY=legacy \
    FOSU_ADMIN_NEXT_ENABLED=true \
    FOSU_ADMIN_NEXT_WRITE_MODULES="$write_modules" \
    FOSU_ROLLOUT_VERSION="$rollout_version" \
    FOSU_STARTUP_DATA_RECONCILIATION_ENABLED=false \
    docker --config "$DOCKER_CONFIG_DIR" compose --project-directory "$APP_SERVER_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$SHADOW_COMPOSE_FILE" "$@"
}

is_exact_image_ref() {
  [[ "${1:-}" =~ ^ghcr\.io/katelya77/fosuclass-api@sha256:[0-9a-f]{64}$ ]]
}

container_exists() {
  sudo docker inspect "$CONTAINER_NAME" >/dev/null 2>&1
}

container_is_running() {
  [ "$(sudo docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || true)" = "true" ]
}

inspect_container_env_value() {
  local name="$1"
  sudo docker inspect "$CONTAINER_NAME" | env EXPECTED_ENV_NAME="$name" node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const value = JSON.parse(input || "[]")[0];
      const prefix = `${process.env.EXPECTED_ENV_NAME}=`;
      const matches = value && value.Config && Array.isArray(value.Config.Env)
        ? value.Config.Env.filter((entry) => entry.startsWith(prefix))
        : [];
      if (matches.length > 1) process.exit(2);
      process.stdout.write(matches.length ? matches[0].slice(prefix.length) : "");
    });
  '
}

inspect_required_durable_bind_mount() {
  local target="$1"
  sudo docker inspect "$CONTAINER_NAME" | env EXPECTED_MOUNT_TARGET="$target" node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const values = JSON.parse(input || "[]");
      const mounts = values[0] && Array.isArray(values[0].Mounts)
        ? values[0].Mounts.filter((entry) => entry.Destination === process.env.EXPECTED_MOUNT_TARGET)
        : [];
      if (mounts.length !== 1 || mounts[0].Type !== "bind" || mounts[0].RW !== true || !mounts[0].Source) process.exit(2);
      process.stdout.write(`${mounts[0].Source}\n`);
    });
  '
}

inspect_old_data_mount() {
  if ! container_exists; then
    return 0
  fi
  OLD_DATA_MOUNT_SOURCE="$(inspect_required_durable_bind_mount /app/data)"
  OLD_STORAGE_MOUNT_SOURCE="$(inspect_required_durable_bind_mount /app/storage)"
  OLD_OPENRESTY_RELEASE_MOUNT_SOURCE="$(inspect_required_durable_bind_mount /openresty-static/releases)"
  OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE="$(inspect_required_durable_bind_mount /openresty-static/runtime)"
  OLD_DATA_MOUNT_TYPE="bind"
  OLD_DATA_MOUNT_SOURCE_REALPATH="$(realpath -e -- "$OLD_DATA_MOUNT_SOURCE")"
  OLD_STORAGE_MOUNT_SOURCE_REALPATH="$(realpath -e -- "$OLD_STORAGE_MOUNT_SOURCE")"
  OLD_OPENRESTY_RELEASE_MOUNT_SOURCE_REALPATH="$(realpath -e -- "$OLD_OPENRESTY_RELEASE_MOUNT_SOURCE")"
  OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE_REALPATH="$(realpath -e -- "$OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE")"
  if [ "$OLD_STORAGE_MOUNT_SOURCE_REALPATH" != "$(realpath -e -- "$STORAGE_DIR")" ]; then
    echo "old container storage bind does not match the durable application storage directory" >&2
    return 1
  fi
}

has_bound_runtime_receipt() {
  sudo env RUNTIME_DATA_DIR="$DATA_DIR" node <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dataDir = path.resolve(process.env.RUNTIME_DATA_DIR);
const receiptPath = path.join(dataDir, ".fosu-runtime-bootstrap.json");
const markerPath = path.join(dataDir, ".fosu-runtime-migration.json");
if (!fs.existsSync(receiptPath) || !fs.existsSync(markerPath)) process.exit(1);
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const markerBytes = fs.readFileSync(markerPath);
const marker = JSON.parse(markerBytes.toString("utf8"));
const digest = (value) => /^[a-f0-9]{64}$/.test(String(value || ""));
const markerSha256 = crypto.createHash("sha256").update(markerBytes).digest("hex");
if (receipt.state !== "migration-accepted" || receipt.migrationVerified !== true) process.exit(1);
if (!digest(receipt.migrationMarkerSha256) || receipt.migrationMarkerSha256 !== markerSha256) process.exit(1);
if (!digest(receipt.migrationDataFingerprint) || receipt.migrationDataFingerprint !== marker.dataFingerprint) process.exit(1);
if (!digest(receipt.migrationArchiveSha256) || receipt.migrationArchiveSha256 !== marker.archiveSha256) process.exit(1);
NODE
}

old_uses_bound_runtime_target() {
  OLD_USES_BOUND_RUNTIME_TARGET=0
  if [ "$OLD_DATA_MOUNT_TYPE" != "bind" ] || [ -z "$OLD_DATA_MOUNT_SOURCE_REALPATH" ] || [ ! -d "$DATA_DIR" ]; then
    return 1
  fi
  local dedicated_realpath
  dedicated_realpath="$(realpath -e -- "$DATA_DIR")"
  if [ "$OLD_DATA_MOUNT_SOURCE_REALPATH" != "$dedicated_realpath" ]; then
    return 1
  fi
  if ! has_bound_runtime_receipt; then
    return 1
  fi
  OLD_USES_BOUND_RUNTIME_TARGET=1
  return 0
}

audit_runtime_path_env_json() {
  local scope="$1"
  local source_kind="$2"
  RUNTIME_PATH_SCOPE="$scope" RUNTIME_PATH_SOURCE_KIND="$source_kind" node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const parsed = JSON.parse(input || "{}");
      let values;
      if (process.env.RUNTIME_PATH_SOURCE_KIND === "container") {
        const env = parsed[0] && parsed[0].Config && parsed[0].Config.Env || [];
        values = Object.fromEntries(env.map((entry) => {
          const index = entry.indexOf("=");
          return index < 0 ? [entry, ""] : [entry.slice(0, index), entry.slice(index + 1)];
        }));
      } else {
        values = parsed.services && parsed.services["fosu-api"] && parsed.services["fosu-api"].environment || {};
        if (Array.isArray(values)) values = Object.fromEntries(values.map((entry) => {
          const index = entry.indexOf("=");
          return index < 0 ? [entry, ""] : [entry.slice(0, index), entry.slice(index + 1)];
        }));
      }
      const names = [
        "FOSU_DATA_DIR",
        "FOSU_STORAGE_DIR",
        "FOSU_ASSISTANT_KB_PATH",
        "FOSU_AI_PROVIDER_CONFIG_PATH",
        "RELAY_DIR",
        "STAGING_DIR",
        "OPENRESTY_STATIC_RELEASE_DIR",
        "OPENRESTY_STATIC_RUNTIME_DIR",
        "STATIC_RELEASE_SYNC_LOCK",
        "STATIC_RELEASE_SYNC_STATUS_PATH",
      ];
      const roots = [
        "/app/data",
        "/app/storage",
        "/openresty-static/releases",
        "/openresty-static/runtime",
      ];
      let rejected = false;
      for (const name of names) {
        const raw = String(values[name] == null ? "" : values[name]).trim();
        let state = "empty";
        if (raw) {
          const resolved = require("path").posix.resolve("/", raw);
          state = roots.some((root) => resolved === root || resolved.startsWith(`${root}/`)) ? "inside" : "outside";
          if (state === "outside") rejected = true;
        }
        process.stdout.write(`${process.env.RUNTIME_PATH_SCOPE} runtime_path_env:${name}=${state}\n`);
      }
      if (rejected) process.exit(2);
    });
  '
}

audit_container_runtime_write_paths() {
  sudo docker inspect "$CONTAINER_NAME" | audit_runtime_path_env_json old-container container
}

audit_deployment_runtime_write_paths() {
  compose_with_image "$FOSU_API_IMAGE" config --format json | audit_runtime_path_env_json candidate-compose compose
}

assert_candidate_durable_bind_mounts() {
  compose_with_image "$FOSU_API_IMAGE" config --format json | env \
    EXPECTED_DATA_SOURCE="$(realpath -e -- "$DATA_DIR")" \
    EXPECTED_STORAGE_SOURCE="$OLD_STORAGE_MOUNT_SOURCE_REALPATH" \
    EXPECTED_RELEASE_SOURCE="$OLD_OPENRESTY_RELEASE_MOUNT_SOURCE_REALPATH" \
    EXPECTED_RUNTIME_SOURCE="$OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE_REALPATH" \
    node -e '
      const fs = require("fs");
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
      const value = JSON.parse(input || "{}");
        const service = value.services && value.services["fosu-api"];
        const volumes = service && Array.isArray(service.volumes) ? service.volumes : [];
        const expected = new Map([
          ["/app/data", process.env.EXPECTED_DATA_SOURCE],
          ["/app/storage", process.env.EXPECTED_STORAGE_SOURCE],
          ["/openresty-static/releases", process.env.EXPECTED_RELEASE_SOURCE],
          ["/openresty-static/runtime", process.env.EXPECTED_RUNTIME_SOURCE],
        ]);
        for (const [target, expectedSource] of expected) {
          const matches = volumes.filter((entry) => entry && entry.target === target);
          if (matches.length !== 1 || matches[0].type !== "bind" || matches[0].read_only === true) process.exit(2);
          let actualSource;
          const sourcePath = require("path").resolve(matches[0].source);
          const parsed = require("path").parse(sourcePath);
          let current = parsed.root;
          for (const part of sourcePath.slice(parsed.root.length).split(require("path").sep).filter(Boolean)) {
            current = require("path").join(current, part);
            if (fs.lstatSync(current).isSymbolicLink()) process.exit(2);
          }
          try { actualSource = fs.realpathSync(matches[0].source); } catch (_) { process.exit(2); }
          if (actualSource !== expectedSource) process.exit(2);
          process.stdout.write(`candidate durable_bind:${target}=rw\n`);
        }
      });
    '
}

assert_host_persistence_preflight() {
  sudo env \
    PREFLIGHT_APP_ROOT="$APP_ROOT" \
    PREFLIGHT_RUNTIME_ROOT="$RUNTIME_ROOT" \
    PREFLIGHT_BACKUP_DIR="$MIGRATION_BACKUP_DIR" \
    PREFLIGHT_QUARANTINE_DIR="$QUARANTINE_DIR" \
    PREFLIGHT_OLD_DATA_SOURCE="$OLD_DATA_MOUNT_SOURCE_REALPATH" \
    PREFLIGHT_OLD_DATA_SOURCE_RAW="$OLD_DATA_MOUNT_SOURCE" \
    PREFLIGHT_STORAGE_SOURCE="$OLD_STORAGE_MOUNT_SOURCE_REALPATH" \
    PREFLIGHT_STORAGE_SOURCE_RAW="$OLD_STORAGE_MOUNT_SOURCE" \
    PREFLIGHT_RELEASE_SOURCE="$OLD_OPENRESTY_RELEASE_MOUNT_SOURCE_REALPATH" \
    PREFLIGHT_RELEASE_SOURCE_RAW="$OLD_OPENRESTY_RELEASE_MOUNT_SOURCE" \
    PREFLIGHT_STATIC_RUNTIME_SOURCE="$OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE_REALPATH" \
    PREFLIGHT_STATIC_RUNTIME_SOURCE_RAW="$OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE" \
    node <<'NODE'
const fs = require("fs");
const path = require("path");
const appRoot = path.resolve(process.env.PREFLIGHT_APP_ROOT);
const runtimeRoot = path.resolve(process.env.PREFLIGHT_RUNTIME_ROOT);
const backupDir = path.resolve(process.env.PREFLIGHT_BACKUP_DIR);
const quarantineDir = path.resolve(process.env.PREFLIGHT_QUARANTINE_DIR);
const durableSources = [
  [process.env.PREFLIGHT_OLD_DATA_SOURCE_RAW, process.env.PREFLIGHT_OLD_DATA_SOURCE],
  [process.env.PREFLIGHT_STORAGE_SOURCE_RAW, process.env.PREFLIGHT_STORAGE_SOURCE],
  [process.env.PREFLIGHT_RELEASE_SOURCE_RAW, process.env.PREFLIGHT_RELEASE_SOURCE],
  [process.env.PREFLIGHT_STATIC_RUNTIME_SOURCE_RAW, process.env.PREFLIGHT_STATIC_RUNTIME_SOURCE],
];

function assertNoSymlinkComponents(candidate) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) throw new Error(`persistence path component is missing: ${path.basename(current)}`);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`persistence path contains a symlink: ${path.basename(current)}`);
  }
}

function assertMode(label, candidate, expected) {
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} is not a safe directory`);
  if ((stat.mode & 0o777) !== expected) throw new Error(`${label} mode must be 0700`);
}

for (const candidate of [runtimeRoot, backupDir, quarantineDir]) {
  const relative = path.relative(appRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("persistence path escaped the application root");
  assertNoSymlinkComponents(candidate);
}
for (const [candidate, expectedRealpath] of durableSources) {
  assertNoSymlinkComponents(candidate);
  if (fs.realpathSync(candidate) !== expectedRealpath) throw new Error("durable bind source realpath changed");
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("durable bind source is not a safe directory");
}
assertMode("runtime", runtimeRoot, 0o700);
assertMode("migration-backups", backupDir, 0o700);
assertMode("quarantine", quarantineDir, 0o700);
process.stdout.write("runtime_host_path_preflight=ok\n");
NODE

  if [ -z "$OLD_DATA_MOUNT_SOURCE" ] || [ ! -d "$OLD_DATA_MOUNT_SOURCE" ]; then
    echo "authoritative /app/data mount source is not measurable" >&2
    return 1
  fi
  local source_bytes available_bytes required_bytes
  source_bytes="$(sudo du -sb -- "$OLD_DATA_MOUNT_SOURCE" | awk '{print $1}')"
  available_bytes="$(df -B1 --output=avail "$RUNTIME_ROOT" | tail -n 1 | tr -d '[:space:]')"
  if [[ ! "$source_bytes" =~ ^[0-9]+$ ]] || [[ ! "$available_bytes" =~ ^[0-9]+$ ]]; then
    echo "runtime disk capacity could not be measured" >&2
    return 1
  fi
  required_bytes=$((source_bytes * 4 + 1073741824))
  echo "runtime_disk_required_bytes=${required_bytes}"
  echo "runtime_disk_available_bytes=${available_bytes}"
  if [ "$available_bytes" -lt "$required_bytes" ]; then
    echo "insufficient disk for export, backup, candidate generation, and shadow verification" >&2
    return 1
  fi
}

freeze_authoritative_source() {
  if ! container_exists; then
    echo "deployment requires the current container as the authoritative runtime-data source" >&2
    return 1
  fi
  local paused status
  paused="$(sudo docker inspect -f '{{.State.Paused}}' "$CONTAINER_NAME")"
  status="$(sudo docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME")"
  if [ "$paused" = "true" ]; then
    return 0
  fi
  case "$status" in
    running)
      if [ "$OLD_CONTAINER_ORIGINAL_STATE" = "running" ]; then OLD_CONTAINER_STOPPED=1; fi
      sudo docker stop --time 30 "$CONTAINER_NAME" >/dev/null
      ;;
    created|exited|dead)
      if [ "$OLD_CONTAINER_ORIGINAL_STATE" = "running" ]; then OLD_CONTAINER_STOPPED=1; fi
      ;;
    *)
      echo "authoritative source is in an unstable state: ${status}" >&2
      return 1
      ;;
  esac
}

retire_paused_source_for_cutover() {
  if [ "$(sudo docker inspect -f '{{.State.Paused}}' "$CONTAINER_NAME" 2>/dev/null || true)" = "true" ]; then
    # SIGKILL terminates a kernel-frozen process without opening an application
    # write window between the verified export and container replacement.
    sudo docker kill --signal KILL "$CONTAINER_NAME" >/dev/null
  fi
}

quarantine_unpromoted_runtime_data() {
  sudo mkdir -p "$QUARANTINE_DIR"
  sudo chmod 700 "$QUARANTINE_DIR"
  if [ -e "$DATA_DIR" ] || [ -L "$DATA_DIR" ]; then
    if [ -L "$DATA_DIR" ] || [ ! -d "$DATA_DIR" ]; then
      echo "runtime target is not a safe directory and cannot be quarantined" >&2
      return 1
    fi
    if [ -n "$OLD_DATA_MOUNT_SOURCE_REALPATH" ] && [ "$OLD_DATA_MOUNT_SOURCE_REALPATH" = "$(realpath -e -- "$DATA_DIR")" ]; then
      echo "refusing to quarantine an authoritative dedicated bind without a valid bound receipt" >&2
      return 1
    fi
    local quarantined="$QUARANTINE_DIR/${DEPLOY_ATTEMPT_ID}-unpromoted-data"
    if [ -e "$quarantined" ] || [ -L "$quarantined" ]; then
      echo "quarantine destination already exists" >&2
      return 1
    fi
    sudo mv -- "$DATA_DIR" "$quarantined"
    sudo chmod 700 "$quarantined"
    echo "quarantined_unpromoted_data=${quarantined}"
  fi
  sudo mkdir -p "$DATA_DIR"
  sudo chmod 700 "$DATA_DIR"
}

record_old_container_original_state() {
  OLD_CONTAINER_ORIGINAL_STATE="absent"
  if ! container_exists; then
    return 0
  fi
  if [ "$(sudo docker inspect -f '{{.State.Paused}}' "$CONTAINER_NAME" 2>/dev/null || true)" = "true" ]; then
    OLD_CONTAINER_ORIGINAL_STATE="paused"
    return 0
  fi
  OLD_CONTAINER_ORIGINAL_STATE="$(sudo docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME")"
}

restore_old_container_state() (
  set -Eeuo pipefail
  local restore_mode="${1:-pre-cutover}"
  case "$OLD_CONTAINER_ORIGINAL_STATE" in
    running)
      if [ "$(sudo docker inspect -f '{{.State.Paused}}' "$CONTAINER_NAME" 2>/dev/null || true)" = "true" ]; then
        sudo docker unpause "$CONTAINER_NAME" >/dev/null
      fi
      if ! container_is_running; then
        sudo docker start "$CONTAINER_NAME" >/dev/null
      fi
      ;;
    paused)
      if ! container_is_running; then
        sudo docker start "$CONTAINER_NAME" >/dev/null
      fi
      if [ "$(sudo docker inspect -f '{{.State.Paused}}' "$CONTAINER_NAME" 2>/dev/null || true)" != "true" ]; then
        sudo docker pause "$CONTAINER_NAME" >/dev/null
      fi
      ;;
    created|exited|dead)
      # A pre-cutover failure must not start a container that was not serving
      # traffic when the deployment attempt began.
      if [ "$restore_mode" = "after-recreate" ] && container_is_running; then
        sudo docker stop --time 30 "$CONTAINER_NAME" >/dev/null
      fi
      ;;
    absent|removing|restarting)
      ;;
    *)
      echo "unknown original container state: ${OLD_CONTAINER_ORIGINAL_STATE}" >&2
      return 1
      ;;
  esac
)

wait_for_health() {
  local expected_image="$1"
  local container_name="${2:-$CONTAINER_NAME}"
  local health_url="${3:-$HEALTH_URL}"
  local health="unknown"
  for attempt in $(seq 1 60); do
    health="$(sudo docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true)"
    if { [ "$health" = "healthy" ] || [ "$health" = "running" ]; } && curl -fsS --max-time 8 "$health_url" >/dev/null; then
      local configured_image
      configured_image="$(sudo docker inspect -f '{{.Config.Image}}' "$container_name")"
      if [ "$configured_image" = "$expected_image" ]; then
        return 0
      fi
      echo "running container image does not match requested digest" >&2
      return 1
    fi
    sleep 2
  done
  echo "health smoke timed out (last status=${health})" >&2
  return 1
}

prepare_shadow_data() {
  sudo mkdir -p "$SHADOW_DATA_DIR"
  sudo chmod 700 "$SHADOW_ROOT" "$SHADOW_DATA_DIR"
  sudo cp -a --reflink=auto "$DATA_DIR/." "$SHADOW_DATA_DIR/"
  sudo env \
    SHADOW_COMPOSE_FILE="$SHADOW_COMPOSE_FILE" \
    SHADOW_DATA_DIR="$(realpath -e -- "$SHADOW_DATA_DIR")" \
    SHADOW_STORAGE_DIR="$OLD_STORAGE_MOUNT_SOURCE_REALPATH" \
    SHADOW_RELEASE_DIR="$OLD_OPENRESTY_RELEASE_MOUNT_SOURCE_REALPATH" \
    SHADOW_RUNTIME_DIR="$OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE_REALPATH" \
    node -e '
      const fs = require("fs");
      const path = require("path");
      const names = ["SHADOW_DATA_DIR", "SHADOW_STORAGE_DIR", "SHADOW_RELEASE_DIR", "SHADOW_RUNTIME_DIR"];
      for (const name of names) {
        if (!process.env[name] || !path.isAbsolute(process.env[name])) throw new Error(`invalid shadow bind source: ${name}`);
      }
      const document = {
        services: {
          "fosu-api": {
            volumes: [
              { type: "bind", source: process.env.SHADOW_DATA_DIR, target: "/app/data", read_only: false },
              { type: "bind", source: process.env.SHADOW_STORAGE_DIR, target: "/app/storage", read_only: true },
              { type: "bind", source: process.env.SHADOW_RELEASE_DIR, target: "/openresty-static/releases", read_only: true },
              { type: "bind", source: process.env.SHADOW_RUNTIME_DIR, target: "/openresty-static/runtime", read_only: true },
            ],
          },
        },
      };
      fs.writeFileSync(process.env.SHADOW_COMPOSE_FILE, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    '
  sudo chmod 600 "$SHADOW_COMPOSE_FILE"
}

assert_shadow_is_loopback_only() {
  local binding
  binding="$(sudo docker inspect "$SHADOW_CONTAINER_NAME" | env \
    EXPECTED_IMAGE="$FOSU_API_IMAGE" \
    EXPECTED_DATA_DIR="$(realpath -e -- "$SHADOW_DATA_DIR")" \
    EXPECTED_STORAGE_DIR="$(realpath -e -- "$STORAGE_DIR")" \
    EXPECTED_RELEASE_DIR="$OLD_OPENRESTY_RELEASE_MOUNT_SOURCE_REALPATH" \
    EXPECTED_RUNTIME_DIR="$OLD_OPENRESTY_RUNTIME_MOUNT_SOURCE_REALPATH" \
    node -e '
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const value = JSON.parse(input || "[]")[0];
        if (!value || value.Config.Image !== process.env.EXPECTED_IMAGE) process.exit(2);
        if (!value.Config.Labels || value.Config.Labels["com.fosuclass.deploy.role"] !== "shadow") process.exit(2);
        const bindings = value.NetworkSettings && value.NetworkSettings.Ports && value.NetworkSettings.Ports["3000/tcp"];
        if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== "127.0.0.1" || !/^[0-9]{2,5}$/.test(bindings[0].HostPort)) process.exit(2);
        const publishedPorts = Object.entries(value.NetworkSettings && value.NetworkSettings.Ports || {})
          .filter(([, entries]) => Array.isArray(entries) && entries.length > 0);
        if (publishedPorts.length !== 1 || publishedPorts[0][0] !== "3000/tcp") process.exit(2);
        const mountList = value.Mounts || [];
        if (mountList.some((entry) => entry && entry.RW === true && entry.Destination !== "/app/data")) process.exit(2);
        const mounts = new Map(mountList.map((entry) => [entry.Destination, entry]));
        const data = mounts.get("/app/data");
        const storage = mounts.get("/app/storage");
        const releases = mounts.get("/openresty-static/releases");
        const runtime = mounts.get("/openresty-static/runtime");
        if (!data || data.Type !== "bind" || data.Source !== process.env.EXPECTED_DATA_DIR || data.RW !== true) process.exit(2);
        if (!storage || storage.Type !== "bind" || storage.Source !== process.env.EXPECTED_STORAGE_DIR || storage.RW !== false) process.exit(2);
        if (!releases || releases.Type !== "bind" || releases.Source !== process.env.EXPECTED_RELEASE_DIR || releases.RW !== false) process.exit(2);
        if (!runtime || runtime.Type !== "bind" || runtime.Source !== process.env.EXPECTED_RUNTIME_DIR || runtime.RW !== false) process.exit(2);
        process.stdout.write(bindings[0].HostPort);
      });
    ' )"
  SHADOW_HOST_PORT="$binding"
  SHADOW_HEALTH_URL="http://127.0.0.1:${SHADOW_HOST_PORT}/api/health"
}

start_shadow_candidate() {
  if sudo docker inspect "$SHADOW_CONTAINER_NAME" >/dev/null 2>&1; then
    cleanup_shadow_candidate
  fi
  prepare_shadow_data
  compose_shadow_with_image "$FOSU_API_IMAGE" run -d --no-deps \
    --name "$SHADOW_CONTAINER_NAME" \
    --label com.fosuclass.deploy.role=shadow \
    -p '127.0.0.1::3000' \
    -e FOSU_RELEASE_WORKER_ENABLED=false \
    -e FOSU_MAINTENANCE_ENABLED=false \
    fosu-api >/dev/null
  assert_shadow_is_loopback_only
}

stop_shadow_candidate() {
  cleanup_shadow_candidate
  cleanup_shadow_data
}

run_runtime_migration_gate() {
  local phase="$1"
  local expected_mode="$2"
  local output_path="$IMAGE_EVIDENCE_DIR/${DEPLOY_ATTEMPT_ID}-migration-gate-${phase}.json"
  local stage_path="$IMAGE_EVIDENCE_DIR/.${DEPLOY_ATTEMPT_ID}.migration-${phase}.$$.tmp"
  if ! sudo node "$MIGRATION_SCRIPT" \
      --source-container "$CONTAINER_NAME" \
      --target-dir "$DATA_DIR" \
      --backup-dir "$MIGRATION_BACKUP_DIR" > "$stage_path"; then
    rm -f -- "$stage_path"
    return 1
  fi
  EXPECTED_MIGRATION_MODE="$expected_mode" node -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (value.archiveVerified !== true) throw new Error("migration archive was not extraction-verified");
    if (process.env.EXPECTED_MIGRATION_MODE === "fresh") {
      if (value.reconciled === true) throw new Error("fresh data generation unexpectedly reconciled stale target state");
      if (!["already-quiesced", "left-quiesced-for-cutover"].includes(value.sourceDisposition)) {
        throw new Error("fresh migration did not leave an authoritative quiesced source");
      }
    } else if (value.reconciled !== true || value.reconcileAuthority !== "same-persistent-bind") {
      throw new Error("runtime reconciliation is not bound to the currently mounted persistent target");
    }
  ' "$stage_path"
  chmod 600 "$stage_path"
  mv "$stage_path" "$output_path"
  echo "runtime_migration_gate=${output_path}"
}

collect_local_image_evidence() {
  local candidate_ref="$1"
  local evidence_temp_dir
  evidence_temp_dir="$(mktemp -d "$IMAGE_EVIDENCE_DIR/.image-evidence.XXXXXXXX")"
  if [ -n "$OLD_IMAGE_ID" ]; then
    sudo docker image inspect "$OLD_IMAGE_ID" > "$evidence_temp_dir/old-inspect.json"
    sudo docker image history --no-trunc --format '{{json .}}' "$OLD_IMAGE_ID" > "$evidence_temp_dir/old-history.jsonl"
  else
    printf '[]\n' > "$evidence_temp_dir/old-inspect.json"
    : > "$evidence_temp_dir/old-history.jsonl"
  fi
  sudo docker image inspect "$candidate_ref" > "$evidence_temp_dir/candidate-inspect.json"
  sudo docker image history --no-trunc --format '{{json .}}' "$candidate_ref" > "$evidence_temp_dir/candidate-history.jsonl"

  local evidence_path="$IMAGE_EVIDENCE_DIR/${DEPLOY_ATTEMPT_ID}-image-sizes.json"
  local evidence_stage="$IMAGE_EVIDENCE_DIR/.${DEPLOY_ATTEMPT_ID}.$$.tmp"
  EVIDENCE_OLD_CONFIGURED_IMAGE="$OLD_CONFIGURED_IMAGE" \
  EVIDENCE_OLD_IMAGE_ID="$OLD_IMAGE_ID" \
  EVIDENCE_CANDIDATE_REF="$candidate_ref" \
  EVIDENCE_TEMP_DIR="$evidence_temp_dir" \
  EVIDENCE_COMMIT="$FOSU_DEPLOY_COMMIT_SHA" \
  EVIDENCE_TARGET="$FOSU_IMAGE_TARGET" \
  EVIDENCE_OLD_CONTAINER_STATE="$OLD_CONTAINER_ORIGINAL_STATE" \
  EVIDENCE_ROLLBACK_IMAGE="$PREVIOUS_IMAGE" \
  node <<'NODE' > "$evidence_stage"
const fs = require("fs");
const path = require("path");
const root = process.env.EVIDENCE_TEMP_DIR;
const first = (name) => {
  const values = JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  return Array.isArray(values) && values.length ? values[0] : null;
};
const history = (name) => fs.readFileSync(path.join(root, name), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const selectInspect = (value) => value && ({
  id: value.Id || null,
  repoTags: value.RepoTags || [],
  repoDigests: value.RepoDigests || [],
  created: value.Created || null,
  architecture: value.Architecture || null,
  os: value.Os || null,
  dockerImageSizeBytes: Number(value.Size || 0),
  dockerVirtualSizeBytes: Number(value.VirtualSize || value.Size || 0),
});
const evidence = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  commit: process.env.EVIDENCE_COMMIT,
  imageTarget: process.env.EVIDENCE_TARGET,
  rollbackDigest: process.env.EVIDENCE_ROLLBACK_IMAGE || "UNKNOWN (bootstrap cutover)",
  rollbackProvenance: process.env.EVIDENCE_ROLLBACK_IMAGE ? "previously-deployed-pointer" : "UNKNOWN-bootstrap-cutover",
  oldRunningImage: {
    originalContainerState: process.env.EVIDENCE_OLD_CONTAINER_STATE,
    configuredImage: process.env.EVIDENCE_OLD_CONFIGURED_IMAGE || null,
    runtimeImageId: process.env.EVIDENCE_OLD_IMAGE_ID || null,
    inspect: selectInspect(first("old-inspect.json")),
    history: history("old-history.jsonl"),
  },
  candidateImage: {
    configuredImage: process.env.EVIDENCE_CANDIDATE_REF,
    inspect: selectInspect(first("candidate-inspect.json")),
    history: history("candidate-history.jsonl"),
  },
};
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
NODE
  chmod 600 "$evidence_stage"
  mv "$evidence_stage" "$evidence_path"
  case "$evidence_temp_dir" in
    "$IMAGE_EVIDENCE_DIR"/.image-evidence.*) rm -rf -- "$evidence_temp_dir" ;;
    *) echo "refusing to remove unexpected image evidence temp path" >&2; return 1 ;;
  esac
  echo "image_size_evidence=${evidence_path}"
  node -e '
    const value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const oldBytes = Number(value.oldRunningImage && value.oldRunningImage.inspect && value.oldRunningImage.inspect.dockerImageSizeBytes || 0);
    const candidateBytes = Number(value.candidateImage && value.candidateImage.inspect && value.candidateImage.inspect.dockerImageSizeBytes || 0);
    process.stdout.write(`old_uncompressed_image_bytes=${oldBytes}\ncandidate_uncompressed_image_bytes=${candidateBytes}\n`);
  ' "$evidence_path"
}

capture_runtime_persistence() {
  sudo node "$PERSISTENCE_SCRIPT" capture \
    --data-dir "$DATA_DIR" \
    --storage-dir "$STORAGE_DIR" \
    --output "$PERSISTENCE_SNAPSHOT"
  sudo chmod 600 "$PERSISTENCE_SNAPSHOT"
}

verify_runtime_persistence_after_recreate() {
  sudo node "$PERSISTENCE_SCRIPT" verify \
    --snapshot "$PERSISTENCE_SNAPSHOT" \
    --data-dir "$DATA_DIR" \
    --storage-dir "$STORAGE_DIR" \
    --output "$PERSISTENCE_RESULT"
  sudo chmod 600 "$PERSISTENCE_RESULT"
  echo "runtime_persistence_result=${PERSISTENCE_RESULT}"
}

verify_runtime_persistence_after_rollback() {
  sudo node "$PERSISTENCE_SCRIPT" verify \
    --snapshot "$PERSISTENCE_SNAPSHOT" \
    --data-dir "$DATA_DIR" \
    --storage-dir "$STORAGE_DIR" \
    --output "$PERSISTENCE_ROLLBACK_RESULT"
  sudo chmod 600 "$PERSISTENCE_ROLLBACK_RESULT"
  echo "rollback_persistence_result=${PERSISTENCE_ROLLBACK_RESULT}"
}

write_deploy_state() {
  DEPLOY_STATE_DIR="$DEPLOY_STATE_DIR" \
  DEPLOY_IMAGE="$FOSU_API_IMAGE" \
  DEPLOY_ROLLBACK_IMAGE="$PREVIOUS_IMAGE" \
  DEPLOY_COMMIT="$FOSU_DEPLOY_COMMIT_SHA" \
  DEPLOY_ROLLOUT_VERSION="$FOSU_ROLLOUT_VERSION" \
  DEPLOY_IMAGE_TARGET="$FOSU_IMAGE_TARGET" \
  DEPLOY_OLD_CONTAINER_STATE="$OLD_CONTAINER_ORIGINAL_STATE" \
  node <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const stateDir = path.resolve(process.env.DEPLOY_STATE_DIR);

function fsyncDirectory() {
  const descriptor = fs.openSync(stateDir, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function durableWrite(name, value) {
  const target = path.join(stateDir, name);
  const temp = path.join(stateDir, `.${name}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  const bytes = Buffer.from(value);
  const descriptor = fs.openSync(temp, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temp, target);
  fs.chmodSync(target, 0o600);
  fsyncDirectory();
}

const deployment = {
  schemaVersion: 1,
  deployedAt: new Date().toISOString(),
  commit: process.env.DEPLOY_COMMIT,
  rolloutVersion: process.env.DEPLOY_ROLLOUT_VERSION,
  imageTarget: process.env.DEPLOY_IMAGE_TARGET,
  image: process.env.DEPLOY_IMAGE,
  rollbackImage: process.env.DEPLOY_ROLLBACK_IMAGE,
  originalContainerState: process.env.DEPLOY_OLD_CONTAINER_STATE,
};
// Metadata lands first. The health pointer is advanced last, so a crash cannot
// advertise a candidate whose evidence was not durably recorded.
durableWrite("last-deployment.json", `${JSON.stringify(deployment, null, 2)}\n`);
durableWrite("last-healthy-image.txt", `${deployment.image}\n`);
NODE
}

verify_admin_capabilities() {
  local capabilities_url="${1:-$CAPABILITIES_URL}"
  local expected_write_modules="${2-${FOSU_ADMIN_WRITE_MODULES:-}}"
  local capabilities
  capabilities="$(curl -fsS --max-time 8 "$capabilities_url")"
  EXPECTED_WRITE_MODULES="$expected_write_modules" node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const value = JSON.parse(input || "{}");
  const expected = String(process.env.EXPECTED_WRITE_MODULES || "").split(",").filter(Boolean).sort();
  const actual = Array.isArray(value.writeModuleList) ? value.writeModuleList.slice().sort() : [];
  if (value.primary !== "legacy" || value.nextEnabled !== true) throw new Error("admin primary/next invariant failed");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`write module rollout mismatch: ${actual} != ${expected}`);
  if (value.writeModules && (value.writeModules.release || value.writeModules.term)) throw new Error("high-risk release/term writes are enabled");
  process.stdout.write("admin-capabilities-ok\n");
});
' <<<"$capabilities"
}

smoke_shadow_candidate() {
  wait_for_health "$FOSU_API_IMAGE" "$SHADOW_CONTAINER_NAME" "$SHADOW_HEALTH_URL"
  verify_admin_capabilities "http://127.0.0.1:${SHADOW_HOST_PORT}/api/admin/capabilities"
  curl -fsS --max-time 8 "http://127.0.0.1:${SHADOW_HOST_PORT}/admin-next/" >/dev/null
  local admin_unauth_status
  admin_unauth_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${SHADOW_HOST_PORT}/api/admin/publisher/receipt" || true)"
  if [ "$admin_unauth_status" != "401" ]; then
    echo "shadow protected admin receipt returned HTTP ${admin_unauth_status} without a token" >&2
    return 1
  fi
  sudo docker exec "$SHADOW_CONTAINER_NAME" node -e '
    const http = require("http");
    const token = process.env.ADMIN_API_TOKEN;
    if (!token) throw new Error("ADMIN_API_TOKEN is missing");
    const request = http.get({ host: "127.0.0.1", port: 3000, path: "/api/admin/publisher/receipt", headers: { "X-Admin-Token": token } }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        const value = JSON.parse(body || "{}");
        if (response.statusCode !== 200 || value.success !== true) process.exit(1);
      });
    });
    request.setTimeout(8000, () => request.destroy(new Error("shadow admin token smoke timed out")));
    request.on("error", (error) => { console.error(error.message); process.exit(1); });
  '
  local bootstrap_status
  bootstrap_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 -X POST -H 'Content-Type: application/json' --data '{}' "http://127.0.0.1:${SHADOW_HOST_PORT}/api/fosu/session/bootstrap" || true)"
  if [ "$bootstrap_status" = "000" ] || [ "$bootstrap_status" = "404" ]; then
    echo "shadow session bootstrap route is unavailable: HTTP ${bootstrap_status}" >&2
    return 1
  fi
  sudo docker exec "$SHADOW_CONTAINER_NAME" sh -lc 'test "$FOSU_RUNTIME_DATA_REQUIRE_MIGRATION" = "true" && test "$FOSU_STARTUP_DATA_RECONCILIATION_ENABLED" = "false" && test "$FOSU_RELEASE_WORKER_ENABLED" = "false" && test "$FOSU_MAINTENANCE_ENABLED" = "false" && test -d /app/data && test -w /app/data && test -d /app/storage && test ! -w /app/storage'
  sudo docker exec "$SHADOW_CONTAINER_NAME" sh -lc 'node scripts/security-postdeploy-check.js --base-url=http://127.0.0.1:3000'
  sudo docker exec "$SHADOW_CONTAINER_NAME" sh -lc 'node scripts/verify-ai-provider.js --mode=status' 2>&1 | sanitize
  echo "shadow_isolation=loopback-ephemeral-port"
}

smoke_candidate() {
  local image_ref="$1"
  wait_for_health "$image_ref"
  verify_admin_capabilities
  curl -fsS --max-time 8 http://127.0.0.1:18318/admin-next/ >/dev/null
  local admin_unauth_status
  admin_unauth_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:18318/api/admin/publisher/receipt || true)"
  if [ "$admin_unauth_status" != "401" ]; then
    echo "protected admin receipt returned HTTP ${admin_unauth_status} without a token" >&2
    return 1
  fi
  sudo docker exec "$CONTAINER_NAME" node -e '
    const http = require("http");
    const token = process.env.ADMIN_API_TOKEN;
    if (!token) throw new Error("ADMIN_API_TOKEN is missing");
    const request = http.get({ host: "127.0.0.1", port: 3000, path: "/api/admin/publisher/receipt", headers: { "X-Admin-Token": token } }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        const value = JSON.parse(body || "{}");
        if (response.statusCode !== 200 || value.success !== true) process.exit(1);
      });
    });
    request.setTimeout(8000, () => request.destroy(new Error("admin token smoke timed out")));
    request.on("error", (error) => { console.error(error.message); process.exit(1); });
  '
  echo "admin-api-token-contract=ok"
  local bootstrap_status
  bootstrap_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 -X POST -H 'Content-Type: application/json' --data '{}' http://127.0.0.1:18318/api/fosu/session/bootstrap || true)"
  if [ "$bootstrap_status" = "000" ] || [ "$bootstrap_status" = "404" ]; then
    echo "session bootstrap route is unavailable: HTTP ${bootstrap_status}" >&2
    return 1
  fi
  sudo docker exec "$CONTAINER_NAME" sh -lc 'test "$FOSU_RUNTIME_DATA_REQUIRE_MIGRATION" = "true" && test "$FOSU_STARTUP_DATA_RECONCILIATION_ENABLED" = "false" && test -d /app/data && test -w /app/data && test -d /app/storage && test -w /app/storage'
  sudo docker exec "$CONTAINER_NAME" sh -lc 'test -f /app/storage/public/runtime/active.json'
  curl -fsS --max-time 10 https://class.katelya.eu.org/static/runtime/active.json >/dev/null
  sudo docker exec "$CONTAINER_NAME" sh -lc 'node scripts/security-postdeploy-check.js --base-url=http://127.0.0.1:3000'
  sudo docker exec "$CONTAINER_NAME" sh -lc 'node scripts/verify-ai-provider.js --mode=status' 2>&1 | sanitize
  run_runtime_migration_gate post-cutover reconcile
}

rollback_to_previous_digest() (
  set -Eeuo pipefail
  if ! is_exact_image_ref "$PREVIOUS_IMAGE"; then
    echo "no verified previous digest is available for rollback" >&2
    return 1
  fi
  echo "candidate failed; restoring previous healthy digest ${PREVIOUS_IMAGE}"
  DEPLOY_COMPOSE_WRITE_MODULES="$OLD_ADMIN_WRITE_MODULES" DEPLOY_COMPOSE_ROLLOUT_VERSION="$OLD_ROLLOUT_VERSION" \
    compose_with_image "$PREVIOUS_IMAGE" pull fosu-api
  DEPLOY_COMPOSE_WRITE_MODULES="$OLD_ADMIN_WRITE_MODULES" DEPLOY_COMPOSE_ROLLOUT_VERSION="$OLD_ROLLOUT_VERSION" \
    compose_with_image "$PREVIOUS_IMAGE" up -d --no-build fosu-api
  wait_for_health "$PREVIOUS_IMAGE"
  verify_runtime_persistence_after_rollback
  verify_admin_capabilities "$CAPABILITIES_URL" "$OLD_ADMIN_WRITE_MODULES"
  run_runtime_migration_gate rollback reconcile
  restore_old_container_state after-recreate
  echo "rollback_digest=${PREVIOUS_IMAGE}"
)

recover_from_failure() {
  local status="$1"
  local reason="$2"
  local line="$3"
  trap - ERR TERM INT HUP
  set +e
  echo "digest deployment failed (${reason}) at line ${line}; sanitized diagnostics follow" >&2
  compose_with_image "$FOSU_API_IMAGE" ps 2>&1 | sanitize || true
  sudo docker inspect "$CONTAINER_NAME" --format '{{json .State}}' 2>&1 | sanitize || true
  sudo docker logs "$CONTAINER_NAME" --tail=120 2>&1 | sanitize || true
  if sudo docker inspect "$SHADOW_CONTAINER_NAME" >/dev/null 2>&1; then
    sudo docker inspect "$SHADOW_CONTAINER_NAME" --format '{{json .State}}' 2>&1 | sanitize || true
    sudo docker logs "$SHADOW_CONTAINER_NAME" --tail=120 2>&1 | sanitize || true
  fi
  if [ "$DEPLOYMENT_STARTED" = "1" ]; then
    rollback_to_previous_digest || echo "automatic digest rollback failed" >&2
  elif [ "$OLD_CONTAINER_STOPPED" = "1" ]; then
    restore_old_container_state || echo "failed to restore original container state ${OLD_CONTAINER_ORIGINAL_STATE}" >&2
  fi
  exit "$status"
}

on_error() {
  local status=$?
  recover_from_failure "$status" ERR "${BASH_LINENO[0]:-unknown}"
}

on_signal() {
  local signal="$1"
  local status=1
  case "$signal" in
    HUP) status=129 ;;
    INT) status=130 ;;
    TERM) status=143 ;;
  esac
  recover_from_failure "$status" "$signal" "${BASH_LINENO[0]:-unknown}"
}
trap on_error ERR
trap 'on_signal TERM' TERM
trap 'on_signal INT' INT
trap 'on_signal HUP' HUP

printf '%s' "$GHCR_READ_TOKEN" | sudo docker --config "$DOCKER_CONFIG_DIR" login ghcr.io -u "$GHCR_READ_USERNAME" --password-stdin >/dev/null
unset GHCR_READ_TOKEN

mkdir -p "$STORAGE_DIR" "$RUNTIME_ROOT" "$DEPLOY_STATE_DIR" "$IMAGE_EVIDENCE_DIR" "$MIGRATION_BACKUP_DIR" "$QUARANTINE_DIR"
chmod 700 "$RUNTIME_ROOT" "$DEPLOY_STATE_DIR" "$IMAGE_EVIDENCE_DIR" "$MIGRATION_BACKUP_DIR" "$QUARANTINE_DIR"

if container_exists; then
  record_old_container_original_state
  inspect_old_data_mount
  OLD_CONFIGURED_IMAGE="$(sudo docker inspect -f '{{.Config.Image}}' "$CONTAINER_NAME")"
  OLD_IMAGE_ID="$(sudo docker inspect -f '{{.Image}}' "$CONTAINER_NAME")"
  OLD_ADMIN_WRITE_MODULES="$(inspect_container_env_value FOSU_ADMIN_NEXT_WRITE_MODULES)"
  OLD_ROLLOUT_VERSION="$(inspect_container_env_value FOSU_ROLLOUT_VERSION)"
  if [[ ! "$OLD_ADMIN_WRITE_MODULES" =~ ^$|^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$ ]]; then
    echo "existing admin write-module state is invalid" >&2
    exit 1
  fi
  if [ -n "$OLD_ROLLOUT_VERSION" ] && [[ ! "$OLD_ROLLOUT_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
    echo "existing rollout version state is invalid" >&2
    exit 1
  fi
fi
if [ -e "$LAST_HEALTHY_IMAGE_FILE" ] || [ -L "$LAST_HEALTHY_IMAGE_FILE" ]; then
  if [ ! -f "$LAST_HEALTHY_IMAGE_FILE" ] || [ -L "$LAST_HEALTHY_IMAGE_FILE" ] || [ "$(stat -c '%a' "$LAST_HEALTHY_IMAGE_FILE")" != "600" ]; then
    echo "trusted last-healthy pointer is not a protected regular file" >&2
    exit 1
  fi
fi
if [ -s "$LAST_HEALTHY_IMAGE_FILE" ]; then
  recorded_image="$(tr -d '\r\n' < "$LAST_HEALTHY_IMAGE_FILE")"
  if is_exact_image_ref "$recorded_image" && [ "$OLD_CONFIGURED_IMAGE" = "$recorded_image" ]; then
    PREVIOUS_IMAGE="$recorded_image"
  elif is_exact_image_ref "$recorded_image"; then
    echo "verified last-healthy pointer does not match the current exact digest" >&2
  fi
fi

# Pulling and inspecting the candidate is read-only with respect to the running
# service. Capture actual VPS size/layer evidence even when the first digest
# transition must stop because the old local image has no verified digest.
docker_with_config pull "$FOSU_API_IMAGE" >/dev/null
compose_with_image "$FOSU_API_IMAGE" pull fosu-api
collect_local_image_evidence "$FOSU_API_IMAGE"

if ! is_exact_image_ref "$PREVIOUS_IMAGE"; then
  echo "previous_digest=UNKNOWN" >&2
  echo "the running image is local or no previously verified healthy digest is recorded; refusing an unrollbackable deployment" >&2
  exit 1
fi

docker_with_config pull "$PREVIOUS_IMAGE" >/dev/null

audit_container_runtime_write_paths
audit_deployment_runtime_write_paths
assert_host_persistence_preflight

if old_uses_bound_runtime_target; then
  echo "authoritative_data_source=dedicated-bind-with-bound-receipt"
else
  if [ -d "$DATA_DIR" ] && [ "$OLD_DATA_MOUNT_SOURCE_REALPATH" = "$(realpath -e -- "$DATA_DIR")" ]; then
    echo "refusing to quarantine an authoritative dedicated bind without a valid bound receipt" >&2
    exit 1
  fi
  echo "authoritative_data_source=legacy-or-unbound"
fi

freeze_authoritative_source

if [ "$OLD_USES_BOUND_RUNTIME_TARGET" = "1" ]; then
  # The currently serving digest already owns this exact bind mount. Its
  # receipt binds the mutable generation to the original archive and marker,
  # so runtime changes after cutover are legitimate and must be preserved.
  run_runtime_migration_gate pre-cutover reconcile
else
  # A marker left by an earlier failed attempt is stale as soon as Legacy is
  # resumed and writes another audit/sync record. Preserve it as evidence, then
  # export the stopped authoritative container into a brand-new generation.
  quarantine_unpromoted_runtime_data
  run_runtime_migration_gate pre-cutover fresh
fi

compose_with_image "$FOSU_API_IMAGE" config >/dev/null
assert_candidate_durable_bind_mounts
start_shadow_candidate
smoke_shadow_candidate
stop_shadow_candidate
capture_runtime_persistence
DEPLOYMENT_STARTED=1
retire_paused_source_for_cutover
compose_with_image "$FOSU_API_IMAGE" up -d --no-build fosu-api
wait_for_health "$FOSU_API_IMAGE"
verify_runtime_persistence_after_recreate
smoke_candidate "$FOSU_API_IMAGE"

write_deploy_state

trap - ERR TERM INT HUP
echo "deployment_digest=${FOSU_API_IMAGE}"
echo "rollback_digest=${PREVIOUS_IMAGE}"
echo "rollout_version=${FOSU_ROLLOUT_VERSION}"
echo "image_target=${FOSU_IMAGE_TARGET}"
echo "original_container_state=${OLD_CONTAINER_ORIGINAL_STATE}"
echo "persistence_snapshot=${PERSISTENCE_SNAPSHOT}"
echo "persistence_result=${PERSISTENCE_RESULT}"
echo "admin_primary=legacy"
echo "admin_next_enabled=true"
