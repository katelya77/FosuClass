#!/usr/bin/env python3
"""Compare the exact archive file set and streamed contents, ignoring mode.

The extracted candidate remains root-private. No extraction or file writes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile


class VerificationError(Exception):
    pass


def reject(code):
    raise VerificationError(code)


def source_path(root, name):
    parts = PurePosixPath(name).parts
    if not parts or name.startswith("/") or "\\" in name or "\x00" in name or any(p in ("", ".", "..") for p in parts) or str(PurePosixPath(name)) != name:
        reject("SOURCE_ARCHIVE_PATH_REJECTED")
    target = root
    for index, part in enumerate(parts):
        target = target / part
        record = target.lstat()
        if stat.S_ISLNK(record.st_mode) or index < len(parts) - 1 and not stat.S_ISDIR(record.st_mode):
            reject("SOURCE_CANDIDATE_LINK_REJECTED")
    return target


def verify(archive_file, candidate_dir):
    root = Path(candidate_dir)
    if not root.is_absolute() or root.resolve() != root or not root.is_dir() or root.is_symlink():
        reject("SOURCE_CANDIDATE_ROOT_REJECTED")
    expected = set()
    records = []
    total = 0
    # r|gz streams the archive once. It never restores public archive modes.
    with tarfile.open(archive_file, "r|gz") as archive:
        for member in archive:
            if not member.isfile() or member.islnk() or member.issym():
                reject("SOURCE_ARCHIVE_TYPE_REJECTED")
            if member.name in expected:
                reject("SOURCE_ARCHIVE_DUPLICATE_REJECTED")
            target = source_path(root, member.name)
            expected.add(member.name)
            if len(expected) > 20000 or member.size < 0 or total + member.size > 512 * 1024 * 1024:
                reject("SOURCE_ARCHIVE_BUDGET_REJECTED")
            descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(descriptor, "rb") as current:
                before = os.fstat(current.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size != member.size:
                    reject("SOURCE_FILE_TYPE_OR_SIZE_MISMATCH")
                original_hash = hashlib.sha256()
                current_hash = hashlib.sha256()
                streamed = 0
                original = archive.extractfile(member)
                if original is None:
                    reject("SOURCE_ARCHIVE_STREAM_REJECTED")
                while True:
                    block = original.read(1024 * 1024)
                    if not block:
                        break
                    streamed += len(block)
                    original_hash.update(block)
                    current_hash.update(current.read(len(block)))
                if current.read(1) or streamed != member.size or original_hash.digest() != current_hash.digest():
                    reject("SOURCE_FILE_CONTENT_MISMATCH")
                after = os.fstat(current.fileno())
                if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
                    reject("SOURCE_FILE_CHANGED_DURING_VERIFICATION")
                records.append((member.name, member.size, original_hash.hexdigest()))
                total += member.size
    actual = set()
    for directory, subdirectories, files in os.walk(root, followlinks=False):
        for name in subdirectories:
            if not stat.S_ISDIR((Path(directory) / name).lstat().st_mode):
                reject("SOURCE_CANDIDATE_LINK_REJECTED")
        for name in files:
            file = Path(directory) / name
            record = file.lstat()
            if not stat.S_ISREG(record.st_mode) or record.st_nlink != 1:
                reject("SOURCE_CANDIDATE_TYPE_REJECTED")
            actual.add(file.relative_to(root).as_posix())
    if actual != expected:
        reject("SOURCE_FILE_SET_MISMATCH")
    fingerprint = hashlib.sha256(json.dumps(sorted(records), separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
    return {"schema": "oracle-source-content-verification.v1", "status": "PASS", "files": len(records), "bytes": total, "contentFingerprint": fingerprint, "exactFileSet": True, "writes": 0}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True)
    parser.add_argument("--candidate-dir", required=True)
    options = parser.parse_args()
    try:
        result = verify(options.archive, options.candidate_dir)
    except VerificationError as error:
        print(json.dumps({"status": "BLOCKED", "code": str(error), "writes": 0}))
        return 2
    except (OSError, tarfile.TarError):
        print(json.dumps({"status": "BLOCKED", "code": "SOURCE_VERIFICATION_IO_FAILED", "writes": 0}))
        return 2
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
