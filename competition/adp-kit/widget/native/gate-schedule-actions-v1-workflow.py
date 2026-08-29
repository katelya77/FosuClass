#!/usr/bin/env python3
"""Static gates for the Schedule WidgetStable Actions V1.1 import package."""

import argparse
import hashlib
import io
import json
import runpy
import subprocess
import sys
import zipfile
from collections import deque
from pathlib import Path


NATIVE_DIR = Path(__file__).resolve().parent
CONTRACT_PATH = NATIVE_DIR / "action-contract.json"
WIDGET_CONTRACT_PATH = NATIVE_DIR / "schedule-runtime-safe-v3-contract.json"


def load_generator():
    path = NATIVE_DIR / "generate-schedule-actions-v1-workflow.py"
    return runpy.run_path(str(path))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def workflow_from_zip(reader):
    names = [name for name in reader.namelist() if name.endswith("_workflow.json")]
    if len(names) != 1:
        raise AssertionError(f"expected one workflow JSON, found {len(names)}")
    return names[0], json.loads(reader.read(names[0]))


def edge_list(workflow):
    value = workflow.get("Edge", [])
    return json.loads(value) if isinstance(value, str) else value


def reference_node_ids(value):
    found = []
    if isinstance(value, dict):
        if value.get("InputType") == "REFERENCE_OUTPUT":
            found.append(value.get("Reference", {}).get("NodeID"))
        for child in value.values():
            found.extend(reference_node_ids(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(reference_node_ids(child))
    return found


def xlsx_id_count(data, workflow_id):
    count = 0
    with zipfile.ZipFile(io.BytesIO(data), "r") as reader:
        for name in reader.namelist():
            count += reader.read(name).count(workflow_id.encode("utf-8"))
    return count


def normalize_baseline(workflow, contract, adapter_code):
    normalized = json.loads(json.dumps(workflow, ensure_ascii=False))
    normalized["WorkflowID"] = contract["generated"]["workflowId"]
    normalized["WorkflowName"] = contract["generated"]["workflowName"]
    adapter = next(
        node for node in normalized["Nodes"]
        if node.get("NodeName") == "Widget数据适配-Schedule"
    )
    adapter["CodeExecutorNodeData"]["Code"] = adapter_code
    load_generator()["apply_week_scope_fix"](normalized, contract)
    return normalized


def run_gate(baseline, artifact):
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    widget_contract = json.loads(WIDGET_CONTRACT_PATH.read_text(encoding="utf-8"))
    adapter_code = (NATIVE_DIR / contract["canonicalAdapter"]).read_text(encoding="utf-8")
    expected_fields = [field["name"] for field in widget_contract["fields"]]
    expected_types = {field["name"]: field["adpType"] for field in widget_contract["fields"]}
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    check("baseline SHA256", sha256(baseline) == contract["baseline"]["sha256"])
    check("Action Builder frozen", hashlib.sha256(adapter_code.encode("utf-8")).hexdigest()
          == contract["canonicalAdapterSha256"])
    with zipfile.ZipFile(baseline, "r") as baseline_zip, zipfile.ZipFile(artifact, "r") as artifact_zip:
        check("ZIP CRC", artifact_zip.testzip() is None)
        check("six-file root contract", len(artifact_zip.infolist()) == 6
              and all("/" not in info.filename for info in artifact_zip.infolist()))

        baseline_name, baseline_workflow = workflow_from_zip(baseline_zip)
        artifact_name, workflow = workflow_from_zip(artifact_zip)
        new_id = contract["generated"]["workflowId"]
        old_id = contract["baseline"]["workflowId"]
        check("new WorkflowID", workflow.get("WorkflowID") == new_id and new_id != old_id)
        check("new WorkflowName", workflow.get("WorkflowName") == contract["generated"]["workflowName"])
        check("workflow JSON filename", artifact_name == f"{new_id}_workflow.json")

        nodes = workflow.get("Nodes", [])
        node_ids = [node.get("NodeID") for node in nodes]
        node_by_id = {node.get("NodeID"): node for node in nodes}
        check("unique NodeIDs", len(node_ids) == len(node_by_id) and None not in node_by_id)
        adapters = [node for node in nodes if node.get("NodeName") == widget_contract["adapterNodeName"]]
        widgets = [node for node in nodes if node.get("NodeType") == "WIDGET"]
        check("single Schedule adapter", len(adapters) == 1)
        check("single Widget node", len(widgets) == 1)
        check("one V1.1 guard added", len(nodes) == len(baseline_workflow.get("Nodes", [])) + 1)
        adapter = adapters[0]
        widget = widgets[0]
        adapter_id = adapter["NodeID"]
        check("canonical adapter injection", adapter["CodeExecutorNodeData"]["Code"] == adapter_code)

        extractor = next(node for node in nodes if node.get("NodeName") == "参数提取")
        prompt = (NATIVE_DIR / contract["parameterExtractorPrompt"]).read_text(encoding="utf-8").strip()
        check("extractor V1.1 contract",
              extractor["ParameterExtractorNodeData"]["UserConstraint"] == prompt)
        guards = [node for node in nodes if node.get("NodeName") == "日期输入守卫"]
        check("single date input guard", len(guards) == 1
              and guards[0].get("NodeID") == contract["dateGuardNodeId"]
              and guards[0].get("NodeType") == "CODE_EXECUTOR")
        guard = guards[0]
        guard_code = (NATIVE_DIR / contract["dateInputGuard"]).read_text(encoding="utf-8")
        check("canonical date input guard", guard["CodeExecutorNodeData"]["Code"] == guard_code)
        normalizer = next(node for node in nodes if node.get("NodeName") == "查询参数归一化")
        normalizer_code = (NATIVE_DIR / contract["queryNormalizer"]).read_text(encoding="utf-8")
        check("canonical query normalizer", normalizer["CodeExecutorNodeData"]["Code"] == normalizer_code)
        date_parser = next(node for node in nodes if node.get("NodeName") == "日期解析")
        date_text_input = next(
            item for item in date_parser["ToolNodeData"]["Body"]
            if item.get("ParamName") == "dateText"
        )["Input"]
        check("date parser guarded input",
              date_text_input.get("InputType") == "REFERENCE_OUTPUT"
              and date_text_input.get("Reference", {}).get("NodeID") == guard["NodeID"]
              and date_text_input.get("Reference", {}).get("JsonPath") == "Output.safe_date_text")

        output = adapter["Outputs"][0]
        properties = output.get("Properties", [])
        property_names = [prop.get("Title") for prop in properties]
        check("Adapter Outputs 22/22", property_names == ["route", *expected_fields])
        check("Adapter output types", all(
            prop.get("Type") == ("STRING" if prop.get("Title") == "route" else expected_types[prop["Title"]])
            for prop in properties
        ))
        check("shownCount INT", next(prop for prop in properties if prop["Title"] == "shownCount")["Type"] == "INT")

        widget_data = widget["WidgetNodeData"]
        params = widget_data.get("WidgetParam", [])
        check("WidgetID", widget_data.get("WidgetID") == contract["widgetId"])
        check("ActionType", widget_data.get("ActionType") == contract["actionType"])
        check("WidgetParam 21/21", [param.get("ParamName") for param in params] == expected_fields)
        check("WidgetParam types", all(
            param.get("ParamType") == expected_types[param["ParamName"]] for param in params
        ))
        check("WidgetParam adapter references", all(
            param.get("Input", {}).get("InputType") == "REFERENCE_OUTPUT"
            and param.get("Input", {}).get("Reference", {}).get("NodeID") == adapter_id
            and param.get("Input", {}).get("Reference", {}).get("JsonPath") == f"Output.{param['ParamName']}"
            for param in params
        ))
        node_ui = json.loads(widget["NodeUI"])
        check("Widget NodeUI inputs", node_ui["data"]["content"]["inputs"] == expected_fields)

        edges = edge_list(workflow)
        edge_pairs = {(edge.get("source"), edge.get("target")) for edge in edges}
        check("Edge endpoints", all(source in node_by_id and target in node_by_id for source, target in edge_pairs))
        check("NextNodeIDs / Edge", all(
            target in node_by_id and (node["NodeID"], target) in edge_pairs
            for node in nodes for target in node.get("NextNodeIDs", [])
        ))
        check("Reference NodeID", all(
            ref in node_by_id for ref in reference_node_ids(workflow) if ref
        ) and all(ref for ref in reference_node_ids(workflow)))

        incoming = {node_id: 0 for node_id in node_ids}
        adjacency = {node_id: [] for node_id in node_ids}
        for source, target in edge_pairs:
            incoming[target] += 1
            adjacency[source].append(target)
        starts = [node_id for node_id, count in incoming.items() if count == 0]
        visited = set(starts)
        queue = deque(starts)
        while queue:
            current = queue.popleft()
            for target in adjacency[current]:
                if target not in visited:
                    visited.add(target)
                    queue.append(target)
        check("Workflow reachability", len(starts) == 1 and visited == set(node_ids))

        expected_workflow = normalize_baseline(
            baseline_workflow,
            contract,
            adapter_code,
        )
        check("only permitted V1.1 workflow changes", workflow == expected_workflow)

        old_hits = new_hits = 0
        for info in artifact_zip.infolist():
            if info.filename.endswith(".xlsx"):
                payload = artifact_zip.read(info.filename)
                old_hits += xlsx_id_count(payload, old_id)
                new_hits += xlsx_id_count(payload, new_id)
        check("XLSX WorkflowID sync", old_hits == 0 and new_hits > 0)
        check("baseline entry replaced", baseline_name not in artifact_zip.namelist())

    action_test = subprocess.run(
        ["node", str(NATIVE_DIR / "test-action-contract.js")],
        cwd=NATIVE_DIR,
        text=True,
        encoding="utf-8",
        capture_output=True,
    )
    check("Action Contract tests", action_test.returncode == 0)
    if action_test.returncode != 0:
        print(action_test.stdout)
        print(action_test.stderr, file=sys.stderr)

    week_scope_test = subprocess.run(
        [sys.executable, str(NATIVE_DIR / "test-schedule-week-scope-contract.py"),
         "--artifact", str(artifact)],
        cwd=NATIVE_DIR,
        text=True,
        encoding="utf-8",
        capture_output=True,
    )
    check("Week Scope Contract regressions", week_scope_test.returncode == 0)
    if week_scope_test.returncode != 0:
        print(week_scope_test.stdout)
        print(week_scope_test.stderr, file=sys.stderr)

    for index, name in enumerate(checks, 1):
        print(f"PASS {index:02d}: {name}")
    print(f"Schedule Actions V1.1 artifact gate: PASS ({len(checks)}/{len(checks)})")
    print(f"SHA256: {sha256(artifact)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--artifact", required=True)
    args = parser.parse_args()
    run_gate(Path(args.baseline).resolve(), Path(args.artifact).resolve())


if __name__ == "__main__":
    main()
