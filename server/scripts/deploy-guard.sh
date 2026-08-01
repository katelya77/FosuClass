#!/usr/bin/env bash
# Deploy guard for .github/workflows/deploy-vps.yml (merge-deploy gate).
#
# pre      — runs BEFORE any deploy mutation: timestamped backup of
#            server/storage and .env plus a pre-deploy state record (previous
#            SHA/image, new SHA). Any failure aborts the deploy. Rollback
#            model: `git revert` on main redeploys prior code and static files
#            (the workflow re-syncs them from the repo on every run); what git
#            cannot restore is host data, which is what we tar. Static
#            release/runtime content is a repo mirror and is intentionally not
#            tarred (disk growth without recoverability gain); only the live
#            runtime pointer (active.json) is copied for the record.
# post     — runs ONLY after all health gates passed: records the verified
#            production version markers that the next pre-run reads back.
# diagnose — ERR-trap diagnostics with secret redaction (replaces the former
#            inline on_error); never leaks env values into the Actions log.
# sanitize — stdin/stdout secret-redaction filter used by the deploy script.
set -Eeuo pipefail

ACTION="${1:?usage: deploy-guard.sh pre|post|diagnose|sanitize [APP_DIR] [CONTAINER_NAME] [COMMIT_SHA] [RUNTIME_DIR]}"

__sanitize() {
  sed -E \
    -e 's/(ADMIN_PASSWORD|ADMIN_TOKEN|ADMIN_API_TOKEN|FOSU_PASSWORD|WECHAT_APPSECRET|FOSU_CSRF_SECRET|FOSU_SESSION_SECRET(_CURRENT|_PREVIOUS)?|FOSU_STATIC_TICKET_SECRET(_CURRENT|_PREVIOUS)?|FOSU_AI_CONFIG_ENCRYPTION_KEY|FOSU_AGENT_MEMORY_SECRET|FOSU_AGENT_REMINDER_SECRET|FOSU_WECHAT_RECIPIENT_SECRET|AI_API_KEY|DEEPSEEK_API_KEY|CLOUDBASE_OPENAI_API_KEY|COZE_API_KEY)=([^[:space:]]*)/\1=***/g' \
    -e 's/(Authorization: Bearer )[A-Za-z0-9._~+\/=-]+/\1***/gi' \
    -e 's/(token|password|secret|key)["=: ]+[A-Za-z0-9._\/+=-]+/\1=***/gi'
}

case "$ACTION" in
  sanitize)
    __sanitize
    ;;
  diagnose)
    CONTAINER_NAME="${2:?container name required}"
    echo "::error::Remote deploy failed"
    sudo docker compose ps 2>&1 | __sanitize || true
    sudo docker inspect "$CONTAINER_NAME" --format '{{json .State}}' 2>&1 | __sanitize || true
    sudo docker inspect "$CONTAINER_NAME" --format '{{range .State.Health.Log}}{{println .Output}}{{end}}' 2>&1 | tail -n 10 | __sanitize || true
    sudo docker logs "$CONTAINER_NAME" --tail=200 2>&1 | __sanitize || true
    sudo docker compose logs --tail=200 2>&1 | __sanitize || true
    ss -lntp 2>/dev/null | grep 18318 || true
    ;;
  pre)
    APP_DIR="${2:?app dir required}"
    CONTAINER_NAME="${3:?container name required}"
    COMMIT_SHA="${4:?commit sha required}"
    RUNTIME_DIR="${5:-/opt/1panel/www/sites/class.katelya.eu.org/index/static/runtime}"
    BACKUP_ROOT="$APP_DIR/backups"
    BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$BACKUP_DIR"
    chmod 700 "$BACKUP_ROOT" "$BACKUP_DIR"
    {
      echo "previousDeployedSha=$(head -n 1 "$APP_DIR/server/storage/deployed-sha" 2>/dev/null || true)"
      echo "previousImage=$(sudo docker inspect -f '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
      echo "newCommitSha=$COMMIT_SHA"
      echo "backupAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$BACKUP_DIR/pre-deploy-state.txt"
    # storage subtrees written by the root-owned API container (storage/secure,
    # publisher-receipts) are unreadable to the deploy user; archive via sudo so
    # the backup is complete instead of aborting the deploy (exit 2 from tar).
    sudo tar czf "$BACKUP_DIR/server-storage.tar.gz" -C "$APP_DIR/server" storage
    if [ -f "$APP_DIR/server/.env" ]; then
      sudo cp -a "$APP_DIR/server/.env" "$BACKUP_DIR/env.backup"
      sudo chmod 600 "$BACKUP_DIR/env.backup"
    fi
    if [ -f "$RUNTIME_DIR/active.json" ]; then
      sudo cp -a "$RUNTIME_DIR/active.json" "$BACKUP_DIR/runtime-active.json" || true
    fi
    # Verify the critical archive is readable before allowing the deploy on.
    sudo tar tzf "$BACKUP_DIR/server-storage.tar.gz" > /dev/null
    ln -sfn "$BACKUP_DIR" "$BACKUP_ROOT/latest"
    # Retention: keep the newest 15 backups (symlinks excluded via -type d).
    find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
      | sort -rn | tail -n +16 | cut -d' ' -f2- | xargs -r sudo rm -rf --
    echo "pre_deploy_backup=$BACKUP_DIR"
    ;;
  post)
    APP_DIR="${2:?app dir required}"
    CONTAINER_NAME="${3:?container name required}"
    COMMIT_SHA="${4:?commit sha required}"
    echo "$COMMIT_SHA" > "$APP_DIR/server/storage/deployed-sha"
    sudo docker inspect -f '{{.Image}}' "$CONTAINER_NAME" > "$APP_DIR/server/storage/deployed-image" 2>/dev/null || true
    chmod 600 "$APP_DIR/server/storage/deployed-sha" "$APP_DIR/server/storage/deployed-image" 2>/dev/null || true
    ;;
  *)
    echo "unknown action: $ACTION" >&2
    exit 2
    ;;
esac
