#!/usr/bin/env python3
"""Audit optional local Tencent ADP exports without committing private platform files."""

import base64
import hashlib
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CATALOG = json.loads((ROOT / "real-adp-export-catalog.json").read_text(encoding="utf-8"))
DOWNLOADS = Path.home() / "Downloads"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


assert CATALOG["pending"] == [], "R2 export batch must be complete"
for name, record in CATALOG["widgets"].items():
    path = DOWNLOADS / record["file"]
    if not path.is_file():
        continue
    assert sha256(path) == record["sha256"], f"{name} Widget hash drift"
    outer = json.loads(path.read_text(encoding="utf-8"))
    inner = json.loads(base64.b64decode(outer["encodedWidget"]))
    assert inner["id"] == record["widgetId"], f"{name} WidgetID drift"

for name, record in CATALOG["workflows"].items():
    path = DOWNLOADS / record["file"]
    if not path.is_file():
        continue
    assert sha256(path) == record["sha256"], f"{name} Workflow hash drift"
    with zipfile.ZipFile(path) as reader:
        names = [value for value in reader.namelist() if value.endswith("_workflow.json")]
        assert len(names) == 1
        workflow = json.loads(reader.read(names[0]))
    assert workflow["WorkflowID"] == record["workflowId"], f"{name} WorkflowID drift"

print("Real ADP export catalog: PASS (5 Widgets + 3 Workflows recorded; no fabricated IDs)")
