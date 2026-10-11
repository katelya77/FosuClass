"""Real Bash orchestration against isolated Docker/preflight fixtures, no network."""
import gzip, hashlib, json, os, pathlib, shutil, subprocess, sys, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
SHA='b'*40
DOCKER=r'''import json,os,sys
from pathlib import Path
a=sys.argv[1:];p=Path(os.environ['FIXTURE_DOCKER']);s=json.loads(p.read_text());fault=os.environ.get('FIXTURE_FAULT','')
with open(os.environ['FIXTURE_LOG'],'a') as f:f.write('docker '+a[0]+'\n')
if a[0]=='compose':
 rollback=any(x.endswith('rollback-image.yml') for x in a)
 s['image']='old-image' if rollback else 'new-image';p.write_text(json.dumps(s))
 if fault=='compose' and not rollback:sys.exit(1)
 print('fixture compose');sys.exit(0)
if a[0] in ('pause','unpause','load'):print('fixture '+a[0]);sys.exit(0)
if a[:2]==['image','save']:print('fixture previous image');sys.exit(0)
if a[:2]==['image','inspect']:
 if '--format' not in a:print('[{}]');sys.exit(0)
 f=a[a.index('--format')+1]
 print('amd64' if fault=='arch' else 'arm64') if 'Architecture' in f else print('sha256:'+'c'*64) if '.Id' in f else print('b'*40)
 sys.exit(0)
if a[0]=='inspect':
 f=a[a.index('--format')+1]
 if '.Image' in f:print(s['image'])
 elif 'Health.Status' in f:print('healthy')
 elif 'working_dir' in f:print(s['project'])
 elif 'config_files' in f:print(s['project']+'/compose.yml')
 elif 'environment_file' in f:print(s['project']+'/.env')
 else:print('fixture-project')
 sys.exit(0)
sys.exit(9)
'''
PREFLIGHT=r'''const fs=require('fs');const s=JSON.parse(fs.readFileSync(process.env.FIXTURE_DOCKER));const args=process.argv.slice(2);const fault=process.env.FIXTURE_FAULT;fs.appendFileSync(process.env.FIXTURE_LOG,'preflight\n');
if(fault==='busy'||fault==='accept'&&args.some(x=>x.startsWith('--verify-after='))){console.log(JSON.stringify({status:'BLOCKED',code:'FIXTURE_GATE'}));process.exit(2);}
console.log(JSON.stringify({schema:'oracle-sample-preflight.v1',status:'PASS',personalAdmissionPaused:fault!=='admission',liveBaseSha:'a3dfd1989705f51c921f13883bcde1cce4502883',protectedFiles:{fixture:'unchanged'},envSha256:'fixture',containerContractSha256:'fixture'}));
'''
class OperateTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='fosu-oracle-operate-');self.root=pathlib.Path(self.temp.name);self.candidate=self.root/'candidate';self.bin=self.root/'bin';self.bin.mkdir()
  self.app=self.root/'app';(self.app/'server/storage').mkdir(parents=True);(self.app/'server/storage/fixture.json').write_text('{}');(self.app/'server/.env').write_text('FIXTURE=preserved\n')
  self.runtime=self.root/'runtime';self.runtime.mkdir();self.project=self.root/'project';self.project.mkdir();(self.project/'compose.yml').write_text('services: {}\n');(self.project/'.env').write_text('FIXTURE=preserved\n')
  self.backup=self.root/'backup';self.images=self.root/'images';self.images.mkdir();self.manifest=self.root/'manifest.json';self.manifest.write_text(json.dumps({'gitCommit':SHA}))
  (self.images/'commit.txt').write_text(SHA);archive=self.images/('fosu-oracle-sample-'+SHA+'-arm64.image.tar.gz');archive.write_bytes(gzip.compress(b'fixture image'))
  (self.images/'SHA256SUMS').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n');(self.images/'image-inspect.json').write_text(json.dumps([{'Id':'sha256:'+'c'*64}]))
  directory=self.candidate/'deploy/oracle-sample';directory.mkdir(parents=True);self.script=directory/'operate.sh';self.script.write_bytes((ROOT/'deploy/oracle-sample/operate.sh').read_bytes());(directory/'preflight.js').write_text(PREFLIGHT)
  self.state=self.root/'docker.json';self.state.write_text(json.dumps({'image':'old-image','project':str(self.project)}));self.log=self.root/'commands.log'
  docker=self.bin/'docker';docker.write_text('#!'+sys.executable+'\n'+DOCKER);docker.chmod(0o700)
  self.env={**os.environ,'PATH':str(self.bin)+':'+os.environ['PATH'],'FIXTURE_DOCKER':str(self.state),'FIXTURE_LOG':str(self.log)}
 def tearDown(self):self.temp.cleanup()
 def run_operation(self,mode,approved=True,fault=''):
  args=['bash',str(self.script),mode,'--app-dir='+str(self.app),'--runtime-dir='+str(self.runtime),'--manifest='+str(self.manifest)]
  if mode!='preflight':
   args+=['--backup-dir='+str(self.backup)]
   if mode=='deploy':args+=['--image-dir='+str(self.images)]
   if approved:args+=['--approve-commit='+SHA]
  return subprocess.run(args,env={**self.env,'FIXTURE_FAULT':fault},text=True,capture_output=True)
 def test_preflight_performs_no_docker_mutations(self):
  r=self.run_operation('preflight');self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(self.log.read_text(),'preflight\n');self.assertFalse(self.backup.exists())
 def test_commit_approval_precedes_every_mutation(self):
  r=self.run_operation('deploy',approved=False);self.assertEqual(r.returncode,2);self.assertIn('EXACT_COMMIT_APPROVAL_REQUIRED',r.stdout);self.assertFalse(self.log.exists())
 def test_personal_admission_gate_is_not_changed_by_entry(self):
  r=self.run_operation('deploy',fault='admission');self.assertEqual(r.returncode,2);self.assertIn('BLOCKED phase=MAINTENANCE_GATE',r.stderr);self.assertFalse(self.backup.exists());self.assertEqual(self.log.read_text(),'preflight\n')
 def test_busy_runtime_blocks_before_backup(self):
  r=self.run_operation('deploy',fault='busy');self.assertEqual(r.returncode,2);self.assertFalse(self.backup.exists())
 def test_success_has_verified_backup_and_independent_code_rollback(self):
  before=(self.app/'server/.env').read_bytes();r=self.run_operation('deploy');self.assertEqual(r.returncode,0,r.stderr);self.assertIn('SUCCESS phase=DEPLOY_ACCEPTANCE',r.stdout)
  self.assertEqual(json.loads(self.state.read_text())['image'],'new-image');self.assertEqual(self.backup.stat().st_mode&0o777,0o700)
  self.assertTrue((self.backup/'state.tar.gz').is_file());self.assertTrue((self.backup/'SHA256SUMS').is_file())
  r=self.run_operation('rollback');self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(json.loads(self.state.read_text())['image'],'old-image');self.assertEqual((self.app/'server/.env').read_bytes(),before)
 def test_failed_acceptance_rolls_back_code_and_retains_evidence(self):
  r=self.run_operation('deploy',fault='accept');self.assertEqual(r.returncode,1,r.stderr);self.assertIn('rolled_back=YES',r.stdout);self.assertEqual(json.loads(self.state.read_text())['image'],'old-image');self.assertTrue((self.backup/'deploy-after.json').exists())
 def test_wrong_architecture_never_recreates_service(self):
  r=self.run_operation('deploy',fault='arch');self.assertEqual(r.returncode,1);self.assertNotIn('docker compose',self.log.read_text());self.assertTrue((self.backup/'SHA256SUMS').exists())
if __name__=='__main__':
 if os.name!='posix' or os.geteuid()!=0:raise SystemExit('LINUX_ROOT_REQUIRED')
 unittest.main()
