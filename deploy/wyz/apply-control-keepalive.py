#!/usr/bin/env python3
"""Manual b1bc12f9 acceptance-runner patch. Python 3.6; no secret reads."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

REVISION = 'b1bc12f96692768d53004e2573e78e6bd5a62d5d'
STATE = Path('/var/lib/fosuclass/schedule-collector')
ACCEPTANCE = STATE / 'acceptance'
RUNNER = ACCEPTANCE / 'heartbeat-only-runner.js'
DROPIN = Path('/etc/systemd/system/wyz-schedule-collector.service.d/90-heartbeat-acceptance.conf')
UNIT = 'wyz-schedule-collector.service'
TIMER = 'wyz-schedule-collector.timer'
PERSONAL = 'wyz-campus-agent.service'
ORIGINAL_HASH = '4e0b685381799fba263cf54bbf7a95db6689f7aa9c71e7e88481c7444acb13ba'
NEEDLE = 'const fetcher = transport.createFetcher(cfg.transport, { onConnection: c => console.log(JSON.stringify({ acceptanceConnection: c })) });'
REPLACEMENT = '''// Only this private control agent's idle socket lifetime changes.
// The installed b1 transport still enforces its origin, CA, SNI and scope.
const https = require("https");
const keepaliveRequest = (url, spec, callback) => {
  if (url.origin !== transport.ORIGIN || url.pathname !== "/api/full-sync/v1/heartbeat" || !spec.agent || !spec.agent.options.keepAlive) throw Error("ACCEPTANCE_POLICY_REJECTED");
  spec.agent.options.timeout = 75000;
  return https.request(url, spec, callback);
};
const fetcher = transport.createFetcher(cfg.transport, { request: keepaliveRequest, onConnection: c => console.log(JSON.stringify({ acceptanceConnection: c })) });'''


def digest(value):
    return hashlib.sha256(value.replace(b'\r\n', b'\n')).hexdigest()


def patch(value):
    if digest(value) != ORIGINAL_HASH:
        raise ValueError('ACCEPTANCE_RUNNER_NOT_ORIGINAL')
    source = value.replace(b'\r\n', b'\n').decode('utf8')
    if source.count(NEEDLE) != 1:
        raise ValueError('ACCEPTANCE_RUNNER_REJECTED')
    return source.replace(NEEDLE, REPLACEMENT).encode('utf8')


def protected(path, directory=False, mode=None):
    stat = path.lstat()
    if path.is_symlink() or stat.st_uid != 0 or stat.st_mode & 0o077:
        raise ValueError('PROTECTED_PATH_REJECTED')
    if directory != path.is_dir() or mode is not None and stat.st_mode & 0o777 != mode:
        raise ValueError('PROTECTED_PATH_REJECTED')
    if not directory and (not path.is_file() or stat.st_size > 32768):
        raise ValueError('PROTECTED_FILE_REJECTED')


def command(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            universal_newlines=True, timeout=30)
    return result.returncode, result.stdout.strip()


def check_safety(require_active=True):
    if os.geteuid() != 0:
        raise ValueError('ROOT_REQUIRED')
    code, version = command(['node', '--version'])
    if code != 0 or version != 'v20.20.2':
        raise ValueError('NODE_VERSION_REJECTED')
    current = Path('/opt/fosuclass/schedule-collector/current')
    if not current.is_symlink() or str(current.resolve()) != '/opt/fosuclass/schedule-collector/releases/' + REVISION:
        raise ValueError('INSTALLED_REVISION_REJECTED')
    for directory in (STATE, ACCEPTANCE, DROPIN.parent):
        protected(directory, directory=True, mode=0o700)
    for file in (RUNNER, DROPIN, Path('/etc/fosuclass/full-sync.env')):
        protected(file, mode=0o600)
    expected = '[Service]\nExecStart=\nExecStart=/usr/bin/env FOSU_COLLECTOR_EXECUTE=0 /usr/bin/node ' + str(RUNNER) + '\n'
    if DROPIN.read_bytes().replace(b'\r\n', b'\n') != expected.encode('utf8'):
        raise ValueError('HEARTBEAT_ONLY_UNIT_REJECTED')
    if command(['systemctl', 'is-enabled', TIMER])[1] != 'disabled' or command(['systemctl', 'is-active', TIMER])[1] != 'inactive':
        raise ValueError('TIMER_GATE_REJECTED')
    if command(['systemctl', 'is-active', PERSONAL])[1] != 'active':
        raise ValueError('PERSONAL_AGENT_NOT_ACTIVE')
    if require_active and command(['systemctl', 'is-active', UNIT])[1] != 'active':
        raise ValueError('COLLECTOR_NOT_ACTIVE')
    js = 'const p=require(process.argv[1]).load(process.argv[2]);if(p.mode!=="oracle-direct")process.exit(1);'
    module = str(current / 'tools/wyz-schedule-collector/oracleTransport.js')
    if command(['node', '-e', js, module, str(STATE)])[0] != 0:
        raise ValueError('ORACLE_DIRECT_POLICY_REJECTED')


def atomic(file, value):
    descriptor, temporary = tempfile.mkstemp(prefix='keepalive-', dir=str(file.parent))
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, str(file))
        parent = os.open(str(file.parent), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    if len(sys.argv) not in (1, 2):
        raise ValueError('MODE_REJECTED')
    mode = sys.argv[1] if len(sys.argv) == 2 else '--dry-run'
    if mode not in ('--apply', '--rollback', '--dry-run'):
        raise ValueError('MODE_REJECTED')
    os.umask(0o077)
    check_safety(require_active=mode != '--rollback')
    source = RUNNER.read_bytes()
    pointer = ACCEPTANCE / 'control-keepalive-last-backup'
    if mode == '--rollback':
        protected(pointer, mode=0o600)
        name = pointer.read_text().strip()
        if not re.fullmatch(r'control-keepalive-[0-9TZ]+-[0-9]+', name):
            raise ValueError('BACKUP_PATH_REJECTED')
        directory = ACCEPTANCE / name
        protected(directory, directory=True, mode=0o700)
        backup = directory / 'runner.js'
        protected(backup, mode=0o600)
        original = backup.read_bytes()
        if digest(source) != digest(patch(original)):
            raise ValueError('RUNNER_CHANGED_SINCE_PATCH')
        target = original
    else:
        target = patch(source)
        if mode == '--dry-run':
            print(json.dumps(dict(dryRun=True, controlIdleTimeoutMs=75000, connectTimeoutMs=6000,
                heartbeatRequestTimeoutMs=15000, leaseSeconds=90, schoolRequests=0,
                configurationChanged=False, serviceRestarted=False)))
            return
        directory = ACCEPTANCE / ('control-keepalive-' + datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ') + '-' + str(os.getpid()))
        directory.mkdir(mode=0o700)
        atomic(directory / 'runner.js', source)
        atomic(pointer, (directory.name + '\n').encode('utf8'))
    descriptor, candidate = tempfile.mkstemp(prefix='runner-check-', suffix='.js', dir=str(ACCEPTANCE))
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(target)
        if command(['node', '--check', candidate])[0] != 0:
            raise ValueError('RUNNER_SYNTAX_REJECTED')
    finally:
        os.unlink(candidate)
    atomic(RUNNER, target)
    if command(['systemctl', 'restart', UNIT])[0] != 0:
        raise ValueError('COLLECTOR_RESTART_FAILED_USE_ROLLBACK')
    active = command(['systemctl', 'is-active', UNIT])[1] == 'active'
    print(json.dumps(dict(status='CONTROL_KEEPALIVE_APPLIED' if mode == '--apply' else 'CONTROL_KEEPALIVE_ROLLED_BACK',
        collectorRevision=REVISION, controlIdleTimeoutMs=75000 if mode == '--apply' else 5000,
        execute=0, timer='disabled', personalAgent='active', collectorActive=active,
        secretsRead=False, codeReleaseChanged=False, checkpointsChanged=False,
        schoolRequests=0, acceptance='PENDING', backupName=directory.name)))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        allowed = str(error) if isinstance(error, ValueError) and re.fullmatch('[A-Z_]+', str(error)) else 'CONTROL_KEEPALIVE_OPERATION_FAILED'
        raise SystemExit(allowed)
