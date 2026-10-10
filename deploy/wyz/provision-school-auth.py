#!/usr/bin/env python3
# PAM terminal input only. Secrets never appear in command arguments or stdout.
import getpass, json, os, stat, sys, tempfile, warnings
from pathlib import Path
def read_credentials(input_stream=None, error_stream=None, reader=None):
    input_stream = input_stream or sys.stdin
    error_stream = error_stream or sys.stderr
    reader = reader or getpass.getpass
    if not input_stream.isatty() or not error_stream.isatty():
        raise SystemExit('SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        try:
            account = reader('学校账号（隐藏输入）: ').strip()
            password = reader('学校密码（隐藏输入）: ')
        except getpass.GetPassWarning:
            raise SystemExit('SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED')
    if not account or not password:
        raise SystemExit('SCHOOL_AUTH_INPUT_REQUIRED')
    return account, password

def provision(directory=Path('/etc/fosuclass')):
    if os.geteuid() != 0:
        raise SystemExit('ROOT_REQUIRED')
    if directory.is_symlink() or not directory.is_dir() or directory.stat().st_uid != 0 or stat.S_IMODE(directory.stat().st_mode) & 0o077:
        raise SystemExit('SCHOOL_AUTH_PARENT_PERMISSIONS_REJECTED')
    target = directory / 'school-auth.json'
    if target.exists() or target.is_symlink():
        raise SystemExit('SCHOOL_AUTH_EXISTS_MANUAL_ROTATION_REQUIRED')
    account, password = read_credentials()
    fd, temp = tempfile.mkstemp(prefix='.school-auth-', dir=str(directory))
    try:
        os.fchmod(fd, 0o600)
        os.fchown(fd, 0, 0)
        with os.fdopen(fd, 'w') as stream:
            json.dump(dict(schema=1,account=account,password=password,recoveryEnabled=False),stream)
            stream.flush()
            os.fsync(stream.fileno())
        # Atomically publish without rotating a concurrently created password.
        os.link(temp, str(target))
        parent = os.open(str(directory), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)

if __name__ == '__main__':
    try:
        provision()
    except OSError:
        raise SystemExit('SCHOOL_AUTH_PROVISION_FAILED')
    print('SCHOOL_AUTH_PROVISIONED rootOnly=true recoveryEnabled=false schoolRequests=0')
