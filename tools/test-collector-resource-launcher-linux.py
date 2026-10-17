"""Actual emitted launcher in an isolated chroot, not the host /root.

Run as Linux root. Only the school Worker and systemd service manager are local
fixtures; Python preflight/reservation/permissions/launch/result logic is intact.
The fixture filesystem contains no Session, credentials, network client or data.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('delivery', REPO/'deploy/collector-closure/build-resource-diagnostic.py')
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)
RUN = 'sc-diag-'+'b'*16
WORKER = r'''
const fs=require('node:fs'),path=require('node:path'),d=__dirname;
const a=JSON.parse(fs.readFileSync(path.join(d,'approval.json')));
const bad=fs.existsSync('/fixture-worker-failure');
const value={schema:'collector-resource-page-diagnostic.v1',runId:a.runId,
 status:bad?'BLOCKED':'OBSERVED',code:bad?'FIXTURE_WORKER_EXIT':'OFFLINE_FIXTURE_ONLY',
 schoolAccessExecuted:false,schoolRequests:0,passwordSubmissions:0,replayAllowed:false};
fs.writeFileSync(path.join(d,'result.json'),JSON.stringify(value),{mode:0o600,flag:'wx'});
process.exitCode=bad?7:0;
'''
MANAGER = '''#!/usr/bin/python3
import json,pathlib,subprocess,sys
if pathlib.Path('/fixture-unit-deny').exists():sys.exit(1)
args=sys.argv[1:]
assert '--property=Type=simple' in args and '--property=UMask=0077' in args
start=next(i for i,v in enumerate(args) if v.endswith('/timeout'))
p=subprocess.run(args[start:],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8)
pathlib.Path('/fixture-worker-exit.json').write_text(json.dumps({'exit':p.returncode}))
# systemd-run accepts a transient unit independently of its Worker's exit status.
sys.exit(0)
'''


@unittest.skipUnless(sys.platform=='linux' and os.geteuid()==0, 'isolated Linux root required')
class LauncherLinuxTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.base=Path(tempfile.mkdtemp(prefix='fosu-launcher-chroot-'))
  def cleanup():
   assert cls.base.parent==Path(tempfile.gettempdir()) and cls.base.name.startswith('fosu-launcher-chroot-')
   shutil.rmtree(cls.base)
  cls.addClassCleanup(cleanup)
  cls.image=cls.base/'image';cls.image.mkdir()
  def copy(file):
   target=cls.image/str(file).lstrip('/');target.parent.mkdir(parents=True,exist_ok=True)
   shutil.copy2(file,target)
  def binary(file,target=None):
   file=Path(file);destination=cls.image/(target or str(file).lstrip('/'))
   destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,destination)
   output=subprocess.check_output(['ldd',str(file)],text=True)
   for dep in re.findall(r'(?:=>\s*)?(/[^\s()]+)',output):copy(Path(dep))
  python=Path(sys.executable).resolve();stdlib=Path(sysconfig.get_path('stdlib'))
  shutil.copytree(stdlib,cls.image/str(stdlib).lstrip('/'),ignore=shutil.ignore_patterns('__pycache__','site-packages','test','tests','ensurepip'))
  binary(python,'usr/bin/python3')
  # Python extension modules can depend on libraries absent from the ELF binary.
  for module in (stdlib/'lib-dynload').glob('*.so'):
   for dep in re.findall(r'(?:=>\s*)?(/[^\s()]+)',subprocess.check_output(['ldd',str(module)],text=True)):copy(Path(dep))
  for name in ['node','timeout','env']:binary(shutil.which(name),'usr/bin/'+name)
  for directory in ['root','tmp','etc','var/lib/fosuclass/schedule-collector']:(cls.image/directory).mkdir(parents=True,exist_ok=True)
  (cls.image/'etc/group').write_text('root:x:0:\n')
  (cls.image/'usr/bin/systemd-run').write_text(MANAGER);(cls.image/'usr/bin/systemd-run').chmod(0o755)
  release=cls.image/'opt/fosuclass/schedule-collector/releases'/delivery.REVISION
  for relative in delivery.FILES:
   target=release/relative;target.parent.mkdir(parents=True,exist_ok=True)
   target.write_bytes(subprocess.check_output(['git','show',delivery.REVISION+':'+relative],cwd=str(REPO)))
  (release.parent.parent/'current').symlink_to('releases/'+delivery.REVISION)
  package=cls.base/'fixture-only.sh';delivery.build(package,RUN)
  wrapper=package.read_text().split("<<'FOSU_DIAGNOSTIC_PY'\n",1)[1].rsplit('\nFOSU_DIAGNOSTIC_PY',1)[0]
  # Replace only the school Worker literal; all emitted Python logic is unchanged.
  original=(REPO/'deploy/collector-closure/resource-page-diagnostic.js').read_text()
  assert wrapper.count('NODE_SOURCE = '+repr(original))==1
  wrapper=wrapper.replace('NODE_SOURCE = '+repr(original),'NODE_SOURCE = '+repr(WORKER))
  (cls.image/'launcher.py').write_text(wrapper)

 def setUp(self):
  self.parent=self.image/'root'
  if self.parent.is_symlink():self.parent.unlink();self.parent.mkdir()
  os.chown(self.parent,0,0);self.parent.chmod(0o700)
  for file in self.parent.iterdir():
   if file.is_symlink() or file.is_file():file.unlink()
   else:shutil.rmtree(file)
  self.state=self.image/'var/lib/fosuclass/schedule-collector';self.state.chmod(0o700)
  runtime=self.state/'browser-runtime.json';runtime.write_text('{"mode":"native"}');runtime.chmod(0o600)
  for name in ['fixture-worker-failure','fixture-unit-deny','fixture-worker-exit.json']:
   file=self.image/name
   if file.exists():file.unlink()
  self.reservation=self.parent/('fosu-resource-diagnostic-'+RUN[8:])

 def launch(self):
  p=subprocess.run([shutil.which('chroot'),str(self.image),'/usr/bin/python3','/launcher.py','--approve-school-access'],capture_output=True,text=True,timeout=15,
                   env={'PATH':'/usr/bin:/bin','LC_ALL':'C'})
  self.assertTrue(p.stdout,p.stderr);return p,json.loads(p.stdout)

 def test_0550_entire_launcher_and_real_worker(self):
  self.parent.chmod(0o550);p,value=self.launch()
  self.assertEqual(value['status'],'OBSERVED',value);self.assertEqual(p.returncode,0)
  self.assertEqual(self.parent.stat().st_mode&0o777,0o550)
  self.assertEqual(self.reservation.stat().st_mode&0o777,0o700)
  for file in self.reservation.iterdir():self.assertEqual(file.stat().st_mode&0o777,0o600)
  self.assertFalse(value['schoolAccessExecuted']);self.assertEqual(value['schoolRequests'],0)
  self.assertEqual(json.loads((self.image/'fixture-worker-exit.json').read_text())['exit'],0)
  _,second=self.launch();self.assertEqual(second['code'],'SCHOOL_RESOURCE_DIAGNOSTIC_ALREADY_RESERVED')

 def test_0700(self):
  _,value=self.launch();self.assertEqual(value['status'],'OBSERVED',value)

 def test_previously_passed_state_runtime_contract_is_unchanged(self):
  self.state.chmod(0o500);(self.state/'browser-runtime.json').chmod(0o400)
  _,value=self.launch();self.assertEqual(value['status'],'OBSERVED',value)
  self.assertEqual(self.reservation.stat().st_mode&0o777,0o700)

 def test_parent_permissions_and_ownership(self):
  for uid,gid,mode in [(12345,0,0o550),(0,12345,0o550),(0,0,0o770),(0,0,0o755)]:
   with self.subTest(uid=uid,gid=gid,mode=oct(mode)):
    os.chown(self.parent,uid,gid);self.parent.chmod(mode)
    _,value=self.launch();self.assertEqual(value['status'],'BLOCKED');self.assertFalse(value['schoolAccessExecuted'])
    self.assertEqual(value['failureStage'],'parent-directory');self.assertEqual(value['errorCategory'],'permissions')
    self.assertFalse(self.reservation.exists())

 def test_private_directory_rejected(self):
  for mode in [0o750,0o500]:
   self.reservation.mkdir(mode=mode)
   _,value=self.launch();self.assertEqual(value['status'],'BLOCKED');self.assertFalse(value['schoolAccessExecuted'])
   self.assertEqual(value['failureStage'],'reservation');self.assertEqual(value['errorCategory'],'permissions')
   self.assertEqual(self.reservation.stat().st_mode&0o777,mode);self.reservation.rmdir()

 def test_private_and_parent_symlinks_rejected(self):
  self.reservation.symlink_to('/tmp');_,value=self.launch();self.assertEqual(value['status'],'BLOCKED');self.assertTrue(self.reservation.is_symlink());self.reservation.unlink()
  self.parent.rmdir();self.parent.symlink_to('/tmp');_,value=self.launch();self.assertEqual(value['status'],'BLOCKED');self.assertFalse(value['schoolAccessExecuted'])

 def test_worker_failure_result(self):
  (self.image/'fixture-worker-failure').touch();_,value=self.launch()
  self.assertEqual(value['code'],'FIXTURE_WORKER_EXIT');self.assertFalse(value['schoolAccessExecuted'])
  self.assertEqual(json.loads((self.image/'fixture-worker-exit.json').read_text())['exit'],7)

 def test_unit_start_failure_has_stage(self):
  (self.image/'fixture-unit-deny').touch();_,value=self.launch()
  self.assertEqual(value['code'],'SCHOOL_RESOURCE_DIAGNOSTIC_UNIT_START_FAILED');self.assertEqual(value['failureStage'],'unit-start')
  self.assertTrue(self.reservation.exists());self.assertFalse((self.image/'fixture-worker-exit.json').exists())

 def test_local_format_error_is_sanitized(self):
  file=self.state/'browser-runtime.json';file.write_text('{PRIVATE-FIXTURE-VALUE')
  p,value=self.launch();self.assertEqual(value['failureStage'],'browser-runtime');self.assertEqual(value['errorCategory'],'format')
  self.assertNotIn('PRIVATE-FIXTURE-VALUE',p.stdout);self.assertFalse(value['schoolAccessExecuted'])

if __name__=='__main__':unittest.main()
