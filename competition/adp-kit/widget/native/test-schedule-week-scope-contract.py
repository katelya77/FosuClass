#!/usr/bin/env python3
"""Regression tests for the Schedule Actions V1.1 week-scope workflow contract."""

import argparse
import json
import zipfile
from pathlib import Path


NATIVE_DIR = Path(__file__).resolve().parent
KIT_DIR = NATIVE_DIR.parent.parent
REPO_DIR = KIT_DIR.parent.parent
CONTRACT_PATH = NATIVE_DIR / "action-contract.json"


def workflow_from_artifact(path):
    with zipfile.ZipFile(path, "r") as reader:
        entries = [name for name in reader.namelist() if name.endswith("_workflow.json")]
        assert len(entries) == 1, f"expected one workflow JSON, found {len(entries)}"
        return json.loads(reader.read(entries[0]))


def run_code(node, params):
    namespace = {}
    exec(node["CodeExecutorNodeData"]["Code"], namespace)
    return namespace["main"](params)


def body_input(node, param_name):
    return next(item for item in node["ToolNodeData"]["Body"] if item["ParamName"] == param_name)


def main():
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact")
    args = parser.parse_args()
    artifact = Path(args.artifact) if args.artifact else (
        REPO_DIR / "output" / "competition-adp" / "final" / contract["generated"]["fileName"]
    )
    workflow = workflow_from_artifact(artifact.resolve())
    nodes = {node["NodeName"]: node for node in workflow["Nodes"]}

    normalizer = nodes["查询参数归一化"]
    normalized = run_code(normalizer, {
        "date_text": "第1周",
        "week": 1,
        "weekday": 0,
        "time_scope": "week",
        "period_start": 0,
        "period_end": 0,
        "academic_body": {},
    })
    assert normalized["query_week"] == 1
    assert normalized["query_weekday"] is None
    invalid_ranges = run_code(normalizer, {
        "date_text": "",
        "week": 0,
        "weekday": 8,
        "time_scope": "day",
        "period_start": 0,
        "period_end": 0,
        "academic_body": {},
    })
    assert invalid_ranges["query_week"] is None
    assert invalid_ranges["query_weekday"] is None

    prompt = nodes["参数提取"]["ParameterExtractorNodeData"]["UserConstraint"]
    required_prompt_contracts = [
        "查询教师003第1周的课表",
        "week=1",
        "weekday=null",
        "date_text=null",
        "time_scope=week",
        "查询教师003第1周周二的课",
        "weekday=2",
        "time_scope=day",
    ]
    for fragment in required_prompt_contracts:
        assert fragment in prompt, f"extractor contract missing: {fragment}"

    guard = nodes["日期输入守卫"]
    assert run_code(guard, {
        "date_text": "第1周", "week": 1, "weekday": 0, "time_scope": "week",
    })["safe_date_text"] == ""
    for relative_date in ["明天", "本周三", "下周五"]:
        guarded = run_code(guard, {
            "date_text": relative_date, "week": 0, "weekday": 0, "time_scope": "day",
        })
        assert guarded["safe_date_text"] == relative_date
    invalid_natural_date = "一个不受支持的日期"
    assert run_code(guard, {
        "date_text": invalid_natural_date, "week": 0, "weekday": 0, "time_scope": "day",
    })["safe_date_text"] == invalid_natural_date

    date_input = body_input(nodes["日期解析"], "dateText")["Input"]
    assert date_input["InputType"] == "REFERENCE_OUTPUT"
    assert date_input["Reference"]["NodeID"] == guard["NodeID"]
    assert date_input["Reference"]["JsonPath"] == "Output.safe_date_text"

    print("Schedule Actions V1.1 week-scope contract: PASS (7 regressions)")


if __name__ == "__main__":
    main()
