#!/usr/bin/env python3
"""Build a default-denied diagnostic; its launcher supports Python 3.6."""
import argparse
import ast
import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
REVISION = '7e8dfb24b2ce1b1e55313c7fcf9f9ba8edfb249f'
FILES = ['tools/fosu-sync-client/'+name+'.js' for name in ['sync','syncEnv','networkProbe','schoolCasPage','schoolLoginProfile']]+['tools/wyz-schedule-collector/'+name+'.js' for name in ['requestLedger','workerReceipt','browserRuntime','runStore','schoolSession','schoolAuthState','schoolBrowserAdapter','schoolRequestPolicy','schoolPrecheck']]+['shared/syncCacheStore.js','shared/syncPlan.js','shared/syncProvenance.js']
FILES += ['tools/wyz-schedule-collector/'+name+'.js' for name in ['collector','heartbeatRecovery','oracleTransport']]

WRAPPER = r'''
import datetime,hashlib,json,os,pathlib,shutil,stat,subprocess,sys,time
RUN = __RUN__
REVISION = __REVISION__
NODE_SOURCE = __NODE_SOURCE__
LOCK_SOURCE = __LOCK_SOURCE__
PINS = __PINS__
ROOT = pathlib.Path('/root/fosu-resource-diagnostic-'+RUN[8:])
DISPATCHED = False
def denied(code):
 print(json.dumps(dict(status='BLOCKED',code=code,runId=RUN,schoolAccessExecuted='UNKNOWN' if DISPATCHED else False,replayAllowed=False)));raise SystemExit(2)
def private(path,directory=False):
 s=path.lstat()
 if s.st_uid!=0 or s.st_mode&0o077 or stat.S_ISLNK(s.st_mode) or (not stat.S_ISDIR(s.st_mode) if directory else not stat.S_ISREG(s.st_mode) or s.st_nlink!=1):raise ValueError('PRIVATE_PATH_REJECTED')
def save(path,value):
 data=value.encode('utf8') if isinstance(value,str) else json.dumps(value,separators=(',',':')).encode('utf8')
 fd=os.open(str(path),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
def main():
 global DISPATCHED
 if sys.argv[1:]!=['--approve-school-access']:denied('FRESH_TEACHER_DIAGNOSTIC_APPROVAL_REQUIRED')
 if os.name!='posix' or os.geteuid()!=0:denied('LINUX_ROOT_REQUIRED')
 release=pathlib.Path('/opt/fosuclass/schedule-collector/current').resolve()
 if release.name!=REVISION:denied('SCHOOL_RESOURCE_DIAGNOSTIC_SOURCE_CHANGED')
 for digest,relative in PINS:
  p=release/relative
  if p.is_symlink() or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:denied('SCHOOL_RESOURCE_DIAGNOSTIC_SOURCE_CHANGED')
 state=pathlib.Path('/var/lib/fosuclass/schedule-collector');private(state,True)
 runtime=state/'browser-runtime.json'
 if runtime.exists():
  private(runtime)
  if json.loads(runtime.read_text()).get('mode')!='native':denied('SCHOOL_AUTH_NATIVE_BROWSER_REQUIRED')
 # Session/credentials contents are not opened by the launcher.
 # collector.lock belongs to the daemon, not school access. The Worker verifies
 # the live heartbeat process and atomically acquires manual/session locks.
 if ROOT.exists() or ROOT.is_symlink():denied('SCHOOL_RESOURCE_DIAGNOSTIC_ALREADY_RESERVED')
 private(pathlib.Path('/root'),True)
 node=shutil.which('node');systemd=shutil.which('systemd-run');timeout=shutil.which('timeout')
 if not node or not systemd or not timeout:denied('SCHOOL_RESOURCE_DIAGNOSTIC_RUNTIME_MISSING')
 version=subprocess.run([node,'--version'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True,timeout=5)
 if version.returncode!=0 or not version.stdout.startswith(('v20.','v22.','v24.')):denied('SCHOOL_RESOURCE_DIAGNOSTIC_NODE_VERSION')
 ROOT.mkdir(mode=0o700)
 now=datetime.datetime.now(datetime.timezone.utc)
 approval=dict(runId=RUN,approved=True,source='teacher',term='2026-2027-1',requestBudget=40,passwordSubmissionLimit=0,startedAt=now.isoformat(),expiresAt=(now+datetime.timedelta(minutes=10)).isoformat())
 save(ROOT/'approval.json',approval);save(ROOT/'worker.js',NODE_SOURCE);save(ROOT/'source-pins.json',PINS)
 save(ROOT/'resource-diagnostic-locks.js',LOCK_SOURCE)
 check=subprocess.run([node,'--check',str(ROOT/'worker.js')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
 if check.returncode!=0:denied('SCHOOL_RESOURCE_DIAGNOSTIC_SYNTAX_REJECTED')
 unit='fosu-teacher-diagnostic-'+RUN[8:]
 # The unit owns its locks; PAM disconnect cannot release an active Worker lock.
 # Type=simple + GNU timeout also work on older WYZ systemd releases.
 args=[systemd,'--quiet','--unit='+unit,'--property=Type=simple','--property=UMask=0077','--property=StandardOutput=null','--property=StandardError=null',timeout,'--signal=TERM','--kill-after=20s','90s','/usr/bin/env','-i','PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','PLAYWRIGHT_BROWSERS_PATH='+str(state/'browsers'),node,str(ROOT/'worker.js')]
 DISPATCHED=True
 result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
 if result.returncode!=0:denied('SCHOOL_RESOURCE_DIAGNOSTIC_UNIT_START_FAILED')
 deadline=time.monotonic()+115
 while time.monotonic()<deadline:
  file=ROOT/'result.json'
  if file.exists():
   private(file)
   if file.stat().st_size>65536:denied('SCHOOL_RESOURCE_DIAGNOSTIC_RESULT_REJECTED')
   value=json.loads(file.read_text())
   if value.get('schema')!='collector-resource-page-diagnostic.v1' or value.get('runId')!=RUN:denied('SCHOOL_RESOURCE_DIAGNOSTIC_RESULT_REJECTED')
   print(json.dumps(value,ensure_ascii=False));return
  time.sleep(1)
 print(json.dumps(dict(status='BLOCKED',code='SCHOOL_RESOURCE_DIAGNOSTIC_RESULT_PENDING_REVIEW',runId=RUN,unit=unit,schoolAccessExecuted='UNKNOWN',requestOutcome='UNKNOWN',replayAllowed=False)));raise SystemExit(2)
try:main()
except Exception:denied('SCHOOL_RESOURCE_DIAGNOSTIC_LAUNCH_REJECTED')
'''

def build(output,run_id):
 if not re.fullmatch(r'sc-diag-[a-f0-9]{16}',run_id):raise ValueError('DIAGNOSTIC_RUN_ID_REJECTED')
 if run_id=='sc-diag-e756876eaaafb174':raise ValueError('DIAGNOSTIC_RUN_ID_RETIRED')
 source=(ROOT/'deploy/collector-closure/resource-page-diagnostic.js').read_text(encoding='utf8')
 locks=(ROOT/'deploy/collector-closure/resource-diagnostic-locks.js').read_text(encoding='utf8')
 pins=[[hashlib.sha256(subprocess.check_output(['git','show',REVISION+':'+relative],cwd=str(ROOT))).hexdigest(),relative] for relative in FILES]
 wrapper=WRAPPER.replace('__RUN__',repr(run_id)).replace('__REVISION__',repr(REVISION)).replace('__NODE_SOURCE__',repr(source)).replace('__LOCK_SOURCE__',repr(locks)).replace('__PINS__',repr(pins))
 ast.parse(wrapper,feature_version=(3,6))
 body="#!/usr/bin/env bash\nset -Eeuo pipefail\nexec python3 - \"$@\" <<'FOSU_DIAGNOSTIC_PY'\n"+wrapper+"\nFOSU_DIAGNOSTIC_PY\n"
 output=pathlib.Path(output);output.parent.mkdir(parents=True,exist_ok=True)
 if output.exists():raise ValueError('DELIVERY_ALREADY_EXISTS')
 output.write_bytes(body.encode('utf8'))
 return dict(file=str(output.resolve()),sha256=hashlib.sha256(output.read_bytes()).hexdigest(),runId=run_id,source='teacher',requestBudget=40,passwordSubmissionLimit=0,approvalRequired=True,schoolAccessExecuted=False,sourceInstall=False,replayAllowed=False)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);parser.add_argument('--run-id',required=True);args=parser.parse_args()
 print(json.dumps(build(args.out,args.run_id),ensure_ascii=False))
