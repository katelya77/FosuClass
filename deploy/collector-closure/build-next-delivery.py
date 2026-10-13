#!/usr/bin/env python3
"""Build one private, hash-bound operational file. Does not queue/install/collect."""
import argparse,base64,hashlib,io,json,pathlib,re,tarfile

def build(directory,receipt_file,output):
    directory=pathlib.Path(directory);receipt=json.loads(pathlib.Path(receipt_file).read_text())
    require=lambda ok: None if ok else (_ for _ in ()).throw(ValueError('NEXT_SAMPLE_APPROVED_QUEUE_REQUIRED'))
    require(receipt.get('phase')=='QUEUED' and receipt.get('audited') is True and receipt.get('authMethod')=='admin-cookie')
    run=receipt.get('runId','');require(re.fullmatch('sc-[a-f0-9]{24}',run) and run!='sc-506d1f4bea522471cf93edc6')
    require(receipt.get('term')=='2026-2027-1' and receipt.get('requestBudget')==40 and receipt.get('entityLimit')==1 and type(receipt.get('allowOneLogin')) is bool and receipt.get('sampleOnly') is True and receipt.get('publishable') is False and receipt.get('coverageValid') is False)
    expiry=receipt.get('schoolWindowExpiresAt','');require(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z',expiry))
    proof=receipt['oraclePreflight'];require(proof.get('schema')=='oracle-sample-preflight.v1' and proof.get('status')=='PASS' and proof.get('liveBaseSha')=='7ad3b2708ce553e6fff099fd881a4b9c86ebea39' and proof.get('schoolRequests')==0)
    minimal={k:proof[k] for k in ('schema','status','liveBaseSha','personalBrokerReady','schoolRequests','configurationChanged','at')}
    payload=io.BytesIO()
    with tarfile.open(fileobj=payload,mode='w:gz') as tar:
        for name in ('contract.js','wyz-sample.js','worker-diagnostics.js','finalize-wyz.js','start-wyz.sh','installed-source-pins.json'):
            data=(directory/name).read_bytes().replace(b'\r\n',b'\n');info=tarfile.TarInfo(name);info.mode=0o600;info.size=len(data);tar.addfile(info,io.BytesIO(data))
        data=(json.dumps(minimal)+'\n').encode();info=tarfile.TarInfo('oracle-preflight.json');info.mode=0o600;info.size=len(data);tar.addfile(info,io.BytesIO(data))
    raw=payload.getvalue();digest=hashlib.sha256(raw).hexdigest();blob=base64.b64encode(raw).decode()
    folder='/root/fosu-collector-closure-packets/'+run
    script='''#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || exit 2
python3 - <<'PY_PACKET'
import base64,hashlib,io,os,pathlib,tarfile
data=base64.b64decode('PAYLOAD')
assert hashlib.sha256(data).hexdigest()=='PAYLOAD_SHA'
parent=pathlib.Path('/root/fosu-collector-closure-packets')
assert not parent.is_symlink()
parent.mkdir(mode=0o700,exist_ok=True)
assert parent.stat().st_uid==0 and parent.stat().st_mode&0o777==0o700
root=pathlib.Path('FOLDER')
assert not root.exists() and not root.is_symlink(), 'PACKET_ALREADY_PREPARED_NO_REPLAY'
root.mkdir(mode=0o700)
with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tar:
    members=tar.getmembers()
    assert len(members)==7 and len(set(m.name for m in members))==7
    for m in members:
        assert m.isfile() and '/' not in m.name and m.name not in ('.','..')
        path=root/m.name
        with path.open('xb') as out:out.write(tar.extractfile(m).read())
        path.chmod(0o600)
print('WYZ_PACKET_PREPARED source_install=NO school_access=NO')
PY_PACKET
bash FOLDER/start-wyz.sh --approve-school-window --kind=class --run-id=RUN --term=2026-2027-1 --request-budget=40 --oracle-preflight=FOLDER/oracle-preflight.json --scope-expires-at=EXPIRY LOGIN
# The transaction is already detached. This bounded read-only wait is optional;
# disconnecting or Ctrl+C here cannot replay/stop the school executor.
python3 - <<'PY_RESULT'
import json,pathlib,time,sys
file=pathlib.Path('/root/fosu-collector-closure/RUN/result.json')
deadline=time.monotonic()+950
while not file.exists() and time.monotonic()<deadline:time.sleep(3)
if file.exists():
    assert not file.is_symlink() and file.stat().st_size<65536
    data=json.loads(file.read_text())
    keys=('status','code','runId','term','sampleKind','uploadId','canonicalHash','collectionSchoolRequests','requestBudget','directSourceSummary','signedOracleReceiptMatched','sampleOnly','publishable','coverageValid','passwordSubmissions','authenticationSchoolRequests','sessionProbeSchoolRequests','failurePhase','workerFailureCode','workerExitCode','workerSignal','requestLedger','requestEvidence','replayAllowed','evidenceRetained','schoolAccessReserved','workerReceipts')
    print(json.dumps({k:data[k] for k in keys if k in data},ensure_ascii=False))
    sys.exit(2 if data.get('status')=='BLOCKED' else 0)
else:
    print(json.dumps({'status':'BLOCKED','code':'CLOSURE_TERMINAL_RECEIPT_MISSING','runId':'RUN','replayAllowed':False}))
    sys.exit(2)
PY_RESULT
'''
    for key,value in [('PAYLOAD_SHA',digest),('PAYLOAD',blob),('FOLDER',folder),('RUN',run),('EXPIRY',expiry),('LOGIN','--one-login' if receipt['allowOneLogin'] else '')]:script=script.replace(key,value)
    output=pathlib.Path(output);require(not output.exists());output.write_bytes(script.encode())
    result={'runId':run,'sha256':hashlib.sha256(script.encode()).hexdigest(),'payloadSha256':digest,'sourceInstall':False,'schoolAccessExecuted':False,'publication':'NOT_APPROVED'}
    pathlib.Path(str(output)+'.receipt.json').write_text(json.dumps(result,indent=2));return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory');parser.add_argument('receipt');parser.add_argument('output');args=parser.parse_args()
    print(json.dumps(build(args.directory,args.receipt,args.output)))
