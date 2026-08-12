#!/usr/bin/env python3
"""Generate the Schedule Actions V1.1 workflow from the real WidgetStable PASS ZIP."""

import argparse
import copy
import html
import hashlib
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path


NATIVE_DIR = Path(__file__).resolve().parent
KIT_DIR = NATIVE_DIR.parent.parent
REPO_DIR = KIT_DIR.parent.parent
CONTRACT_PATH = NATIVE_DIR / "action-contract.json"


def read_contract():
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def locate_baseline(explicit, contract):
    file_name = f"{contract['baseline']['workflowName']}-可直接导入.zip"
    candidates = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    candidates.extend([
        REPO_DIR / ".tmp" / "widget-stable-baseline.zip",
        Path.home() / "Downloads" / file_name,
    ])
    expected_hash = contract["baseline"]["sha256"].lower()
    mismatches = []
    for candidate in candidates:
        if not candidate.is_file():
            continue
        actual_hash = sha256(candidate)
        if actual_hash == expected_hash:
            return candidate.resolve()
        mismatches.append(f"{candidate} ({actual_hash})")
    detail = "; ".join(mismatches) if mismatches else "no candidate file found"
    raise SystemExit(f"WidgetStable PASS baseline unavailable or hash mismatch: {detail}")


def rewrite_inner_zip(data, old_id, new_id):
    source = io.BytesIO(data)
    target = io.BytesIO()
    replacements = 0
    with zipfile.ZipFile(source, "r") as reader, zipfile.ZipFile(target, "w") as writer:
        for info in reader.infolist():
            payload = reader.read(info.filename)
            count = payload.count(old_id.encode("utf-8"))
            if count:
                payload = payload.replace(old_id.encode("utf-8"), new_id.encode("utf-8"))
                replacements += count
            writer.writestr(copy.copy(info), payload)
    return target.getvalue(), replacements


def input_reference(name, input_type, node_id, json_path):
    return {
        "Name": name,
        "Type": input_type,
        "Input": {
            "InputType": "REFERENCE_OUTPUT",
            "Reference": {"NodeID": node_id, "JsonPath": json_path},
        },
        "Desc": "",
        "IsRequired": False,
        "SubInputs": [],
        "DefaultValue": "",
        "DefaultFileName": "",
    }


def make_date_guard(contract, extractor, date_parser):
    guard_id = contract["dateGuardNodeId"]
    extractor_id = extractor["NodeID"]
    date_id = date_parser["NodeID"]
    code = (NATIVE_DIR / contract["dateInputGuard"]).read_text(encoding="utf-8")
    node_ui = {
        "data": {
            "isHovering": False,
            "isParallel": False,
            "source": True,
            "target": True,
            "debug": None,
            "error": False,
            "output": [],
            "schema": None,
            "checkDataError": 0,
            "showTips": False,
            "isConcurrent": False,
            "financeType": None,
            "content": {
                "inputs": ["date_text", "week", "weekday", "time_scope"],
                "outputs": ["Output", "Output.safe_date_text"],
            },
        },
        "position": {"x": 950, "y": 400},
        "targetPosition": "left",
        "sourcePosition": "right",
        "selected": False,
        "measured": {"width": 250, "height": 140},
        "dragging": False,
    }
    return {
        "NodeID": guard_id,
        "NodeName": "日期输入守卫",
        "NodeDesc": "显式合法教学周清空重复 date_text；没有合法显式 week 时保留原自然语言日期交给 CampusTools 确定性解析。",
        "NodeType": "CODE_EXECUTOR",
        "CodeExecutorNodeData": {"Code": code, "Language": "PYTHON3"},
        "Inputs": [
            input_reference("date_text", "STRING", extractor_id, "Output.date_text"),
            input_reference("week", "INT", extractor_id, "Output.week"),
            input_reference("weekday", "INT", extractor_id, "Output.weekday"),
            input_reference("time_scope", "STRING", extractor_id, "Output.time_scope"),
        ],
        "Outputs": [{
            "Title": "Output",
            "Type": "OBJECT",
            "Required": [],
            "Properties": [{
                "Title": "safe_date_text",
                "Type": "STRING",
                "Required": [],
                "Properties": [],
                "Desc": "",
                "AnalysisMethod": "COVER",
            }],
            "Desc": "输出内容",
            "AnalysisMethod": "COVER",
        }],
        "NextNodeIDs": [date_id],
        "NodeUI": json.dumps(node_ui, ensure_ascii=False, separators=(",", ":")),
        "ExceptionHandling": {
            "Switch": "OFF",
            "MaxRetries": "1",
            "RetryInterval": "1",
            "AbnormalOutputResult": "",
            "HandleMethod": "EXCEPTION_OUTPUT",
            "NextNodeIDs": [],
            "AbnormalRetrySwitch": "ABNORMAL_RETRY_ON",
            "Timeout": "10",
        },
    }


def edge_between(source_id, target_id):
    return {
        "source": source_id,
        "target": target_id,
        "sourceHandle": f"{source_id}-source",
        "type": "custom",
        "data": {"connectedNodeIsHovering": False, "error": False, "isHovering": False},
        "id": f"xy-edge__{source_id}{source_id}-source-{target_id}",
        "selected": False,
        "animated": False,
    }


def apply_week_scope_fix(workflow, contract):
    nodes = workflow.get("Nodes", [])
    by_name = {node.get("NodeName"): node for node in nodes}
    required_names = ["参数提取", "必填判断", "日期解析", "查询参数归一化"]
    missing = [name for name in required_names if name not in by_name]
    if missing:
        raise SystemExit(f"baseline missing V1.1 nodes: {', '.join(missing)}")

    extractor = by_name["参数提取"]
    required = by_name["必填判断"]
    date_parser = by_name["日期解析"]
    normalizer = by_name["查询参数归一化"]
    prompt = (NATIVE_DIR / contract["parameterExtractorPrompt"]).read_text(encoding="utf-8").strip()
    extractor["ParameterExtractorNodeData"]["UserConstraint"] = prompt
    extractor_ui = json.loads(extractor["NodeUI"])
    extractor_ui["data"]["displayPrompt"] = (
        "<p>" + html.escape(prompt).replace("\n", "<br>") + "</p>"
    )
    extractor["NodeUI"] = json.dumps(extractor_ui, ensure_ascii=False, separators=(",", ":"))

    normalizer["CodeExecutorNodeData"]["Code"] = (
        NATIVE_DIR / contract["queryNormalizer"]
    ).read_text(encoding="utf-8")

    guard = make_date_guard(contract, extractor, date_parser)
    guard_id = guard["NodeID"]
    date_id = date_parser["NodeID"]
    required_id = required["NodeID"]
    complete_group = required["LogicEvaluatorNodeData"]["Group"][-1]
    if complete_group.get("NextNodeIDs") != [date_id]:
        raise SystemExit("baseline required-parameter complete branch changed")
    complete_group["NextNodeIDs"] = [guard_id]

    date_text_input = next(
        item for item in date_parser["ToolNodeData"]["Body"]
        if item.get("ParamName") == "dateText"
    )
    date_text_input["Input"] = {
        "InputType": "REFERENCE_OUTPUT",
        "Reference": {"NodeID": guard_id, "JsonPath": "Output.safe_date_text"},
    }

    date_index = nodes.index(date_parser)
    nodes.insert(date_index, guard)

    edges = json.loads(workflow["Edge"]) if isinstance(workflow.get("Edge"), str) else workflow["Edge"]
    branch_edges = [
        edge for edge in edges
        if edge.get("source") == required_id and edge.get("target") == date_id
    ]
    if len(branch_edges) != 1:
        raise SystemExit(f"expected one complete-branch edge, found {len(branch_edges)}")
    branch_edge = branch_edges[0]
    branch_edge["target"] = guard_id
    branch_edge["id"] = branch_edge["id"].replace(date_id, guard_id)
    edges.insert(edges.index(branch_edge) + 1, edge_between(guard_id, date_id))
    workflow["Edge"] = json.dumps(edges, ensure_ascii=False, separators=(",", ":"))


def generate(baseline, output, contract):
    old_id = contract["baseline"]["workflowId"]
    old_name = contract["baseline"]["workflowName"]
    new_id = contract["generated"]["workflowId"]
    new_name = contract["generated"]["workflowName"]
    adapter_source = (NATIVE_DIR / contract["canonicalAdapter"]).read_text(encoding="utf-8")
    if hashlib.sha256(adapter_source.encode("utf-8")).hexdigest() != contract["canonicalAdapterSha256"]:
        raise SystemExit("canonical Action Builder changed; V1.1 must keep Actions V1 unchanged")

    output.parent.mkdir(parents=True, exist_ok=True)
    xlsx_replacements = 0
    with zipfile.ZipFile(baseline, "r") as reader, zipfile.ZipFile(output, "w") as writer:
        workflow_entries = [name for name in reader.namelist() if name.endswith("_workflow.json")]
        if len(workflow_entries) != 1:
            raise SystemExit(f"baseline must contain one workflow JSON, found {len(workflow_entries)}")
        workflow_entry = workflow_entries[0]

        workflow = json.loads(reader.read(workflow_entry))
        if workflow.get("WorkflowID") != old_id or workflow.get("WorkflowName") != old_name:
            raise SystemExit("baseline workflow identity does not match Action Contract")
        adapters = [
            node for node in workflow.get("Nodes", [])
            if node.get("NodeName") == "Widget数据适配-Schedule"
        ]
        if len(adapters) != 1:
            raise SystemExit(f"expected one Schedule adapter, found {len(adapters)}")

        workflow["WorkflowID"] = new_id
        workflow["WorkflowName"] = new_name
        adapters[0]["CodeExecutorNodeData"]["Code"] = adapter_source
        apply_week_scope_fix(workflow, contract)
        workflow_payload = json.dumps(
            workflow,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        for info in reader.infolist():
            payload = reader.read(info.filename)
            target_info = copy.copy(info)
            if info.filename == workflow_entry:
                target_info.filename = f"{new_id}_workflow.json"
                target_info.orig_filename = target_info.filename
                payload = workflow_payload
            elif info.filename.endswith(".xlsx"):
                payload, replacements = rewrite_inner_zip(payload, old_id, new_id)
                xlsx_replacements += replacements
            writer.writestr(target_info, payload)

    if xlsx_replacements == 0:
        raise SystemExit("no XLSX WorkflowID references were updated")


def main():
    contract = read_contract()
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", help="exact WidgetStable PASS ZIP")
    parser.add_argument("--output", help="Actions V1.1 output ZIP")
    args = parser.parse_args()

    baseline = locate_baseline(args.baseline, contract)
    output = (
        Path(args.output).expanduser()
        if args.output
        else REPO_DIR / "output" / "competition-adp" / contract["generated"]["fileName"]
    ).resolve()
    generate(baseline, output, contract)
    print(f"Generated: {output}")
    print(f"SHA256: {sha256(output)}")

    gate_path = NATIVE_DIR / "gate-schedule-actions-v1-workflow.py"
    subprocess.run([
        sys.executable,
        str(gate_path),
        "--baseline", str(baseline),
        "--artifact", str(output),
    ], check=True)


if __name__ == "__main__":
    main()
