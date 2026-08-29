#!/usr/bin/env python3
"""Validate the generated Runtime Closure Pack at the ZIP boundary."""

import hashlib
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
NEXT = ROOT / "output" / "competition-adp" / "next"
PACK = NEXT / "ADP-Runtime-Closure-Pack.zip"
REQUIRED = {
    "01-Schedule-Final.zip", "02-Classroom-Final.zip", "03-Conflict-Final.zip",
    "04-DayPlan-Final.zip", "widget-registry.json", "ADP-RUNTIME-E2E-CHECKLIST.md",
    "NEEDS_USER_RICH_V4_WIDGET_EXPORT.md", "manifest.json", "SHA256SUMS.txt", "ROLLBACK.md",
    "Schedule-Rich-V4-Pilot/adapter.py", "Schedule-Rich-V4-Pilot/contract.json",
    "Schedule-Rich-V4-Pilot/default.json", "Schedule-Rich-V4-Pilot/schema.json",
    "Schedule-Rich-V4-Pilot/template.txt", "Schedule-Rich-V4-Pilot/zod.txt",
}


assert PACK.is_file()
with zipfile.ZipFile(PACK) as reader:
    assert reader.testzip() is None
    names = set(reader.namelist())
    assert REQUIRED <= names, sorted(REQUIRED - names)
    manifest = json.loads(reader.read("manifest.json"))
    registry = json.loads(reader.read("widget-registry.json"))
    assert manifest["runtimeStatus"] == "PENDING_TENCENT_ADP_E2E"
    assert manifest["richV4RealWidgetId"] is None and manifest["needsUserExport"] is True
    assert manifest["widgetCount"] == 6 and len(registry["widgets"]) == 6
    assert all(value["widgetId"] for value in registry["widgets"].values())
    sums = {}
    for line in reader.read("SHA256SUMS.txt").decode("utf-8").splitlines():
        digest, name = line.split("  ", 1)
        sums[name] = digest
    for name, digest in sums.items():
        assert hashlib.sha256(reader.read(name)).hexdigest() == digest, name
    checklist = reader.read("ADP-RUNTIME-E2E-CHECKLIST.md").decode("utf-8")
    assert all(f"## {index}. {kind}" in checklist for index, kind in enumerate(
        ["Schedule", "Classroom", "Conflict", "DayPlan", "Choice", "Error"], 1
    ))
    assert "schedule_risk_check" in checklist and "03-课程冲突比较-Final" in checklist

print(f"ADP Runtime Closure Pack gate: PASS ({len(names)} ZIP entries + checksums + 6 E2E cases)")
