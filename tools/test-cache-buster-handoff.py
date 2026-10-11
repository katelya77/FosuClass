#!/usr/bin/env python3
"""Pinned source, read-only acceptance, failure propagation and rollback fixtures."""
import hashlib, importlib.util, io, json, os, subprocess, tarfile, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OLD='9153876458df7b1dd6b4fae698851638b31c702e';NEW='f'*40
spec=importlib.util.spec_from_file_location('verify',ROOT/'deploy/wyz/verify-installed-candidate.py');verify=importlib.util.module_from_spec(spec);spec.loader.exec_module(verify)
def write(file,text,mode=0o600):file.parent.mkdir(parents=True,exist_ok=True);file.write_text(text);file.chmod(mode)
def main():
    assert os.getuid()==0
    count=0
    with tempfile.TemporaryDirectory(prefix='fosu-915-handoff-') as temporary:
        root=Path(temporary);base=root/'base';state=root/'state';work=root/'work';bins=root/'bin';units=root/'units'
        for p in (base/'releases'/OLD,base/'releases'/NEW,state,work,bins,units):p.mkdir(parents=True,exist_ok=True)
        (base/'current').symlink_to(base/'releases'/NEW)
        write(base/'releases'/OLD/'.install-complete.json',json.dumps(dict(revision=OLD,bundleSha256='2b28122efd8dc93641c429fc311b9cefbfc1509a9f1eae5f5b8a045f2a730199',runtimeVerified=True)))
        body=b'committed fixture\n';data=io.BytesIO()
        with tarfile.open(fileobj=data,mode='w:gz') as tar:
            info=tarfile.TarInfo('fixture.js');info.size=len(body);tar.addfile(info,io.BytesIO(body))
        digest=hashlib.sha256(data.getvalue()).hexdigest();bundle='wyz-schedule-collector-'+NEW+'.tar.gz';(work/bundle).write_bytes(data.getvalue())
        write(base/'releases'/NEW/'fixture.js',body.decode());write(work/'upgrade-candidate.json',json.dumps(dict(revision=NEW,fromRevision=OLD,bundle=bundle,sha256=digest)))
        write(work/(bundle+'.receipt.json'),json.dumps(dict(sha=NEW,sha256=digest,files=1)))
        write(base/'releases'/NEW/'.install-complete.json',json.dumps(dict(revision=NEW,bundleSha256=digest,runtimeVerified=True)))
        assert verify.verify(work,base)['files']==1;count+=1
        for fault in ['source','receipt','pointer']:
            if fault=='source':write(base/'releases'/NEW/'fixture.js','corrupted\n')
            elif fault=='receipt':write(base/'releases'/NEW/'.install-complete.json','{}')
            else:(base/'current').unlink();(base/'current').symlink_to(base/'releases'/OLD)
            try:verify.verify(work,base);raise AssertionError('bad installed source accepted')
            except (ValueError,KeyError):count+=1
            write(base/'releases'/NEW/'fixture.js',body.decode());write(base/'releases'/NEW/'.install-complete.json',json.dumps(dict(revision=NEW,bundleSha256=digest,runtimeVerified=True)))
            (base/'current').unlink();(base/'current').symlink_to(base/'releases'/NEW)
        def adapt(text):return text.replace('/opt/fosuclass/schedule-collector',str(base)).replace('/var/lib/fosuclass/schedule-collector',str(state)).replace('/etc/systemd/system',str(units))
        for name in ('pam-cache-buster-upgrade.sh','rollback-cache-buster.sh','verify-installed-candidate.py'):
            write(work/name,adapt((ROOT/'deploy/wyz'/name).read_text()))
        write(work/'check-heartbeat-service.py','import os,sys\nprint("HEARTBEAT_FIXTURE_PASS")\nsys.exit(2 if os.environ.get("FIXTURE_FAIL")=="heartbeat" else 0)\n')
        backup=state/'cas-mobile-backup-fixture';backup.mkdir();write(backup/'current.txt',str(base/'releases'/OLD));write(backup/'heartbeat-signatures.json','{}')
        for name in ['wyz-schedule-collector.service','wyz-schedule-collector.timer']:write(backup/name,'old unit fixture\n');write(units/name,'old unit fixture\n')
        write(work/'rollback-backup.path',str(backup))
        write(bins/'fosu-collector','#!/bin/sh\necho "{}"\n',0o700)
        # Node's metadata/receipt branches are fixture adapters; the actual
        # evaluator and credential permissions have separate real Node tests.
        write(bins/'node','''#!/usr/bin/python3
import json,os,sys
from pathlib import Path
a=sys.argv[1:]
if '--output=' in ' '.join(a):
 file=next(x.split('=',1)[1] for x in a if x.startswith('--output='));Path(file).write_text(json.dumps({'status':'PASS'}))
elif len(a)==2 and a[0]=='-':
 if json.loads(Path(a[1]).read_text())['status']!='PASS':sys.exit(2)
else:sys.stdin.read();print('PROTECTED_FILE_METADATA_PASS')
''',0o700)
        write(bins/'systemctl','''#!/usr/bin/python3
import os,sys
from pathlib import Path
with open(os.environ['FIXTURE_CALLS'],'a') as f:f.write(' '.join(sys.argv[1:])+'\\n')
if sys.argv[1]=='is-active':print('active')
''',0o700)
        write(work/'upgrade-candidate.sh','#!/bin/bash\nprintf "upgrade\\n" >> "$FIXTURE_CALLS"\nexit 43\n')
        protected={name:b'synthetic-preserved\n' for name in ['school-auth-state.json','school-credentials.json','session.json','checkpoint.json']}
        for name,value in protected.items():(state/name).write_bytes(value)
        calls=root/'calls';env={**os.environ,'PATH':str(bins)+':'+os.environ['PATH'],'FIXTURE_CALLS':str(calls)}
        def run(name,flag,expected,fail=''):
            nonlocal count
            env['FIXTURE_FAIL']=fail
            result=subprocess.run(['bash',str(work/name),flag],env=env,capture_output=True,text=True,timeout=15)
            assert result.returncode==expected,(result.returncode,result.stdout,result.stderr)
            assert all((state/n).read_bytes()==b for n,b in protected.items())
            count+=1;return result.stdout+result.stderr
        text=run('pam-cache-buster-upgrade.sh','--approve-install',0);assert 'INSTALLATION_ALREADY_PRESENT' in text and 'INSTALLATION_PASS' in text
        assert not calls.exists(),'already-installed target must not invoke installer/systemd'
        text=run('pam-cache-buster-upgrade.sh','--approve-install',2,'heartbeat');assert 'INSTALLATION_PASS' not in text
        assert not calls.exists(),'read-only failure must not stop current service'
        run('pam-cache-buster-upgrade.sh','bad-approval',2);assert not calls.exists()
        (base/'current').unlink();(base/'current').symlink_to(base/'releases'/OLD)
        text=run('pam-cache-buster-upgrade.sh','--approve-install',43);assert 'FAILED' in text and 'INSTALLATION_PASS' not in text
        assert calls.read_text().splitlines()==['upgrade','stop wyz-schedule-collector.service']
        text=run('pam-cache-buster-upgrade.sh','--approve-install',2);assert 'PREVIOUS_ATTEMPT_REVIEW_REQUIRED' in text
        calls.write_text('')
        (base/'current').unlink();(base/'current').symlink_to(base/'releases'/NEW)
        text=run('rollback-cache-buster.sh','--approve-rollback',0);assert 'ROLLBACK_PASS' in text and (base/'current').resolve().name==OLD
        assert calls.read_text().splitlines()==['is-active wyz-schedule-collector.service','stop wyz-schedule-collector.service','daemon-reload','start wyz-schedule-collector.service']
        text=run('rollback-cache-buster.sh','bad-approval',1);assert 'ROLLBACK_PASS' not in text
    print('CACHE_BUSTER_HANDOFF_PASS cases='+str(count)+' schoolRequests=0 productionWrites=0')
if __name__=='__main__':main()
