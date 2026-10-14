"""Offline packet preparation and retired-run gates; never executes a packet."""
import importlib.util,json,pathlib,tempfile,unittest

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

if __name__=='__main__':unittest.main()
