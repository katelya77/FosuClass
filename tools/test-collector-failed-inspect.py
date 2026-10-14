import ast,hashlib,importlib.util,json,pathlib,tempfile,unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
FILE=ROOT/'deploy/collector-closure/inspect_failed_sample.py'
spec=importlib.util.spec_from_file_location('failed_inspect',str(FILE));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
RUN='sc-'+'a'*24;TERM='2026-2027-1';REV='b'*40

class FailedInspectTests(unittest.TestCase):
 def test_python36_syntax(self):ast.parse(FILE.read_text(),feature_version=(3,6))
 def test_realistic_unknown_reservation_stays_unknown_and_contains_no_sensitive_values(self):
  with tempfile.TemporaryDirectory() as temp:
   root=pathlib.Path(temp);state=root/'state';closure=root/'closure';release=root/REV
   source=release/'tools/fosu-sync-client/sync.js';source.parent.mkdir(parents=True);source.write_bytes(b'fixture-source');digest=hashlib.sha256(source.read_bytes()).hexdigest()
   evidence=closure/RUN;worker=state/'runs'/TERM/RUN;worker.mkdir(parents=True);evidence.mkdir(parents=True)
   def save(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d))
   expiry='2026-10-14T03:25:42.000Z';scope={'runId':RUN,'term':TERM,'workerSourceHash':digest,'requestBudget':40,'expiresAt':expiry}
   save(evidence/'approval.json',{'runId':RUN,'term':TERM,'wyzRevision':REV,'requestBudget':40,'expiresAt':expiry})
   save(evidence/'school-access.started.json',{'runId':RUN,'at':'2026-10-14T03:00:00.000Z'})
   save(evidence/'result.json',{'code':'COLLECTOR_WORKER_UNTYPED_FAILURE','password':'SECRET'})
   save(worker/'sync-result.json',{'code':'COLLECTOR_WORKER_UNTYPED_FAILURE','failurePhase':'session-check','stderr':'SECRET','url':'https://private.invalid?ticket=SECRET'})
   save(worker/'client/request-ledger.json',{'schema':'collector-worker-request-ledger.v1','scope':scope,'scopeHash':hashlib.sha256(json.dumps(scope,separators=(',',':')).encode()).hexdigest(),'reserved':11,'completed':10,'failed':0,'pending':{'ordinal':11,'method':'GET','resourceType':'script','url':'SECRET'}})
   calls=[]
   def command(args):calls.append(args);return 0,'active\n' if 'is-active' in args else 'disabled\n' if 'is-enabled' in args else 'ActiveState=failed\nResult=exit-code\nExecMainStatus=1\n'
   result=m.inspect(RUN,TERM,REV,digest,state,closure,release,command,enforce=False)
   self.assertEqual(result['requestLedger'],{'reserved':11,'completed':10,'failed':0,'unknown':1,'remaining':29,'pendingMethod':'GET','pendingResourceType':'script'})
   self.assertEqual(result['originalExceptionRetained'],'NOT_RETAINED_BY_INSTALLED_WORKER')
   self.assertEqual(result['authenticationEvidence']['originalPasswordSubmissionCount'],'UNKNOWN')
   self.assertEqual(result['schoolRequests'],0);self.assertFalse(result['replayAllowed'])
   self.assertNotIn('SECRET',json.dumps(result));self.assertNotIn('private.invalid',json.dumps(result))
   self.assertTrue(all(c[0]=='systemctl' for c in calls));self.assertEqual(len(calls),5)
   scope['requestBudget']=120;save(worker/'client/request-ledger.json',{'scope':scope})
   bad=m.inspect(RUN,TERM,REV,digest,state,closure,release,command,enforce=False)
   self.assertEqual(bad['requestLedger'],'INVALID_SCOPE_OR_COUNTERS')
 def test_private_reader_rejects_link_large_and_nonobject(self):
  with tempfile.TemporaryDirectory() as temp:
   p=pathlib.Path(temp)/'bad.json';p.write_text('[]');self.assertIsNone(m.private_json(p,False))
   p.write_text('x'*65537);self.assertIsNone(m.private_json(p,False))
 def test_scope_rejected_before_any_command(self):
  with self.assertRaises(ValueError):m.inspect('../../bad',TERM,REV,'a'*64,'unused','unused','unused',lambda _:self.fail('must not run'))
if __name__=='__main__':unittest.main()
