#!/usr/bin/env python3
# PAM terminal input only. Secrets never appear in command arguments or stdout.
import getpass, json, os, stat, sys, tempfile
from pathlib import Path
if os.geteuid() != 0:
    raise SystemExit('ROOT_REQUIRED')
directory = Path('/etc/fosuclass')
if directory.is_symlink() or not directory.is_dir() or directory.stat().st_uid != 0 or stat.S_IMODE(directory.stat().st_mode) & 0o077:
    raise SystemExit('SCHOOL_AUTH_PARENT_PERMISSIONS_REJECTED')
target = directory / 'school-auth.json'
if target.exists() or target.is_symlink():
    raise SystemExit('SCHOOL_AUTH_EXISTS_MANUAL_ROTATION_REQUIRED')
account = getpass.getpass('学校账号（隐藏输入）: ').strip()
password = getpass.getpass('学校密码（隐藏输入）: ')
if not account or not password:
    raise SystemExit('SCHOOL_AUTH_INPUT_REQUIRED')
fd, temp = tempfile.mkstemp(prefix='.school-auth-',dir=str(directory))
try:
    os.fchmod(fd,0o600)
    with os.fdopen(fd,'w') as stream:
        json.dump(dict(schema=1,account=account,password=password,recoveryEnabled=False),stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp,str(target))
finally:
    if os.path.exists(temp):
        os.unlink(temp)
print('SCHOOL_AUTH_PROVISIONED rootOnly=true recoveryEnabled=false schoolRequests=0')
