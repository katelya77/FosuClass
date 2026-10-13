#!/usr/bin/env python3
# Python 3.6 compatible. Fixed run, read-only, no school or Oracle requests.
import json
import pathlib
import re
import subprocess

RUN = "sc-506d1f4bea522471cf93edc6"
UNIT = "fosu-collector-sample-506d1f4bea522471cf93edc6.service"
ROOT = pathlib.Path("/root/fosu-collector-closure") / RUN
WORKER = pathlib.Path("/var/lib/fosuclass/schedule-collector/runs/2026-2027-1") / RUN
PROPS = ["ActiveState", "SubState", "Result", "ExecMainStatus",
         "ExecMainStartTimestamp", "ExecMainExitTimestamp"]
CODE = re.compile(r"^(?:CLOSURE|CAS|SESSION|SCHOOL|AUTH|LOGIN|COLLECTOR|SAMPLE|SYNC|UPSTREAM|NETWORK|PROTECTED|ORACLE|PLAYWRIGHT|BROWSER|RUN|TERM|CLI|DIRECT)_[A-Z0-9_]{1,70}$")
NUMBERS = ["passwordSubmissions", "authenticationSchoolRequests", "sessionProbeSchoolRequests",
           "collectionSchoolRequests", "schoolRequestCount", "requestBudget", "uploadBytes", "workerExitCode"]
FLAGS = ["evidenceRetained", "replayAllowed", "sampleOnly", "publishable",
         "coverageValid", "signedOracleReceiptMatched", "success"]

def read(file):
    if not file.is_file() or file.is_symlink():
        return {"exists": False}
    if file.stat().st_size > 1048576:
        return {"exists": True, "read": "TOO_LARGE"}
    try:
        data = json.loads(file.read_text())
        if not isinstance(data, dict):
            raise ValueError()
        out = {"exists": True}
        for key in NUMBERS:
            value = data.get(key)
            if type(value) is int and value >= 0 or value == "NOT_COUNTED_BY_EXISTING_CLI":
                out[key] = value
        for key in FLAGS:
            if type(data.get(key)) is bool:
                out[key] = data[key]
        for key in ["status", "result"]:
            if data.get(key) in ["BLOCKED", "FAILED", "RUNNING", "COMPLETED", "PENDING_REVIEW", "PENDING SAMPLE REVIEW", "failed", "running", "completed", "success"]:
                out[key] = data[key]
        for key in ["code", "failureCode"]:
            if isinstance(data.get(key), str) and CODE.fullmatch(data[key]):
                out[key] = data[key]
        for key in ["stage", "failurePhase"]:
            if data.get(key) in ["bootstrap", "idle", "auth-check", "term-config", "preflight", "campus-diagnosis", "browser-launch", "session-check", "catalog", "directory-fetch", "schedule-fetch", "resource-build", "resource-fetch", "hash", "upload", "validate"]:
                out[key] = data[key]
        if data.get("runId") == RUN:
            out["runId"] = RUN
        if data.get("term") == "2026-2027-1":
            out["term"] = data["term"]
        for key, pattern in [("uploadId", r"stg_[A-Za-z0-9_-]+"), ("canonicalHash", r"[a-f0-9]{64}")]:
            if re.fullmatch(pattern, str(data.get(key, ""))):
                out[key] = data[key]
        return out
    except Exception:
        return {"exists": True, "read": "INVALID_OR_UNREADABLE"}

def inspect():
    out = {"runId": RUN, "readOnly": True, "replayAllowed": False}
    try:
        p = subprocess.run(["systemctl", "show", UNIT] + ["--property=" + x for x in PROPS],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           universal_newlines=True, timeout=10)
        out["systemd"] = dict(line.split("=", 1) for line in p.stdout.splitlines()
                              if "=" in line and line.split("=", 1)[0] in PROPS)
        out["systemdQueryExit"] = p.returncode
    except Exception:
        out["systemdQuery"] = "UNAVAILABLE_OR_TIMEOUT"
    reservation = ROOT / "school-access.started.json"
    out["schoolAccessReserved"] = reservation.is_file() and not reservation.is_symlink()
    out["result"] = read(ROOT / "result.json")
    out["worker"] = dict((name, read(WORKER / name)) for name in ["state.json", "sync-result.json", "progress.json", "worker-status.json", "worker-exit.json"])
    log = ROOT / "executor.log"
    if log.is_file() and not log.is_symlink():
        try:
            with log.open("rb") as f:
                f.seek(max(0, log.stat().st_size - 262144))
                text = f.read().decode("utf-8", "replace")
            out["sanitizedCodes"] = sorted(set(value for value in re.findall(r"\b[A-Z][A-Z0-9_]{1,80}\b", text) if CODE.fullmatch(value)))[:40]
        except Exception:
            out["logRead"] = "UNREADABLE"
    return out

if __name__ == "__main__":
    print(json.dumps(inspect(), ensure_ascii=False, indent=2))
