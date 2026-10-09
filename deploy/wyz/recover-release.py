#!/usr/bin/env python3
"""Validate every archive member before recovering missing source files only."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import sys
import tarfile


def recover(bundle, destination):
    root = Path(destination)
    if not root.is_absolute() or root.is_symlink():
        raise ValueError("RELEASE_PATH_REJECTED")
    with tarfile.open(bundle, "r:gz") as archive:
        members = archive.getmembers()
        names = set()
        if len(members) > 10000 or sum(member.size for member in members) > 512 * 1024 * 1024:
            raise ValueError("ARCHIVE_SIZE_REJECTED")
        for member in members:
            name = member.name.rstrip("/")
            parts = PurePosixPath(name).parts
            if (not parts or member.name.startswith("/") or ".." in parts
                    or any(c in member.name for c in "\\\r\n\x00")
                    or name in names or not (member.isfile() or member.isdir())):
                raise ValueError("ARCHIVE_MEMBER_REJECTED")
            names.add(name)
            target = root.joinpath(*parts)
            for parent in [target, *target.parents]:
                if parent.is_symlink():
                    raise ValueError("RELEASE_SYMLINK_REJECTED")
                if parent == root:
                    break
            if target.exists():
                if member.isdir() and not target.is_dir():
                    raise ValueError("RELEASE_TYPE_CONFLICT")
                if member.isfile():
                    if not target.is_file() or hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(archive.extractfile(member).read()).digest():
                        raise ValueError("EXISTING_SOURCE_CORRUPTED")
        # Nothing is extracted until the entire archive and existing source pass.
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        for member in members:
            target = root.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            elif not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, "wb") as output:
                    output.write(archive.extractfile(member).read())
                    output.flush()
                    os.fsync(output.fileno())
    print("SOURCE_INTEGRITY=PASS")


if __name__ == "__main__":
    try:
        recover(*sys.argv[1:])
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else "RELEASE_RECOVERY_FAILED", file=sys.stderr)
        sys.exit(1)
