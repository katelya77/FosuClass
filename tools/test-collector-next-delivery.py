"""Offline packet preparation and retired-run gates; never executes a packet."""
import base64,hashlib,importlib.util,io,json,pathlib,re,tarfile,tempfile,unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('packet',str(ROOT/'deploy/collector-closure/build-next-delivery.py'))
packet=importlib.util.module_from_spec(spec);spec.loader.exec_module(packet)

class DeliveryTests(unittest.TestCase):
 def receipt(self,run):
  return {'phase':'QUEUED','audited':True,'authMethod':'admin-cookie','runId':run,'term':'2026-2027-1','requestBudget':40,'entityLimit':1,'allowOneLogin':True,'sampleOnly':True,'publishable':False,'coverageValid':False,'schoolWindowExpiresAt':'2026-10-14T14:00:00.000Z','oraclePreflight':{'schema':'oracle-sample-preflight.v1','status':'PASS','liveBaseSha':'7ad3b2708ce553e6fff099fd881a4b9c86ebea39','personalBrokerReady':True,'schoolRequests':0,'configurationChanged':False,'at':'2026-10-14T13:30:00.000Z'}}
 def build(self,value):
  with tempfile.TemporaryDirectory(prefix='collector-packet-fixture-') as directory:
   root=pathlib.Path(directory);receipt=root/'fixture.json';receipt.write_text(json.dumps(value));output=root/'fixture.sh'
   return packet.build(ROOT/'deploy/collector-closure',receipt,output),output.read_bytes()
 def test_retired_runs_never_produce_packet(self):
  for run in ['sc-506d1f4bea522471cf93edc6','sc-2e93227bd8502bde7c08c88c']:
   with self.assertRaisesRegex(ValueError,'APPROVED_QUEUE_REQUIRED'):self.build(self.receipt(run))
 def test_missing_native_audit_never_produces_packet(self):
  value=self.receipt('sc-'+'a'*24);value['audited']=False
  with self.assertRaisesRegex(ValueError,'APPROVED_QUEUE_REQUIRED'):self.build(value)
 def test_offline_fixture_packet_is_hash_bound_and_detached(self):
  import hashlib,subprocess
  result,script=self.build(self.receipt('sc-'+'b'*24))
  self.assertEqual(result['sha256'],hashlib.sha256(script).hexdigest())
  self.assertFalse(result['sourceInstall']);self.assertFalse(result['schoolAccessExecuted'])
  self.assertIn(b'PACKET_ALREADY_PREPARED_NO_REPLAY',script)
  self.assertIn(b'--request-budget=40',script);self.assertIn(b'--one-login',script)
  if __import__('os').name!='nt':
   subprocess.run(['bash','-n'],input=script,check=True)
 def four_receipt(self):
  return dict(self.receipt('sc-'+'c'*24),sampleKind='four',requestBudget=120,allowOneLogin=False,classRunId='sc-'+'e'*24,classCanonicalHash='a'*64,classReviewConfirmed=True)
 def test_four_packet_binds_review_and_never_submits_password(self):
  result,script=self.build(self.four_receipt())
  self.assertEqual(result['sampleKind'],'four');self.assertEqual(result['requestBudget'],120)
  self.assertIn(b'--kind=four',script);self.assertIn(b'--request-budget=120',script)
  self.assertIn(('--class-run-id=sc-'+'e'*24).encode(),script)
  self.assertIn(('--class-canonical-hash='+'a'*64).encode(),script)
  self.assertNotIn(b'--one-login',script);self.assertNotIn(b'__PACKET_',script)
  payload=base64.b64decode(re.search(rb"data=base64.b64decode\('([^']+)'\)",script).group(1))
  self.assertEqual(hashlib.sha256(payload).hexdigest(),result['payloadSha256'])
  with tarfile.open(fileobj=io.BytesIO(payload),mode='r:gz') as tar:
   self.assertEqual(len(tar.getmembers()),7)
   self.assertEqual(tar.extractfile('contract.js').read(),(ROOT/'deploy/collector-closure/contract.js').read_bytes().replace(b'\r\n',b'\n'))
  if __import__('os').name!='nt':
   __import__('subprocess').run(['bash','-n'],input=script,check=True)
 def test_four_rejects_missing_review_wrong_budget_login_or_retired_class(self):
  for field,value in [('allowOneLogin',True),('requestBudget',40),('classReviewConfirmed',False),('classCanonicalHash','b'*63),('classRunId','sc-506d1f4bea522471cf93edc6'),('classRunId','sc-2e93227bd8502bde7c08c88c'),('classRunId','sc-'+'c'*24)]:
   with self.subTest(field=field,value=value):
    receipt=self.four_receipt();receipt[field]=value
    with self.assertRaisesRegex(ValueError,'APPROVED_QUEUE_REQUIRED'):self.build(receipt)
 def test_class_packet_cannot_smuggle_four_review_binding(self):
  value=self.receipt('sc-'+'b'*24);value['classRunId']='sc-'+'e'*24
  with self.assertRaisesRegex(ValueError,'APPROVED_QUEUE_REQUIRED'):self.build(value)

if __name__=='__main__':unittest.main()
