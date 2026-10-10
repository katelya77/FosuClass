"""Build a Sample overlay on the pinned Oracle ancestor.

Does not access a server, build/push an image, or change Git state.
"""
import argparse
import gzip
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile

BASE = "a3dfd1989705f51c921f13883bcde1cce4502883"
PR_HEAD = "6fe02a552e7511bc27a2f4751db302ebb7a8e001"
CONTEXT = ["server", "packages", "plugins", "apps", "package.json", "package-lock.json", ".dockerignore"]
ALLOWED = {
    "server/src/services/scheduleCollectorService.js",
    "server/src/routes/fullSyncAgent.js",
    "server/src/modules/schedule-collector/routes.js",
    "server/src/shared/sampleCollectionContract.js",
    "server/src/services/stagingFinalizeService.js",
    "server/src/services/stagingSafetyService.js",
    "server/src/services/stagingPublishService.js",
    "server/src/services/stagingUploadService.js",
    "server/src/shared/fourDirectSourceContract.js",
    "server/src/services/sampleReviewService.js",
}
TEXT_SUFFIXES = {".js", ".json", ".md", ".sh", ".yml", ".yaml", ".txt", ".py"}


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, stderr=subprocess.DEVNULL)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def collect(root):
    head = git(root, "rev-parse", "HEAD").decode().strip()
    try:
        subprocess.run(["git", "merge-base", "--is-ancestor", BASE, head], cwd=root, check=True, capture_output=True)
        subprocess.run(["git", "merge-base", "--is-ancestor", BASE, PR_HEAD], cwd=root, check=True, capture_output=True)
    except subprocess.CalledProcessError:
        raise ValueError("ORACLE_BASE_MISMATCH")
    tracked = git(root, "diff", "--name-only", BASE).decode().splitlines()
    new = git(root, "ls-files", "--others", "--exclude-standard").decode().splitlines()
    changed = sorted(set(tracked + new))
    runtime = [name for name in changed if name.startswith(("server/", "packages/", "plugins/", "apps/")) or name in CONTEXT]
    if any(name not in ALLOWED for name in runtime):
        raise ValueError("UNREVIEWED_RUNTIME_CHANGE")
    if not runtime:
        raise ValueError("SAMPLE_OVERLAY_MISSING")
    members = {}
    with tarfile.open(fileobj=io.BytesIO(git(root, "archive", "--format=tar", BASE, "--", *CONTEXT))) as archive:
        for item in archive:
            if item.isdir():
                continue
            if not item.isfile():
                raise ValueError("RUNTIME_LINK_REJECTED")
            if "/storage/" in item.name or item.name == "server/.env" or "/node_modules/" in item.name:
                continue
            members[item.name] = (archive.extractfile(item).read(), item.mode)
    overlay = {}
    for name in runtime:
        target = root / name
        if target.is_symlink() or not target.is_file():
            raise ValueError("RUNTIME_DELETE_OR_LINK_REJECTED")
        content = target.read_bytes()
        if target.suffix in TEXT_SUFFIXES:
            content = content.replace(b"\r\n", b"\n")
        previous = members.get(name)
        overlay[name] = {"beforeSha256": digest(previous[0]) if previous else None, "sha256": digest(content)}
        members[name] = (content, previous[1] if previous else 0o644)
    return members, overlay


def build(root, output, require_commit=False):
    members, overlay = collect(root)
    members = dict(members)
    head = git(root, "rev-parse", "HEAD").decode().strip()
    packaged_tools = ["deploy/oracle-sample/preflight.js", "tools/oracle-sample/queue.js", "deploy/oracle-sample/README.md"]
    bound_paths = CONTEXT + packaged_tools
    dirty = git(root, "diff", "HEAD", "--name-only", "--", *bound_paths).decode().splitlines()
    untracked = git(root, "ls-files", "--others", "--exclude-standard", "--", *bound_paths).decode().splitlines()
    commit = head if head != BASE and not dirty and not untracked else None
    if require_commit and not commit:
        raise ValueError("CANDIDATE_COMMIT_REQUIRED")
    candidate = "oracle-sample-" + digest(json.dumps(overlay, sort_keys=True).encode())[:16]
    manifest = {"schema": "oracle-sample-candidate.v1", "candidateId": candidate,
                "baseSha": BASE, "expectedProductionSha": BASE, "referencePrSha": PR_HEAD,
                "gitCommit": commit, "deploymentBoundary": "BLOCKED_PENDING_CI_LIVE_PREFLIGHT_AND_APPROVAL" if commit else "BLOCKED_PENDING_COMMIT_CI_AND_APPROVAL",
                "overlay": overlay, "publishable": False, "timerEnabled": False,
                "protectedRuntimeSha256": digest(json.dumps({k: digest(v[0]) for k, v in members.items() if k not in overlay}, sort_keys=True).encode())}
    for name in ("deploy/oracle-sample/preflight.js", "deploy/oracle-sample/README.md"):
        p = root / name
        if p.exists():
            members[name] = (p.read_bytes().replace(b"\r\n", b"\n"), 0o644)
    queue = root / "tools/oracle-sample/queue.js"
    if queue.exists():
        members["tools/oracle-sample/queue.js"] = (queue.read_bytes().replace(b"\r\n", b"\n"), 0o644)
    members["oracle-sample-candidate.json"] = ((json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode(), 0o644)
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, (content, mode) in sorted(members.items()):
            item = tarfile.TarInfo(name)
            item.size, item.mode, item.mtime = len(content), mode, 0
            item.uid = item.gid = 0
            archive.addfile(item, io.BytesIO(content))
    output.mkdir(parents=True, exist_ok=True)
    artifact = candidate + ("-" + commit if commit else "")
    target = output / (artifact + ".tar.gz")
    target.write_bytes(gzip.compress(raw.getvalue(), compresslevel=9, mtime=0))
    receipt = {**manifest, "archive": target.name, "archiveSha256": digest(target.read_bytes()), "runtimeFiles": len(members), "bytes": target.stat().st_size}
    receipt_path = output / (artifact + ".receipt.json")
    receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--require-commit", action="store_true")
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    try:
        result = build(root, args.output or root / ".local/oracle-sample-candidates", args.require_commit)
        print(json.dumps(result, indent=2))
    except (ValueError, subprocess.CalledProcessError):
        raise SystemExit("ORACLE_SAMPLE_BUILD_BLOCKED")
