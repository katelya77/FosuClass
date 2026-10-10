#!/usr/bin/env python3
"""Package committed upgrade helpers; never synthesize unreviewed shell scripts."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def git(*args):
    return subprocess.check_output(['git'] + list(args), cwd=str(ROOT))


def require(condition):
    if not condition:
        raise ValueError('UPGRADE_DELIVERY_SOURCE_REJECTED')


def build(previous):
    require(re.fullmatch(r'[a-f0-9]{40}', previous))
    revision = git('rev-parse', 'HEAD').decode().strip()
    require(previous != revision)
    git('cat-file', '-e', previous + '^{commit}')
    require(subprocess.call(['git', 'merge-base', '--is-ancestor', previous, revision], cwd=str(ROOT)) == 0)
    parent = ROOT / '.local/collector-packages'
    archive = parent / ('wyz-schedule-collector-' + revision + '.tar.gz')
    data = archive.read_bytes()
    receipt = json.loads(Path(str(archive) + '.receipt.json').read_text(encoding='utf8'))
    digest = hashlib.sha256(data).hexdigest()
    require(receipt['sha'] == revision and receipt['sha256'] == digest)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        members = [m for m in tar.getmembers() if m.isfile()]
        names = [m.name for m in members]
        require(len(names) == len(set(names)) == receipt['files'])
        source = {m.name: tar.extractfile(m).read() for m in members}
    # Check every archive source byte against the commit, not just its receipt.
    with tarfile.open(fileobj=io.BytesIO(git('archive', '--format=tar', revision, '--', *names)), mode='r:') as tar:
        committed = {m.name: tar.extractfile(m).read() for m in tar.getmembers() if m.isfile()}
    require(source == committed)
    helpers = ['upgrade-candidate.sh', 'check-heartbeat-service.py', 'install-schedule-collector.sh',
               'recover-release.py', 'rollback-schedule-collector.sh']
    folder = parent / ('heartbeat-upgrade-' + revision)
    folder.mkdir(exist_ok=False)
    for name in helpers:
        (folder / name).write_bytes(source['deploy/wyz/' + name])
    (folder / archive.name).write_bytes(data)
    (folder / 'source.sha256').write_text(digest + '  ' + archive.name + '\n', encoding='ascii')
    (folder / 'upgrade-candidate.json').write_text(json.dumps({'fromRevision': previous, 'revision': revision,
                   'bundle': archive.name, 'sha256': digest}, indent=2) + '\n', encoding='ascii')
    (folder / (archive.name + '.receipt.json')).write_text(json.dumps(receipt, indent=2), encoding='utf8')
    (folder / 'fosuclass-operations-and-release-runbook.md').write_bytes(source['docs/production/fosuclass-operations-and-release-runbook.md'])
    (folder / 'PAM-HANDOFF.md').write_text('''# Heartbeat-only upgrade helper candidate

Commit: {revision}
Expected installed predecessor: {previous}
Source SHA256: {digest}

This package has not been installed. Do not reinstall WYZ as part of the current
repair. The operator is restoring the already installed 6eea0ec service separately.
All helpers are exact committed source; source.sha256 and upgrade-candidate.json
bind the archive. Review the runbook before any separately approved installation.

Only after installation approval, from this unpacked root-only directory:

```bash
sha256sum -c source.sha256
bash upgrade-candidate.sh --approve-install
```

After the operator has restored the service, this independent read-only check
needs no school credentials and does not change any unit or start a service:

```bash
python3 check-heartbeat-service.py --state active --health
```

Failures report INSTALL_FAILED gate and HEARTBEAT_GATE_FAILED subgate. Never
delete auth history, reset cooldown, enable the timer or automatically retry.
The runbook documents approved rollback using the exact BACKUP_PATH. No school
login, sample, Oracle deployment, CloudBase active switch or Agent changes.
'''.format(revision=revision, previous=previous, digest=digest), encoding='utf8')
    target = folder.with_suffix('.zip')
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive_zip:
        for item in sorted(folder.iterdir()):
            archive_zip.write(item, item.name)
    delivery = {'commit': revision, 'previousCommit': previous, 'sourceFiles': receipt['files'],
                'sourceSha256': digest, 'archive': str(target),
                'archiveSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                'allSourceBytesMatchGit': True, 'productionInstalled': False, 'schoolAccessExecuted': False}
    Path(str(target) + '.receipt.json').write_text(json.dumps(delivery, indent=2), encoding='utf8')
    print(json.dumps(delivery, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--from-revision', required=True)
    build(parser.parse_args().from_revision)
