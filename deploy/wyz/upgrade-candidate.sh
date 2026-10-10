#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
gate=APPROVAL
mutation_started=0
unit=wyz-schedule-collector.service
base=/opt/fosuclass/schedule-collector
state=/var/lib/fosuclass/schedule-collector
fail() {
  local code=$1 active recovery=NOT_MUTATED
  trap - ERR
  # Never restart or auto-rollback after a failed gate. Stop only the Collector
  # if this invocation has begun its approved mutation; leave Agent/timer alone.
  if (( mutation_started )); then
    systemctl stop "$unit" >/dev/null 2>&1 || true
    recovery=REVIEWED_ROLLBACK_REQUIRED
  fi
  active=$(systemctl is-active "$unit" 2>/dev/null || true)
  case $active in active|inactive|failed|activating|deactivating) ;; *) active=unknown;; esac
  printf 'INSTALL_FAILED gate=%s exit=%s collector_state=%s recovery=%s\n' "$gate" "$code" "$active" "$recovery" >&2
  exit "$code"
}
trap 'fail "$?"' ERR
[[ $EUID -eq 0 && $# -eq 1 && $1 == --approve-install ]]
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
gate=MANIFEST
[[ -f upgrade-candidate.json && ! -L upgrade-candidate.json ]]
# Only identifiers and the fixed archive basename leave this parser, no shell eval.
metadata=$(python3 - <<'PY'
import json,re
from pathlib import Path
def require(condition):
    if not condition: raise ValueError('MANIFEST_REJECTED')
try:
    p=Path('upgrade-candidate.json')
    require(p.stat().st_size < 4096)
    r=json.loads(p.read_text())
    require(set(r)=={'fromRevision','revision','bundle','sha256'})
    require(all(re.fullmatch('[a-f0-9]{40}',r[k]) for k in ('fromRevision','revision')))
    require(r['bundle']=='wyz-schedule-collector-'+r['revision']+'.tar.gz')
    require(re.fullmatch('[a-f0-9]{64}',r['sha256']))
    require(r['fromRevision']!=r['revision'])
    print('\n'.join(r[k] for k in ('fromRevision','revision','bundle','sha256')))
except Exception:
    raise SystemExit(1)
PY
)
mapfile -t fields <<< "$metadata"
old=${fields[0]} revision=${fields[1]} bundle=${fields[2]} digest=${fields[3]}
gate=SOURCE_INTEGRITY
[[ -f $bundle && ! -L $bundle ]]
printf '%s  %s\n' "$digest" "$bundle" | sha256sum -c -
gate=HELPERS_MATCH_SOURCE
python3 - "$bundle" <<'PY'
import sys,tarfile
from pathlib import Path
def require(condition):
    if not condition: raise ValueError('HELPER_REJECTED')
try:
    with tarfile.open(sys.argv[1],'r:gz') as tar:
        for name in ('upgrade-candidate.sh','check-heartbeat-service.py','install-schedule-collector.sh','recover-release.py'):
            p=Path(name)
            require(p.is_file() and not p.is_symlink())
            matches=[m for m in tar.getmembers() if m.name=='deploy/wyz/'+name]
            require(len(matches)==1 and matches[0].isfile())
            require(p.read_bytes()==tar.extractfile(matches[0]).read())
except Exception:
    raise SystemExit(1)
PY
gate=INSTALL_PATHS
[[ ! -L $base && ! -L $state && -L $base/current && ! -L $base/releases/$old ]]
[[ $(readlink -f "$base/current") == "$base/releases/$old" ]]
gate=UPGRADE_LOCK
[[ ! -L $state/upgrade.lock ]]
exec 8>"$state/upgrade.lock"
flock -n 8
gate=PREFLIGHT_HEARTBEAT
python3 check-heartbeat-service.py --state active
gate=BACKUP
backup=$state/cas-mobile-backup-$(date -u +%Y%m%dT%H%M%SZ)
[[ ! -e $backup && ! -L $backup ]]
install -d -m 700 "$backup"
readlink -f "$base/current" > "$backup/current.txt"
cp -a /etc/systemd/system/wyz-schedule-collector.service "$backup/"
cp -a /etc/systemd/system/wyz-schedule-collector.timer "$backup/"
cp -a /etc/systemd/system/wyz-schedule-collector.service.d "$backup/"
python3 check-heartbeat-service.py --state active --record "$backup/heartbeat-signatures.json"
[[ ! -L rollback-backup.path ]]
printf '%s\n' "$backup" > rollback-backup.path
printf 'BACKUP_PATH=%s\n' "$backup"
gate=STOP_COLLECTOR
mutation_started=1
systemctl stop "$unit" >/dev/null 2>&1
gate=STOPPED_HEARTBEAT
python3 check-heartbeat-service.py --state inactive --baseline "$backup/heartbeat-signatures.json"
gate=INSTALLER
bash install-schedule-collector.sh "$bundle" "$digest"
gate=INSTALLED_REVISION
[[ $(readlink -f "$base/current") == "$base/releases/$revision" ]]
gate=POST_RELOAD_HEARTBEAT
python3 check-heartbeat-service.py --state inactive --baseline "$backup/heartbeat-signatures.json"
gate=START_COLLECTOR
systemctl start "$unit" >/dev/null 2>&1
gate=STARTED_HEALTH
python3 check-heartbeat-service.py --state active --health --baseline "$backup/heartbeat-signatures.json"
gate=CLI_OFFLINE
fosu-collector help
fosu-collector auth-state
gate=FINAL_HEARTBEAT
python3 check-heartbeat-service.py --state active --baseline "$backup/heartbeat-signatures.json"
echo CAS_REPAIR_INSTALL_PASS mode=heartbeat-only school_access_invoked=NO timer=disabled personal_agent=unchanged
