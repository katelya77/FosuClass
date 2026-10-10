#!/usr/bin/env python3
"""Root-only, atomic school consent update. Never reads Oracle credentials or performs network requests."""
import argparse, datetime, json, os, stat, tempfile
from pathlib import Path

UTC = datetime.timezone.utc
FIELDS = {'schema', 'account', 'password', 'recoveryEnabled', 'approvedUntil'}

def approval_time(value, now=None):
    now = now or datetime.datetime.now(UTC)
    try:
        approved = datetime.datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
    except (TypeError, ValueError):
        raise ValueError('SCHOOL_AUTH_APPROVAL_TIME_REJECTED')
    if not now < approved <= now + datetime.timedelta(days=30):
        raise ValueError('SCHOOL_AUTH_APPROVAL_TIME_REJECTED')
    return approved.strftime('%Y-%m-%dT%H:%M:%SZ')

def configure(target, approved_until=None, now=None):
    if os.geteuid() != 0:
        raise ValueError('ROOT_REQUIRED')
    target = Path(target)
    parent = target.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or stat.S_IMODE(parent.st_mode) != 0o700:
        raise ValueError('SCHOOL_AUTH_PARENT_PERMISSIONS_REJECTED')
    descriptor = os.open(str(target), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'r') as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size > 1048576:
            raise ValueError('SCHOOL_AUTH_PERMISSIONS_REJECTED')
        value = json.load(stream)
    if not isinstance(value, dict) or set(value) - FIELDS or type(value.get('schema')) is not int or value['schema'] != 1 or not isinstance(value.get('account'), str) or not value['account'].strip() or not isinstance(value.get('password'), str) or not value['password'] or not isinstance(value.get('recoveryEnabled'), bool):
        raise ValueError('SCHOOL_AUTH_CONFIGURATION_REJECTED')
    value['recoveryEnabled'] = approved_until is not None
    if approved_until is None:
        value.pop('approvedUntil', None)
    else:
        value['approvedUntil'] = approval_time(approved_until, now)
    descriptor, temporary = tempfile.mkstemp(prefix='.school-consent-', dir=str(target.parent))
    try:
        os.fchmod(descriptor, 0o600)
        os.fchown(descriptor, 0, 0)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, str(target))
        parent_descriptor = os.open(str(target.parent), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_descriptor)
        finally:
            os.close(parent_descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return dict(recoveryEnabled=value['recoveryEnabled'], approvedUntil=value.get('approvedUntil'), schoolRequests=0, oracleCredentialsRead=False, timerChanged=False, collectorRestarted=False, personalAgentChanged=False)

def main():
    parser = argparse.ArgumentParser()
    options = parser.add_mutually_exclusive_group(required=True)
    options.add_argument('--approve-until')
    options.add_argument('--disable', action='store_true')
    args = parser.parse_args()
    print(json.dumps(configure('/etc/fosuclass/school-auth.json', args.approve_until)))

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        code = str(error) if isinstance(error, ValueError) and str(error).replace('_', '').isupper() else 'SCHOOL_AUTH_CONSENT_UPDATE_FAILED'
        raise SystemExit(code)
