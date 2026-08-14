#!/usr/bin/env python3
"""Compile deterministic Tencent ADP import artifacts from canonical contracts.

The real ADP V1.1 export is used only as a platform-format seed. Business rules,
transport routes, widget inputs, actions and workbook metadata come from the
canonical files beside this compiler. CampusTools fact logic is never modified.
"""

import argparse
import copy
import datetime
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
import os
from pathlib import Path

from openpyxl import Workbook

from campus_widget_compiler import SPECS, compile_workflow, source_path, workbook_records


NATIVE_DIR = Path(__file__).resolve().parent
KIT_DIR = NATIVE_DIR.parent.parent
REPO_DIR = KIT_DIR.parent.parent
OUTPUT_DIR = REPO_DIR / "output" / "competition-adp" / "final"
ACTION_PATH = NATIVE_DIR / "action-contract.json"
TRANSPORT_PATH = NATIVE_DIR / "adp-transport-contract.json"
WIDGET_PATH = NATIVE_DIR / "schedule-runtime-safe-v3-contract.json"
VERIFIER_PATH = NATIVE_DIR / "schedule-result-verifier-v2.py"
REAL_EXPORT_CATALOG_PATH = NATIVE_DIR / "real-adp-export-catalog.json"
FIXED_ZIP_TIME = (2026, 8, 12, 0, 0, 0)
ROOT_FILES = [
    "workflows.xlsx",
    "parameters.xlsx",
    "variables.xlsx",
    "example_queries.xlsx",
    "workflow_references.xlsx",
]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    return sha256_bytes(path.read_bytes())


def locate_seed(contract, explicit=None):
    seed = contract["compilerBaseline"]
    candidates = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    candidates.extend(sorted(
        (Path.home() / "Downloads").glob(seed["glob"]),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    ))
    candidates.extend([
        REPO_DIR / ".tmp" / "schedule-actions-v1.1-seed.zip",
        REPO_DIR / "output" / "competition-adp" / "01-多维课表查询-WidgetStable-ActionsV1.1-可直接导入.zip",
    ])
    mismatches = []
    for candidate in candidates:
        if not candidate.is_file():
            continue
        actual = sha256_file(candidate)
        if actual == seed["sha256"]:
            return candidate.resolve(), "platform-v1.1"
        mismatches.append({"path": str(candidate), "sha256": actual})
    final_candidate = OUTPUT_DIR / contract["generated"]["fileName"]
    if final_candidate.is_file():
        try:
            workflow = workflow_from_zip(final_candidate)
        except (AssertionError, KeyError, ValueError, zipfile.BadZipFile):
            workflow = {}
        node_names = {node.get("NodeName") for node in workflow.get("Nodes", [])}
        if (
            workflow.get("WorkflowID") == contract["generated"]["workflowId"]
            and workflow.get("WorkflowName") == contract["generated"]["workflowName"]
            and {"课表查询-WEEK", "课表查询-DAY", "课表查询-DATE"} <= node_names
        ):
            return final_candidate.resolve(), "canonical-final-recompile"
    # Bootstrapping remains possible after a fresh output cleanup because the
    # previously compiled Final is also tracked in Git. Read it from HEAD into
    # an isolated temp file; never silently reuse the old output artifact.
    try:
        relative = final_candidate.relative_to(REPO_DIR).as_posix()
        tracked = subprocess.run(
            ["git", "show", f"HEAD:{relative}"], cwd=REPO_DIR,
            capture_output=True, check=True,
        ).stdout
        with tempfile.NamedTemporaryFile(prefix="fosuclass-adp-seed-", suffix=".zip", delete=False) as handle:
            handle.write(tracked)
            tracked_seed = Path(handle.name)
        workflow = workflow_from_zip(tracked_seed)
        node_names = {node.get("NodeName") for node in workflow.get("Nodes", [])}
        if (
            workflow.get("WorkflowID") == contract["generated"]["workflowId"]
            and workflow.get("WorkflowName") == contract["generated"]["workflowName"]
            and {"课表查询-WEEK", "课表查询-DAY", "课表查询-DATE"} <= node_names
        ):
            return tracked_seed.resolve(), "git-head-final-recompile"
        tracked_seed.unlink(missing_ok=True)
    except (subprocess.CalledProcessError, AssertionError, KeyError, ValueError, zipfile.BadZipFile):
        pass
    raise SystemExit(
        "真实 ADP V1.1 platform seed 与 canonical Final recompile seed 均不可用；"
        "候选仅报告路径与哈希："
        + json.dumps(mismatches, ensure_ascii=False)
    )


def workflow_from_zip(path):
    with zipfile.ZipFile(path, "r") as reader:
        if reader.testzip() is not None:
            raise AssertionError("platform seed ZIP CRC failed")
        names = [name for name in reader.namelist() if name.endswith("_workflow.json")]
        if len(names) != 1:
            raise AssertionError(f"expected one workflow JSON, found {len(names)}")
        return json.loads(reader.read(names[0]))


def deep_replace(value, replacements):
    if isinstance(value, dict):
        return {key: deep_replace(child, replacements) for key, child in value.items()}
    if isinstance(value, list):
        return [deep_replace(child, replacements) for child in value]
    if isinstance(value, str):
        result = value
        for old, new in replacements.items():
            result = result.replace(old, new)
        return result
    return value


def edge_list(workflow):
    value = workflow.get("Edge", [])
    return json.loads(value) if isinstance(value, str) else value


def set_edges(workflow, edges):
    workflow["Edge"] = json.dumps(edges, ensure_ascii=False, separators=(",", ":"))


def edge_between(source, target, source_handle=None):
    source_handle = source_handle or f"{source}-source"
    return {
        "source": source,
        "target": target,
        "sourceHandle": source_handle,
        "targetHandle": f"{target}-target",
        "type": "custom",
        "data": {"connectedNodeIsHovering": False, "error": False, "isHovering": False},
        "id": f"xy-edge__{source}{source_handle}-{target}{target}-target",
        "selected": False,
        "animated": False,
    }


def node_ui(node):
    return json.loads(node["NodeUI"])


def write_node_ui(node, value):
    node["NodeUI"] = json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def move_node(node, x_delta=0, y_delta=0):
    ui = node_ui(node)
    position = ui.setdefault("position", {})
    position["x"] = float(position.get("x", 0)) + x_delta
    position["y"] = float(position.get("y", 0)) + y_delta
    write_node_ui(node, ui)


def body_by_names(tool, names):
    source = {item["ParamName"]: item for item in tool["ToolNodeData"]["Body"]}
    return [copy.deepcopy(source[name]) for name in names]


def sync_tool_ui_inputs(tool):
    ui = node_ui(tool)
    ui["data"]["content"]["inputs"] = [
        item["ParamName"] for item in tool["ToolNodeData"]["Body"]
    ]
    write_node_ui(tool, ui)


def add_transport_route_output(normalizer):
    properties = normalizer["Outputs"][0]["Properties"]
    if not any(item.get("Title") == "transport_route" for item in properties):
        properties.insert(0, {
            "Title": "transport_route",
            "Type": "STRING",
            "Required": [],
            "Properties": [],
            "Desc": "WEEK/DAY/DATE transport branch",
            "AnalysisMethod": "COVER",
        })
    ui = node_ui(normalizer)
    outputs = ui["data"]["content"]["outputs"]
    if "Output.transport_route" not in outputs:
        outputs.insert(1, "Output.transport_route")
    write_node_ui(normalizer, ui)


def make_scope_router(template, contract, normalizer_id, targets):
    router = copy.deepcopy(template)
    router["NodeID"] = contract["compiler"]["scopeRouterNodeId"]
    router["NodeName"] = "ADP Transport Scope Router"
    router["NodeDesc"] = "按归一化后的 WEEK/DAY/DATE 结构路由到独立 Tool Node；不依赖 optional INT 的空值语义。"
    group_ids = {
        "WEEK": "ae35a38d-94da-5ec3-a028-6836332cd3c1",
        "DAY": "a4cb7b79-c55e-5f4e-912c-4f43e6eb1abd",
        "DATE": "ed2b5cfb-fae5-5fdf-b067-b679ef50a7fd",
    }
    groups = []
    for route in ["WEEK", "DAY"]:
        groups.append({
            "NextNodeIDs": [targets[route]],
            "Logical": {
                "LogicalOperator": "UNSPECIFIED",
                "Compound": [],
                "Comparison": {
                    "Left": {"InputType": "REFERENCE_OUTPUT", "Reference": {
                        "NodeID": normalizer_id, "JsonPath": "Output.transport_route"}},
                    "LeftType": "STRING",
                    "Operator": "EQ",
                    "Right": {"InputType": "USER_INPUT", "UserInputValue": {
                        "Values": [route], "FileNames": []}},
                    "MatchType": "SEMANTIC",
                },
            },
        })
    groups.append({"NextNodeIDs": [targets["DATE"]]})
    router["LogicEvaluatorNodeData"]["Group"] = groups
    router["LogicEvaluatorNodeData"]["ModelParams"]["Temperature"] = 0
    router["NextNodeIDs"] = []
    ui = node_ui(router)
    ui["data"]["content"] = [
        {"content": [{"leftStr": "Output.transport_route", "rightStr": route,
                       "operatorStr": "等于"}], "index": index, "id": group_ids[route]}
        for index, route in enumerate(["WEEK", "DAY"])
    ] + [{"content": [], "index": 2, "id": group_ids["DATE"]}]
    ui["position"] = {"x": 1600, "y": 240}
    write_node_ui(router, ui)
    return router, group_ids


def logic_group_handles(node):
    ui = node_ui(node)
    content = ui.get("data", {}).get("content", [])
    groups = node.get("LogicEvaluatorNodeData", {}).get("Group", [])
    if not isinstance(content, list) or len(content) != len(groups):
        raise AssertionError(f"logic UI/group mismatch: {node.get('NodeName')}")
    return [item["id"] for item in content]


def clone_branch(nodes, old_ids, new_ids, suffix, y_delta, extra_replacements=None):
    replacements = dict(zip(old_ids, new_ids))
    replacements.update(extra_replacements or {})
    clones = []
    for old_id in old_ids:
        source = next(node for node in nodes if node["NodeID"] == old_id)
        clone = deep_replace(copy.deepcopy(source), replacements)
        base_name = re.sub(r"-(?:WEEK|DAY|DATE)$", "", source["NodeName"])
        clone["NodeName"] = f"{base_name}-{suffix}"
        move_node(clone, y_delta=y_delta)
        clones.append(clone)
    return clones


def reference_input(name, node_id, json_path="Output.Body"):
    return {
        "Name": name,
        "Type": "OBJECT" if name.endswith("_body") else "STRING",
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


def literal_input(name, value):
    return {
        "Name": name,
        "Type": "STRING",
        "Input": {
            "InputType": "USER_INPUT",
            "UserInputValue": {"Values": [value], "FileNames": []},
        },
        "Desc": "WEEK/DAY/DATE response scope, fixed by compiler",
        "IsRequired": True,
        "SubInputs": [],
        "DefaultValue": value,
        "DefaultFileName": "",
    }


def set_code_inputs(node, inputs):
    node["Inputs"] = inputs
    ui = node_ui(node)
    ui["data"]["content"]["inputs"] = [item["Name"] for item in inputs]
    write_node_ui(node, ui)


def configure_response_branch(
    verify, adapter, scope, tool_id, academic_id, extractor_id,
    verifier_source, adapter_source,
):
    verify["CodeExecutorNodeData"]["Code"] = verifier_source
    verify["NodeDesc"] = f"{scope} response verifier: scope-aware canonical presentation."
    set_code_inputs(verify, [
        literal_input("transport_scope", scope),
        reference_input("academic_body", academic_id),
        reference_input("tool_body", tool_id),
        reference_input("entity_type", extractor_id, "Output.entity_type"),
        reference_input("entity_name", extractor_id, "Output.entity_name"),
    ])
    adapter["CodeExecutorNodeData"]["Code"] = adapter_source
    adapter["NodeDesc"] = f"{scope} response adapter: scope-aware sentinel canonicalization."
    set_code_inputs(adapter, [
        literal_input("transport_scope", scope),
        reference_input("academic_body", academic_id),
        reference_input("tool_body", tool_id),
    ])


def compile_schedule(seed_path, contract, transport, widget_contract):
    workflow = workflow_from_zip(seed_path)
    seed = contract["compilerBaseline"]
    if (workflow.get("WorkflowID"), workflow.get("WorkflowName")) != (
        seed["workflowId"], seed["workflowName"]
    ):
        raise AssertionError("platform seed identity mismatch")
    workflow["WorkflowID"] = contract["generated"]["workflowId"]
    workflow["WorkflowName"] = contract["generated"]["workflowName"]
    workflow["WorkflowDesc"] = (
        "ADP Final：query_schedule 按 WEEK/DAY/DATE 拆分独立 Tool Node；"
        "WEEK 请求结构完全省略 weekday/date；Schedule 21 字段 Widget 与 sys.chat Action 保持真实 PASS 合同。"
    )
    workflow["ReleaseTime"] = ""
    workflow["UpdateTime"] = "1786464000000"

    nodes = workflow["Nodes"]
    by_name = {node["NodeName"]: node for node in nodes}
    normalizer = by_name["查询参数归一化"]
    normalizer["CodeExecutorNodeData"]["Code"] = (
        NATIVE_DIR / contract["queryNormalizer"]
    ).read_text(encoding="utf-8")
    add_transport_route_output(normalizer)
    original_tool = by_name["课表查询"]
    platform_tool_template = copy.deepcopy(original_tool)
    original_verify = by_name["结果核验与呈现"]
    original_adapter = by_name["Widget数据适配-Schedule"]
    original_display = by_name["Widget展示判断"]
    original_widget = next(node for node in nodes if node.get("NodeType") == "WIDGET")
    original_answer = by_name["查询结果回复"]
    end_node = next(node for node in nodes if node.get("NodeType") == "END")
    old_chain_ids = [
        original_verify["NodeID"], original_adapter["NodeID"], original_display["NodeID"],
        original_widget["NodeID"], original_answer["NodeID"],
    ]
    extractor = by_name["参数提取"]
    academic_tool = by_name["日期解析"]
    verifier_source = VERIFIER_PATH.read_text(encoding="utf-8")
    adapter_source = (NATIVE_DIR / contract["canonicalAdapter"]).read_text(encoding="utf-8")

    normalizer["NextNodeIDs"] = [contract["compiler"]["scopeRouterNodeId"]]
    original_tool["NodeName"] = "课表查询-DAY"
    original_tool["NodeDesc"] = "DAY transport：只发送 entityType/entityName/week/weekday/periodStart/periodEnd。"
    original_tool["ToolNodeData"]["Body"] = body_by_names(
        original_tool, ["entityType", "entityName", "week", "weekday", "periodStart", "periodEnd"]
    )
    sync_tool_ui_inputs(original_tool)
    for node, suffix in [
        (original_verify, "DAY"), (original_adapter, "DAY"), (original_display, "DAY"),
        (original_widget, "DAY"), (original_answer, "DAY"),
    ]:
        node["NodeName"] = f"{node['NodeName']}-{suffix}"
    move_node(original_tool, y_delta=0)

    branch_nodes = contract["compiler"]["branchNodeIds"]
    week_chain_ids = [branch_nodes["WEEK"][key] for key in ["verify", "adapter", "display", "widget", "answer"]]
    date_chain_ids = [branch_nodes["DATE"][key] for key in ["verify", "adapter", "display", "widget", "answer"]]
    week_chain = clone_branch(
        nodes, old_chain_ids, week_chain_ids, "WEEK", -360,
        {original_tool["NodeID"]: branch_nodes["WEEK"]["tool"]},
    )
    date_chain = clone_branch(
        nodes, old_chain_ids, date_chain_ids, "DATE", 360,
        {original_tool["NodeID"]: branch_nodes["DATE"]["tool"]},
    )

    week_tool = deep_replace(copy.deepcopy(original_tool), {
        original_tool["NodeID"]: branch_nodes["WEEK"]["tool"],
        original_verify["NodeID"]: branch_nodes["WEEK"]["verify"],
    })
    week_tool["NodeName"] = "课表查询-WEEK"
    week_tool["NodeDesc"] = "WEEK transport：Body 中根本不存在 weekday/date key。"
    week_tool["ToolNodeData"]["Body"] = body_by_names(
        original_tool, ["entityType", "entityName", "week", "periodStart", "periodEnd"]
    )
    sync_tool_ui_inputs(week_tool)
    move_node(week_tool, y_delta=-360)

    date_tool = deep_replace(copy.deepcopy(original_tool), {
        original_tool["NodeID"]: branch_nodes["DATE"]["tool"],
        original_verify["NodeID"]: branch_nodes["DATE"]["verify"],
    })
    date_tool["NodeName"] = "课表查询-DATE"
    date_tool["NodeDesc"] = "DATE transport：只发送 entityType/entityName/date/periodStart/periodEnd。"
    date_tool["ToolNodeData"]["Body"] = body_by_names(
        platform_tool_template, ["entityType", "entityName", "date", "periodStart", "periodEnd"]
    )
    date_tool["ToolNodeData"]["Body"] = deep_replace(
        date_tool["ToolNodeData"]["Body"], {original_tool["NodeID"]: date_tool["NodeID"]}
    )
    sync_tool_ui_inputs(date_tool)
    move_node(date_tool, y_delta=360)

    targets = {
        "WEEK": week_tool["NodeID"],
        "DAY": original_tool["NodeID"],
        "DATE": date_tool["NodeID"],
    }
    router, group_ids = make_scope_router(original_display, contract, normalizer["NodeID"], targets)
    nodes.extend([router, week_tool, date_tool, *week_chain, *date_chain])

    response_nodes = {
        "WEEK": (week_tool, week_chain[0], week_chain[1]),
        "DAY": (original_tool, original_verify, original_adapter),
        "DATE": (date_tool, date_chain[0], date_chain[1]),
    }
    for scope, (tool, verify, adapter) in response_nodes.items():
        configure_response_branch(
            verify, adapter, scope, tool["NodeID"], academic_tool["NodeID"],
            extractor["NodeID"], verifier_source, adapter_source,
        )

    edges = edge_list(workflow)
    edges = [edge for edge in edges if not (
        edge.get("source") == normalizer["NodeID"] and edge.get("target") == original_tool["NodeID"]
    )]
    edges.append(edge_between(normalizer["NodeID"], router["NodeID"]))
    for route, target in targets.items():
        edges.append(edge_between(
            router["NodeID"], target,
            f"{router['NodeID']}.{group_ids[route]}-source",
        ))
    for tool, ids in [(week_tool, week_chain_ids), (date_tool, date_chain_ids)]:
        verify, adapter, display, widget, answer = ids
        display_node = next(node for node in nodes if node["NodeID"] == display)
        widget_handle, fallback_handle = logic_group_handles(display_node)
        edges.extend([
            edge_between(tool["NodeID"], verify),
            edge_between(verify, adapter),
            edge_between(adapter, display),
            edge_between(display, widget, f"{display}.{widget_handle}-source"),
            edge_between(display, answer, f"{display}.{fallback_handle}-source"),
            edge_between(widget, end_node["NodeID"]),
            edge_between(answer, end_node["NodeID"]),
        ])
    set_edges(workflow, edges)
    return workflow


def recompile_schedule_final(seed_path, contract):
    """Re-inject canonical branch response code into an existing Final canvas."""
    workflow = workflow_from_zip(seed_path)
    if (
        workflow.get("WorkflowID") != contract["generated"]["workflowId"]
        or workflow.get("WorkflowName") != contract["generated"]["workflowName"]
    ):
        raise AssertionError("canonical Final recompile seed identity mismatch")
    nodes = {node.get("NodeName"): node for node in workflow.get("Nodes", [])}
    extractor = nodes["参数提取"]
    academic_tool = nodes["日期解析"]
    verifier_source = VERIFIER_PATH.read_text(encoding="utf-8")
    adapter_source = (NATIVE_DIR / contract["canonicalAdapter"]).read_text(encoding="utf-8")
    for scope in ["WEEK", "DAY", "DATE"]:
        tool = nodes[f"课表查询-{scope}"]
        verify = nodes[f"结果核验与呈现-{scope}"]
        adapter = nodes[f"Widget数据适配-Schedule-{scope}"]
        configure_response_branch(
            verify, adapter, scope, tool["NodeID"], academic_tool["NodeID"],
            extractor["NodeID"], verifier_source, adapter_source,
        )
    workflow["WorkflowDesc"] = (
        "ADP Interaction Convergence R2：保留 WEEK/DAY/DATE request transport split；"
        "Verify/Adapter 按分支规范化 Tool Output sentinel，并使用 Action Protocol V2。"
    )
    return workflow


def deterministic_xlsx(headers, rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Sheet1"
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    workbook.properties.creator = "FosuClass ADP Compiler"
    workbook.properties.lastModifiedBy = "FosuClass ADP Compiler"
    fixed_timestamp = datetime.datetime(2026, 8, 12, 0, 0, 0)
    workbook.properties.created = fixed_timestamp
    workbook.properties.modified = fixed_timestamp
    with tempfile.TemporaryDirectory() as temp:
        raw = Path(temp) / "raw.xlsx"
        workbook.save(raw)
        with zipfile.ZipFile(raw, "r") as reader:
            entries = [(name, reader.read(name)) for name in sorted(reader.namelist())]
        entries = [
            (name, re.sub(
                rb"(<dcterms:modified\b[^>]*>)[^<]*(</dcterms:modified>)",
                rb"\g<1>2026-08-12T00:00:00Z\g<2>", data,
            ) if name == "docProps/core.xml" else data)
            for name, data in entries
        ]
        target = Path(temp) / "deterministic.xlsx"
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as writer:
            for name, data in entries:
                info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                writer.writestr(info, data)
        return target.read_bytes()


def workbook_payloads(workflow, contract):
    workflow_id = workflow["WorkflowID"]
    canvas = f"{workflow_id}_workflow.json"
    examples = [
        "教师003第1周周一的课",
        "查询教师003第1周的课表",
        "查询教师003第1周周二的课",
        "A1-101第2周周三的课表",
        "2025级A班第3周周五的课",
        "高等数学A第4周的课表",
    ]
    return {
        "workflows.xlsx": deterministic_xlsx(
            ["WorkflowId", "WorkflowName", "WorkflowDescription", "CanvasStructure"],
            [[workflow_id, workflow["WorkflowName"], workflow["WorkflowDesc"], canvas]],
        ),
        "parameters.xlsx": deterministic_xlsx(
            ["WorkflowId", "WorkflowNodeId", "WorkflowNodeName", "ParameterId", "ParameterName",
             "ParameterDescription", "ParameterType", "ParameterCorrectExample", "ParameterIncorrectExample",
             "ParameterParentId", "ParameterRequiredStatus"],
            [],
        ),
        "variables.xlsx": deterministic_xlsx(
            ["WorkflowId", "VariableId", "VariableName", "VariableDescription", "VariableType",
             "VariableDefaultValue", "VariableDefaultValueFileName", "ParameterType"],
            [[workflow_id, "a39583c8-2484-46f2-8ba8-e7384a0365e8", "campus_api_authorization",
              "导入后绑定现有赛事空间环境变量；占位值不是凭据", "STRING",
              "Bearer ADP_IMPORT_PLACEHOLDER_NOT_A_CREDENTIAL", "", "1"]],
        ),
        "example_queries.xlsx": deterministic_xlsx(
            ["WorkflowId", "ExampleQueryContent"],
            [[workflow_id, example] for example in examples],
        ),
        "workflow_references.xlsx": deterministic_xlsx(
            ["WorkflowId", "WorkflowNodeId", "ReferenceWorkflowId", "ReferenceWorkflowName"],
            [],
        ),
    }


def write_workflow_zip(path, workflow, workbooks):
    path.parent.mkdir(parents=True, exist_ok=True)
    workflow_name = f"{workflow['WorkflowID']}_workflow.json"
    payloads = {workflow_name: json.dumps(
        workflow, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8"), **workbooks}
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as writer:
        for name in [workflow_name, *ROOT_FILES]:
            info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            writer.writestr(info, payloads[name])


def needs_adp_export_text():
    catalog = read_json(REAL_EXPORT_CATALOG_PATH)
    pending = catalog.get("pending", [])
    lines = ["# NEEDS_ADP_EXPORT", ""]
    if pending:
        lines.extend(["仍需从腾讯 ADP 导出：", ""])
        lines.extend(f"- `{name}`" for name in pending)
    else:
        lines.extend([
            "Schedule / Classroom / Conflict / DayPlan / Choice / Error Widget 与 02 / 03 / 04 Workflow 真实导出已全部接收并校验。",
            "",
            "状态：NONE。无需继续导出；后续仅需腾讯 ADP 草稿 Runtime E2E。",
        ])
    return "\n".join(lines) + "\n"


def import_readme(artifact_names):
    listed = "\n".join(f"- `{name}`" for name in artifact_names)
    return f"""# CampusFlow ADP Final Import

本 Bundle 的 Workflow ZIP 均由 `npm run adp:compile` 从 canonical contract 自动生成。

## 包含

{listed}

## 腾讯 ADP 操作

1. 依次导入 01 / 02 / 03 / 04 Final ZIP。
2. 应用仅启用 01 Final、02 Final、03 Final、04 Final；旧 01 与 00 Seed 不参与路由。
3. 按 `ADP-App-Expected-Config.json` 核对 Workflow examples 与 6 个真实 WidgetID。
4. 在 ADP 草稿环境完成 Runtime E2E 后再发布；不要手改 Workflow 节点。
"""


def write_bundle_zip(path, directory, names):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as writer:
        for name in sorted(names):
            info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            writer.writestr(info, (directory / name).read_bytes())


def run_validator(artifact, report):
    child_env = dict(os.environ)
    child_env["PYTHONUTF8"] = "1"
    result = subprocess.run([
        sys.executable, str(NATIVE_DIR / "validate-adp-artifact.py"),
        "--artifact", str(artifact), "--report", str(report),
    ], cwd=REPO_DIR, text=True, encoding="utf-8", errors="replace",
       capture_output=True, env=child_env)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise SystemExit(result.returncode)
    print(result.stdout.strip())
    return read_json(report)


def run_campus_validator(key, artifact, report):
    child_env = dict(os.environ)
    child_env["PYTHONUTF8"] = "1"
    result = subprocess.run([
        sys.executable, str(NATIVE_DIR / "validate-campus-widget-artifact.py"),
        "--key", key, "--artifact", str(artifact), "--report", str(report),
    ], cwd=REPO_DIR, text=True, encoding="utf-8", errors="replace", capture_output=True, env=child_env)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise SystemExit(result.returncode)
    validation = read_json(report)
    print(f"{artifact.name}: {validation['status']} ({validation['checksPassed']} semantic checks)")
    return validation


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", help="exact real ADP V1.1 export ZIP")
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR))
    args = parser.parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    contract = read_json(ACTION_PATH)
    transport = read_json(TRANSPORT_PATH)
    widget = read_json(WIDGET_PATH)
    seed, seed_mode = locate_seed(contract, args.seed)
    seed_workflow = workflow_from_zip(seed)
    workflow = (
        recompile_schedule_final(seed, contract)
        if seed_mode in {"canonical-final-recompile", "git-head-final-recompile"}
        else compile_schedule(seed, contract, transport, widget)
    )
    schedule_path = output_dir / contract["generated"]["fileName"]
    write_workflow_zip(schedule_path, workflow, workbook_payloads(workflow, contract))
    report_path = output_dir / "validation-report-01.json"
    validation = run_validator(schedule_path, report_path)
    # Keep the historical generic report name as a deterministic compatibility
    # alias for downstream artifact consumers.
    shutil.copyfile(report_path, output_dir / "validation-report.json")

    downloads = Path.home() / "Downloads"
    campus_artifacts = []
    for key, spec in SPECS.items():
        target = output_dir / spec["file"]
        try:
            source = source_path(key, downloads)
        except AssertionError:
            # Historical V2 exports are evidence for the frozen logical compiler,
            # not global environment resources that every checkout must retain.
            # Current-environment rebuilding is handled strictly by
            # bind_runtime_environment.py.  The frozen artifact remains usable
            # only when it is already tracked and still passes its semantic gate.
            if not target.is_file():
                raise
            compiled = workflow_from_zip(target)
            print(f"{target.name}: reusing frozen logical artifact; historical raw export is not present")
        else:
            source_workflow = workflow_from_zip(source)
            assert source_workflow["WorkflowID"] == read_json(REAL_EXPORT_CATALOG_PATH)["workflows"][key]["workflowId"]
            compiled = compile_workflow(key, source_workflow)
            write_workflow_zip(target, compiled, workbook_records(
                source, compiled, spec["examples"], deterministic_xlsx,
            ))
        campus_report = output_dir / f"validation-report-{key}.json"
        campus_validation = run_campus_validator(key, target, campus_report)
        campus_artifacts.append({
            "file": target.name, "workflowId": compiled["WorkflowID"],
            "workflowName": compiled["WorkflowName"], "sha256": sha256_file(target),
            "validation": campus_validation["status"],
        })

    dataset = read_json(KIT_DIR / "mock-data" / "competition-demo-v1.json")
    registry = read_json(NATIVE_DIR / "widget-registry.json")
    expected_config = {
        "schema": "fosuclass-adp-app-expected-config/v1",
        "appName": "校园智序 · 小序",
        "dataVersion": dataset["meta"]["dataVersion"],
        "dataHash": dataset["dataHash"],
        "knowledgeBase": {"id": "2084871572396491520", "role": "stable rules only"},
        "activeWorkflows": [
            {"slot": "01", "workflowId": workflow["WorkflowID"], "name": workflow["WorkflowName"]},
            *[{"slot": key, "workflowId": item["workflowId"], "name": item["workflowName"]}
              for key, item in zip(SPECS, campus_artifacts)],
        ],
        "excludedFromRouting": ["01-多维课表查询 (legacy)", "00-节点格式种子-勿启用"],
        "routerExamples": {
            "01": ["教师003第1周周一的课", "查询教师003第1周的课表", "A1-101第2周周三的占用"],
            "02": SPECS["02"]["examples"], "03": SPECS["03"]["examples"], "04": SPECS["04"]["examples"],
        },
        "routingContract": {
            "intentPriority": True, "schedule_risk_check": "03", "schedule_day": "01",
            "schedule_week": "01", "schedule_choose_day": "Choice",
        },
        "widgets": registry["widgets"],
    }
    expected_path = output_dir / "ADP-App-Expected-Config.json"
    expected_path.write_text(json.dumps(expected_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")

    needs_path = output_dir / "NEEDS_ADP_EXPORT.md"
    needs_path.write_text(needs_adp_export_text(), encoding="utf-8", newline="\n")
    readme_path = output_dir / "ADP-IMPORT-README.md"
    artifact_names = [schedule_path.name, *[item["file"] for item in campus_artifacts]]
    readme_path.write_text(import_readme(artifact_names), encoding="utf-8", newline="\n")
    manifest = {
        "schema": "fosuclass-adp-import-bundle/v1",
        "compilerVersion": contract["compiler"]["version"],
        "generatedAt": "2026-08-12T00:00:00Z",
        "dataVersion": transport["dataVersion"],
        "dataHash": dataset["dataHash"],
        "sourceSeed": {
            "mode": seed_mode,
            "sha256": sha256_file(seed),
            "workflowId": seed_workflow["WorkflowID"],
        },
        "artifacts": [{
            "file": schedule_path.name,
            "workflowId": workflow["WorkflowID"],
            "workflowName": workflow["WorkflowName"],
            "sha256": sha256_file(schedule_path),
            "validation": validation["status"],
        }, *campus_artifacts],
        "deferred": ["Schedule Rich V4 awaits a real exported rich Schedule Widget; RuntimeSafe V3 remains active"],
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    sum_names = [*artifact_names, "manifest.json", "ADP-IMPORT-README.md", "NEEDS_ADP_EXPORT.md",
                 "validation-report.json", "validation-report-01.json", "validation-report-02.json", "validation-report-03.json",
                 "validation-report-04.json", "ADP-App-Expected-Config.json"]
    sums_path = output_dir / "SHA256SUMS.txt"
    sums_path.write_text("".join(
        f"{sha256_file(output_dir / name)}  {name}\n" for name in sorted(sum_names)
    ), encoding="utf-8", newline="\n")
    bundle_names = [*sum_names, "SHA256SUMS.txt"]
    bundle_path = output_dir / "CampusFlow-ADP-Import-Bundle.zip"
    write_bundle_zip(bundle_path, output_dir, bundle_names)
    print(f"ADP compiler: PASS\nFinal directory: {output_dir}")
    print(f"Bundle: {bundle_path}\nSHA256: {sha256_file(bundle_path)}")
    if seed_mode == "git-head-final-recompile":
        seed.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
