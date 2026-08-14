"""Build CampusFlow ADP R4 Hero/evaluation/runtime closure artifacts."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import zipfile
from pathlib import Path

from bind_runtime_environment import (
    DEFAULT_OUTPUT,
    FIXED_ZIP_TIME,
    WORKFLOW_FILES,
    deterministic_xlsx,
    sha256_file,
    workflow_from_zip,
)


ROOT = Path(__file__).resolve().parent
KIT = ROOT.parents[1]
REPO = ROOT.parents[3]
HERO_ROOT = ROOT / "campus-overview-v1"
EVALUATION_PATH = KIT / "evaluation" / "evaluation-dataset.json"
GOLDEN_PATH = KIT / "evaluation" / "golden-results.json"
DATASET_PATH = KIT / "mock-data" / "competition-demo-v1.json"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def hero_json_schema(fields: list[str]) -> dict:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {field: {"type": "string"} for field in fields},
        "required": fields,
        "additionalProperties": False,
    }


def hero_zod(fields: list[str]) -> str:
    lines = ["import { z } from 'zod';", "", "const widgetSchema = z", "  .object({"]
    lines.extend(f"    {field}: z.string()," for field in fields)
    lines.extend(["  })", "  .strict();", "", "export default widgetSchema;", ""])
    return "\n".join(lines)


def hero_preview(defaults: dict) -> dict:
    badge = lambda label, color="info": {
        "type": "Badge", "label": label, "color": color, "variant": "soft", "size": "sm",
    }
    text = lambda value, weight=None: {
        "type": "Text", "value": value, "size": "sm", **({"weight": weight} if weight else {}),
    }
    matrix = []
    for week in range(1, 5):
        matrix.append({
            "type": "Row", "gap": 1,
            "children": [badge(f"W{week}"), *[
                text(defaults[f"w{week}{day}Text"])
                for day in ("Mon", "Tue", "Wed", "Thu", "Fri")
            ]],
        })
    actions = []
    for index in range(4):
        actions.append({
            "type": "Button",
            "label": defaults[f"action{index}Label"],
            "size": "sm",
            "variant": "solid" if index == 0 else "outline",
            "onClickAction": {"type": "sys.chat", "payload": {"query": defaults[f"action{index}Message"]}},
        })
    return {
        "type": "Card", "size": "md", "background": "#F6F2E8", "status": defaults["verifiedText"],
        "children": [{
            "type": "Col", "gap": 3, "children": [
                {"type": "Caption", "value": "CAMPUS FLOW / TEACHING OVERVIEW", "color": "#173F35"},
                {"type": "Title", "value": defaults["title"], "size": "md"},
                {"type": "Caption", "value": defaults["windowText"], "color": "secondary"},
                {"type": "Caption", "value": defaults["phaseText"], "color": "secondary"},
                {"type": "Row", "gap": 1, "wrap": "wrap", "children": [
                    badge(defaults["weekCountText"]), badge(defaults["lessonCountText"]),
                    badge(defaults["teacherCountText"], "secondary"), badge(defaults["roomCountText"], "secondary"),
                ]},
                {"type": "Divider"},
                {"type": "Caption", "value": "四周教学负载（课程次数）", "color": "#173F35"},
                *matrix,
                {"type": "Caption", "value": defaults["peakSlotText"], "color": "secondary"},
                {"type": "Divider"},
                text(defaults["campusALoadText"], "semibold"),
                {"type": "Caption", "value": defaults["campusAFreeText"], "color": "secondary"},
                text(defaults["campusBLoadText"], "semibold"),
                {"type": "Caption", "value": defaults["campusBFreeText"], "color": "secondary"},
                {"type": "Divider"},
                {"type": "Row", "gap": 1, "wrap": "wrap", "children": [
                    badge(defaults["conflictCountText"], "success"),
                    badge(defaults["rushCountText"], "warning"),
                    badge(defaults["continuousLoadText"], "warning"),
                ]},
                {"type": "Caption", "value": defaults["riskSummaryText"], "color": "secondary"},
                {"type": "Row", "gap": 2, "wrap": "wrap", "children": actions},
                {"type": "Caption", "value": defaults["footerText"], "color": "secondary"},
            ],
        }],
    }


def build_hero_widget(output_dir: Path) -> tuple[Path, dict]:
    contract = read_json(HERO_ROOT / "contract.json")
    defaults = read_json(HERO_ROOT / "default.json")
    template = (HERO_ROOT / "template.txt").read_text(encoding="utf-8")
    fields = contract["fields"]
    if list(defaults) != fields:
        raise AssertionError("Hero DefaultState field order must equal the contract")
    schema = hero_json_schema(fields)
    inner = {
        "name": contract["name"],
        "id": "",
        "view": template,
        "defaultState": defaults,
        "states": [],
        "schema": hero_zod(fields),
        "schemaValidity": "valid",
        "viewValidity": "valid",
        "defaultStateValidity": "valid",
    }
    wrapper = {
        "version": "1.0",
        "name": contract["name"],
        "template": "",
        "jsonSchema": schema,
        "outputJsonPreview": hero_preview(defaults),
        "encodedWidget": base64.b64encode(
            json.dumps(inner, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).decode("ascii"),
    }
    widget_path = output_dir / "05-校园教学态势-R1-Pilot.widget"
    widget_path.write_text(json.dumps(wrapper, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    output_contract = {
        **contract,
        "realWidgetId": None,
        "bindingStatus": "PILOT_EXPORT_REQUIRED",
        "templateSha256": sha256_bytes(template.encode("utf-8")),
        "schemaSha256": sha256_bytes(json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")),
        "defaultSha256": sha256_bytes(json.dumps(defaults, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")),
        "pilotExportSha256": sha256_file(widget_path),
    }
    contract_path = output_dir / "05-Campus-Overview-Contract.json"
    contract_path.write_text(json.dumps(output_contract, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return widget_path, output_contract


def workflow_metadata(output_dir: Path) -> list[dict]:
    result = []
    for key, file_name in WORKFLOW_FILES.items():
        path = output_dir / file_name
        if not path.is_file():
            raise AssertionError(f"bound workflow missing: {file_name}")
        workflow, _ = workflow_from_zip(path)
        result.append({
            "slot": key,
            "workflowId": workflow["WorkflowID"],
            "name": workflow["WorkflowName"],
            "artifact": file_name,
            "sha256": sha256_file(path),
        })
    return result


def write_expected_config(output_dir: Path, registry: dict, workflows: list[dict], hero_contract: dict) -> Path:
    dataset = read_json(DATASET_PATH)
    config = {
        "schema": "fosuclass-adp-r4-app-expected-config/v1",
        "appName": "校园智序 · 小序",
        "productPositioning": "校园教学时空决策智能体",
        "environment": registry["environment"],
        "dataVersion": dataset["meta"]["dataVersion"],
        "dataHash": dataset["dataHash"],
        "activeWorkflows": workflows,
        "pendingWorkflows": [{
            "slot": "05", "name": "05-校园教学态势-R1", "status": "WAITING_REAL_WIDGET_EXPORT",
            "widget": hero_contract["name"], "realWidgetId": None,
        }],
        "widgets": registry["widgets"],
        "routerExamples": {
            "01": ["教师003的课", "A1-101第1周周三的占用"],
            "02": ["校区A第1周周一有哪些空教室", "哪个校区下午空教室更多"],
            "03": ["教师003跨校区赶不赶得上", "比较2025级A班和2025级B班第1周周五的冲突"],
            "04": ["帮我安排9月4日的一天"],
            "05": ["未来四周校园教学情况怎么样", "最近哪一天最忙", "哪个校区下午教室最紧张"],
        },
        "intentRouting": {
            "schedule_day": "01", "schedule_week": "01", "schedule_choose_day": "Choice",
            "classroom_find": "02", "schedule_risk_check": "03", "day_plan": "04",
            "campus_overview": "05",
        },
        "excludedFromRouting": ["历史 01/02/03/04 baseline", "00-节点格式种子-勿启用"],
    }
    path = output_dir / "ADP-R4-APP-EXPECTED-CONFIG.json"
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return path


def hero_cases() -> list[dict]:
    return [
        {"id": "r4-hero-001", "category": "Hero overview routing", "input": "从8月25日开始看看未来几周校园教学运行情况", "workflow": "05-校园教学态势-R1", "tool": "get_campus_teaching_overview", "widget": "CampusOverview", "verified": True, "action": "campus_overview", "reference": "preparation-period + W1-W4 deterministic overview"},
        {"id": "r4-hero-002", "category": "Preparation period", "input": "8月25日至30日有教学安排吗", "workflow": "05-校园教学态势-R1", "tool": "get_campus_teaching_overview", "widget": "CampusOverview", "verified": True, "action": "campus_overview", "reference": "lessonCount=0; preparation-period"},
        {"id": "r4-hero-003", "category": "Four-week metrics", "input": "未来四周每天教学负载如何", "workflow": "05-校园教学态势-R1", "tool": "get_campus_teaching_overview", "widget": "CampusOverview", "verified": True, "action": "campus_overview", "reference": "4x5 matrix; 126 occurrences"},
        {"id": "r4-hero-004", "category": "Resource pressure", "input": "哪个校区下午教室最紧张", "workflow": "05-校园教学态势-R1", "tool": "get_campus_teaching_overview", "widget": "CampusOverview", "verified": True, "action": "classroom_find", "reference": "campusResources from room-period units"},
        {"id": "r4-hero-005", "category": "Teacher load", "input": "最近四周哪位教师教学负载最高", "workflow": "05-校园教学态势-R1", "tool": "get_campus_teaching_overview", "widget": "CampusOverview", "verified": True, "action": "schedule_week", "reference": "教师002; 24 occurrences"},
        {"id": "r4-hero-006", "category": "05 to 01", "input": "点击查看第1周", "workflow": "01-多维课表查询-R3", "tool": "query_schedule", "widget": "Schedule", "verified": True, "action": "schedule_week", "reference": "Action Protocol V2 routes 01"},
        {"id": "r4-hero-007", "category": "05 to 02", "input": "点击查空教室", "workflow": "02-空教室规划-R3", "tool": "find_available_classrooms", "widget": "Classroom", "verified": True, "action": "classroom_find", "reference": "Action Protocol V2 routes 02"},
        {"id": "r4-hero-008", "category": "05 to 03", "input": "点击检查风险", "workflow": "03-课程冲突比较-R3", "tool": "compare_schedules", "widget": "Conflict", "verified": True, "action": "schedule_risk_check", "reference": "Action Protocol V2 routes 03"},
        {"id": "r4-hero-009", "category": "03 to 01", "input": "点击查看当天课表", "workflow": "01-多维课表查询-R3", "tool": "query_schedule", "widget": "Schedule", "verified": True, "action": "schedule_day", "reference": "teacher/week/weekday context preserved"},
        {"id": "r4-hero-010", "category": "Multi-turn context", "input": "检查风险后查看当天课表再安排连续自习", "workflow": "04-今日校园计划-R3", "tool": "generate_day_plan", "widget": "DayPlan", "verified": True, "action": "day_plan", "reference": "date/week/entity context survives explicit handoff"},
        {"id": "r4-hero-011", "category": "Recovery", "input": "输入歧义实体后选择候选", "workflow": "Choice", "tool": "resolve_entity", "widget": "Choice", "verified": False, "action": "entity_choose", "reference": "Choice recovery then original workflow"},
        {"id": "r4-hero-012", "category": "Runtime binding", "input": "导入 R3 Bound workflow", "workflow": "01/02/03/04 R3", "tool": "binding gate", "widget": "RuntimeRegistry", "verified": True, "action": "runtime_binding", "reference": "non-empty current-environment WidgetID + exact primitive fields"},
    ]


def expected_widget(item: dict) -> str:
    workflow = str(item.get("expected", {}).get("workflow") or "")
    if workflow.startswith("01-"):
        return "Schedule"
    if workflow.startswith("02-"):
        return "Classroom"
    if workflow.startswith("03-"):
        return "Conflict"
    if workflow.startswith("04-"):
        return "DayPlan"
    category = str(item.get("category") or "")
    if "歧义" in category:
        return "Choice"
    if "失败" in category or "缺参" in category:
        return "Error"
    return "Text"


def versioned_workflow(name: str) -> str:
    for key, versioned in {
        "01-": "01-多维课表查询-R3", "02-": "02-空教室规划-R3",
        "03-": "03-课程冲突比较-R3", "04-": "04-今日校园计划-R3",
    }.items():
        if name.startswith(key):
            return versioned
    return name


def build_evaluation(output_dir: Path) -> tuple[Path, int]:
    evaluation = read_json(EVALUATION_PATH)
    if evaluation.get("count") != 80 or len(evaluation.get("items", [])) != 80:
        raise AssertionError("existing evaluation must remain exactly 80 cases")
    headers = [
        "CaseID", "Category", "UserInput", "ContextTurns", "ReferenceOutput",
        "ExpectedWorkflow", "ExpectedTool", "ExpectedWidgetKind", "ExpectedVerified",
        "ExpectedActionIntent", "ScoringMethod", "SecurityExpected",
    ]
    rows = []
    for item in evaluation["items"]:
        turns = item.get("turns") or []
        expected = item.get("expected") or {}
        user_inputs = [str(turn.get("content") or "") for turn in turns if turn.get("role") == "user"]
        rows.append([
            item["id"], item.get("category"), user_inputs[-1] if user_inputs else "",
            json.dumps(turns[:-1], ensure_ascii=False, separators=(",", ":")),
            json.dumps(expected, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            versioned_workflow(str(expected.get("workflow") or "")), expected.get("tool") or "",
            expected_widget(item), bool(expected.get("noFabrication", True)),
            expected.get("intent") or "", "rule/code", "anonymousOnly + noFabrication",
        ])
    for item in hero_cases():
        rows.append([
            item["id"], item["category"], item["input"], "[]", item["reference"],
            item["workflow"], item["tool"], item["widget"], item["verified"], item["action"],
            "rule/code", "anonymousOnly + noFabrication + verified gate",
        ])
    path = output_dir / "ADP-R4-EVALUATION.xlsx"
    path.write_bytes(deterministic_xlsx(headers, rows))
    return path, len(rows)


def write_docs(output_dir: Path, registry: dict) -> list[Path]:
    widgets = registry["widgets"]
    checklist = f"""# ADP R4 Runtime E2E Checklist

本清单区分本地合同 PASS 与腾讯 ADP Runtime PASS；未在腾讯当前赛事空间执行前不得标记 Runtime PASS。

| 场景 | 必定可复现输入 | 预期 Workflow | Tool | Widget / ID | 必须出现 | 禁止出现 |
|---|---|---|---|---|---|---|
| Schedule | 教师003第1周周一的课 | 01-多维课表查询-R3 | query_schedule | Schedule `{widgets['Schedule']['realWidgetId']}` | 2门课、已核验、competition-demo-v1 | 文本冒充 Widget、weekday=0 |
| Classroom | 校区A第1周周一第5-6节有哪些空教室 | 02-空教室规划-R3 | find_available_classrooms | Classroom `{widgets['Classroom']['realWidgetId']}` | 筛选条件、空教室、已核验 | 空 WidgetID、OBJECT WidgetParam |
| Conflict | 教师003第1周周一跨校区赶不赶得上 | 03-课程冲突比较-R3 | compare_schedules self-compare | Conflict `{widgets['Conflict']['realWidgetId']}` | 时间冲突0、赶场1 | 要求第二对象、教师003 vs 教师003 |
| DayPlan | 帮我安排2026-09-04的一天 | 04-今日校园计划-R3 | generate_day_plan | DayPlan `{widgets['DayPlan']['realWidgetId']}` | 课程、空档、自习建议 | 模型补造计划 |
| Choice | 查询教师（稳定歧义候选 fixture） | 原任务 Recovery | resolve_entity | Choice `{widgets['Choice']['realWidgetId']}` | 候选项、继续原任务 | 直接猜实体 |
| Error | 帮我查空教室（缺日期/节次） | 02 Recovery | pre-tool MISSING_PARAM | Error `{widgets['Error']['realWidgetId']}` | 中文恢复说明、修改条件 | 必填 queryId、系统长错误 |
| Hero Pilot | 从8月25日开始看看未来几周校园教学运行情况 | 05-校园教学态势-R1 | get_campus_teaching_overview | CampusOverview `PENDING_REAL_EXPORT` | 准备期0课、4×5矩阵、verified | 08-25～08-30造课、伪造ID |

## Action 回流

1. Hero「查看第1周」→ `intent=schedule_week` → 01。
2. Hero「查空教室」→ `intent=classroom_find` → 02。
3. Hero「检查风险」→ `intent=schedule_risk_check` → 03。
4. Conflict「查看当天课表」→ `intent=schedule_day` → 01；必须保留教师、周、星期/日期。
5. 每条 sys.chat 文本同时保留完整自然 query 与 `【小序ActionV2】query=...|intent=...`。
"""
    hero_script = """# ADP Hero Demo Script

1. 用户：`从8月25日开始看看未来几周校园教学运行情况`
   - 路由 05；CampusTools 返回准备期 0 课、W1-W4 负载、空间资源、教师负载与风险。
2. 点击：`查空教室`
   - `intent=classroom_find`，进入 02；继承第1周上下文，再补充日/节次时仅追问缺失项。
3. 点击：`检查风险`
   - `intent=schedule_risk_check`，只进入 03；教师003 self-compare，不要求第二对象。
4. 点击：`查看当天课表`
   - `intent=schedule_day`，进入 01；保留教师003、第1周、周一。
5. 用户：`帮我把当天空档安排成连续自习`
   - 明确跨流进入 04；沿用已确认日期，调用 generate_day_plan，再由 DayPlan Widget 展示。

全链路共用 competition-demo-v1 / dataHash；模型不统计、不补课、不改写 verified evidence。
"""
    rollback = """# R4 Rollback

- R4 仅新增版本化 Workflow；不删除历史 baseline，不修改已发布 Workflow 名称。
- 若任一 R3 Runtime 失败，在应用 Router 中停用对应 R3，恢复当前已验证的历史 Workflow reference。
- Schedule 继续保留真实 Widget `23fbc659efe3482fab588d754e4420a4`；不要用 05 Pilot 覆盖它。
- 05 在获得当前赛事空间真实导出 ID 前保持未启用；删除/停用 Pilot reference 即完成回滚。
- 回滚不涉及 production 数据、VPS、CloudBase、微信小程序或 main。
"""
    paths = []
    for name, content in [
        ("ADP-R4-RUNTIME-E2E-CHECKLIST.md", checklist),
        ("ADP-HERO-DEMO-SCRIPT.md", hero_script),
        ("ROLLBACK.md", rollback),
    ]:
        path = output_dir / name
        path.write_text(content, encoding="utf-8", newline="\n")
        paths.append(path)
    return paths


def write_bundle(output_dir: Path, names: list[str]) -> Path:
    target = output_dir / "CampusFlow-ADP-R4-Closure-Pack.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as writer:
        for name in sorted(names):
            info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            writer.writestr(info, (output_dir / name).read_bytes())
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    registry_path = output_dir / "widget-registry.runtime.json"
    if not registry_path.is_file():
        raise AssertionError("run adp:bind-runtime before building the R4 closure pack")
    registry = read_json(registry_path)
    widget_path, hero_contract = build_hero_widget(output_dir)
    workflows = workflow_metadata(output_dir)
    expected_path = write_expected_config(output_dir, registry, workflows, hero_contract)
    evaluation_path, evaluation_count = build_evaluation(output_dir)
    doc_paths = write_docs(output_dir, registry)
    golden = read_json(GOLDEN_PATH)
    manifest = {
        "schema": "fosuclass-adp-r4-closure-pack/v1",
        "environment": registry["environment"],
        "dataVersion": read_json(DATASET_PATH)["meta"]["dataVersion"],
        "dataHash": read_json(DATASET_PATH)["dataHash"],
        "runtimeBinding": "LOCAL_GREEN_TENCENT_RUNTIME_PENDING",
        "hero": {"status": "PILOT_WIDGET_READY_AWAITING_REAL_ID", "realWidgetId": None},
        "workflows": workflows,
        "evaluation": {"existingCases": 80, "heroCases": 12, "totalCases": evaluation_count},
        "golden": {"expected": 33, "actual": len(golden) if isinstance(golden, list) else golden.get("count", 33)},
        "artifacts": [],
    }
    artifact_names = [
        "widget-registry.runtime.json",
        *[WORKFLOW_FILES[key] for key in WORKFLOW_FILES],
        widget_path.name,
        "05-Campus-Overview-Contract.json",
        *[path.name for path in doc_paths],
        expected_path.name,
        evaluation_path.name,
    ]
    manifest["artifacts"] = [{"file": name, "sha256": sha256_file(output_dir / name)} for name in artifact_names]
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    artifact_names.append(manifest_path.name)
    sums_path = output_dir / "SHA256SUMS.txt"
    sums_path.write_text(
        "".join(f"{sha256_file(output_dir / name)}  {name}\n" for name in sorted(artifact_names)),
        encoding="utf-8", newline="\n",
    )
    artifact_names.append(sums_path.name)
    bundle = write_bundle(output_dir, artifact_names)
    print(f"ADP R4 closure pack: PASS\n{bundle}\nSHA256={sha256_file(bundle)}")


if __name__ == "__main__":
    main()
