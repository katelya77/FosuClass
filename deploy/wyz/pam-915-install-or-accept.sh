#!/usr/bin/env bash
# Paste the entire file, or run it with Bash. Parent errexit/nounset remain safe.
if bash -s -- "$@" <<'PAM_915'
set -Eeuo pipefail
umask 077
stage=PRECHECK
trap 'rc=$?; case $rc in 2) status=BLOCKED;; *) status=FAILED;; esac; printf "%s stage=%s exit=%s retained=YES\n" "$status" "$stage" "$rc" >&2; exit "$rc"' ERR
blocked() { printf 'BLOCKED stage=%s code=%s retained=YES\n' "$stage" "$1"; exit 2; }
mode=${1:-accept}
[[ $# -le 1 && ( $mode == accept || $mode == --approve-install || $mode == --approve-session ) ]] || blocked ARGUMENT_REJECTED
[[ $EUID -eq 0 ]] || blocked ROOT_REQUIRED
target=9153876458df7b1dd6b4fae698851638b31c702e
previous=215f7e54ee08bcf1a9478e8f4d81b9fcff364a5a
zip=/root/heartbeat-upgrade-$target.zip
zip_sha=38b6e3770cd4ee1a91087e979ec8c8c5a42d6245b5f98e1b1eec7a32735b7eae
source_sha=2b28122efd8dc93641c429fc311b9cefbfc1509a9f1eae5f5b8a045f2a730199
base=/opt/fosuclass/schedule-collector
state=/var/lib/fosuclass/schedule-collector
backup_record=/root/fosu-cas-91538764/normalized-candidate/rollback-backup.path
[[ -L $base/current && ! -L $base && ! -L $state && -f $zip && ! -L $zip ]] || blocked MANAGED_PATH_REQUIRED
current=$(readlink -f "$base/current")
[[ $current == "$base/releases/$target" || $current == "$base/releases/$previous" ]] || blocked UNEXPECTED_REVISION
stage=VERIFY_DELIVERY
printf '%s  %s\n' "$zip_sha" "$zip" | sha256sum -c -
python3 - "$zip" "$target" "$previous" "$source_sha" <<'PY'
import hashlib, json, sys, zipfile
from pathlib import PurePosixPath
with zipfile.ZipFile(sys.argv[1]) as z:
    names=z.namelist()
    assert len(names)==len(set(names)) and len(names)<60
    assert all('..' not in PurePosixPath(n).parts and not n.startswith('/') for n in names)
    def item(name):
        found=[n for n in names if PurePosixPath(n).name==name]
        assert len(found)==1
        return z.read(found[0])
    m=json.loads(item('upgrade-candidate.json'))
    assert m==dict(fromRevision=sys.argv[3],revision=sys.argv[2],bundle='wyz-schedule-collector-'+sys.argv[2]+'.tar.gz',sha256=sys.argv[4])
    assert hashlib.sha256(item(m['bundle'])).hexdigest()==sys.argv[4]
print('SUCCESS stage=VERIFY_DELIVERY source=FIXED_915')
PY
if [[ $current == "$base/releases/$previous" ]]; then
  [[ $mode != --approve-session ]] || blocked TARGET_INSTALLATION_REQUIRED
  stage=INSTALL_APPROVAL
  [[ $mode == --approve-install ]] || blocked INSTALL_APPROVAL_REQUIRED
  stage=PRIVATE_WORKDIR
  work=$(mktemp -d /root/fosu-pam-915.XXXXXXXX)
  backup_record=$work/normalized-candidate/rollback-backup.path
  printf 'WORKDIR=%s retained=YES\n' "$work"
  python3 - "$zip" "$work/unpack-candidate.py" <<'PY'
import os, sys, zipfile
from pathlib import PurePosixPath
with zipfile.ZipFile(sys.argv[1]) as z:
    matches=[n for n in z.namelist() if PurePosixPath(n).name=='unpack-candidate.py']
    assert len(matches)==1
    with open(sys.argv[2],'xb') as f: f.write(z.read(matches[0]))
os.chmod(sys.argv[2],0o600)
PY
  stage=EXTRACT_VERIFIED_HELPER
  python3 "$work/unpack-candidate.py" "$zip" "$zip_sha" "$work/normalized-candidate"
  cd "$work/normalized-candidate"
  stage=SOURCE_CHECKSUM
  sha256sum -c source.sha256
  stage=APPROVED_INSTALL
  bash upgrade-candidate.sh --approve-install
  current=$(readlink -f "$base/current")
  [[ $current == "$base/releases/$target" ]] || blocked INSTALLED_REVISION_MISMATCH
fi
stage=READ_ONLY_SOURCE_ACCEPTANCE
# Already installed: no extraction, installer, restart, npm or receipt rewrite.
python3 - "$zip" "$current" "$source_sha" "$target" <<'PY'
import hashlib, io, json, sys, tarfile, zipfile
from pathlib import Path, PurePosixPath
root=Path(sys.argv[2])
receipt=json.loads((root/'.install-complete.json').read_text())
assert receipt['revision']==sys.argv[4] and receipt['bundleSha256']==sys.argv[3] and receipt['runtimeVerified'] is True
with zipfile.ZipFile(sys.argv[1]) as z:
    name='wyz-schedule-collector-'+sys.argv[4]+'.tar.gz'
    matches=[n for n in z.namelist() if PurePosixPath(n).name==name]
    assert len(matches)==1
    source=z.read(matches[0]); assert hashlib.sha256(source).hexdigest()==sys.argv[3]
with tarfile.open(fileobj=io.BytesIO(source),mode='r:gz') as tar:
    members=tar.getmembers(); assert len(members)==len(set(m.name for m in members))
    checked=0
    for member in members:
        assert '..' not in PurePosixPath(member.name).parts and not member.name.startswith('/')
        if member.isdir(): continue
        assert member.isfile()
        file=root/member.name
        assert file.is_file() and all(not p.is_symlink() for p in [file,*file.parents] if p==root or root in p.parents)
        assert hashlib.sha256(file.read_bytes()).digest()==hashlib.sha256(tar.extractfile(member).read()).digest()
        checked+=1
    assert checked==425
print('SUCCESS stage=READ_ONLY_SOURCE_ACCEPTANCE files=425 reinstall=NO')
PY
stage=HEARTBEAT_PERSONAL_TIMER
python3 "$current/deploy/wyz/check-heartbeat-service.py" --state active --health
stage=ROLLBACK_BACKUP
[[ -f $backup_record && ! -L $backup_record ]] || blocked BACKUP_RECORD_REQUIRED
backup=$(cat "$backup_record")
[[ $backup == "$state"/cas-mobile-backup-* && -d $backup && ! -L $backup ]] || blocked BACKUP_PATH_REJECTED
[[ $(cat "$backup/current.txt") == "$base/releases/$previous" && -f $backup/heartbeat-signatures.json && -d $base/releases/$previous ]] || blocked PREVIOUS_ROLLBACK_POINT_REQUIRED
python3 "$current/deploy/wyz/check-heartbeat-service.py" --state active --baseline "$backup/heartbeat-signatures.json"
printf 'SUCCESS stage=ROLLBACK_BACKUP previous=215 retained=YES\n'
stage=AUTH_AND_CREDENTIAL_METADATA
fosu-collector auth-state
node - "$current" "$state" <<'JS'
const path=require('path'),root=process.argv[2],dataRoot=process.argv[3];
try { require(path.join(root,'tools/wyz-schedule-collector/protectedSchoolCredentials')).available({dataRoot}); console.log(JSON.stringify({status:'PROTECTED_FILE_METADATA_PASS',credentialBytesRead:false,schoolRequests:0})); }
catch (_) { console.log(JSON.stringify({status:'BLOCKED',stage:'AUTH_AND_CREDENTIAL_METADATA',code:'PROTECTED_FILE_METADATA_REJECTED',credentialBytesRead:false,schoolRequests:0})); process.exitCode=2; }
JS
printf 'SUCCESS stage=ACCEPT_915 mode=READ_ONLY schoolRequests=0 oracleRequests=0 reinstalled=NO\n'
if [[ $mode == --approve-session ]]; then
  # This flag requires separate approval for public diagnosis and one login.
  # It does not approve Sample, Oracle deployment, timers or publication.
  stage=PRIVATE_SESSION_EVIDENCE
  evidence=$(mktemp -d /root/fosu-session-915.XXXXXXXX)
  printf 'EVIDENCE_DIR=%s retained=YES\n' "$evidence"
  accept=$current/tools/wyz-schedule-collector/acceptance.js
  export PLAYWRIGHT_BROWSERS_PATH=$state/browsers
  node "$accept" installation --candidate-revision="$target" --output="$evidence/installation.receipt.json"
  stage=PUBLIC_CAS
  auth_before=$(sha256sum "$state/school-auth-state.json")
  if fosu-collector diagnose-login --login-profile=mobile --approve-school-access > "$evidence/public-cas.jsonl" 2>&1; then
    cat "$evidence/public-cas.jsonl"
  else
    cat "$evidence/public-cas.jsonl"
    blocked PUBLIC_CAS_STOPPED_NO_LOGIN
  fi
  [[ $(sha256sum "$state/school-auth-state.json") == "$auth_before" ]] || blocked PUBLIC_AUTH_HISTORY_CHANGED
  node "$accept" record --stage=public-cas --source=wyz-school --attest-live --candidate-revision="$target" --input="$evidence/public-cas.jsonl" --output="$evidence/public-cas.receipt.json"
  stage=AUTH_BUDGET
  fosu-collector auth-state | tee "$evidence/auth-before.json"
  acknowledge=$(node - "$evidence/auth-before.json" <<'JS'
const fs=require('fs'),s=JSON.parse(fs.readFileSync(process.argv[2]));
if(s.status!=='LOCAL_AUTH_STATE'||s.dailyLimit!==2||!Number.isInteger(s.dailyBudgetUsed)||s.dailyBudgetUsed<0||s.dailyBudgetUsed>=2||s.cooldownRemainingSeconds!==0)process.exit(2);
if(s.blocked===true){if(s.lastFailureCode!=='SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED'||s.failureCategory!=='local_preflight')process.exit(2);console.log('--acknowledge-auth-failure');}
else if(s.blocked===false)console.log('NONE');else process.exit(2);
JS
  )
  args=(login --login-profile=mobile --credential-source=protected-file --approve-school-access)
  [[ $acknowledge == NONE ]] || args+=("$acknowledge")
  stage=ONE_PROTECTED_FILE_LOGIN
  if fosu-collector "${args[@]}" > "$evidence/session.jsonl" 2>&1; then
    cat "$evidence/session.jsonl"
  else
    cat "$evidence/session.jsonl"
    fosu-collector auth-state
    blocked LOGIN_STOPPED_NO_RETRY
  fi
  outcome=$(node - "$evidence/session.jsonl" <<'JS'
const fs=require('fs');let out;
for(const line of fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/)){try{const s=JSON.parse(line);if(['SESSION_SAVED','SESSION_REUSED','SESSION_EXPIRED'].includes(s.status))out=s.status;}catch{}}
if(!out)process.exit(2);console.log(out);
JS
  )
  [[ $outcome != SESSION_EXPIRED ]] || blocked SESSION_EXPIRED
  stage=PROTECTED_SESSION_CHECK
  node "$accept" session-check --approve-school-read --output="$evidence/session-initial-check.json"
  node - "$evidence/session-initial-check.json" <<'JS'
const s=JSON.parse(require('fs').readFileSync(process.argv[2]));if(s.status!=='SESSION_VALID')process.exit(2);
JS
  if [[ $outcome == SESSION_SAVED ]]; then
    stage=SESSION_SAVED_RECEIPT
    node "$accept" record --stage=session --source=wyz-school --attest-live --candidate-revision="$target" --input="$evidence/session.jsonl" --session-check="$evidence/session-initial-check.json" --output="$evidence/session.receipt.json"
  fi
  stage=FINAL_SERVICE_BOUNDARY
  python3 "$current/deploy/wyz/check-heartbeat-service.py" --state active --baseline "$backup/heartbeat-signatures.json"
  fosu-collector auth-state
  printf 'SUCCESS stage=%s protectedPage=VERIFIED retry=NO sample=NO timer=DISABLED evidence_retained=YES\n' "$outcome"
fi
PAM_915
then
  printf 'PAM_CHILD_SUCCESS interactive_shell_retained=YES\n'
else
  printf 'PAM_CHILD_STOPPED interactive_shell_retained=YES inspect_last_stage=YES\n'
fi
