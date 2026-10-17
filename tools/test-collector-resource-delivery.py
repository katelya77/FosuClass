import ast,importlib.util,json,pathlib,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
FILE=ROOT/'deploy/collector-closure/build-resource-diagnostic.py'
spec=importlib.util.spec_from_file_location('resource_delivery',str(FILE));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
RUN='sc-diag-'+'a'*16
class ResourceDeliveryTests(unittest.TestCase):
 def package(self,root):
  file=pathlib.Path(root)/'diagnostic.sh';value=m.build(file,RUN)
  content=file.read_text(encoding='utf8');wrapper=content.split("<<'FOSU_DIAGNOSTIC_PY'\n",1)[1].rsplit('\nFOSU_DIAGNOSTIC_PY',1)[0]
  return file,value,wrapper
 def test_python36_and_bound_scope(self):
  with tempfile.TemporaryDirectory() as root:
   file,value,wrapper=self.package(root);ast.parse(wrapper,feature_version=(3,6))
   self.assertEqual(value['requestBudget'],40);self.assertEqual(value['passwordSubmissionLimit'],0)
   self.assertFalse(value['sourceInstall']);self.assertFalse(value['schoolAccessExecuted'])
   self.assertIn('Type=simple',wrapper);self.assertIn('--kill-after=20s',wrapper);self.assertIn("'90s'",wrapper)
   self.assertNotIn('RuntimeMaxSec',wrapper);self.assertIn('StandardOutput=null',wrapper);self.assertIn("'PLAYWRIGHT_BROWSERS_PATH='",wrapper)
 def test_default_and_wrong_flags_deny_before_private_state_access(self):
  with tempfile.TemporaryDirectory() as root:
   file,value,wrapper=self.package(root)
   for args in [[],['--approve-one-login'],['--approve-school-access','--retry']]:
    p=subprocess.run([sys.executable,'-c',wrapper]+args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True,timeout=10)
    self.assertEqual(p.returncode,2);receipt=json.loads(p.stdout)
    self.assertEqual(receipt['code'],'FRESH_TEACHER_DIAGNOSTIC_APPROVAL_REQUIRED');self.assertFalse(receipt['schoolAccessExecuted']);self.assertFalse(receipt['replayAllowed'])
 def test_no_overwrite_or_old_sample_id(self):
  with tempfile.TemporaryDirectory() as root:
   file,value,wrapper=self.package(root);before=file.read_bytes()
   with self.assertRaises(ValueError):m.build(file,RUN)
   self.assertEqual(file.read_bytes(),before)
   with self.assertRaises(ValueError):m.build(pathlib.Path(root)/'bad.sh','sc-9611df5c90c4dc800e7e2c14')
if __name__=='__main__':unittest.main()
