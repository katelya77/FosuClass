import ast
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

source = Path(__file__).parents[1] / 'deploy/wyz/apply-control-keepalive.py'
ast.parse(source.read_text(), feature_version=(3, 6))
spec = importlib.util.spec_from_file_location('patch_runner', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
installer = (source.parent / 'accept-oracle-direct.sh').read_text()
original = (re.search(r"<<'JS'\n(.*?)\nJS", installer, re.S).group(1) + '\n').encode('utf8')
target = module.patch(original)
assert module.digest(original) == module.ORIGINAL_HASH
assert b'process.env.FOSU_COLLECTOR_EXECUTE = "0"' in target
assert b'spec.agent.options.timeout = 75000' in target
assert b'url.origin !== transport.ORIGIN' in target
assert b'url.pathname !== "/api/full-sync/v1/heartbeat"' in target
assert module.patch(original.replace(b'\n', b'\r\n')) == target
try:
    module.patch(original + b'// synthetic-private-marker\n')
    raise AssertionError('changed runner accepted')
except ValueError as error:
    assert str(error) == 'ACCEPTANCE_RUNNER_NOT_ORIGINAL'
with tempfile.TemporaryDirectory(prefix='fosu-keepalive-fixture-') as tmp:
    root = Path(tmp)
    syntax = root / 'syntax.js'
    syntax.write_bytes(target)
    assert subprocess.run(['node', '--check', str(syntax)], stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode == 0
    if os.name == 'nt':
        print('SKIP POSIX atomic/ownership on Windows; Linux CI executes root-only filesystem fixture')
    else:
        assert os.geteuid() == 0, 'run this POSIX fixture with sudo'
        module.ACCEPTANCE = root
        module.RUNNER = root / 'heartbeat-only-runner.js'
        module.RUNNER.write_bytes(original)
        os.chmod(str(module.RUNNER), 0o600)
        safety_calls, commands = [], []
        module.check_safety = lambda **kwargs: safety_calls.append(kwargs)
        def command(args):
            commands.append(args)
            if args[:2] == ['node', '--check']:
                result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                return result.returncode, ''
            return 0, 'active'
        module.command = command
        previous = sys.argv
        try:
            sys.argv = ['fixture', '--dry-run']
            module.main()
            assert module.RUNNER.read_bytes() == original and not commands
            sys.argv = ['fixture', '--apply']
            module.main()
            assert module.RUNNER.read_bytes() == target
            pointer = root / 'control-keepalive-last-backup'
            backup = root / pointer.read_text().strip() / 'runner.js'
            assert backup.read_bytes() == original
            assert module.RUNNER.stat().st_mode & 0o777 == 0o600
            sys.argv = ['fixture', '--rollback']
            module.RUNNER.write_bytes(target + b'// changed by another operation\n')
            restarts = len(commands)
            try:
                module.main()
                raise AssertionError('stale rollback accepted')
            except ValueError as error:
                assert str(error) == 'RUNNER_CHANGED_SINCE_PATCH'
            assert len(commands) == restarts
            module.RUNNER.write_bytes(target)
            module.main()
            assert module.RUNNER.read_bytes() == original
            assert len(safety_calls) == 4
            assert [args for args in commands if args[:2] == ['systemctl', 'restart']] == [
                ['systemctl', 'restart', module.UNIT], ['systemctl', 'restart', module.UNIT]]
            assert not any(module.PERSONAL in args or module.TIMER in args for args in commands)
        finally:
            sys.argv = previous
print('b1 acceptance keepalive patch: exact original binding, control-only scope, syntax, atomic backup/rollback fixtures PASS; no production or school requests')
