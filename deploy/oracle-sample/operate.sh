#!/usr/bin/env bash
# Host-local entry to the existing Sample preflight / Compose / rollback contract.
set -Eeuo pipefail
umask 077
phase=ARGUMENTS
trap 'rc=$?; case $rc in 2) status=BLOCKED;; *) status=FAILED;; esac; printf "%s phase=%s exit=%s retained=YES\n" "$status" "$phase" "$rc" >&2; exit "$rc"' ERR
block() { printf 'BLOCKED phase=%s code=%s retained=YES\n' "$phase" "$1"; exit 2; }
mode=${1:-}; [[ $# -gt 0 ]] || block MODE_REQUIRED; shift
app_dir= runtime_dir= manifest= image_dir= backup= approval=
candidate_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
for arg in "$@"; do
 case $arg in
  --app-dir=*) [[ -z $app_dir ]] || block DUPLICATE_ARGUMENT; app_dir=${arg#*=};;
  --runtime-dir=*) [[ -z $runtime_dir ]] || block DUPLICATE_ARGUMENT; runtime_dir=${arg#*=};;
  --manifest=*) [[ -z $manifest ]] || block DUPLICATE_ARGUMENT; manifest=${arg#*=};;
  --image-dir=*) [[ -z $image_dir ]] || block DUPLICATE_ARGUMENT; image_dir=${arg#*=};;
  --backup-dir=*) [[ -z $backup ]] || block DUPLICATE_ARGUMENT; backup=${arg#*=};;
  --approve-commit=*) [[ -z $approval ]] || block DUPLICATE_ARGUMENT; approval=${arg#*=};;
  *) block ARGUMENT_REJECTED;;
 esac
done
[[ $EUID -eq 0 && ( $mode == preflight || $mode == deploy || $mode == rollback ) ]] || block ROOT_OR_MODE_REJECTED
[[ $app_dir == /* && $runtime_dir == /* && $manifest == /* && -f $manifest && ! -L $manifest ]] || block ABSOLUTE_PATHS_REQUIRED
preflight() { node "$candidate_dir/deploy/oracle-sample/preflight.js" --app-dir="$app_dir" --runtime-dir="$runtime_dir" --manifest="$manifest" "$@"; }
phase=READ_ONLY_PREFLIGHT
if [[ $mode == preflight ]]; then
 [[ -z $approval && -z $backup && -z $image_dir ]] || block PREFLIGHT_WRITE_ARGUMENT_REJECTED
 preflight
 printf 'SUCCESS phase=PREFLIGHT writes=0 schoolRequests=0 deployment=NOT_EXECUTED\n'
 exit 0
fi
candidate_sha=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).gitCommit || ""' "$manifest")
[[ $candidate_sha =~ ^[a-f0-9]{40}$ && $approval == "$candidate_sha" ]] || block EXACT_COMMIT_APPROVAL_REQUIRED
[[ $backup == /* && ! -L $backup ]] || block PRIVATE_BACKUP_PATH_REQUIRED
base_sha=a3dfd1989705f51c921f13883bcde1cce4502883
wait_healthy() {
 for (( attempt=0; attempt<60; attempt++ )); do
  [[ $(docker inspect --format '{{.State.Health.Status}}' fosuclass-api 2>/dev/null) == healthy ]] && return 0
  sleep 2
 done
 return 1
}
compose_context() {
 project=$(cat "$backup/compose-project.txt")
 project_dir=$(cat "$backup/compose-working-dir.txt")
 [[ $project =~ ^[a-z0-9][a-z0-9_-]*$ && $project_dir == /* && -d $project_dir ]]
 compose_args=(--project-directory "$project_dir" -p "$project")
 IFS=',' read -r -a env_files < "$backup/compose-env-files.txt"
 for file in "${env_files[@]}"; do [[ $file == /* && -f $file && ! -L $file ]]; compose_args+=(--env-file "$file"); done
 IFS=',' read -r -a original_files < "$backup/compose-config-files.txt"
 for i in "${!original_files[@]}"; do compose_args+=(-f "$backup/compose-$i.yml"); done
}
rollback_code() {
 phase=CODE_ROLLBACK
 old_image=$(cat "$backup/previous-image-id.txt")
 docker image inspect "$old_image" >/dev/null 2>&1 || docker load -i "$backup/previous-image.tar.gz" >/dev/null || return 1
 docker compose "${compose_args[@]}" -f "$backup/rollback-image.yml" up -d --no-build --pull never --no-deps fosu-api > "$backup/rollback-compose.log" 2>&1 || return 1
 wait_healthy || return 1
 preflight --compare-before="$backup/deploy-before.json" > "$backup/rollback-after.json" || return 1
 printf 'SUCCESS phase=CODE_ROLLBACK data_restored=NO backup_retained=YES\n'
}
if [[ $mode == rollback ]]; then
 phase=ROLLBACK_APPROVAL
 [[ -d $backup && -f $backup/SHA256SUMS && -z $image_dir ]] || block BACKUP_REQUIRED
 (cd "$backup"; sha256sum -c SHA256SUMS >/dev/null)
 node - "$backup/operation-context.json" "$app_dir" "$runtime_dir" "$candidate_sha" <<'JS'
const fs=require('fs'),r=JSON.parse(fs.readFileSync(process.argv[2]));if(r.appDir!==process.argv[3]||r.runtimeDir!==process.argv[4]||r.candidateSha!==process.argv[5])process.exit(2);
JS
 # Existing signed preflight rejects in-flight tasks and changed state before rollback.
 preflight --expected-sha="$candidate_sha" > "$backup/rollback-precheck.json"
 compose_context
 rollback_code
 exit 0
fi
phase=IMAGE_AND_APPROVAL
[[ $image_dir == /* && -d $image_dir && ! -L $image_dir && ! -e $backup ]] || block IMAGE_OR_NEW_BACKUP_REQUIRED
[[ $(cat "$image_dir/commit.txt") == "$candidate_sha" ]] || block IMAGE_COMMIT_MISMATCH
image_archive=$image_dir/fosu-oracle-sample-$candidate_sha-arm64.image.tar.gz
image_hash=$(awk -v wanted="$(basename "$image_archive")" '{name=$2; sub(/^.*\//,"",name); if(name==wanted) print $1}' "$image_dir/SHA256SUMS")
[[ $image_hash =~ ^[a-f0-9]{64}$ && -f $image_archive && ! -L $image_archive ]] || block IMAGE_CHECKSUM_REQUIRED
printf '%s  %s\n' "$image_hash" "$image_archive" | sha256sum -c - >/dev/null
phase=MAINTENANCE_GATE
before=$(preflight)
printf '%s' "$before" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(r.status!=="PASS"||r.personalAdmissionPaused!==true)process.exit(2);});'
# This script never pauses/resumes personal admission or the WYZ personal Agent.
phase=BACKUP
mkdir -m 700 -- "$backup"
printf '%s\n' "$before" > "$backup/deploy-before.json"
node - "$backup/operation-context.json" "$app_dir" "$runtime_dir" "$candidate_sha" <<'JS'
const fs=require('fs');fs.writeFileSync(process.argv[2],JSON.stringify({appDir:process.argv[3],runtimeDir:process.argv[4],candidateSha:process.argv[5]}),{mode:0o600});
JS
old_image=$(docker inspect --format '{{.Image}}' fosuclass-api)
docker image inspect "$old_image" >/dev/null
docker image save "$old_image" | gzip -n > "$backup/previous-image.tar.gz"
printf '%s\n' "$old_image" > "$backup/previous-image-id.txt"
for label in working_dir config_files environment_file; do
 file_label=${label//_/-}
 docker inspect --format "{{ index .Config.Labels \"com.docker.compose.project.$label\" }}" fosuclass-api > "$backup/compose-$file_label.txt"
done
# project uses the original Compose label without the project.* suffix.
docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' fosuclass-api > "$backup/compose-project.txt"
mv "$backup/compose-environment-file.txt" "$backup/compose-env-files.txt"
env_source=$(cat "$backup/compose-env-files.txt")
if [[ -z $env_source || $env_source == '<no value>' ]]; then printf '%s/.env\n' "$(cat "$backup/compose-working-dir.txt")" > "$backup/compose-env-files.txt"; fi
IFS=',' read -r -a original_files < "$backup/compose-config-files.txt"
for i in "${!original_files[@]}"; do [[ ${original_files[$i]} == /* && -f ${original_files[$i]} && ! -L ${original_files[$i]} ]]; cp -- "${original_files[$i]}" "$backup/compose-$i.yml"; done
IFS=',' read -r -a env_files < "$backup/compose-env-files.txt"
for i in "${!env_files[@]}"; do [[ ${env_files[$i]} == /* && -f ${env_files[$i]} && ! -L ${env_files[$i]} ]]; cp -- "${env_files[$i]}" "$backup/compose-env-$i.env"; done
cp -- "$app_dir/server/.env" "$backup/previous.env"
trap 'docker unpause fosuclass-api >/dev/null 2>&1 || true' EXIT
docker pause fosuclass-api >/dev/null
tar -czf "$backup/state.tar.gz" -C "$app_dir/server" storage .env
docker unpause fosuclass-api >/dev/null
trap - EXIT
tar -tzf "$backup/state.tar.gz" >/dev/null
printf 'services:\n  fosu-api:\n    image: "%s"\n    pull_policy: never\n    environment:\n      FOSU_DEPLOY_COMMIT_SHA: "%s"\n' "$old_image" "$base_sha" > "$backup/rollback-image.yml"
(cd "$backup"; sha256sum previous-image.tar.gz state.tar.gz previous-image-id.txt previous.env deploy-before.json operation-context.json compose-*.txt compose-*.yml compose-env-*.env rollback-image.yml > SHA256SUMS)
chmod 600 "$backup"/*
phase=LOAD_VERIFIED_IMAGE
docker load -i "$image_archive" > "$backup/candidate-image-load.txt"
image_ref=fosu-oracle-sample:$candidate_sha
[[ $(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_ref") == "$candidate_sha" ]]
[[ $(docker image inspect --format '{{.Architecture}}' "$image_ref") == arm64 ]]
image_id=$(docker image inspect --format '{{.Id}}' "$image_ref")
[[ $image_id == $(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1]))[0].Id' "$image_dir/image-inspect.json") ]]
printf 'services:\n  fosu-api:\n    image: "%s"\n    pull_policy: never\n    environment:\n      FOSU_DEPLOY_COMMIT_SHA: "%s"\n' "$image_id" "$candidate_sha" > "$backup/sample-image.yml"
compose_context
phase=LAST_READ_ONLY_GATE
preflight --compare-before="$backup/deploy-before.json" > "$backup/deploy-recheck.json"
phase=APPROVED_DEPLOY
if ! docker compose "${compose_args[@]}" -f "$backup/sample-image.yml" up -d --no-build --pull never --no-deps fosu-api > "$backup/deploy-compose.log" 2>&1 \
 || ! wait_healthy \
 || ! preflight --verify-after="$candidate_sha" --before="$backup/deploy-before.json" > "$backup/deploy-after.json"; then
 rollback_code || { printf 'FAILED phase=ROLLBACK manual_review=REQUIRED retained=YES\n'; exit 1; }
 printf 'FAILED phase=DEPLOY_ACCEPTANCE rolled_back=YES retained=YES\n'; exit 1
fi
printf 'SUCCESS phase=DEPLOY_ACCEPTANCE schoolRequests=0 publication=NO backup_retained=YES\n'
