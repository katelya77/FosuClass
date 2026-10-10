#!/usr/bin/env python3
"""Read-only heartbeat-only systemd gates. Python 3.6; never print unit/env data.

ExecStart is read as a typed D-Bus array, preserving argument boundaries. Only
the executable, argv and ignore-failure flag determine the command contract;
timestamps, PID and exit records are deliberately excluded from its identity.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import time

BASE = Path('/opt/fosuclass/schedule-collector')
STATE = Path('/var/lib/fosuclass/schedule-collector')
UNIT = 'wyz-schedule-collector.service'
PERSONAL = 'wyz-campus-agent.service'
TIMER = 'wyz-schedule-collector.timer'
RUNNER = STATE / 'acceptance/heartbeat-only-runner.js'
DROPIN = Path('/etc/systemd/system') / (UNIT + '.d/90-heartbeat-acceptance.conf')


class GateError(Exception):
    pass


def require(condition, gate):
    if not condition:
        raise GateError(gate)


def command(args):
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                universal_newlines=True, timeout=10,
                                env=dict(os.environ, LC_ALL='C', SYSTEMD_COLORS='0'))
    except (OSError, subprocess.TimeoutExpired):
        raise GateError('SYSTEMD_QUERY_UNAVAILABLE')
    require(result.returncode == 0 and len(result.stdout) < 65536, 'SYSTEMD_QUERY_FAILED')
    return result.stdout.strip()


def properties(unit):
    keys = ['LoadState', 'ActiveState', 'SubState', 'Result', 'NRestarts', 'WorkingDirectory',
            'UnitFileState', 'ExecStartPre', 'ExecStartPost', 'ExecCondition', 'ExecStopPost',
            'PartOf', 'BindsTo', 'Requires', 'Wants', 'PropagatesStopTo', 'ConsistsOf']
    args = ['systemctl', 'show', unit]
    for key in keys:
        args.extend(['-p', key])
    values = {}
    for line in command(args).splitlines():
        key, separator, value = line.partition('=')
        require(separator and key in keys and key not in values, 'SYSTEMD_PROPERTIES_INVALID')
        values[key] = value
    require(values.get('LoadState') == 'loaded', 'UNIT_NOT_LOADED')
    return values


def parse_exec_start(value):
    """systemd 239+ busctl wire signature; do not use systemctl's joined argv[]."""
    try:
        tokens = shlex.split(value)
        require(tokens[:2] == ['a(sasbttttuii)', '1'], 'EXECSTART_COUNT_OR_TYPE')
        executable, count = tokens[2], int(tokens[3])
        require(0 < count < 32 and len(tokens) == 12 + count, 'EXECSTART_STRUCTURE')
        argv, ignore = tokens[4:4 + count], tokens[4 + count]
        require(ignore in ('true', 'false'), 'EXECSTART_STRUCTURE')
        require(all(re.match(r'^-?[0-9]+$', n) for n in tokens[5 + count:]), 'EXECSTART_STRUCTURE')
        return executable, argv, ignore
    except (ValueError, IndexError):
        raise GateError('EXECSTART_STRUCTURE')


def effective_command(unit):
    # systemd's bus path escaping, including underscores (not filesystem escaping).
    escaped = ''.join(chr(b) if chr(b).isalnum() else '_%02x' % b for b in unit.encode('ascii'))
    return parse_exec_start(command(['busctl', 'get-property', 'org.freedesktop.systemd1',
                                    '/org/freedesktop/systemd1/unit/' + escaped,
                                    'org.freedesktop.systemd1.Service', 'ExecStart']))


def protected_bytes(file):
    info = file.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o777 == 0o600
            and info.st_size < 65536, 'PROTECTED_FILE_PERMISSIONS')
    for directory in (file.parent, STATE):
        info = directory.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o777 == 0o700,
                'PROTECTED_DIRECTORY_PERMISSIONS')
    return file.read_bytes()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def check(expected_state):
    collector, personal, timer = properties(UNIT), properties(PERSONAL), properties(TIMER)
    require(timer.get('UnitFileState') == 'disabled', 'TIMER_NOT_DISABLED')
    require(timer.get('ActiveState') == 'inactive' and timer.get('SubState') == 'dead', 'TIMER_NOT_INACTIVE')
    require(personal.get('ActiveState') == 'active' and personal.get('SubState') == 'running', 'PERSONAL_AGENT_NOT_RUNNING')
    for properties_value, other in ((collector, PERSONAL), (personal, UNIT)):
        for key in ('PartOf', 'BindsTo', 'Requires', 'Wants', 'PropagatesStopTo', 'ConsistsOf'):
            require(other not in properties_value.get(key, '').split(), 'PERSONAL_AGENT_NOT_INDEPENDENT')
    require(collector.get('WorkingDirectory') == str(BASE / 'current'), 'WORKING_DIRECTORY')
    for key in ('ExecStartPre', 'ExecStartPost', 'ExecCondition', 'ExecStopPost'):
        require(not collector.get(key), 'UNEXPECTED_EXEC_HOOK')
    expected_argv = ['/usr/bin/env', 'FOSU_COLLECTOR_EXECUTE=0', '/usr/bin/node', str(RUNNER)]
    executable, argv, ignore = effective_command(UNIT)
    require(executable == '/usr/bin/env', 'EXECSTART_EXECUTABLE')
    require(argv == expected_argv, 'EXECSTART_ARGV_HEARTBEAT_ONLY')
    require(ignore == 'false', 'EXECSTART_IGNORE_FAILURE')
    runner_bytes = protected_bytes(RUNNER)
    protected_bytes(DROPIN)
    require(collector.get('ActiveState') == expected_state and collector.get('SubState') ==
            ('running' if expected_state == 'active' else 'dead'), 'COLLECTOR_NOT_' + expected_state.upper())
    if expected_state == 'active':
        require(collector.get('Result') == 'success', 'COLLECTOR_RESULT')
    # Private signatures catch a changed runner or personal command without logging either.
    signatures = {'runnerSha256': digest(runner_bytes),
                  'personalCommandSha256': digest(json.dumps([effective_command(PERSONAL), personal.get('WorkingDirectory')]).encode('utf8'))}
    return signatures, collector


def main():
    parser = argparse.ArgumentParser(description='Read-only heartbeat-only gate; no school access')
    parser.add_argument('--state', choices=('active', 'inactive'), required=True)
    parser.add_argument('--record')
    parser.add_argument('--baseline')
    parser.add_argument('--health', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0, 'ROOT_REQUIRED')
    require(not args.health or args.state == 'active', 'HEALTH_MODE_INVALID')
    signatures, collector = check(args.state)
    if args.baseline:
        require(signatures == json.loads(protected_bytes(Path(args.baseline)).decode('utf8')), 'RUNNER_OR_PERSONAL_COMMAND_CHANGED')
    if args.record:
        descriptor = os.open(args.record, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(signatures, stream)
    if args.health:
        # Bounded local liveness, not a replacement for the completed HMAC acceptance.
        for sample in range(6):
            if sample:
                time.sleep(1)
            current_signatures, collector = check('active')
            require(current_signatures == signatures, 'RUNNER_OR_PERSONAL_COMMAND_CHANGED')
            require(collector.get('NRestarts') == '0', 'COLLECTOR_RESTARTED')
    print('HEARTBEAT_GATE_PASS state=' + args.state + ' execute=0 runner=heartbeat-only personal=independent timer=disabled/inactive' +
          (' health=local-stable-5s' if args.health else ''))


if __name__ == '__main__':
    try:
        main()
    except GateError as error:
        print('HEARTBEAT_GATE_FAILED gate=' + str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, TypeError):
        print('HEARTBEAT_GATE_FAILED gate=PROTECTED_STATE_INVALID', file=sys.stderr)
        sys.exit(1)
