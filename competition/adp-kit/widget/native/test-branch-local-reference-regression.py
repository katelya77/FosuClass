#!/usr/bin/env python3
"""Prove the old globally-valid but branch-wrong Tool references stay rejected."""

import json
import runpy
import tempfile
import zipfile
from pathlib import Path


NATIVE_DIR = Path(__file__).resolve().parent
FINAL_ZIP = NATIVE_DIR.parents[3] / "output" / "competition-adp" / "final" / "01-Schedule-Final.zip"
RUN_GATE = runpy.run_path(str(NATIVE_DIR / "validate-adp-artifact.py"))["run_gate"]


def rewrite_tool_reference(node, tool_node_id):
    tool_body = next(value for value in node["Inputs"] if value.get("Name") == "tool_body")
    tool_body["Input"]["Reference"]["NodeID"] = tool_node_id


green_checks, green_failures, _ = RUN_GATE(FINAL_ZIP)
assert not green_failures, green_failures
assert len(green_checks) == 71, len(green_checks)

with zipfile.ZipFile(FINAL_ZIP, "r") as reader:
    payloads = {name: reader.read(name) for name in reader.namelist()}
workflow_name = next(name for name in payloads if name.endswith("_workflow.json"))
workflow = json.loads(payloads[workflow_name])
nodes = {node["NodeName"]: node for node in workflow["Nodes"]}
day_tool_id = nodes["课表查询-DAY"]["NodeID"]
for scope in ["WEEK", "DATE"]:
    rewrite_tool_reference(nodes[f"结果核验与呈现-{scope}"], day_tool_id)
    rewrite_tool_reference(nodes[f"Widget数据适配-Schedule-{scope}"], day_tool_id)
payloads[workflow_name] = json.dumps(
    workflow, ensure_ascii=False, separators=(",", ":")
).encode("utf-8")

with tempfile.TemporaryDirectory() as temp_dir:
    broken_zip = Path(temp_dir) / "01-Schedule-Old-BranchRef-Broken.zip"
    with zipfile.ZipFile(broken_zip, "w", compression=zipfile.ZIP_DEFLATED) as writer:
        for name, data in payloads.items():
            writer.writestr(name, data)
    _, red_failures, _ = RUN_GATE(broken_zip)

branch_failures = [
    failure for failure in red_failures
    if failure["check"].endswith("branch-local tool_body")
]
assert len(branch_failures) == 4, branch_failures
assert {failure["check"].split()[0] for failure in branch_failures} == {"WEEK", "DATE"}

print("Branch-local reference regression: PASS (old artifact RED 4; current Final GREEN 71/71)")
