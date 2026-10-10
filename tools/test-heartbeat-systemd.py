#!/usr/bin/env python3
"""Real local systemd metadata regression using a unique, temporary sleep unit.

No production unit names, network, timers or personal Agent access. Always cleans
its own /run unit. Run only on an isolated Linux development/CI host as root.
"""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('heartbeat_gate', ROOT/'deploy/wyz/check-heartbeat-service.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, universal_newlines=True).strip()


def main():
    assert os.geteuid()==0, 'ISOLATED_LINUX_ROOT_REQUIRED'
    assert run('systemctl','show','--property=Version','--value'), 'SYSTEMD_REQUIRED'
    name='fosu-upgrade-fixture-'+uuid.uuid4().hex+'.service'
    unit=Path('/run/systemd/system')/name
    assert not unit.exists()
    directory=Path(tempfile.mkdtemp(prefix='fosu-real-systemd-'))
    try:
        def install():
            unit.write_text('[Unit]\nDescription=Fosu isolated metadata fixture\n[Service]\nType=simple\nWorkingDirectory='+str(directory)+'\nExecStart=/usr/bin/env FOSU_COLLECTOR_EXECUTE=0 /usr/bin/sleep infinity\n',encoding='utf8')
            unit.chmod(0o600)
        def raw(): return run('systemctl','show',name,'-p','ExecStart','--value')
        escaped=''.join(c if c.isalnum() else '_%02x'%ord(c) for c in name)
        def effective():
            return gate.parse_exec_start(run('busctl','get-property','org.freedesktop.systemd1',
                    '/org/freedesktop/systemd1/unit/'+escaped,'org.freedesktop.systemd1.Service','ExecStart'))
        install(); run('systemctl','daemon-reload'); run('systemctl','start',name)
        before,command=raw(),effective()
        assert command==('/usr/bin/env',['/usr/bin/env','FOSU_COLLECTOR_EXECUTE=0','/usr/bin/sleep','infinity'],'false')
        run('systemctl','stop',name)
        stopped=raw()
        assert before!=stopped, 'LEGACY_EQUALITY_MUST_FAIL_AFTER_STOP'
        # Install the same command as the new unit version and reload its config.
        install(); run('systemctl','daemon-reload')
        assert effective()==command
        assert run('systemctl','show',name,'-p','ActiveState','--value')=='inactive'
        run('systemctl','start',name)
        assert effective()==command
        for sample in range(3):
            time.sleep(0.1)
            assert run('systemctl','show',name,'-p','ActiveState','--value')=='active'
            assert run('systemctl','show',name,'-p','SubState','--value')=='running'
            assert run('systemctl','show',name,'-p','NRestarts','--value')=='0'
        assert raw()!=before
        print('real-systemd: PASS old-active -> stopped -> unit-install -> daemon-reload -> new-active; raw equality failed, typed command identity preserved')
    finally:
        subprocess.run(['systemctl','stop',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if unit.exists(): unit.unlink()
        subprocess.run(['systemctl','daemon-reload'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        subprocess.run(['systemctl','reset-failed',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        directory.rmdir()


if __name__=='__main__': main()
