import ast, datetime, getpass, importlib.util, json, os, stat, tempfile, warnings
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / 'deploy/wyz/configure-school-recovery.py'
for file in (source, root / 'deploy/wyz/provision-school-auth.py'):
    ast.parse(file.read_text(encoding='utf8'), feature_version=(3, 6))
spec = importlib.util.spec_from_file_location('school_consent', str(source))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
provision_spec = importlib.util.spec_from_file_location('school_provision', str(root / 'deploy/wyz/provision-school-auth.py'))
provision = importlib.util.module_from_spec(provision_spec)
provision_spec.loader.exec_module(provision)
class FakeTerminal:
    def __init__(self, tty):
        self.tty = tty
    def isatty(self):
        return self.tty
def forbidden_read(prompt):
    raise AssertionError('hidden input must not fall back to echoed input')
for terminals in ((False, True), (True, False)):
    try:
        provision.read_credentials(FakeTerminal(terminals[0]), FakeTerminal(terminals[1]), forbidden_read)
    except SystemExit as error:
        assert str(error) == 'SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED'
    else:
        raise AssertionError('non-TTY input accepted')
def warning_read(prompt):
    warnings.warn('fixture-only echo fallback', getpass.GetPassWarning)
    raise AssertionError('warning fallback reached')
try:
    provision.read_credentials(FakeTerminal(True), FakeTerminal(True), warning_read)
except SystemExit as error:
    assert str(error) == 'SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED'
else:
    raise AssertionError('getpass echo fallback accepted')
now = datetime.datetime(2026, 10, 10, tzinfo=datetime.timezone.utc)
assert module.approval_time('2026-10-11T00:00:00Z', now) == '2026-10-11T00:00:00Z'
for value in ('wrong', '2026-10-09T00:00:00Z', '2026-12-01T00:00:00Z'):
    try:
        module.approval_time(value, now)
    except ValueError:
        pass
    else:
        raise AssertionError('invalid expiry accepted')
if os.name != 'posix' or os.geteuid() != 0:
    print('school consent expiry/3.6 syntax PASS; SKIP POSIX root atomic/permission fixtures, required in Linux CI')
else:
    with tempfile.TemporaryDirectory(prefix='fosu-school-consent-fixture-') as folder:
        target = Path(folder) / 'school-auth.json'
        value = dict(schema=1, account='fixture-user', password='fixture-only-password', recoveryEnabled=False)
        provision.read_credentials = lambda: (value['account'], value['password'])
        provision.provision(Path(folder))
        assert json.loads(target.read_text()) == value
        try:
            provision.provision(Path(folder))
        except SystemExit as error:
            assert str(error) == 'SCHOOL_AUTH_EXISTS_MANUAL_ROTATION_REQUIRED'
        else:
            raise AssertionError('existing password overwritten')
        approved = module.configure(target, '2026-10-11T00:00:00Z', now)
        assert approved['schoolRequests'] == 0 and approved['recoveryEnabled']
        updated = json.loads(target.read_text())
        assert updated['account'] == value['account'] and updated['password'] == value['password']
        assert stat.S_IMODE(target.stat().st_mode) == 0o600 and target.stat().st_uid == 0 and target.stat().st_gid == 0
        assert module.configure(target)['recoveryEnabled'] is False
        assert 'approvedUntil' not in json.loads(target.read_text())
        os.chmod(target, 0o644)
        try:
            module.configure(target)
        except ValueError as error:
            assert str(error) == 'SCHOOL_AUTH_PERMISSIONS_REJECTED'
        else:
            raise AssertionError('world-readable credentials accepted')
        target.unlink()
        other = Path(folder) / 'other.json'
        other.write_text(json.dumps(value)); os.chmod(other, 0o600)
        target.symlink_to(other)
        try:
            module.configure(target)
        except OSError:
            pass
        else:
            raise AssertionError('symlink credentials accepted')
        assert json.loads(other.read_text()) == value
    print('school consent bounded expiry, root permissions, atomic preservation/disable and symlink rejection fixtures PASS; schoolRequests=0')
