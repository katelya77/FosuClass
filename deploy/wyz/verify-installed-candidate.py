#!/usr/bin/env python3
"""Read-only verification of every pinned candidate source file and receipt."""
import hashlib, json, re, tarfile
from pathlib import Path, PurePosixPath
BASE=Path('/opt/fosuclass/schedule-collector')
PREVIOUS='9153876458df7b1dd6b4fae698851638b31c702e'
def require(value):
    if not value: raise ValueError('INSTALLED_CANDIDATE_REJECTED')
def verify(folder,base=BASE):
    manifest=json.loads((folder/'upgrade-candidate.json').read_text())
    require(set(manifest)=={'revision','fromRevision','bundle','sha256'})
    revision=manifest['revision'];require(re.fullmatch('[a-f0-9]{40}',revision) and manifest['fromRevision']==PREVIOUS)
    require(manifest['bundle']=='wyz-schedule-collector-'+revision+'.tar.gz' and re.fullmatch('[a-f0-9]{64}',manifest['sha256']))
    source=folder/manifest['bundle'];require(source.is_file() and not source.is_symlink())
    require(hashlib.sha256(source.read_bytes()).hexdigest()==manifest['sha256'])
    root=base/'releases'/revision;require(not root.is_symlink() and (base/'current').resolve()==root)
    receipt=root/'.install-complete.json';require(receipt.is_file() and not receipt.is_symlink())
    installed=json.loads(receipt.read_text());require(installed['revision']==revision and installed['bundleSha256']==manifest['sha256'] and installed['runtimeVerified'] is True)
    with tarfile.open(source,'r:gz') as tar:
        members=tar.getmembers();require(len(members)==len(set(m.name for m in members)))
        checked=0
        for member in members:
            p=PurePosixPath(member.name);require(not p.is_absolute() and '..' not in p.parts)
            if member.isdir():continue
            require(member.isfile());file=root/member.name
            require(file.is_file() and all(not item.is_symlink() for item in [file,*file.parents] if item==root or root in item.parents))
            require(hashlib.sha256(file.read_bytes()).digest()==hashlib.sha256(tar.extractfile(member).read()).digest());checked+=1
    packaged=json.loads((folder/(manifest['bundle']+'.receipt.json')).read_text())
    require(packaged['sha']==revision and packaged['sha256']==manifest['sha256'] and packaged['files']==checked)
    return {'status':'SOURCE_INTEGRITY_PASS','revision':revision,'files':checked,'reinstalled':False}
if __name__=='__main__':
    try:print(json.dumps(verify(Path.cwd())))
    except (OSError,ValueError,KeyError,tarfile.TarError):print('BLOCKED stage=SOURCE_ACCEPTANCE code=INSTALLED_CANDIDATE_REJECTED');raise SystemExit(2)
