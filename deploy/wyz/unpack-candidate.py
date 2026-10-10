#!/usr/bin/env python3
"""Validate a pinned delivery ZIP, flatten one inner root; never install/start."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile
import zipfile


def require(condition):
    if not condition:
        raise ValueError('CANDIDATE_ZIP_REJECTED')


def unpack(bundle, digest, destination):
    bundle, destination = Path(bundle), Path(destination)
    require(re.fullmatch('[a-f0-9]{64}', digest))
    require(bundle.is_file() and not bundle.is_symlink() and bundle.stat().st_size < 100 * 1024 * 1024)
    require(not destination.exists() and not destination.is_symlink())
    require(destination.parent.is_dir())
    require(not any(p.is_symlink() for p in [destination.parent, *destination.parent.parents]))
    data = bundle.read_bytes()
    require(hashlib.sha256(data).hexdigest() == digest)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        require(0 < len(members) <= 60 and sum(m.file_size for m in members) < 200 * 1024 * 1024)
        names = [m.filename for m in members]
        require(len(names) == len(set(names)))
        for member in members:
            name = member.filename.rstrip('/')
            parts = name.split('/')
            require(name and not member.flag_bits & 1 and len(parts) <= 5)
            require(all(re.fullmatch('[A-Za-z0-9_.-]+', p) and p not in ('.', '..') for p in parts))
            mode = stat.S_IFMT(member.external_attr >> 16)
            require(mode in (0, stat.S_IFDIR if member.is_dir() else stat.S_IFREG))
        roots = [PurePosixPath(n).parent for n in names if PurePosixPath(n).name == 'upgrade-candidate.json']
        require(len(roots) == 1)
        root = roots[0]
        files = {}
        for member in members:
            if member.is_dir():
                continue
            item = PurePosixPath(member.filename)
            require(item.parent == root)
            files[item.name] = archive.read(member)
    manifest = json.loads(files['upgrade-candidate.json'])
    require(set(manifest) == {'fromRevision', 'revision', 'bundle', 'sha256'})
    require(all(re.fullmatch('[a-f0-9]{40}', manifest[k]) for k in ('fromRevision', 'revision')))
    require(manifest['bundle'] == 'wyz-schedule-collector-' + manifest['revision'] + '.tar.gz')
    require(re.fullmatch('[a-f0-9]{64}', manifest['sha256']))
    source = files[manifest['bundle']]
    require(hashlib.sha256(source).hexdigest() == manifest['sha256'])
    require(files['source.sha256'] == (manifest['sha256'] + '  ' + manifest['bundle'] + '\n').encode('ascii'))
    with tarfile.open(fileobj=io.BytesIO(source), mode='r:gz') as tar:
        for name in ('upgrade-candidate.sh', 'check-heartbeat-service.py', 'install-schedule-collector.sh',
                     'recover-release.py', 'rollback-schedule-collector.sh', 'unpack-candidate.py'):
            matches = [m for m in tar.getmembers() if m.name == 'deploy/wyz/' + name]
            require(len(matches) == 1 and matches[0].isfile())
            require(files[name] == tar.extractfile(matches[0]).read())
    destination.mkdir(mode=0o700)
    for name, content in files.items():
        target = destination / name
        with target.open('xb') as output:
            output.write(content)
        target.chmod(0o600)
    return destination.resolve()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('zip')
    parser.add_argument('sha256')
    parser.add_argument('destination')
    args = parser.parse_args()
    try:
        print(unpack(args.zip, args.sha256, args.destination))
    except (ValueError, OSError, KeyError, tarfile.TarError, zipfile.BadZipFile):
        raise SystemExit('CANDIDATE_ZIP_REJECTED')
