"""Execute the paste wrapper in a private Linux fixture using the original CI ZIP.

No production paths, service writes, school traffic or passwords are used.
"""
import argparse, hashlib, io, json, os, pathlib, shutil, subprocess, sys, tarfile, tempfile, unittest, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
TARGET='9153876458df7b1dd6b4fae698851638b31c702e'
PREVIOUS='215f7e54ee08bcf1a9478e8f4d81b9fcff364a5a'
ZIP_SHA='38b6e3770cd4ee1a91087e979ec8c8c5a42d6245b5f98e1b1eec7a32735b7eae'
SOURCE_SHA='2b28122efd8dc93641c429fc311b9cefbfc1509a9f1eae5f5b8a045f2a730199'
ARGS=None
class PasteTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='fosu-pam-915-');self.root=pathlib.Path(self.temp.name)
  self.base=self.root/'base';self.state=self.root/'state';self.bin=self.root/'bin';self.bin.mkdir()
  self.state.mkdir(mode=0o700);self.log=self.root/'commands.log';self.zip=self.root/'candidate.zip'
  self.zip.write_bytes(pathlib.Path(ARGS.zip).read_bytes());self.assertEqual(hashlib.sha256(self.zip.read_bytes()).hexdigest(),ZIP_SHA)
  self.target=self.base/'releases'/TARGET;self.target.mkdir(parents=True)
  previous=self.base/'releases'/PREVIOUS;previous.mkdir()
  with zipfile.ZipFile(self.zip) as z:
   name=[n for n in z.namelist() if pathlib.PurePosixPath(n).name=='wyz-schedule-collector-'+TARGET+'.tar.gz'][0]
   source=z.read(name);self.assertEqual(hashlib.sha256(source).hexdigest(),SOURCE_SHA)
  with tarfile.open(fileobj=io.BytesIO(source),mode='r:gz') as t:
   for m in t.getmembers():
    self.assertFalse(m.name.startswith('/') or '..' in pathlib.PurePosixPath(m.name).parts)
    p=self.target/m.name
    if m.isdir():p.mkdir(parents=True,exist_ok=True)
    else:
     self.assertTrue(m.isfile());p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(t.extractfile(m).read())
  (self.target/'.install-complete.json').write_text(json.dumps(dict(revision=TARGET,bundleSha256=SOURCE_SHA,runtimeVerified=True)))
  (self.base/'current').symlink_to(self.target)
  self.backup=self.state/'cas-mobile-backup-fixture';self.backup.mkdir()
  (self.backup/'current.txt').write_text(str(previous)+'\n');(self.backup/'heartbeat-signatures.json').write_text('{}')
  self.record=self.root/'rollback-backup.path';self.record.write_text(str(self.backup)+'\n')
  self.auth=self.state/'school-auth-state.json';self.auth.write_text('{"blocked":true,"dailyBudgetUsed":1,"cooldown":0}')
  self.credential=self.state/'school-credentials.json';self.credential.write_text('{}');self.credential.chmod(0o600)
  original=(ROOT/'deploy/wyz/pam-915-install-or-accept.sh').read_text()
  script=original.replace('/root/heartbeat-upgrade-$target.zip',str(self.zip)).replace('base=/opt/fosuclass/schedule-collector','base='+str(self.base)).replace('state=/var/lib/fosuclass/schedule-collector','state='+str(self.state)).replace('/root/fosu-cas-91538764/normalized-candidate/rollback-backup.path',str(self.record)).replace('/root/fosu-session-915.XXXXXXXX',str(self.root/'evidence.XXXXXXXX'))
  self.script=self.root/'paste.sh';self.script.write_text(script)
  stub=self.bin/'python3';stub.write_text('#!'+sys.executable+'\nimport os,sys\nfrom pathlib import Path\nif len(sys.argv)>1 and sys.argv[1].endswith("check-heartbeat-service.py"):\n with open(os.environ["FIXTURE_LOG"],"a") as f:f.write("heartbeat-read-only\\n")\n print("HEARTBEAT_GATE_PASS fixture=YES")\nelse:os.execv(sys.executable,[sys.executable,*sys.argv[1:]])\n');stub.chmod(0o700)
  stub=self.bin/'fosu-collector';stub.write_text('#!/usr/bin/env bash\n[[ $1 == auth-state ]] || exit 9\nprintf "auth-state-read-only\\n" >> "$FIXTURE_LOG"\nprintf \'{"status":"LOCAL_AUTH_STATE","blocked":true,"dailyBudgetUsed":1,"schoolRequests":0}\\n\'\n');stub.chmod(0o700)
  stub=self.bin/'node';stub.write_text('#!/usr/bin/env bash\nprintf "node-metadata-only\\n" >> "$FIXTURE_LOG"\nexec '+shutil.which('node')+' "$@"\n');stub.chmod(0o700)
  self.env={**os.environ,'PATH':str(self.bin)+':'+os.environ['PATH'],'FIXTURE_LOG':str(self.log)}
 def tearDown(self):self.temp.cleanup()
 def execute(self,*args):
  before=self.auth.read_bytes(),self.credential.read_bytes(),(self.target/'.install-complete.json').read_bytes()
  result=subprocess.run(['bash','-eu','-c','bash "$1" "${@:2}"; printf "PARENT_SURVIVED\\n"','fixture',str(self.script),*args],env=self.env,text=True,capture_output=True)
  self.assertEqual(result.returncode,0,result.stderr);self.assertIn('PARENT_SURVIVED',result.stdout)
  self.assertEqual(before,(self.auth.read_bytes(),self.credential.read_bytes(),(self.target/'.install-complete.json').read_bytes()))
  return result
 def test_installed_target_accepts_without_installer_or_mutations(self):
  r=self.execute();self.assertIn('SUCCESS stage=ACCEPT_915',r.stdout);self.assertIn('credentialBytesRead',r.stdout)
  self.assertEqual(self.log.read_text().splitlines(),['heartbeat-read-only','heartbeat-read-only','auth-state-read-only','node-metadata-only'])
 def test_approve_flag_does_not_reinstall_target(self):
  r=self.execute('--approve-install');self.assertIn('reinstall=NO',r.stdout);self.assertNotIn('APPROVED_INSTALL',r.stdout)
 def test_previous_requires_independent_install_approval(self):
  (self.base/'current').unlink();(self.base/'current').symlink_to(self.base/'releases'/PREVIOUS)
  r=self.execute();self.assertIn('INSTALL_APPROVAL_REQUIRED',r.stdout);self.assertFalse(self.log.exists())
 def test_corrupt_source_preserves_shell_and_field_evidence(self):
  p=self.target/'tools/wyz-schedule-collector/cli.js';p.write_text('corrupted fixture')
  r=self.execute();self.assertIn('FAILED stage=READ_ONLY_SOURCE_ACCEPTANCE',r.stderr);self.assertFalse(self.log.exists());self.assertTrue(self.backup.exists())
 def test_bad_zip_is_never_extracted(self):
  self.zip.write_bytes(b'broken fixture');r=self.execute();self.assertIn('FAILED stage=VERIFY_DELIVERY',r.stderr);self.assertFalse(self.log.exists())
 def test_invalid_credential_permissions_block_without_content_read(self):
  self.credential.chmod(0o644);r=self.execute();self.assertIn('PROTECTED_FILE_METADATA_REJECTED',r.stdout);self.assertIn('BLOCKED stage=AUTH_AND_CREDENTIAL_METADATA',r.stderr)
 def session_stubs(self,**changes):
  # Only service observation, login and protected-page traffic are fixtures.
  # The fixed original ZIP/source, POSIX metadata, Bash and receipt evaluator
  # execute for real. Fixture results must never be called school acceptance.
  state=dict(status='LOCAL_AUTH_STATE',blocked=True,dailyBudgetUsed=1,dailyLimit=2,cooldownRemainingSeconds=0,lastFailureCode='SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED',failureCategory='local_preflight')
  state.update(changes.pop('state',{}))
  self.env.update(FIXTURE_AUTH=json.dumps(state),FIXTURE_DIAG=changes.get('diag','ready'),FIXTURE_OUTCOME=changes.get('outcome','SESSION_SAVED'),FIXTURE_VALIDITY=changes.get('validity','SESSION_VALID'),FIXTURE_TARGET=TARGET)
  stub=self.bin/'fosu-collector';stub.write_text('#!'+sys.executable+'\n'+'''import json,os,sys
from pathlib import Path
command=sys.argv[1]
with open(os.environ['FIXTURE_LOG'],'a') as f:f.write(command+' '+ ' '.join(sys.argv[2:])+'\\n')
if command=='auth-state':print(os.environ['FIXTURE_AUTH'])
elif command=='diagnose-login':
 if os.environ['FIXTURE_DIAG']=='failed':print(json.dumps(dict(status='failed',code='SCHOOL_SECURITY_CHALLENGE')));sys.exit(1)
 print(json.dumps(dict(status='CAS_PUBLIC_FORM_READY',formReady=True,loginReady=os.environ['FIXTURE_DIAG']=='ready',networkCompatibility='COMPATIBLE',requiredInitializationComplete=True,backgroundPostsBlocked=0,noncriticalPostsBlocked=0,passwordSubmissions=0,authHistoryChanged=False,credentialsRead=False,sessionSaved=False)))
elif command=='login':
 outcome=os.environ['FIXTURE_OUTCOME']
 if outcome=='failed':print(json.dumps(dict(status='failed',code='INVALID_CREDENTIALS')));sys.exit(1)
 print(json.dumps(dict(status=outcome,schoolLoginAttempts=1 if outcome=='SESSION_SAVED' else 0,sessionChanged=outcome=='SESSION_SAVED',passwordPersisted=False)))
else:sys.exit(9)
''');stub.chmod(0o700)
  real_node=shutil.which('node');stub=self.bin/'node';stub.write_text('#!'+sys.executable+'\n'+'''import datetime,json,os,sys
from pathlib import Path
if len(sys.argv)>2 and sys.argv[1].endswith('/acceptance.js') and sys.argv[2] in ['installation','session-check']:
 command=sys.argv[2];output=[v.split('=',1)[1] for v in sys.argv if v.startswith('--output=')][0]
 result=dict(status='PASS',stage='installation') if command=='installation' else dict(schema='collector-session-validity.v1',status=os.environ['FIXTURE_VALIDITY'],source='wyz-school',liveAttested=True,checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),installedRevision=os.environ['FIXTURE_TARGET'],checkMethod='protected-page',schoolLoginAttempts=0,sessionChanged=False,credentialsRead=False,authHistoryChanged=False)
 with open(output,'x') as f:json.dump(result,f)
 os.chmod(output,0o600);print(json.dumps(result));sys.exit(0)
os.execv('''+repr(real_node)+''',['node',*sys.argv[1:]])
''');stub.chmod(0o700)
 def login_commands(self):return [line for line in self.log.read_text().splitlines() if line.startswith('login ')]
 def test_approved_session_runs_once_and_pairs_real_evaluator_receipts(self):
  self.session_stubs();r=self.execute('--approve-session');self.assertIn('SUCCESS stage=SESSION_SAVED',r.stdout)
  self.assertEqual(len(self.login_commands()),1);self.assertIn('--credential-source=protected-file',self.login_commands()[0]);self.assertIn('--acknowledge-auth-failure',self.login_commands()[0])
  receipt=list(self.root.glob('evidence.*/session.receipt.json'));self.assertEqual(len(receipt),1);self.assertEqual(json.loads(receipt[0].read_text())['status'],'PASS')
 def test_public_error_stops_before_login(self):
  self.session_stubs(diag='failed');r=self.execute('--approve-session');self.assertIn('PUBLIC_CAS_STOPPED_NO_LOGIN',r.stdout);self.assertEqual(self.login_commands(),[])
 def test_incomplete_public_result_stops_even_with_zero_exit(self):
  self.session_stubs(diag='not-ready');r=self.execute('--approve-session');self.assertIn('CAS_REQUIRED_INITIALIZATION_UNVERIFIED',r.stdout);self.assertEqual(self.login_commands(),[])
 def test_budget_and_cooldown_each_stop_before_login(self):
  for state in [dict(dailyBudgetUsed=2),dict(cooldownRemainingSeconds=30)]:
   with self.subTest(state=state):
    self.session_stubs(state=state);r=self.execute('--approve-session');self.assertIn('BLOCKED stage=AUTH_BUDGET',r.stderr);self.assertEqual(self.login_commands(),[])
 def test_new_unknown_blocked_reason_is_not_acknowledged(self):
  self.session_stubs(state=dict(lastFailureCode='INVALID_CREDENTIALS'));r=self.execute('--approve-session');self.assertIn('BLOCKED stage=AUTH_BUDGET',r.stderr);self.assertEqual(self.login_commands(),[])
 def test_login_failure_does_not_retry(self):
  self.session_stubs(outcome='failed');r=self.execute('--approve-session');self.assertIn('LOGIN_STOPPED_NO_RETRY',r.stdout);self.assertEqual(len(self.login_commands()),1)
 def test_reused_session_never_becomes_saved_receipt(self):
  self.session_stubs(outcome='SESSION_REUSED',state=dict(blocked=False));r=self.execute('--approve-session');self.assertIn('SUCCESS stage=SESSION_REUSED',r.stdout);self.assertNotIn('--acknowledge-auth-failure',self.login_commands()[0]);self.assertEqual(list(self.root.glob('evidence.*/session.receipt.json')),[])
 def test_expired_protected_session_blocks_saved_receipt(self):
  self.session_stubs(validity='SESSION_EXPIRED');r=self.execute('--approve-session');self.assertIn('BLOCKED stage=PROTECTED_SESSION_CHECK',r.stderr);self.assertEqual(len(self.login_commands()),1);self.assertEqual(list(self.root.glob('evidence.*/session.receipt.json')),[])
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--zip',required=True);ARGS,rest=p.parse_known_args()
 if os.name!='posix' or os.geteuid()!=0:raise SystemExit('LINUX_ROOT_REQUIRED; do not describe this as PASS')
 unittest.main(argv=[sys.argv[0],*rest])
