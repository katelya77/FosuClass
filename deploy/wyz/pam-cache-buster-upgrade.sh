#!/usr/bin/env bash
# Child process only. No school request, password read, retry or auto-rollback.
set -Eeuo pipefail
umask 077
stage=APPROVAL
mutating=0
stop() {
  trap - ERR
  if (( mutating )); then systemctl stop wyz-schedule-collector.service >/dev/null 2>&1 || true; fi
  printf '%s stage=%s code=%s evidence_retained=YES\n' "$1" "$stage" "$2" >&2
  exit "$3"
}
trap 'rc=$?; case $rc in 2) result=BLOCKED;; *) result=FAILED;; esac; stop "$result" "CHILD_EXIT_$rc" "$rc"' ERR
blocked() { stop BLOCKED "$1" 2; }
[[ $EUID == 0 && $# == 1 && $1 == --approve-install ]] || blocked INSTALL_APPROVAL_REQUIRED
base=/opt/fosuclass/schedule-collector
state=/var/lib/fosuclass/schedule-collector
previous=9153876458df7b1dd6b4fae698851638b31c702e
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
stage=PINNED_MANIFEST
mapfile -t fields < <(python3 - <<'PY'
import json,re
from pathlib import Path
m=json.loads(Path('upgrade-candidate.json').read_text())
assert set(m)=={'revision','fromRevision','bundle','sha256'}
assert m['fromRevision']=='9153876458df7b1dd6b4fae698851638b31c702e'
assert re.fullmatch('[a-f0-9]{40}',m['revision']) and re.fullmatch('[a-f0-9]{64}',m['sha256'])
assert m['revision']!=m['fromRevision'] and m['bundle']=='wyz-schedule-collector-'+m['revision']+'.tar.gz'
print(m['revision'])
print(m['sha256'])
PY
)
[[ ${#fields[@]} == 2 ]] || blocked MANIFEST_REJECTED
target=${fields[0]}
stage=CURRENT_REVISION
[[ -L $base/current && ! -L $base && ! -L $state ]] || blocked MANAGED_PATH_REQUIRED
current=$(readlink -f "$base/current")
[[ $current == "$base/releases/$previous" || $current == "$base/releases/$target" ]] || blocked UNEXPECTED_REVISION
stage=PROTECTED_STATE_SNAPSHOT
evidence=$(mktemp -d "$PWD/local-acceptance.XXXXXXXX")
python3 - "$state" > "$evidence/protected-state.before.json" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);v={}
for name in ('school-auth-state.json','session.json','school-credentials.json','checkpoint.json'):
 p=root/name
 if p.exists():
  s=p.lstat();v[name]=[s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid]
 else:v[name]=None
print(json.dumps(v))
PY
if [[ $current == "$base/releases/$previous" ]]; then
  stage=VERIFIED_915_PREDECESSOR
  node - "$current/.install-complete.json" "$previous" <<'JS'
const fs=require('fs'),file=process.argv[2],s=fs.lstatSync(file),r=JSON.parse(fs.readFileSync(file));
if(s.isSymbolicLink()||r.revision!==process.argv[3]||r.bundleSha256!=='2b28122efd8dc93641c429fc311b9cefbfc1509a9f1eae5f5b8a045f2a730199'||r.runtimeVerified!==true)process.exit(2);
JS
  stage=APPROVED_UPGRADE
  [[ ! -e upgrade-attempt.started ]] || blocked PREVIOUS_ATTEMPT_REVIEW_REQUIRED
  (set -C; : > upgrade-attempt.started)
  mutating=1
  bash upgrade-candidate.sh --approve-install
else
  printf 'INSTALLATION_ALREADY_PRESENT revision=%s mode=READ_ONLY reinstall=NO\n' "$target"
fi
stage=SOURCE_ACCEPTANCE
python3 verify-installed-candidate.py
stage=HEARTBEAT_PERSONAL_TIMER
python3 check-heartbeat-service.py --state active --health
stage=ROLLBACK_POINT
[[ -f rollback-backup.path && ! -L rollback-backup.path ]] || blocked BACKUP_RECORD_REQUIRED
backup=$(cat rollback-backup.path)
[[ $backup == "$state"/cas-mobile-backup-* && -d $backup && ! -L $backup ]] || blocked BACKUP_PATH_REJECTED
[[ $(cat "$backup/current.txt") == "$base/releases/$previous" && -d $base/releases/$previous && ! -L $base/releases/$previous ]] || blocked EXACT_915_ROLLBACK_REQUIRED
python3 check-heartbeat-service.py --state active --baseline "$backup/heartbeat-signatures.json"
stage=AUTH_AND_CREDENTIAL_METADATA
fosu-collector auth-state
node - "$base/releases/$target" "$state" <<'JS'
const path=require('path');require(path.join(process.argv[2],'tools/wyz-schedule-collector/protectedSchoolCredentials')).available({dataRoot:process.argv[3]});
console.log('PROTECTED_FILE_METADATA_PASS credentialBytesRead=NO');
JS
python3 - "$state" "$evidence/protected-state.before.json" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);before=json.loads(Path(sys.argv[2]).read_text())
for name,expected in before.items():
 p=root/name
 if p.exists():
  s=p.lstat();actual=[s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid]
 else:actual=None
 assert actual==expected,'PROTECTED_STATE_CHANGED'
print('PROTECTED_STATE_UNCHANGED auth_history=YES session=YES credentials=YES checkpoint=YES')
PY
stage=INSTALLATION_RECEIPT
receipt=$evidence/installation.receipt.json
node "$base/current/tools/wyz-schedule-collector/acceptance.js" installation --candidate-revision="$target" --output="$receipt"
node - "$receipt" <<'JS'
const r=JSON.parse(require('fs').readFileSync(process.argv[2]));if(r.status!=='PASS')process.exit(2);
JS
printf 'INSTALLATION_PASS revision=%s fromRevision=%s schoolRequests=0 timer=DISABLED personal_agent=UNCHANGED rollback_backup=%s\n' "$target" "$previous" "$backup"
