#!/usr/bin/env python3
"""Execute the delivered upgrade and real installer in a private Linux filesystem.

No school/Oracle requests, production paths, credentials or personal Agent writes.
--legacy-script reproduces the previously delivered failure before applying the fix.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OLD = 'df4ed1e985630002f614d37db246a76dcaad65a8'
NEW = '6eea0ec099930f40d16cd3f0ea641e3572f9c675'


def write(file, data, mode=0o600):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(data, encoding='utf8')
    file.chmod(mode)


MOCK = r'''#!/usr/bin/python3
import json, os, sys
from pathlib import Path
args=sys.argv[1:]; file=Path(os.environ['FIXTURE_STATE']); s=json.loads(file.read_text())
fault=os.environ.get('FIXTURE_FAULT','')
with open(os.environ['FIXTURE_LOG'],'a') as log: log.write(' '.join(args)+'\n')
if args[0]=='get-property':
    personal='agent' in args[2]
    argv=['/usr/bin/sleep','infinity'] if personal else ['/usr/bin/env','FOSU_COLLECTOR_EXECUTE=0','/usr/bin/node',os.environ['FIXTURE_RUNNER']]
    fault=os.environ.get('FIXTURE_FAULT','')
    if s['stage'] in ('reloaded','started'):
        if fault=='execute' and not personal: argv[1]='FOSU_COLLECTOR_EXECUTE=1'
        if fault=='runner' and not personal: argv[-1]+='.wrong'
        if fault=='extra-argv' and not personal: argv+=['--unexpected']
        if fault=='joined-argv' and not personal: argv=[argv[0], ' '.join(argv[1:])]
        if fault=='personal-changed' and personal: argv[-1]='90'
    import shlex
    data=['a(sasbttttuii)','1',argv[0],str(len(argv))]+argv+['false','100','100','0','0','812' if s['stage']=='old' else '0','0','0']
    if fault=='ignore-failure' and s['stage']=='reloaded' and not personal: data[-8]='true'
    if fault=='multiple-commands' and s['stage']=='reloaded' and not personal: data[1]='2'
    print(' '.join(shlex.quote(t) for t in data)); sys.exit(0)
unit=next((a for a in args if a.endswith(('.service','.timer'))),'')
is_collector=unit=='wyz-schedule-collector.service'
active=s['collector'] if is_collector else ('active' if unit.endswith('agent.service') else 'inactive')
if args[0]=='stop': s['collector']='inactive'; s['stage']='stopped'
elif args[0]=='start':
    if fault=='start-failed': sys.exit(42)
    s['collector']='active'; s['stage']='started'
elif args[0]=='daemon-reload': s['stage']='reloaded'
elif args[0]=='is-active':
    if '--quiet' not in args: print(active)
    sys.exit(0 if active=='active' else 3)
elif args[0]=='is-enabled':
    if '--quiet' not in args: print('disabled')
    sys.exit(1)
elif args[0]=='show':
    command='/usr/bin/env FOSU_COLLECTOR_EXECUTE=0 /usr/bin/node '+os.environ['FIXTURE_RUNNER']
    props={'LoadState':'loaded','ActiveState':active,'SubState':'running' if active=='active' else 'dead',
           'Result':'success','NRestarts':'0','WorkingDirectory':os.environ['FIXTURE_CURRENT'],
           'UnitFileState':'disabled','ExecStartPre':'','ExecStartPost':'','ExecCondition':'','ExecStopPost':'',
           'PartOf':'','BindsTo':'','Requires':'','Wants':'network-online.target','PropagatesStopTo':'','ConsistsOf':''}
    fault=os.environ.get('FIXTURE_FAULT','')
    if fault=='preflight-timer' and unit.endswith('.timer'): props['UnitFileState']='enabled'
    if s['stage'] in ('reloaded','started'):
        if fault=='working-directory' and is_collector: props['WorkingDirectory']+='.wrong'
        if fault=='timer-enabled' and unit.endswith('.timer'): props['UnitFileState']='enabled'
        if fault=='timer-active' and unit.endswith('.timer'): props['ActiveState']='active'
        if fault=='agent-inactive' and unit.endswith('agent.service'): props['ActiveState']='inactive'
        if fault=='agent-dependent' and unit.endswith('agent.service'): props['PartOf']='wyz-schedule-collector.service'
        if fault=='exec-hook' and is_collector: props['ExecStartPost']='PRIVATE_SYNTHETIC_VALUE_MUST_NOT_APPEAR'
    if s['stage']=='started' and is_collector:
        if fault=='health-failed': props['ActiveState']='failed'; props['Result']='exit-code'
        if fault=='restart': props['NRestarts']='1'
    pid=812 if s['stage']=='old' else 0 if s['stage']=='reloaded' else 901
    props['ExecStart']='{ path=/usr/bin/env ; argv[]='+command+' ; ignore_errors=no ; start_time=[n/a] ; stop_time=['+('n/a' if s['stage']=='old' else 'Fri 2026-10-10 10:00:00 UTC')+'] ; pid='+str(pid)+' ; code=(null) ; status=0/0 }'
    keys=[args[i+1] for i,a in enumerate(args) if a in ('-p','--property')]
    for key in keys:
        print(props.get(key,'') if '--value' in args else key+'='+props.get(key,''))
file.write_text(json.dumps(s))
'''


def fixture(legacy=None, fault=''):
    temp = Path(tempfile.mkdtemp(prefix='fosu-upgrade-'))
    base, state, units, bin_dir, source = [temp / p for p in ('base', 'state', 'units', 'bin', 'source')]
    handoff = temp / 'handoff'
    def adapt(text):
        return (text.replace('/opt/fosuclass/schedule-collector', str(base))
                .replace('/var/lib/fosuclass/schedule-collector', str(state))
                .replace('/etc/systemd/system', str(units)).replace('/etc/fosuclass', str(temp/'etc'))
                .replace('/usr/local/bin/fosu-collector', str(bin_dir/'fosu-collector')))
    for directory in (base/'releases'/OLD, state, units, handoff, bin_dir):
        directory.mkdir(parents=True, exist_ok=True)
    state.chmod(0o700)
    (base/'current').symlink_to(base/'releases'/OLD)
    for name in ('install-schedule-collector.sh','recover-release.py'):
        write(handoff/name, adapt((ROOT/'deploy/wyz'/name).read_text()))
    upgrade = Path(legacy).read_text() if legacy else (ROOT/'deploy/wyz/upgrade-candidate.sh').read_text()
    write(handoff/'upgrade-candidate.sh', adapt(upgrade))
    checker = ROOT/'deploy/wyz/check-heartbeat-service.py'
    if checker.exists(): write(handoff/checker.name, adapt(checker.read_text()))
    for name in ('upgrade-candidate.sh','check-heartbeat-service.py','install-schedule-collector.sh','recover-release.py'):
        if (handoff/name).exists(): write(source/'deploy/wyz'/name, (handoff/name).read_text())
    write(bin_dir/'systemctl', MOCK, 0o700)
    write(bin_dir/'busctl', MOCK, 0o700)
    write(bin_dir/'npm', '#!/bin/sh\nmkdir -p "$2/node_modules/.bin"\nprintf "#!/bin/sh\\nexit 0\\n" > "$2/node_modules/.bin/playwright"\nchmod 700 "$2/node_modules/.bin/playwright"\n', 0o700)
    write(bin_dir/'node', '#!/usr/bin/python3\nimport sys,json,pathlib,os\na=sys.argv\nif "f.writeFileSync" in a[2]:\n if os.environ.get("FIXTURE_FAULT")=="installer-failed": sys.exit(43)\n pathlib.Path(a[3]).write_text(json.dumps({"revision":a[4],"bundleSha256":a[5],"runtimeVerified":True}))\n', 0o700)
    write(source/'tools/fosu-sync-client/package.json', '{}')
    write(source/'server/package.json', '{}')
    write(source/'deploy/wyz/repair-browser.sh', '#!/bin/sh\necho NATIVE_BROWSER_FIXTURE_PASS\n')
    write(source/'deploy/wyz/fosu-collector.sh', '#!/bin/sh\necho CLI_OFFLINE_FIXTURE_PASS\n')
    for name, data in [('wyz-schedule-collector.service','[Service]\n'),('wyz-schedule-collector.timer','[Timer]\n')]:
        write(source/'deploy/wyz'/name, data)
        write(units/name, data)
    write(units/'wyz-schedule-collector.service.d/90-heartbeat-acceptance.conf', '[Service]\nExecStart=\nExecStart=/usr/bin/env FOSU_COLLECTOR_EXECUTE=0 /usr/bin/node '+str(state/'acceptance/heartbeat-only-runner.js')+'\n')
    write(state/'acceptance/heartbeat-only-runner.js', 'SYNTHETIC_HEARTBEAT_RUNNER\n')
    (state/'acceptance').chmod(0o700)
    (units/'wyz-schedule-collector.service.d').chmod(0o700)
    write(temp/'etc/full-sync.env','SYNTHETIC_PRIVATE_ENV_UNCHANGED\n')
    bundle=handoff/('wyz-schedule-collector-'+NEW+'.tar.gz')
    with tarfile.open(bundle,'w:gz') as tar:
        for directory in ('tools','server','deploy'): tar.add(source/directory,arcname=directory)
    digest=hashlib.sha256(bundle.read_bytes()).hexdigest()
    write(handoff/'source.sha256',digest+'  '+bundle.name+'\n')
    write(handoff/'upgrade-candidate.json',json.dumps({'fromRevision':OLD,'revision':NEW,'bundle':bundle.name,'sha256':digest}))
    if fault=='helper-mismatch': write(handoff/'check-heartbeat-service.py','raise SystemExit("PRIVATE_SYNTHETIC_VALUE_MUST_NOT_APPEAR")\n')
    if fault=='source-corrupted': bundle.write_bytes(bundle.read_bytes()+b'corrupt')
    if legacy:
        script=(handoff/'upgrade-candidate.sh').read_text()
        import re
        script=re.sub(r'(bash install-schedule-collector.sh \S+ )\S+',r'\g<1>'+digest,script)
        write(handoff/'upgrade-candidate.sh',script)
    write(temp/'systemd.json',json.dumps({'collector':'active','stage':'old'}))
    env=dict(os.environ, PATH=str(bin_dir)+':'+os.environ['PATH'], FIXTURE_STATE=str(temp/'systemd.json'),
             FIXTURE_LOG=str(temp/'systemctl.log'), FIXTURE_RUNNER=str(state/'acceptance/heartbeat-only-runner.js'),
             FIXTURE_CURRENT=str(base/'current'),FIXTURE_FAULT=fault,PYTHONOPTIMIZE='1')
    return temp, handoff, env


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--legacy-script')
    args=parser.parse_args()
    if os.geteuid()!=0 or not sys_platform_linux(): raise SystemExit('ISOLATED_LINUX_ROOT_REQUIRED')
    if not args.legacy_script:
        cases={'':None,'execute':'EXECSTART_ARGV_HEARTBEAT_ONLY','runner':'EXECSTART_ARGV_HEARTBEAT_ONLY',
               'extra-argv':'EXECSTART_ARGV_HEARTBEAT_ONLY','joined-argv':'EXECSTART_ARGV_HEARTBEAT_ONLY',
               'ignore-failure':'EXECSTART_IGNORE_FAILURE','working-directory':'WORKING_DIRECTORY',
               'timer-enabled':'TIMER_NOT_DISABLED','timer-active':'TIMER_NOT_INACTIVE',
               'agent-inactive':'PERSONAL_AGENT_NOT_RUNNING','agent-dependent':'PERSONAL_AGENT_NOT_INDEPENDENT',
               'exec-hook':'UNEXPECTED_EXEC_HOOK','personal-changed':'RUNNER_OR_PERSONAL_COMMAND_CHANGED',
               'health-failed':'COLLECTOR_NOT_ACTIVE','restart':'COLLECTOR_RESTARTED',
               'multiple-commands':'EXECSTART_COUNT_OR_TYPE','start-failed':'START_COLLECTOR',
               'installer-failed':'INSTALLER','preflight-timer':'TIMER_NOT_DISABLED',
               'helper-mismatch':'HELPERS_MATCH_SOURCE','source-corrupted':'SOURCE_INTEGRITY'}
        for fault,expected in cases.items(): run_case(fault,expected)
        temp,handoff,env=fixture()
        try:
            result=subprocess.run(['bash',str(handoff/'upgrade-candidate.sh')],env=env,
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True,timeout=10)
            assert result.returncode!=0 and 'gate=APPROVAL' in result.stderr
            assert json.loads((temp/'systemd.json').read_text())['stage']=='old'
            assert not (handoff/'rollback-backup.path').exists()
            assert not any(line.startswith(('start ','stop ','enable ','disable ')) for line in (temp/'systemctl.log').read_text().splitlines())
        finally: shutil.rmtree(str(temp))
        print('collector-upgrade-linux: '+str(len(cases)+1)+' PASS (isolated full upgrade/installer, typed systemd fixture, no network)')
        return
    temp,handoff,env=fixture(args.legacy_script)
    try:
        result=subprocess.run(['bash',str(handoff/'upgrade-candidate.sh'),'--approve-install'],env=env,
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True,timeout=60)
        if args.legacy_script:
            assert result.returncode!=0, result.stdout+result.stderr
            assert (temp/'base/current').resolve().name==NEW
            assert json.loads((temp/'systemd.json').read_text())['collector']=='inactive'
            assert 'INSTALL_FAILED_COLLECTOR_STOPPED' in result.stderr
            print('LEGACY_FAILURE_REPRODUCED after installation + daemon-reload; collector inactive; unchanged command; runtime metadata changed')
    finally: shutil.rmtree(str(temp))


def run_case(fault,expected):
    temp,handoff,env=fixture(fault=fault)
    try:
        result=subprocess.run(['bash',str(handoff/'upgrade-candidate.sh'),'--approve-install'],env=env,
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,universal_newlines=True,timeout=60)
        output=result.stdout+result.stderr
        assert 'PRIVATE_SYNTHETIC_VALUE' not in output, output
        assert 'SYNTHETIC_PRIVATE_ENV' not in output, output
        state=json.loads((temp/'systemd.json').read_text())
        before_install=fault in ('preflight-timer','helper-mismatch','source-corrupted','installer-failed')
        assert (temp/'base/current').resolve().name==(OLD if before_install else NEW), output
        assert (temp/'etc/full-sync.env').read_text()=='SYNTHETIC_PRIVATE_ENV_UNCHANGED\n'
        log=(temp/'systemctl.log').read_text().splitlines()
        writes=[line for line in log if line.split()[0] in ('start','stop','enable','disable','restart')]
        assert all(line in ('start wyz-schedule-collector.service','stop wyz-schedule-collector.service') for line in writes), writes
        if expected:
            assert result.returncode!=0 and 'gate='+expected in output, output
            preflight=fault in ('preflight-timer','helper-mismatch','source-corrupted')
            assert state['collector']==('active' if preflight else 'inactive'), output
            phase=('STARTED_HEALTH' if fault in ('health-failed','restart') else
                   'PREFLIGHT_HEARTBEAT' if fault=='preflight-timer' else
                   expected if fault in ('helper-mismatch','source-corrupted','installer-failed','start-failed') else 'POST_RELOAD_HEARTBEAT')
            assert 'INSTALL_FAILED gate='+phase in output, output
            assert 'recovery='+('NOT_MUTATED' if preflight else 'REVIEWED_ROLLBACK_REQUIRED') in output, output
            if preflight: assert not writes, writes
            if fault not in ('health-failed','restart','start-failed'): assert 'start wyz-schedule-collector.service' not in writes
        else:
            assert result.returncode==0 and 'CAS_REPAIR_INSTALL_PASS' in output, output
            assert state['collector']=='active', output
            assert writes==['stop wyz-schedule-collector.service','start wyz-schedule-collector.service'], writes
        print('CASE_PASS '+(fault or 'stop-install-reload-start-runtime-fields-change'))
    finally: shutil.rmtree(str(temp))


def sys_platform_linux():
    import sys
    return sys.platform.startswith('linux')


if __name__=='__main__': main()
