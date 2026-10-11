#!/usr/bin/env bash
# Independent public-page and one-login approvals; never invoked by installer.
set -Eeuo pipefail
umask 077
stage=APPROVAL
trap 'rc=$?; case $rc in 2) result=BLOCKED;; *) result=FAILED;; esac; printf "%s stage=%s child_exit=%s retained=YES\n" "$result" "$stage" "$rc" >&2; exit "$rc"' ERR
blocked() { printf 'BLOCKED stage=%s code=%s retained=YES\n' "$stage" "$1"; exit 2; }
[[ $EUID == 0 && $# -ge 1 && $# -le 2 ]] || blocked ROOT_AND_APPROVAL_REQUIRED
mode=$1
[[ $mode == --approve-public-cas && $# == 1 || $mode == --approve-session && $# == 2 ]] || blocked SEPARATE_APPROVAL_REQUIRED
public_evidence=${2:-NONE}
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
base=/opt/fosuclass/schedule-collector
state=/var/lib/fosuclass/schedule-collector
stage=INSTALLED_SOURCE
python3 verify-installed-candidate.py
target=$(python3 -c 'import json;print(json.load(open("upgrade-candidate.json"))["revision"])')
accept=$base/current/tools/wyz-schedule-collector/acceptance.js
export PLAYWRIGHT_BROWSERS_PATH=$state/browsers
stage=LOCAL_BUDGET_AND_METADATA
evidence=$(mktemp -d "$PWD/cas-gate.XXXXXXXX")
fosu-collector auth-state | tee "$evidence/auth-before.json"
node - "$base/current" "$state" <<'JS'
require(require('path').join(process.argv[2],'tools/wyz-schedule-collector/protectedSchoolCredentials')).available({dataRoot:process.argv[3]});
console.log('PROTECTED_FILE_METADATA_PASS credentialBytesRead=NO');
JS
acknowledge=$(node - "$evidence/auth-before.json" <<'JS'
const s=JSON.parse(require('fs').readFileSync(process.argv[2]));
if(s.status!=='LOCAL_AUTH_STATE'||s.dailyLimit!==2||!Number.isInteger(s.dailyBudgetUsed)||s.dailyBudgetUsed<0||s.dailyBudgetUsed>=2||s.cooldownRemainingSeconds!==0)process.exit(2);
if(s.blocked===true){if(s.failureCategory!=='local_preflight'||!['SCHOOL_LOGIN_PRECHECK_REQUEST_REJECTED','SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED'].includes(s.lastFailureCode))process.exit(2);console.log('--acknowledge-auth-failure');}
else if(s.blocked===false)console.log('NONE');else process.exit(2);
JS
)
if [[ $mode == --approve-public-cas ]]; then
  stage=PUBLIC_CAS_ONLY
  python3 - "$state" > "$evidence/private-metadata.json" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);v={}
for name in ('school-auth-state.json','session.json','school-credentials.json'):
 p=root/name;v[name]=list((p.lstat().st_ino,p.stat().st_size,p.stat().st_mtime_ns,p.stat().st_ctime_ns)) if p.exists() else None
print(json.dumps(v))
PY
  if fosu-collector diagnose-login --login-profile=mobile --approve-school-access > "$evidence/public-cas.jsonl" 2>&1; then
    cat "$evidence/public-cas.jsonl"
  else
    cat "$evidence/public-cas.jsonl"; blocked PUBLIC_CAS_STOPPED_NO_LOGIN
  fi
  python3 - "$state" "$evidence/private-metadata.json" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);v=json.loads(Path(sys.argv[2]).read_text())
for name,before in v.items():
 p=root/name;after=list((p.lstat().st_ino,p.stat().st_size,p.stat().st_mtime_ns,p.stat().st_ctime_ns)) if p.exists() else None
 assert before==after
PY
  node "$accept" record --stage=public-cas --source=wyz-school --attest-live --candidate-revision="$target" --input="$evidence/public-cas.jsonl" --output="$evidence/public-cas.receipt.json"
  node - "$evidence/public-cas.receipt.json" <<'JS'
if(JSON.parse(require('fs').readFileSync(process.argv[2])).status!=='PASS')process.exit(2);
JS
  printf 'CAS_PUBLIC_PASS passwordSubmissions=0 evidence=%s next=SEPARATE_LOGIN_APPROVAL\n' "$evidence"
  exit 0
fi
stage=FRESH_PUBLIC_RECEIPT
[[ $public_evidence == "$PWD"/cas-gate.* && -d $public_evidence && ! -L $public_evidence ]] || blocked PUBLIC_RECEIPT_REQUIRED
node - "$public_evidence/public-cas.receipt.json" "$target" <<'JS'
const fs=require('fs'),file=process.argv[2],s=fs.lstatSync(file),r=JSON.parse(fs.readFileSync(file));
if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)||r.status!=='PASS'||r.candidateRevision!==process.argv[3]||Date.now()-s.mtimeMs>15*60*1000||s.mtimeMs>Date.now()+30000)process.exit(2);
JS
stage=ONE_PROTECTED_FILE_LOGIN
args=(login --login-profile=mobile --credential-source=protected-file --approve-school-access)
[[ $acknowledge == NONE ]] || args+=("$acknowledge")
if fosu-collector "${args[@]}" > "$evidence/session.jsonl" 2>&1; then
  cat "$evidence/session.jsonl"
else
  cat "$evidence/session.jsonl"; blocked LOGIN_STOPPED_NO_RETRY
fi
outcome=$(node - "$evidence/session.jsonl" <<'JS'
const fs=require('fs'),rows=fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const r=rows.findLast(row=>['SESSION_SAVED','SESSION_REUSED','SESSION_EXPIRED'].includes(row.status));
if(!r||r.status==='SESSION_EXPIRED'||r.status==='SESSION_SAVED'&&r.sessionChanged!==true)process.exit(2);console.log(r.status);
JS
)
stage=PROTECTED_SESSION_CHECK
node "$accept" session-check --approve-school-read --output="$evidence/session-check.json"
node - "$evidence/session-check.json" <<'JS'
if(JSON.parse(require('fs').readFileSync(process.argv[2])).status!=='SESSION_VALID')process.exit(2);
JS
if [[ $outcome == SESSION_SAVED ]]; then
  node "$accept" record --stage=session --source=wyz-school --attest-live --candidate-revision="$target" --input="$evidence/session.jsonl" --session-check="$evidence/session-check.json" --output="$evidence/session.receipt.json"
  node - "$evidence/session.receipt.json" <<'JS'
if(JSON.parse(require('fs').readFileSync(process.argv[2])).status!=='PASS')process.exit(2);
JS
fi
python3 check-heartbeat-service.py --state active
fosu-collector auth-state
printf '%s_AND_VERIFIED evidence=%s retry=NO sample=NO timer=DISABLED\n' "$outcome" "$evidence"
