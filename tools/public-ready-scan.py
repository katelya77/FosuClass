#!/usr/bin/env python3
"""Sanitized public-repository readiness scan for worktree and reachable Git history."""

import argparse
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
REPORT_PATH = ROOT / "output" / "public-ready" / "report.json"
ALLOWLIST_PATH = ROOT / "security" / "public-allowlist.yml"
MAX_BLOB = 12 * 1024 * 1024
MAX_FINDINGS = 5000
SKIP_PARTS = {".git", ".agents", ".tmp", "node_modules", ".venv", "venv", "coverage"}
PLACEHOLDER_MARKERS = {
    "placeholder", "example", "redacted", "dummy", "mock", "your_", "your-",
    "change_me", "changeme", "not_a_credential", "not-a-credential", "xxxxx",
    "aaaaa", "sample", "fake", "test_only", "test-only", "process.env", "${{",
    "<secret>", "<token>", "<password>", "env.", "secret_",
}

KNOWN_PATTERNS = [
    ("PRIVATE_KEY", re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("GITHUB_TOKEN", re.compile(rb"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("OPENAI_STYLE_KEY", re.compile(rb"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("AWS_ACCESS_KEY", re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("TENCENT_SECRET_ID", re.compile(rb"\bAKID[A-Za-z0-9]{13,}\b")),
    ("JWT", re.compile(rb"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("BEARER_TOKEN", re.compile(rb"(?i)\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)")),
]


def run_git(args, input_data=None, check=True):
    return subprocess.run(
        ["git", *args], cwd=ROOT, input=input_data, capture_output=True, check=check
    )


def fingerprint(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()[:16]


def entropy(value):
    if not value:
        return 0.0
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def looks_placeholder(value):
    lowered = value.decode("utf-8", "ignore").lower()
    if any(marker in lowered for marker in PLACEHOLDER_MARKERS):
        return True
    compact = re.sub(r"[^a-z0-9]", "", lowered)
    if not compact or len(set(compact)) <= 3:
        return True
    return False


def text_findings(data):
    findings = []
    for kind, pattern in KNOWN_PATTERNS:
        for match in pattern.finditer(data):
            value = match.group(1) if match.lastindex else match.group(0)
            if looks_placeholder(value):
                continue
            findings.append((kind, value))
    unique = {}
    for kind, value in findings:
        unique[(kind, fingerprint(value))] = value
    return [(kind, fp) for kind, fp in unique]


def scan_zip(data, prefix):
    results = []
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
            if archive.testzip() is not None:
                return [("CORRUPT_ZIP", "sha256:" + hashlib.sha256(data).hexdigest()[:16], prefix)]
            for info in archive.infolist():
                if info.is_dir() or info.file_size > MAX_BLOB:
                    continue
                try:
                    payload = archive.read(info.filename)
                except Exception:
                    continue
                for kind, fp in text_findings(payload):
                    results.append((kind, fp, f"{prefix}!{info.filename}"))
    except zipfile.BadZipFile:
        pass
    return results


def sensitive_path_kind(path):
    normalized = path.replace("\\", "/").lower()
    name = normalized.rsplit("/", 1)[-1]
    if name == ".env" or (name.startswith(".env.") and not name.endswith(".example")):
        return "SENSITIVE_ENV_FILE"
    if name.endswith(".har"):
        return "HAR_ARCHIVE"
    if name.endswith((".pem", ".key", ".p12", ".pfx")):
        return "KEY_MATERIAL_FILE"
    if name.endswith((".sqlite", ".sqlite3", ".db")):
        return "DATABASE_FILE"
    if name.endswith(".sql") and ("dump" in name or "backup" in name):
        return "DATABASE_DUMP"
    return None


def large_unscanned_kind(path):
    normalized = path.replace("\\", "/").lower()
    name = normalized.rsplit("/", 1)[-1]
    path_kind = sensitive_path_kind(path)
    if path_kind:
        return path_kind
    if name.endswith((".zip", ".tar", ".tgz", ".gz", ".7z", ".rar")):
        return "LARGE_UNSCANNED_ARCHIVE"
    if "snapshot" in normalized or "pre-snapshot" in normalized or "post-snapshot" in normalized:
        return "LARGE_UNSCANNED_SNAPSHOT"
    if "/storage/" in normalized or "/staging/" in normalized:
        return "LARGE_UNSCANNED_STORAGE_EXPORT"
    if "production" in name and name.endswith((".json", ".yaml", ".yml", ".toml", ".ini")):
        return "LARGE_UNSCANNED_PRODUCTION_CONFIG"
    return None


def repository_artifact_kind(path):
    normalized = normalize_path(path).lower()
    if normalized == "docs/captures/.gitkeep":
        return None
    if normalized.startswith("docs/captures/") and normalized.endswith((".json", ".har", ".md")):
        return "CAPTURE_ARTIFACT"
    if normalized.startswith("server/data/backups/"):
        return "BACKUP_ARTIFACT"
    if normalized.startswith("server/storage/snapshots/"):
        return "PRODUCTION_SNAPSHOT"
    return None


def normalize_path(path):
    normalized = str(path or "").replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def load_allowlist():
    if not ALLOWLIST_PATH.is_file():
        return []
    try:
        payload = json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"invalid public allowlist: {error}") from error
    fixtures = payload.get("fixtures", [])
    if not isinstance(fixtures, list):
        raise RuntimeError("invalid public allowlist: fixtures must be an array")
    entries = []
    for item in fixtures:
        path = normalize_path(item.get("path")) if isinstance(item, dict) else ""
        secret_types = item.get("secretTypes", []) if isinstance(item, dict) else []
        reason = str(item.get("reason", "")).strip() if isinstance(item, dict) else ""
        if not path or not secret_types or not reason:
            raise RuntimeError("invalid public allowlist: every fixture needs path, secretTypes and reason")
        entries.append({"path": path, "secretTypes": set(secret_types), "reason": reason})
    return entries


def is_allowlisted(target, path, kind):
    normalized = normalize_path(path).split("!", 1)[0]
    return any(item["path"] == normalized and kind in item["secretTypes"]
               for item in target.get("allowlist", []))


def likely_credential(kind):
    upper = str(kind).upper()
    if any(marker in upper for marker in ("SNAPSHOT", "BACKUP", "CAPTURE", "ARCHIVE", "STORAGE_EXPORT")):
        return False
    return any(marker in upper for marker in (
        "KEY", "TOKEN", "SECRET", "CREDENTIAL", "JWT", "ENV_FILE", "COOKIE", "PASSWORD",
    ))


def add_finding(target, *, path, commit, kind, fp, exposure, blocker=True):
    path = normalize_path(path)
    if is_allowlisted(target, path, kind):
        target["allowlistedCount"] = target.get("allowlistedCount", 0) + 1
        return
    key = (path, commit, kind, fp, exposure)
    if key in target["seen"] or len(target["items"]) >= MAX_FINDINGS:
        return
    target["seen"].add(key)
    tracked = path.split("!", 1)[0] in target.get("tracked", set())
    history_reachable = "HISTORY" in exposure
    suspected = likely_credential(kind)
    target["items"].append({
        "path": path,
        "commit": commit,
        "secretType": kind,
        "fingerprint": fp,
        "exposure": exposure,
        "blocker": blocker,
        "tracked": tracked or history_reachable,
        "historyReachable": history_reachable,
        "suspectedRealCredential": suspected,
        "rotationRequired": bool(blocker and suspected and (tracked or history_reachable)),
    })


def scan_payload(target, data, path, commit, exposure, blocker=True):
    artifact_kind = repository_artifact_kind(path)
    if artifact_kind and exposure == "GIT_HISTORY":
        add_finding(
            target, path=path, commit=commit, kind=f"HISTORY_{artifact_kind}",
            fp=fingerprint(path.encode()), exposure=exposure, blocker=blocker,
        )
    path_kind = sensitive_path_kind(path)
    if path_kind:
        add_finding(target, path=path, commit=commit, kind=path_kind,
                    fp=fingerprint(path.encode()), exposure=exposure, blocker=blocker)
    if data is None:
        large_kind = large_unscanned_kind(path)
        if large_kind:
            add_finding(target, path=path, commit=commit, kind=large_kind,
                        fp=fingerprint(path.encode()), exposure=exposure, blocker=blocker)
        return
    if b"\0" not in data[:8192]:
        for kind, fp in text_findings(data):
            add_finding(target, path=path, commit=commit, kind=kind, fp=fp,
                        exposure=exposure, blocker=blocker)
    if path.lower().endswith(".zip") and len(data) <= MAX_BLOB:
        for kind, fp, inner_path in scan_zip(data, path):
            add_finding(target, path=inner_path, commit=commit, kind=kind, fp=fp,
                        exposure=exposure, blocker=blocker)


def worktree_files(include_ignored):
    commands = [
        (["ls-files", "-c", "-z"], "WORKTREE_TRACKED", True),
        (["ls-files", "-o", "--exclude-standard", "-z"], "WORKTREE_UNTRACKED", True),
    ]
    if include_ignored:
        commands.append((["ls-files", "--others", "-i", "--exclude-standard", "-z"],
                         "WORKTREE_IGNORED", False))
    seen = set()
    for command, exposure, blocker in commands:
        output = run_git(command).stdout
        for raw in output.split(b"\0"):
            if not raw:
                continue
            relative = raw.decode("utf-8", "surrogateescape")
            if relative in seen or any(part in SKIP_PARTS for part in Path(relative).parts):
                continue
            seen.add(relative)
            path = ROOT / relative
            if not path.is_file():
                continue
            if path.stat().st_size > MAX_BLOB:
                yield relative, None, exposure, blocker
            else:
                yield relative, path.read_bytes(), exposure, blocker


def reachable_blobs():
    objects = run_git(["rev-list", "--objects", "--all"]).stdout
    records = []
    for raw in objects.splitlines():
        if not raw:
            continue
        parts = raw.split(b" ", 1)
        records.append((parts[0].decode(), parts[1].decode("utf-8", "surrogateescape") if len(parts) > 1 else ""))
    hashes = [item[0] for item in records]
    check_input = "".join(f"{item}\n" for item in hashes).encode()
    checked = run_git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], check_input).stdout
    meta = {}
    for line in checked.decode("ascii", "replace").splitlines():
        parts = line.split()
        if len(parts) == 3:
            meta[parts[0]] = (parts[1], int(parts[2]))
    for object_id, path in records:
        kind, size = meta.get(object_id, (None, 0))
        if kind == "blob":
            yield object_id, path, size


def history_blob_commits():
    output = run_git([
        "log", "--all", "--format=COMMIT:%H", "--raw", "--no-abbrev", "--no-renames"
    ]).stdout.decode("utf-8", "replace")
    current = "REACHABLE_HISTORY"
    mapping = {}
    for line in output.splitlines():
        if line.startswith("COMMIT:"):
            current = line.split(":", 1)[1]
            continue
        if not line.startswith(":") or "\t" not in line:
            continue
        metadata = line.split("\t", 1)[0].split()
        if len(metadata) < 4:
            continue
        for blob in metadata[2:4]:
            if blob != "0" * 40:
                mapping.setdefault(blob, current)
    return mapping


def scan_history(target):
    blob_map = {}
    blob_sizes = {}
    for blob, path, size in reachable_blobs():
        blob_map.setdefault(blob, path)
        blob_sizes[blob] = size
    commit_map = history_blob_commits()
    process = subprocess.Popen(
        ["git", "cat-file", "--batch"], cwd=ROOT,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    for blob, path in blob_map.items():
        if blob_sizes.get(blob, 0) > MAX_BLOB:
            large_kind = large_unscanned_kind(path)
            if large_kind:
                add_finding(
                    target, path=path or f"<blob:{blob[:12]}>",
                    commit=commit_map.get(blob, "REACHABLE_HISTORY"), kind=large_kind,
                    fp=fingerprint(blob.encode()), exposure="GIT_HISTORY", blocker=True,
                )
            continue
        process.stdin.write(f"{blob}\n".encode("ascii"))
        process.stdin.flush()
        header = process.stdout.readline().decode("ascii", "replace").strip().split()
        if len(header) < 3 or header[0] != blob or header[1] != "blob":
            continue
        size = int(header[2])
        data = process.stdout.read(size)
        process.stdout.read(1)
        before = len(target["items"])
        scan_payload(target, data, path or f"<blob:{blob[:12]}>", "PENDING", "GIT_HISTORY", True)
        if len(target["items"]) > before:
            commit = commit_map.get(blob, "REACHABLE_HISTORY")
            for item in target["items"][before:]:
                item["commit"] = commit
    process.stdin.close()
    process.wait()


def find_gitleaks():
    candidates = [
        shutil.which("gitleaks"),
        ROOT / ".tmp" / "gitleaks-v8.28.0" / "gitleaks.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())
    return None


def find_trufflehog():
    candidate = shutil.which("trufflehog")
    return str(Path(candidate).resolve()) if candidate and Path(candidate).is_file() else None


def run_gitleaks(target, include_history=True):
    executable = find_gitleaks()
    if not executable:
        return {"status": "UNAVAILABLE", "historyFindings": 0, "worktreeFindings": 0}
    common = [
        "--no-banner", "--redact=100", "--report-format=json",
        "--max-archive-depth=2", "--max-decode-depth=2", "--max-target-megabytes=20",
    ]
    counts = {}
    with tempfile.TemporaryDirectory() as temp:
        commands = [("worktree", ["dir", "."])]
        if include_history:
            commands.insert(0, ("history", ["git", ".", "--log-opts=--all"]))
        for scope, command in commands:
            report = Path(temp) / f"{scope}.json"
            result = subprocess.run(
                [executable, *command, *common, f"--report-path={report}"],
                cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=240,
            )
            if result.returncode not in (0, 1):
                add_finding(
                    target, path="<gitleaks>", commit="SCAN_ERROR",
                    kind=f"GITLEAKS_{scope.upper()}_ERROR",
                    fp=fingerprint(f"{scope}:{result.returncode}".encode()),
                    exposure="SCANNER", blocker=True,
                )
                counts[scope] = "ERROR"
                continue
            findings = json.loads(report.read_text(encoding="utf-8")) if report.is_file() else []
            counts[scope] = len(findings)
            for finding in findings:
                stable = finding.get("Fingerprint") or ":".join([
                    finding.get("File", ""), finding.get("RuleID", "unknown"),
                    str(finding.get("StartLine", "")),
                ])
                path = normalize_path(finding.get("File") or "<unknown>")
                base_path = path.split("!", 1)[0]
                tracked = base_path in target.get("tracked", set())
                ignored = base_path in target.get("ignored", set())
                blocker = scope == "history" or tracked or not ignored
                add_finding(
                    target,
                    path=path,
                    commit=finding.get("Commit") or ("WORKTREE" if scope == "worktree" else "REACHABLE_HISTORY"),
                    kind=f"GITLEAKS_{finding.get('RuleID', 'unknown').upper()}",
                    fp=fingerprint(stable.encode("utf-8", "replace")),
                    exposure=f"GITLEAKS_{scope.upper()}", blocker=blocker,
                )
    version = subprocess.run(
        [executable, "version"], cwd=ROOT, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=20,
    ).stdout.strip()
    return {
        "status": "RUN",
        "version": version,
        "historyFindings": counts.get("history", 0),
        "worktreeFindings": counts.get("worktree", 0),
    }


def run_trufflehog(target, include_history=True):
    executable = find_trufflehog()
    if not executable:
        return {"status": "UNAVAILABLE", "historyFindings": 0, "worktreeFindings": 0}
    commands = [("worktree", ["filesystem", str(ROOT), "--json", "--no-update"])]
    if include_history:
        commands.insert(0, ("history", ["git", ROOT.as_uri(), "--json", "--no-update"]))
    counts = {}
    for scope, command in commands:
        result = subprocess.run(
            [executable, *command], cwd=ROOT, capture_output=True,
            timeout=300,
        )
        if result.returncode not in (0, 183):
            add_finding(
                target, path="<trufflehog>", commit="SCAN_ERROR",
                kind=f"TRUFFLEHOG_{scope.upper()}_ERROR",
                fp=fingerprint(f"{scope}:{result.returncode}".encode()),
                exposure="SCANNER", blocker=True,
            )
            counts[scope] = "ERROR"
            continue
        count = 0
        for raw_line in result.stdout.splitlines():
            try:
                finding = json.loads(raw_line)
            except json.JSONDecodeError:
                continue
            source_data = ((finding.get("SourceMetadata") or {}).get("Data") or {})
            location = source_data.get("Git") or source_data.get("Filesystem") or {}
            path = normalize_path(location.get("file") or location.get("path") or "<unknown>")
            commit = location.get("commit") or ("WORKTREE" if scope == "worktree" else "REACHABLE_HISTORY")
            raw_value = finding.get("RawV2") or finding.get("Raw") or ""
            stable = raw_value.encode("utf-8", "replace") if isinstance(raw_value, str) else bytes(raw_value)
            detector = re.sub(r"[^A-Za-z0-9_-]", "_", str(finding.get("DetectorName") or "unknown"))
            base_path = path.split("!", 1)[0]
            tracked = base_path in target.get("tracked", set())
            ignored = base_path in target.get("ignored", set())
            blocker = scope == "history" or tracked or not ignored
            add_finding(
                target, path=path, commit=commit,
                kind=f"TRUFFLEHOG_{detector.upper()}",
                fp=fingerprint(stable or f"{path}:{detector}".encode()),
                exposure=f"TRUFFLEHOG_{scope.upper()}", blocker=blocker,
            )
            count += 1
        counts[scope] = count
    version = subprocess.run(
        [executable, "--version"], cwd=ROOT, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=20,
    ).stdout.strip()
    return {
        "status": "RUN", "version": version,
        "historyFindings": counts.get("history", 0),
        "worktreeFindings": counts.get("worktree", 0),
    }


def self_test():
    real = b'API_KEY="sk-' + b"aB3_" * 8 + b'"'
    placeholder = b'API_KEY="YOUR_API_KEY_PLACEHOLDER"'
    assert text_findings(real)
    assert not text_findings(placeholder)
    print("public-ready scanner self-test: PASS")


def tracked_artifact_guards(target):
    for path in sorted(target.get("tracked", set())):
        artifact_kind = repository_artifact_kind(path)
        if artifact_kind:
            add_finding(
                target, path=path, commit="HEAD", kind=f"TRACKED_{artifact_kind}",
                fp=fingerprint(path.encode()), exposure="TRACKED_FILE_GUARD", blocker=True,
            )

    required_docker_ignores = {
        "**/.env", "server/storage", "server/data/backups", "*.key", "*.pem", "*.har",
    }
    dockerignore = ROOT / ".dockerignore"
    configured = {
        line.strip() for line in dockerignore.read_text(encoding="utf-8").splitlines()
        if dockerignore.is_file() and line.strip() and not line.lstrip().startswith("#")
    }
    for missing in sorted(required_docker_ignores - configured):
        add_finding(
            target, path=".dockerignore", commit="HEAD", kind="DOCKER_CONTEXT_GUARD_MISSING",
            fp=fingerprint(missing.encode()), exposure="PACKAGE_CONTEXT_GUARD", blocker=True,
        )

    secret_name = re.compile(r"(?i)(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|SSH_KEY|API_KEY)$")
    workflow_ref = re.compile(r"\$\{\{\s*(secrets|vars)\.([A-Za-z0-9_]+)")
    assignment = re.compile(r"(?i)^\s*([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|SSH_KEY|API_KEY))\s*:\s*(.+?)\s*$")
    for workflow in sorted((ROOT / ".github" / "workflows").glob("*.y*ml")):
        for line_number, line in enumerate(workflow.read_text(encoding="utf-8").splitlines(), 1):
            for namespace, name in workflow_ref.findall(line):
                if namespace == "vars" and secret_name.search(name):
                    add_finding(
                        target, path=workflow.relative_to(ROOT).as_posix(), commit="HEAD",
                        kind="WORKFLOW_SECRET_USES_VARIABLE",
                        fp=fingerprint(f"{name}:{line_number}".encode()),
                        exposure="WORKFLOW_SECRET_GUARD", blocker=True,
                    )
            match = assignment.match(line)
            if not match:
                continue
            value = match.group(2).strip().strip("'\"")
            if value and "${{" not in value and not looks_placeholder(value.encode()):
                add_finding(
                    target, path=workflow.relative_to(ROOT).as_posix(), commit="HEAD",
                    kind="WORKFLOW_HARDCODED_SECRET",
                    fp=fingerprint(f"{match.group(1)}:{line_number}".encode()),
                    exposure="WORKFLOW_SECRET_GUARD", blocker=True,
                )


def build_path_sets():
    tracked = {
        normalize_path(raw.decode("utf-8", "surrogateescape"))
        for raw in run_git(["ls-files", "-c", "-z"]).stdout.split(b"\0") if raw
    }
    ignored = {
        normalize_path(raw.decode("utf-8", "surrogateescape"))
        for raw in run_git(["ls-files", "--others", "-i", "--exclude-standard", "-z"]).stdout.split(b"\0") if raw
    }
    return tracked, ignored


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--no-ignored", action="store_true")
    parser.add_argument("--head-only", action="store_true")
    parser.add_argument("--report", default=str(REPORT_PATH))
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    tracked, ignored = build_path_sets()
    target = {
        "items": [], "seen": set(), "tracked": tracked, "ignored": ignored,
        "allowlist": load_allowlist(), "allowlistedCount": 0,
    }
    for path, data, exposure, blocker in worktree_files(not args.no_ignored):
        scan_payload(target, data, path, exposure, exposure, blocker)
    tracked_artifact_guards(target)
    if not args.head_only:
        scan_history(target)
    gitleaks_status = run_gitleaks(target, include_history=not args.head_only)
    trufflehog_status = run_trufflehog(target, include_history=not args.head_only)
    items = sorted(target["items"], key=lambda item: (
        not item["blocker"], item["exposure"], item["path"], item["secretType"], item["commit"]
    ))
    blockers = [item for item in items if item["blocker"]]
    report = {
        "schema": "fosuclass-public-ready-report/v2",
        "status": "FAIL" if blockers else "PASS",
        "mode": "HEAD_ONLY" if args.head_only else "FULL_REACHABLE_HISTORY",
        "scanner": "builtin-history-secret-scan",
        "externalScanners": {"gitleaks": gitleaks_status, "trufflehog": trufflehog_status},
        "scope": ["working tree tracked/untracked", "working tree ignored (non-public warning)",
                  "all reachable Git history", "branches", "tags", "ZIP contents <= 12 MiB",
                  "large sensitive artifacts fail closed"],
        "blockerCount": len(blockers),
        "warningCount": len(items) - len(blockers),
        "allowlistedFixtureFindingCount": target["allowlistedCount"],
        "findings": items,
    }
    report_path = Path(args.report).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"PUBLIC_READY = {report['status']}")
    print(f"blockers={len(blockers)} warnings={len(items) - len(blockers)}")
    for item in items[:100]:
        print(" | ".join([
            item["path"], item["commit"], item["secretType"], item["fingerprint"],
            item["exposure"], "BLOCKER" if item["blocker"] else "LOCAL_ONLY_WARNING",
        ]))
    if len(items) > 100:
        print(f"... {len(items) - 100} additional sanitized findings are in {report_path}")
    print(f"sanitized_report={report_path}")
    raise SystemExit(1 if blockers else 0)


if __name__ == "__main__":
    main()
