"""Bind Tencent ADP workflow exports to Widget resources from one environment.

The logical registry remains stable.  This compiler creates an environment-scoped
runtime registry and refuses empty, stale, synthetic, or schema-drifted bindings.
"""

from __future__ import annotations

import argparse
import base64
import copy
import datetime
import hashlib
import io
import json
import re
import tempfile
import uuid
import zipfile
from pathlib import Path

from openpyxl import Workbook, load_workbook

from widget_semantic_view import (
    assert_runtime_safe_view,
    assert_semantically_equal,
    semantic_view_sha256,
)


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
DEFAULT_OUTPUT = REPO / "output" / "competition-adp" / "r4"
DEFAULT_R5_OUTPUT = REPO / "output" / "competition-adp" / "r5"
LOGICAL_REGISTRY_PATH = ROOT / "widget-registry.json"
HERO_ROOT = ROOT / "campus-overview-v1"
FIXED_ZIP_TIME = (2026, 8, 14, 0, 0, 0)
R4_NAMESPACE = uuid.UUID("d56d7b28-60b9-48a2-9d07-bf2ff7bd1414")
ROOT_FILES = [
    "workflows.xlsx",
    "parameters.xlsx",
    "example_queries.xlsx",
    "variables.xlsx",
    "workflow_references.xlsx",
]
RUNTIME_KINDS = ("Schedule", "Classroom", "Conflict", "DayPlan", "Choice", "Error", "CampusOverview")
WIDGET_NAME_MARKERS = {
    "Classroom": "空教室票据",
    "Conflict": "冲突赶场票据",
    "DayPlan": "今日校园计划",
    "Choice": "候选确认",
    "Error": "任务恢复",
    "CampusOverview": "校园教学态势",
}
EXPECTED_HERO_EXPORT_SHA256 = "84d7147947be08a5b34ba82bbb0537a2b23fd564a37e38ef22d4d1555195b643"
EXPECTED_HERO_WIDGET_ID = "876474681d584d95b4a99da929dfb3b1"
EXPECTED_HERO_SCHEMA_SHA256 = "7a02ad628bd8d3ab27cb6b90a4c2eda31ecd870d56dce1fb5b6a19c162c3b2a8"
EXPECTED_HERO_DEFAULT_SHA256 = "541751912cb37117a50866f6bf5485734edad2ce0f6b6060a5765cca1729a4c5"
EXPECTED_HERO_SOURCE_VIEW_SHA256 = "a1e20a51af58b50f0b001a879e67f03e8e139fbb6cb2cf7c4d5d10575a893663"
EXPECTED_HERO_TENCENT_VIEW_SHA256 = "fa73087a230af47d43f97e127b28a8cbb3bc23630b97301fac975e5a8e9c69a0"
WORKFLOW_NAMES = {
    "01": "01-多维课表查询-R3",
    "02": "02-空教室规划-R3",
    "03": "03-课程冲突比较-R3",
    "04": "04-今日校园计划-R3",
    "05": "05-校园教学态势-R1",
}
WORKFLOW_FILES = {
    "01": "01-多维课表查询-R3-Bound.zip",
    "02": "02-空教室规划-R3-Bound.zip",
    "03": "03-课程冲突比较-R3-Bound.zip",
    "04": "04-今日校园计划-R3-Bound.zip",
    "05": "05-校园教学态势-R1-Bound.zip",
}
WORKFLOW_SOURCE_PATTERNS = {
    "01": re.compile(r"^(?:01-多维课表查询-Final(?:_|$)|01-多维课表查询-R3$)"),
    "02": re.compile(r"^(?:02-空教室规划-RuntimeSafeV3|02-空教室规划-R3)$"),
    "03": re.compile(r"^(?:03-课程冲突比较-RuntimeSafeV3|03-课程冲突比较-R3)$"),
    "04": re.compile(r"^(?:04-今日校园计划-RuntimeSafeV3|04-今日校园计划-R3)$"),
}
WORKFLOW_EXAMPLES = {
    "01": ["教师003第1周周一的课", "A1-101第1周周三的占用"],
    "02": ["校区A第1周周一第5-6节有哪些空教室"],
    "03": ["教师003第1周周一跨校区赶不赶得上", "比较2025级A班和2025级B班第1周周五下午的课程冲突"],
    "04": ["帮我安排2026-09-04的一天"],
    "05": [
        "未来四周校园教学情况怎么样",
        "从8月25日开始看看未来几周校园教学运行情况",
        "最近哪一天最忙",
        "哪个校区下午教室最紧张",
    ],
}
BASE_WORKFLOW_SLOTS = ("01", "02", "03", "04")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_json(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exported_at(path: Path) -> str:
    stamp = datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.timezone.utc)
    return stamp.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_widget(path: Path) -> dict:
    raw = path.read_bytes()
    outer = json.loads(raw.decode("utf-8-sig"))
    encoded = outer.get("encodedWidget")
    if not isinstance(encoded, str) or not encoded:
        raise AssertionError(f"{path.name}: encodedWidget missing")
    try:
        inner = json.loads(base64.b64decode(encoded).decode("utf-8"))
    except Exception as error:
        raise AssertionError(f"{path.name}: encodedWidget invalid") from error
    name = str(inner.get("name") or outer.get("name") or "").strip()
    kind = next((key for key, marker in WIDGET_NAME_MARKERS.items() if marker in name), None)
    if not kind:
        raise AssertionError(f"{path.name}: unknown logical Widget kind")
    real_id = str(inner.get("id") or "").strip()
    if not re.fullmatch(r"[0-9a-f]{32}", real_id):
        raise AssertionError(f"{path.name}: real WidgetID is empty or invalid")
    default_state = inner.get("defaultState")
    json_schema = outer.get("jsonSchema")
    if not isinstance(default_state, dict) or not isinstance(json_schema, dict):
        raise AssertionError(f"{path.name}: defaultState/jsonSchema missing")
    for key in ("schemaValidity", "viewValidity", "defaultStateValidity"):
        if inner.get(key) != "valid":
            raise AssertionError(f"{path.name}: {key} is not valid")
    view = str(inner.get("view") or "")
    zod_schema = str(inner.get("schema") or "")
    if not view or not zod_schema:
        raise AssertionError(f"{path.name}: view/schema missing")
    schema_fields = list((json_schema.get("properties") or {}).keys())
    default_fields = list(default_state.keys())
    if set(schema_fields) != set(default_fields):
        raise AssertionError(f"{path.name}: DefaultState and JSON Schema field drift")
    if json_schema.get("type") != "object" or json_schema.get("additionalProperties") is not False:
        raise AssertionError(f"{path.name}: runtime Widget schema must be strict object")
    if set(json_schema.get("required") or []) != set(schema_fields):
        raise AssertionError(f"{path.name}: all RuntimeSafe fields must be required")
    for field, schema in (json_schema.get("properties") or {}).items():
        if schema.get("type") not in {"string", "integer", "number", "boolean"}:
            raise AssertionError(f"{path.name}: {field} is not primitive")
    schema_hash = sha256_bytes(canonical_json(json_schema))
    default_hash = sha256_bytes(canonical_json(default_state))
    view_hash = sha256_bytes(view.encode("utf-8"))
    semantic_hash = semantic_view_sha256(view)
    source_template_hash = None
    if kind == "CampusOverview":
        contract = json.loads((HERO_ROOT / "contract.json").read_text(encoding="utf-8"))
        source_view = (HERO_ROOT / "template.txt").read_text(encoding="utf-8")
        source_template_hash = sha256_bytes(source_view.encode("utf-8"))
        if sha256_bytes(raw) != EXPECTED_HERO_EXPORT_SHA256:
            raise AssertionError(f"{path.name}: real Tencent export SHA256 mismatch")
        if real_id != EXPECTED_HERO_WIDGET_ID:
            raise AssertionError(f"{path.name}: CampusOverview real WidgetID mismatch")
        if name != contract["name"] or list(default_state) != contract["fields"]:
            raise AssertionError(f"{path.name}: CampusOverview logical contract drift")
        if schema_fields != contract["fields"]:
            raise AssertionError(f"{path.name}: CampusOverview JSON Schema field order drift")
        if schema_hash != EXPECTED_HERO_SCHEMA_SHA256:
            raise AssertionError(f"{path.name}: CampusOverview JSON Schema hash drift")
        if default_hash != EXPECTED_HERO_DEFAULT_SHA256:
            raise AssertionError(f"{path.name}: CampusOverview DefaultState hash drift")
        if source_template_hash != EXPECTED_HERO_SOURCE_VIEW_SHA256:
            raise AssertionError("CampusOverview Git source template hash drift")
        if view_hash != EXPECTED_HERO_TENCENT_VIEW_SHA256:
            raise AssertionError(f"{path.name}: Tencent raw view evidence hash drift")
        semantic_hash = assert_semantically_equal(source_view, view)
        assert_runtime_safe_view(view)
    return {
        "kind": kind,
        "path": path,
        "outer": outer,
        "inner": inner,
        "record": {
            "logicalKind": kind,
            "realWidgetId": real_id,
            "widgetName": name,
            "exportSha256": sha256_bytes(raw),
            "viewSha256": view_hash,
            "tencentExportViewSha256": view_hash,
            "sourceTemplateSha256": source_template_hash,
            "semanticViewSha256": semantic_hash,
            "schemaSha256": schema_hash,
            "defaultStateSha256": default_hash,
            "zodSchemaSha256": sha256_bytes(zod_schema.encode("utf-8")),
            "environment": None,
            "exportedAt": exported_at(path),
            "fieldNames": schema_fields,
            "fieldTypes": {key: value.get("type") for key, value in json_schema["properties"].items()},
            "sourceFile": path.name,
            "sourceType": "tencent-widget-export",
            "validity": {
                "schema": inner["schemaValidity"],
                "view": inner["viewValidity"],
                "defaultState": inner["defaultStateValidity"],
            },
        },
    }


def assert_current_runtime_id(path_name: str, real_id: str, stale_ids: set[str]) -> None:
    if not re.fullmatch(r"[0-9a-f]{32}", str(real_id or "")):
        raise AssertionError(f"{path_name}: real WidgetID is empty or invalid")
    if real_id in stale_ids:
        raise AssertionError(f"{path_name}: stale logical-registry WidgetID is not an environment binding")


def workflow_from_zip(path: Path) -> tuple[dict, str]:
    with zipfile.ZipFile(path) as reader:
        names = [name for name in reader.namelist() if name.endswith("_workflow.json")]
        if len(names) != 1:
            raise AssertionError(f"{path.name}: expected one workflow JSON")
        return json.loads(reader.read(names[0]).decode("utf-8")), names[0]


def discover_workflows(directory: Path) -> dict[str, Path]:
    matches: dict[str, list[Path]] = {key: [] for key in BASE_WORKFLOW_SLOTS}
    for path in directory.glob("*.zip"):
        try:
            workflow, _ = workflow_from_zip(path)
        except Exception:
            continue
        name = str(workflow.get("WorkflowName") or "")
        for key, pattern in WORKFLOW_SOURCE_PATTERNS.items():
            if pattern.search(name):
                matches[key].append(path)
    selected = {}
    for key, candidates in matches.items():
        if not candidates:
            raise AssertionError(f"real Tencent workflow export missing for {key}")
        candidates.sort(key=lambda item: (item.stat().st_mtime_ns, item.name), reverse=True)
        selected[key] = candidates[0]
    return selected


def schedule_record(workflow_path: Path, logical_registry: dict, environment: str) -> dict:
    workflow, _ = workflow_from_zip(workflow_path)
    widgets = [node for node in workflow.get("Nodes", []) if node.get("NodeType") == "WIDGET"]
    ids = {str((node.get("WidgetNodeData") or {}).get("WidgetID") or "") for node in widgets}
    ids.discard("")
    expected = logical_registry["widgets"]["Schedule"]
    if ids != {expected["widgetId"]}:
        raise AssertionError("01 Schedule export does not reference the verified runtime WidgetID")
    field_sets = {
        tuple(sorted(param.get("ParamName") for param in (node.get("WidgetNodeData") or {}).get("WidgetParam", [])))
        for node in widgets
    }
    if len(field_sets) != 1:
        raise AssertionError("01 Schedule Widget field sets drifted across DAY/WEEK/DATE")
    view_path = ROOT / "contracts" / "schedule" / "view.txt"
    schema_path = ROOT / "contracts" / "schedule" / "schema.json"
    default_path = ROOT / "contracts" / "schedule" / "default.json"
    view = view_path.read_text(encoding="utf-8")
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    defaults = json.loads(default_path.read_text(encoding="utf-8"))
    view_hash = sha256_bytes(view.encode("utf-8"))
    return {
        "logicalKind": "Schedule",
        "realWidgetId": expected["widgetId"],
        "widgetName": expected["name"],
        "exportSha256": expected["sourceSha256"],
        "viewSha256": view_hash,
        "tencentExportViewSha256": view_hash,
        "sourceTemplateSha256": view_hash,
        "semanticViewSha256": semantic_view_sha256(view),
        "schemaSha256": sha256_bytes(canonical_json(schema)),
        "defaultStateSha256": sha256_bytes(canonical_json(defaults)),
        "environment": environment,
        "exportedAt": exported_at(workflow_path),
        "fieldNames": list(next(iter(field_sets))),
        "fieldTypes": {key: value.get("type") for key, value in schema.get("properties", {}).items()},
        "sourceFile": workflow_path.name,
        "sourceType": "verified-schedule-export-plus-current-workflow-reference",
        "workflowEvidenceSha256": sha256_file(workflow_path),
    }


def build_runtime_registry(
    widget_dir: Path,
    workflows: dict[str, Path],
    environment: str,
    base_registry_path: Path | None = None,
) -> dict:
    logical = json.loads(LOGICAL_REGISTRY_PATH.read_text(encoding="utf-8"))
    stale_ids = {
        value.get("widgetId") for key, value in logical.get("widgets", {}).items()
        if key != "Schedule" and value.get("widgetId")
    }
    parsed = {}
    for path in widget_dir.glob("*.widget"):
        item = parse_widget(path)
        kind = item["kind"]
        if kind in parsed:
            raise AssertionError(f"duplicate current-environment Widget export: {kind}")
        assert_current_runtime_id(path.name, item["record"]["realWidgetId"], stale_ids)
        item["record"]["environment"] = environment
        parsed[kind] = item
    widgets = {}
    if base_registry_path is not None:
        if not base_registry_path.is_file():
            raise AssertionError("base runtime registry is missing")
        base_registry = json.loads(base_registry_path.read_text(encoding="utf-8"))
        if base_registry.get("environment") != environment:
            raise AssertionError("base runtime registry environment mismatch")
        if base_registry.get("bindingPolicy") != "FAIL_CLOSED_CURRENT_ENVIRONMENT_EXPORTS_ONLY":
            raise AssertionError("base runtime registry is not fail-closed current-environment evidence")
        for kind, record in base_registry.get("widgets", {}).items():
            if kind == "CampusOverview":
                continue
            assert_current_runtime_id(f"base-registry/{kind}", record.get("realWidgetId"), stale_ids)
            if kind != "Schedule" and record.get("sourceType") != "tencent-widget-export":
                raise AssertionError(f"base-registry/{kind}: not a real Tencent export")
            widgets[kind] = copy.deepcopy(record)
    if "Schedule" not in widgets:
        widgets["Schedule"] = schedule_record(workflows["01"], logical, environment)
    widgets.update({kind: parsed[kind]["record"] for kind in sorted(parsed)})
    missing = sorted(set(RUNTIME_KINDS) - set(widgets))
    extra = sorted(set(widgets) - set(RUNTIME_KINDS))
    if missing or extra:
        raise AssertionError(f"runtime Widget evidence set mismatch; missing={missing}; extra={extra}")
    if "CampusOverview" not in parsed:
        raise AssertionError("CampusOverview must come from the current real Tencent .widget export")
    ids = [record["realWidgetId"] for record in widgets.values()]
    if len(ids) != len(set(ids)):
        raise AssertionError("runtime Widget IDs must be unique")
    return {
        "schema": "fosuclass-widget-runtime-registry/v1",
        "logicalRegistry": "competition/adp-kit/widget/native/widget-registry.json",
        "environment": environment,
        "bindingPolicy": "FAIL_CLOSED_CURRENT_ENVIRONMENT_EXPORTS_ONLY",
        "widgets": widgets,
    }


ACTION_PROTOCOL_WRAPPER = r'''

# CampusFlow R4 compiler wrapper: preserve the natural query and append a
# deterministic Action Protocol V2 envelope to every sys.chat message.
_campusflow_runtime_main = main

def main(params: dict) -> dict:
    result = _campusflow_runtime_main(params)
    if not isinstance(result, dict):
        return result
    body = params.get("tool_body") if isinstance(params, dict) else {}
    body = body if isinstance(body, dict) else {}
    query_context = body.get("query") if isinstance(body.get("query"), dict) else {}
    resolved = body.get("resolvedEntity") if isinstance(body.get("resolvedEntity"), dict) else {}
    compared = body.get("compared") if isinstance(body.get("compared"), list) else []

    def infer(label, natural):
        value = f"{label} {natural}"
        if "风险" in value or "冲突" in value or "赶场" in value:
            return "schedule_risk_check"
        if "当天" in value:
            return "schedule_day"
        if "整周" in value:
            return "schedule_week"
        if "课表" in value:
            return "schedule_day"
        if "空教室" in value or "校区" in value or "时段" in value:
            return "classroom_find"
        if "日期" in value or "规划" in value or "计划" in value:
            return "day_plan_choose_date"
        if "选择" in value or "确认" in value:
            return "entity_choose"
        return "recovery_continue"

    def clean(value):
        return str(value if value is not None else "").replace("|", " ").replace("\n", " ").strip()

    entity = resolved
    if not entity and compared and isinstance(compared[0], dict):
        entity = compared[0]
    for key in list(result):
        if not key.endswith("Message") or not isinstance(result.get(key), str):
            continue
        natural = clean(result[key])
        if not natural or "【小序ActionV2】" in natural:
            continue
        label = clean(result.get(key[:-7] + "Label"))
        parts = [f"query={natural}", f"intent={infer(label, natural)}"]
        context = {
            "entityType": entity.get("type") or query_context.get("entityType"),
            "entityName": entity.get("name") or query_context.get("entityName"),
            "week": query_context.get("week"),
            "weekday": query_context.get("weekday"),
            "date": query_context.get("date"),
        }
        for context_key in ("entityType", "entityName", "week", "weekday", "date"):
            value = context.get(context_key)
            if value not in (None, "", 0):
                parts.append(f"{context_key}={clean(value)}")
        result[key] = natural + "\n【小序ActionV2】" + "|".join(parts)
    return result
'''


def node_widget_fields(node: dict) -> list[str]:
    return [param.get("ParamName") for param in (node.get("WidgetNodeData") or {}).get("WidgetParam", [])]


def bind_literal_widget_actions(node: dict) -> None:
    params = (node.get("WidgetNodeData") or {}).get("WidgetParam", [])
    by_name = {param.get("ParamName"): param for param in params}
    for name, param in by_name.items():
        if not str(name or "").endswith("Message"):
            continue
        input_value = param.get("Input") or {}
        if input_value.get("InputType") != "USER_INPUT":
            continue
        user_value = input_value.get("UserInputValue") or {}
        values = user_value.get("Values") or []
        if not values or not isinstance(values[0], str) or not values[0].strip():
            continue
        natural = values[0].replace("|", " ").replace("\n", " ").strip()
        if "【小序ActionV2】" in natural:
            continue
        label_name = name[:-7] + "Label"
        label_values = (((by_name.get(label_name) or {}).get("Input") or {}).get("UserInputValue") or {}).get("Values") or []
        label = str(label_values[0] if label_values else "")
        intent = "entity_choose" if "选择" in label or "确认" in label else "recovery_continue"
        values[0] = f"{natural}\n【小序ActionV2】query={natural}|intent={intent}"


def bind_workflow(key: str, source: Path, registry: dict, environment: str) -> dict:
    workflow, _ = workflow_from_zip(source)
    workflow["WorkflowID"] = str(uuid.uuid5(R4_NAMESPACE, f"{environment}:{key}:R3"))
    workflow["WorkflowName"] = WORKFLOW_NAMES[key]
    workflow["WorkflowDesc"] = (
        f"CampusFlow ADP R4 environment-bound {key}; current Tencent export base; "
        "RuntimeSafe primitive Widget boundary; Action Protocol V2."
    )
    workflow["ReleaseTime"] = ""
    runtime_by_fields = {
        tuple(sorted(record["fieldNames"])): record
        for record in registry["widgets"].values()
    }
    widget_count = 0
    for node in workflow.get("Nodes", []):
        if node.get("NodeType") == "WIDGET":
            widget_count += 1
            fields = tuple(sorted(node_widget_fields(node)))
            record = runtime_by_fields.get(fields)
            if not record:
                raise AssertionError(f"{key}/{node.get('NodeName')}: WidgetParam does not match runtime registry")
            data = node.setdefault("WidgetNodeData", {})
            data["WidgetID"] = record["realWidgetId"]
            if not data["WidgetID"]:
                raise AssertionError(f"{key}/{node.get('NodeName')}: empty WidgetID")
            for param in data.get("WidgetParam", []):
                if param.get("ParamType") not in {"STRING", "INT", "FLOAT", "BOOL"}:
                    raise AssertionError(f"{key}/{node.get('NodeName')}: non-primitive Widget field")
            if key in {"02", "03", "04"}:
                bind_literal_widget_actions(node)
        code_data = node.get("CodeExecutorNodeData") or {}
        code = code_data.get("Code")
        if key in {"02", "03", "04"} and isinstance(code, str) and "Message\"" in code and "_campusflow_runtime_main" not in code:
            code_data["Code"] = code.rstrip() + ACTION_PROTOCOL_WRAPPER
    if not widget_count:
        raise AssertionError(f"{key}: no WIDGET nodes")
    allowed_ids = {record["realWidgetId"] for record in registry["widgets"].values()}
    for node in workflow.get("Nodes", []):
        if node.get("NodeType") != "WIDGET":
            continue
        widget_id = (node.get("WidgetNodeData") or {}).get("WidgetID")
        if not widget_id or widget_id not in allowed_ids:
            raise AssertionError(f"{key}/{node.get('NodeName')}: WidgetID not in runtime registry")
    return workflow


def workbook_rows(source: Path, name: str) -> tuple[list, list[list]]:
    with zipfile.ZipFile(source) as reader:
        workbook = load_workbook(io.BytesIO(reader.read(name)), read_only=True, data_only=False)
    rows = list(workbook.active.iter_rows(values_only=True))
    if not rows:
        raise AssertionError(f"{source.name}/{name}: empty workbook")
    return list(rows[0]), [list(row) for row in rows[1:]]


def deterministic_xlsx(headers: list, rows: list[list]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Sheet1"
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    fixed = datetime.datetime(2026, 8, 14, 0, 0, 0)
    workbook.properties.creator = "FosuClass ADP R4 Binder"
    workbook.properties.lastModifiedBy = "FosuClass ADP R4 Binder"
    workbook.properties.created = fixed
    workbook.properties.modified = fixed
    with tempfile.TemporaryDirectory() as temp_dir:
        raw_path = Path(temp_dir) / "raw.xlsx"
        output_path = Path(temp_dir) / "deterministic.xlsx"
        workbook.save(raw_path)
        with zipfile.ZipFile(raw_path) as reader:
            entries = [(name, reader.read(name)) for name in sorted(reader.namelist())]
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as writer:
            for name, data in entries:
                if name == "docProps/core.xml":
                    data = re.sub(
                        rb"(<dcterms:modified\b[^>]*>)[^<]*(</dcterms:modified>)",
                        rb"\g<1>2026-08-14T00:00:00Z\g<2>",
                        data,
                    )
                info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                writer.writestr(info, data)
        return output_path.read_bytes()


def bound_workbooks(source: Path, workflow: dict, key: str) -> dict[str, bytes]:
    workflow_id = workflow["WorkflowID"]
    payloads = {}
    expected_headers = {
        "workflows.xlsx": ["WorkflowId", "WorkflowName", "WorkflowDescription", "CanvasStructure"],
        "parameters.xlsx": ["WorkflowId", "WorkflowNodeId", "WorkflowNodeName", "ParameterId", "ParameterName", "ParameterDescription", "ParameterType", "ParameterCorrectExample", "ParameterIncorrectExample", "ParameterParentId", "ParameterRequiredStatus"],
        "example_queries.xlsx": ["WorkflowId", "ExampleQueryContent"],
        "variables.xlsx": ["WorkflowId", "VariableId", "VariableName", "VariableDescription", "VariableType", "VariableDefaultValue", "VariableDefaultValueFileName", "ParameterType"],
        "workflow_references.xlsx": ["WorkflowId", "WorkflowNodeId", "ReferenceWorkflowId", "ReferenceWorkflowName"],
    }
    for name in ROOT_FILES:
        # Recent Tencent re-exports may collapse every workbook to the single
        # WorkflowId header.  The real import contract is the full header set
        # captured by the working 01 package, so never propagate that lossy
        # export representation into a generated import artifact.
        source_headers, source_rows = workbook_rows(source, name)
        headers = expected_headers[name]
        rows = source_rows if source_headers == headers else []
        if name == "workflows.xlsx":
            rows = [[workflow_id, workflow["WorkflowName"], workflow["WorkflowDesc"], f"{workflow_id}_workflow.json"]]
        elif name == "example_queries.xlsx":
            rows = [[workflow_id, example] for example in WORKFLOW_EXAMPLES[key]]
        elif name == "variables.xlsx" and key in {"01", "05"} and not rows:
            rows = [[
                workflow_id,
                "a39583c8-2484-46f2-8ba8-e7384a0365e8",
                "campus_api_authorization",
                "导入后绑定当前赛事空间环境变量；占位值不是凭据",
                "STRING",
                "Bearer ADP_IMPORT_PLACEHOLDER_NOT_A_CREDENTIAL",
                "",
                "1",
            ]]
        else:
            if rows:
                workflow_index = headers.index("WorkflowId")
                for row in rows:
                    row[workflow_index] = workflow_id
        payloads[name] = deterministic_xlsx(headers, rows)
    return payloads


def write_workflow_zip(path: Path, workflow: dict, workbooks: dict[str, bytes]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    workflow_name = f"{workflow['WorkflowID']}_workflow.json"
    payloads = {
        workflow_name: json.dumps(workflow, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        **workbooks,
    }
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as writer:
        for name in [workflow_name, *ROOT_FILES]:
            info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            writer.writestr(info, payloads[name])


HERO_VERIFY_CODE = r'''def main(params: dict) -> dict:
    body = params.get("tool_body") if isinstance(params, dict) else {}
    body = body if isinstance(body, dict) else {}
    evidence = body.get("evidence") if isinstance(body.get("evidence"), dict) else {}
    items = body.get("items") if isinstance(body.get("items"), list) else []
    overview = items[0] if items and isinstance(items[0], dict) else {}
    window = overview.get("window") if isinstance(overview.get("window"), dict) else {}
    preparation = window.get("preparationPeriod") if isinstance(window.get("preparationPeriod"), dict) else {}
    valid = (
        body.get("success") is True
        and body.get("dataVersion") == "competition-demo-v1"
        and evidence.get("verified") is True
        and evidence.get("dataHash") == "sha1:fefef4bf425b"
        and preparation.get("startDate") == "2026-08-25"
        and preparation.get("endDate") == "2026-08-30"
        and preparation.get("lessonCount") == 0
    )
    if valid:
        return {"Body": body}
    if body.get("success") is not True and isinstance(body.get("error"), dict):
        return {"Body": body}
    return {"Body": {
        "success": False,
        "queryId": str(body.get("queryId") or ""),
        "dataVersion": "competition-demo-v1",
        "error": {
            "code": "TOOL_FAILURE",
            "message": "校园教学态势未通过数据版本、证据或准备期零课程校验。",
        },
    }}
'''


def hero_node_id(environment: str, role: str) -> str:
    return str(uuid.uuid5(R4_NAMESPACE, f"{environment}:05:R1:{role}"))


def set_node_position(node: dict, x: int, y: int) -> None:
    try:
        ui = json.loads(node.get("NodeUI") or "{}")
    except json.JSONDecodeError:
        ui = {}
    ui["position"] = {"x": x, "y": y}
    ui["selected"] = False
    node["NodeUI"] = json.dumps(ui, ensure_ascii=False, separators=(",", ":"))


def replace_reference_node_id(value, old_id: str, new_id: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "NodeID" and child == old_id:
                value[key] = new_id
            else:
                replace_reference_node_id(child, old_id, new_id)
    elif isinstance(value, list):
        for child in value:
            replace_reference_node_id(child, old_id, new_id)


def primitive_output_property(name: str, value_type: str = "STRING") -> dict:
    return {
        "Title": name, "Type": value_type, "Required": [], "Properties": [],
        "Desc": "RuntimeSafe primitive field", "AnalysisMethod": "COVER",
    }


def hero_widget_param(name: str, source_id: str) -> dict:
    return {
        "ParamName": name,
        "ParamDesc": "CampusOverview RuntimeSafe primitive field",
        "ParamType": "STRING",
        "Input": {
            "InputType": "REFERENCE_OUTPUT",
            "Reference": {"NodeID": source_id, "JsonPath": f"Output.{name}"},
        },
        "IsRequired": True,
        "SubParams": [],
        "IsSecretField": False,
        "ParamTypeOf": [],
    }


def graph_edge(source: str, target: str, handle: str | None = None) -> dict:
    source_handle = handle or f"{source}-source"
    target_handle = f"{target}-target"
    return {
        "source": source, "target": target, "sourceHandle": source_handle,
        "targetHandle": target_handle, "type": "custom",
        "data": {"connectedNodeIsHovering": False, "error": False, "isHovering": False},
        "id": f"xy-edge__{source}{source_handle}-{target}{target_handle}",
        "selected": False, "animated": False,
    }


def build_hero_workflow(source: Path, registry: dict, environment: str) -> dict:
    """Build 05 from the already-importable 04 R3 node shapes, not a guessed ZIP."""
    base = bind_workflow("04", source, registry, environment)
    nodes = base["Nodes"]
    by_name = {node.get("NodeName"): node for node in nodes}
    start = copy.deepcopy(next(node for node in nodes if node.get("NodeType") == "START"))
    end = copy.deepcopy(next(node for node in nodes if node.get("NodeType") == "END"))
    tool = copy.deepcopy(by_name["今日计划"])
    verify = copy.deepcopy(by_name["今日计划核验与呈现"])
    adapter = copy.deepcopy(by_name["DayPlan Adapter"])
    recovery = copy.deepcopy(by_name["Recovery RuntimeSafe Adapter"])
    router = copy.deepcopy(by_name["Native Widget Route"])
    dayplan_widget = next(
        node for node in nodes
        if node.get("NodeType") == "WIDGET"
        and (node.get("WidgetNodeData") or {}).get("WidgetID") == registry["widgets"]["DayPlan"]["realWidgetId"]
    )
    error_widget = copy.deepcopy(next(
        node for node in nodes
        if node.get("NodeType") == "WIDGET"
        and (node.get("WidgetNodeData") or {}).get("WidgetID") == registry["widgets"]["Error"]["realWidgetId"]
    ))
    hero_widget = copy.deepcopy(dayplan_widget)

    ids = {role: hero_node_id(environment, role) for role in (
        "start", "tool", "verify", "adapter", "recovery", "router", "widget", "error", "end",
    )}
    start.update({
        "NodeID": ids["start"], "NodeName": "开始",
        "NodeDesc": "校园教学态势固定窗口；所有指标由确定性 Tool 派生。",
        "Inputs": [], "Outputs": [], "NextNodeIDs": [ids["tool"]],
    })
    start.setdefault("StartNodeData", {})["WorkflowParams"] = []
    set_node_position(start, 80, 300)

    old_tool_id = tool["NodeID"]
    tool.update({
        "NodeID": ids["tool"], "NodeName": "校园教学态势分析",
        "NodeDesc": "调用 get_campus_teaching_overview；模型不参与统计。",
        "NextNodeIDs": [ids["verify"]],
    })
    tool_data = tool["ToolNodeData"]
    tool_data["API"]["URL"] = re.sub(r"/api/[^/]+$", "/api/get_campus_teaching_overview", tool_data["API"]["URL"])
    tool_data["Body"] = [
        {
            "ParamName": name, "ParamDesc": description, "ParamType": "STRING",
            "Input": {"InputType": "USER_INPUT", "UserInputValue": {"Values": [value], "FileNames": []}},
            "IsRequired": True, "SubParams": [], "IsSecretField": False, "ParamTypeOf": [],
        }
        for name, value, description in (
            ("windowStart", "2026-08-25", "Hero R1 固定窗口开始"),
            ("teachingStart", "2026-08-31", "第1教学周开始"),
            ("windowEnd", "2026-09-27", "Hero R1 固定窗口结束"),
        )
    ]
    set_node_position(tool, 380, 300)

    verify.update({
        "NodeID": ids["verify"], "NodeName": "CampusOverview Result Guard",
        "NodeDesc": "校验 success、dataVersion、dataHash、verified 与准备期零课程。",
        "Inputs": [{
            "Name": "tool_body", "Type": "OBJECT",
            "Input": {"InputType": "REFERENCE_OUTPUT", "Reference": {"NodeID": ids["tool"], "JsonPath": "Output.Body"}},
            "Desc": "CampusTools output", "IsRequired": False, "SubInputs": [],
            "DefaultValue": "", "DefaultFileName": "",
        }],
        "Outputs": [{
            "Title": "Output", "Type": "OBJECT", "Required": [],
            "Properties": [{
                "Title": "Body", "Type": "OBJECT", "Required": [], "Properties": [],
                "Desc": "verified or fail-closed Tool envelope", "AnalysisMethod": "COVER",
            }],
            "Desc": "contract guard", "AnalysisMethod": "COVER",
        }],
        "NextNodeIDs": [ids["adapter"]],
    })
    verify["CodeExecutorNodeData"]["Code"] = HERO_VERIFY_CODE
    verify["CodeExecutorNodeData"]["Language"] = "PYTHON3"
    set_node_position(verify, 680, 300)

    contract = json.loads((HERO_ROOT / "contract.json").read_text(encoding="utf-8"))
    adapter.update({
        "NodeID": ids["adapter"], "NodeName": "CampusOverview Adapter",
        "NodeDesc": "将已核验 Tool facts 映射为 53 个 primitive Widget 字段。",
        "Inputs": [{
            "Name": "tool_body", "Type": "OBJECT",
            "Input": {"InputType": "REFERENCE_OUTPUT", "Reference": {"NodeID": ids["verify"], "JsonPath": "Output.Body"}},
            "Desc": "verified CampusOverview envelope", "IsRequired": False, "SubInputs": [],
            "DefaultValue": "", "DefaultFileName": "",
        }],
        "Outputs": [{
            "Title": "Output", "Type": "OBJECT", "Required": [],
            "Properties": [primitive_output_property(field) for field in contract["fields"]],
            "Desc": "CampusOverview native Widget view model", "AnalysisMethod": "COVER",
        }],
        "NextNodeIDs": [ids["recovery"]],
    })
    adapter["CodeExecutorNodeData"]["Code"] = (HERO_ROOT / "adapter.py").read_text(encoding="utf-8")
    adapter["CodeExecutorNodeData"]["Language"] = "PYTHON3"
    set_node_position(adapter, 980, 240)

    old_recovery_id = recovery["NodeID"]
    recovery.update({
        "NodeID": ids["recovery"], "NodeName": "CampusOverview Recovery Adapter",
        "NodeDesc": "成功进入 Hero；任何未核验输出进入 Error Widget。",
        "NextNodeIDs": [ids["router"]],
    })
    replace_reference_node_id(recovery, old_tool_id, ids["verify"])
    recovery["Inputs"] = [{
        "Name": "tool_body", "Type": "OBJECT",
        "Input": {"InputType": "REFERENCE_OUTPUT", "Reference": {"NodeID": ids["verify"], "JsonPath": "Output.Body"}},
        "Desc": "guarded CampusOverview envelope", "IsRequired": False, "SubInputs": [],
        "DefaultValue": "", "DefaultFileName": "",
    }]
    set_node_position(recovery, 1280, 360)

    hero_widget.update({
        "NodeID": ids["widget"], "NodeName": "小序-校园教学态势-RuntimeSafe-V1",
        "NodeDesc": "真实腾讯赛事空间 CampusOverview Widget；primitive-only。",
        "WidgetNodeData": {
            "WidgetID": registry["widgets"]["CampusOverview"]["realWidgetId"],
            "ActionType": "WIDGET_ACTION_NONE",
            "WidgetParam": [hero_widget_param(field, ids["adapter"]) for field in contract["fields"]],
        },
        "Inputs": [], "Outputs": [], "NextNodeIDs": [ids["end"]],
    })
    set_node_position(hero_widget, 1880, 220)

    error_widget.update({
        "NodeID": ids["error"], "NodeName": "小序-任务恢复-RuntimeSafe-V3",
        "NodeDesc": "CampusOverview fail-closed Error Widget。",
        "NextNodeIDs": [ids["end"]],
    })
    replace_reference_node_id(error_widget, old_recovery_id, ids["recovery"])
    set_node_position(error_widget, 1880, 500)

    primary_handle = hero_node_id(environment, "route-primary")
    error_handle = hero_node_id(environment, "route-error")
    fallback_handle = hero_node_id(environment, "route-fallback")
    router.update({
        "NodeID": ids["router"], "NodeName": "CampusOverview Success/Error Route",
        "NodeDesc": "仅允许 primary 或 error；未知 route fail closed 到 Error。",
        "NextNodeIDs": [],
    })
    router["LogicEvaluatorNodeData"]["Group"] = [
        {
            "NextNodeIDs": [ids["widget"]],
            "Logical": {
                "LogicalOperator": "UNSPECIFIED", "Compound": [],
                "Comparison": {
                    "Left": {"InputType": "REFERENCE_OUTPUT", "Reference": {"NodeID": ids["recovery"], "JsonPath": "Output.route"}},
                    "LeftType": "STRING", "Operator": "EQ",
                    "Right": {"InputType": "USER_INPUT", "UserInputValue": {"Values": ["primary"], "FileNames": []}},
                    "MatchType": "SEMANTIC",
                },
            },
        },
        {
            "NextNodeIDs": [ids["error"]],
            "Logical": {
                "LogicalOperator": "UNSPECIFIED", "Compound": [],
                "Comparison": {
                    "Left": {"InputType": "REFERENCE_OUTPUT", "Reference": {"NodeID": ids["recovery"], "JsonPath": "Output.route"}},
                    "LeftType": "STRING", "Operator": "EQ",
                    "Right": {"InputType": "USER_INPUT", "UserInputValue": {"Values": ["error"], "FileNames": []}},
                    "MatchType": "SEMANTIC",
                },
            },
        },
        {"NextNodeIDs": [ids["error"]]},
    ]
    try:
        router_ui = json.loads(router.get("NodeUI") or "{}")
    except json.JSONDecodeError:
        router_ui = {}
    router_ui.setdefault("data", {})["content"] = [
        {"content": [{"leftStr": "Output.route", "rightStr": "primary", "operatorStr": "="}], "index": 0, "id": primary_handle},
        {"content": [{"leftStr": "Output.route", "rightStr": "error", "operatorStr": "="}], "index": 1, "id": error_handle},
        {"content": [], "index": 2, "id": fallback_handle},
    ]
    router["NodeUI"] = json.dumps(router_ui, ensure_ascii=False, separators=(",", ":"))
    set_node_position(router, 1580, 360)

    end.update({
        "NodeID": ids["end"], "NodeName": "结束",
        "NodeDesc": "结束校园教学态势展示或恢复分支。",
        "Inputs": [], "Outputs": [], "NextNodeIDs": [],
    })
    set_node_position(end, 2180, 360)

    workflow = copy.deepcopy(base)
    workflow.update({
        "WorkflowID": str(uuid.uuid5(R4_NAMESPACE, f"{environment}:05:R1")),
        "WorkflowName": WORKFLOW_NAMES["05"],
        "WorkflowDesc": (
            "CampusFlow ADP R5 campus teaching overview: deterministic Tool → contract guard → "
            "primitive Adapter → real Tencent CampusOverview/Error Widget."
        ),
        "ReleaseTime": "",
        "Nodes": [start, tool, verify, adapter, recovery, router, hero_widget, error_widget, end],
    })
    edges = [
        graph_edge(ids["start"], ids["tool"]),
        graph_edge(ids["tool"], ids["verify"]),
        graph_edge(ids["verify"], ids["adapter"]),
        graph_edge(ids["adapter"], ids["recovery"]),
        graph_edge(ids["recovery"], ids["router"]),
        graph_edge(ids["router"], ids["widget"], f"{ids['router']}.{primary_handle}-source"),
        graph_edge(ids["router"], ids["error"], f"{ids['router']}.{error_handle}-source"),
        graph_edge(ids["widget"], ids["end"]),
        graph_edge(ids["error"], ids["end"]),
    ]
    workflow["Edge"] = json.dumps(edges, ensure_ascii=False, separators=(",", ":"))
    allowed = {registry["widgets"]["CampusOverview"]["realWidgetId"], registry["widgets"]["Error"]["realWidgetId"]}
    for node in workflow["Nodes"]:
        if node.get("NodeType") == "WIDGET":
            widget_id = (node.get("WidgetNodeData") or {}).get("WidgetID")
            if widget_id not in allowed:
                raise AssertionError("05 contains an unbound or wrong-environment WidgetID")
            if any(param.get("ParamType") not in {"STRING", "INT", "FLOAT", "BOOL"} for param in node["WidgetNodeData"]["WidgetParam"]):
                raise AssertionError("05 main path must remain primitive-only")
    return workflow


def validate_frozen_bound_workflow(key: str, source: Path, registry: dict) -> dict:
    workflow, _ = workflow_from_zip(source)
    if workflow.get("WorkflowName") != WORKFLOW_NAMES[key]:
        raise AssertionError(f"{key}: frozen workflow name mismatch")
    runtime_by_fields = {
        tuple(sorted(record["fieldNames"])): record
        for record in registry["widgets"].values()
    }
    widgets = [node for node in workflow.get("Nodes", []) if node.get("NodeType") == "WIDGET"]
    if not widgets:
        raise AssertionError(f"{key}: frozen workflow contains no Widget")
    for node in widgets:
        data = node.get("WidgetNodeData") or {}
        fields = tuple(sorted(node_widget_fields(node)))
        record = runtime_by_fields.get(fields)
        if not record or data.get("WidgetID") != record["realWidgetId"]:
            raise AssertionError(f"{key}/{node.get('NodeName')}: frozen environment binding drift")
        if any(param.get("ParamType") not in {"STRING", "INT", "FLOAT", "BOOL"} for param in data.get("WidgetParam", [])):
            raise AssertionError(f"{key}/{node.get('NodeName')}: frozen primitive boundary drift")
    if key in {"02", "03", "04"}:
        wrapped = [
            node for node in workflow.get("Nodes", [])
            if "_campusflow_runtime_main" in (node.get("CodeExecutorNodeData") or {}).get("Code", "")
        ]
        if len(wrapped) < 2:
            raise AssertionError(f"{key}: Action Protocol V2 wrapper missing")
    expected_headers = {
        "workflows.xlsx": ["WorkflowId", "WorkflowName", "WorkflowDescription", "CanvasStructure"],
        "parameters.xlsx": ["WorkflowId", "WorkflowNodeId", "WorkflowNodeName", "ParameterId", "ParameterName", "ParameterDescription", "ParameterType", "ParameterCorrectExample", "ParameterIncorrectExample", "ParameterParentId", "ParameterRequiredStatus"],
        "example_queries.xlsx": ["WorkflowId", "ExampleQueryContent"],
        "variables.xlsx": ["WorkflowId", "VariableId", "VariableName", "VariableDescription", "VariableType", "VariableDefaultValue", "VariableDefaultValueFileName", "ParameterType"],
        "workflow_references.xlsx": ["WorkflowId", "WorkflowNodeId", "ReferenceWorkflowId", "ReferenceWorkflowName"],
    }
    for workbook_name, headers in expected_headers.items():
        actual, _ = workbook_rows(source, workbook_name)
        if actual != headers:
            raise AssertionError(f"{key}/{workbook_name}: frozen XLSX header drift")
    return workflow


def bind_environment(
    widget_dir: Path,
    workflow_dir: Path,
    environment: str,
    output_dir: Path,
    base_registry_path: Path | None = None,
) -> dict:
    if not widget_dir.is_dir() or not workflow_dir.is_dir():
        raise AssertionError("widget-dir and workflow-dir must exist")
    workflows = discover_workflows(workflow_dir)
    registry = build_runtime_registry(widget_dir, workflows, environment, base_registry_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    registry_path = output_dir / "widget-registry.runtime.json"
    registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    artifacts = []
    for key in BASE_WORKFLOW_SLOTS:
        source_workflow, _ = workflow_from_zip(workflows[key])
        target = output_dir / WORKFLOW_FILES[key]
        if source_workflow.get("WorkflowName") == WORKFLOW_NAMES[key]:
            workflow = validate_frozen_bound_workflow(key, workflows[key], registry)
            target.write_bytes(workflows[key].read_bytes())
        else:
            workflow = bind_workflow(key, workflows[key], registry, environment)
            write_workflow_zip(target, workflow, bound_workbooks(workflows[key], workflow, key))
        artifacts.append({
            "slot": key,
            "file": target.name,
            "workflowId": workflow["WorkflowID"],
            "workflowName": workflow["WorkflowName"],
            "sourceFile": workflows[key].name,
            "sourceSha256": sha256_file(workflows[key]),
            "sha256": sha256_file(target),
        })
    hero = build_hero_workflow(workflows["04"], registry, environment)
    hero_target = output_dir / WORKFLOW_FILES["05"]
    write_workflow_zip(hero_target, hero, bound_workbooks(workflows["04"], hero, "05"))
    artifacts.append({
        "slot": "05",
        "file": hero_target.name,
        "workflowId": hero["WorkflowID"],
        "workflowName": hero["WorkflowName"],
        "sourceFile": workflows["04"].name,
        "sourceSha256": sha256_file(workflows["04"]),
        "sha256": sha256_file(hero_target),
    })
    hero_source = widget_dir / registry["widgets"]["CampusOverview"]["sourceFile"]
    evidence_path = output_dir / "05-Tencent-Widget-Evidence.widget"
    evidence_path.write_bytes(hero_source.read_bytes())
    if sha256_file(evidence_path) != EXPECTED_HERO_EXPORT_SHA256:
        raise AssertionError("copied 05 Tencent Widget evidence hash drift")
    return {
        "registry": registry, "registryPath": registry_path,
        "artifacts": artifacts, "heroEvidencePath": evidence_path,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--widget-dir", required=True)
    parser.add_argument("--workflow-dir", required=True)
    parser.add_argument("--env", required=True)
    parser.add_argument("--output-dir", default=str(DEFAULT_R5_OUTPUT))
    parser.add_argument(
        "--base-runtime-registry",
        default=str(DEFAULT_OUTPUT / "widget-registry.runtime.json"),
        help="previous current-environment runtime evidence for frozen 01-04 resources",
    )
    args = parser.parse_args()
    result = bind_environment(
        Path(args.widget_dir).resolve(),
        Path(args.workflow_dir).resolve(),
        args.env,
        Path(args.output_dir).resolve(),
        Path(args.base_runtime_registry).resolve() if args.base_runtime_registry else None,
    )
    print(f"ADP runtime binding: PASS ({args.env})")
    for item in result["artifacts"]:
        print(f"{item['slot']}: {item['workflowName']} -> {item['file']} [{item['sha256']}]")


if __name__ == "__main__":
    main()
