#!/usr/bin/env python3
"""Regression tests for the final serialized ADP Tool requests."""

import argparse
import json
import zipfile
from pathlib import Path


NATIVE_DIR = Path(__file__).resolve().parent
KIT_DIR = NATIVE_DIR.parent.parent
REPO_DIR = KIT_DIR.parent.parent
CONTRACT = json.loads((NATIVE_DIR / "action-contract.json").read_text(encoding="utf-8"))


def load_workflow(path):
    with zipfile.ZipFile(path, "r") as reader:
        names = [name for name in reader.namelist() if name.endswith("_workflow.json")]
        assert len(names) == 1
        return json.loads(reader.read(names[0]))


def run_code(node, params):
    namespace = {}
    exec(node["CodeExecutorNodeData"]["Code"], namespace)
    return namespace["main"](params)


def serialize_request(node, values):
    request = {}
    for item in node["ToolNodeData"]["Body"]:
        reference = item["Input"]["Reference"]["JsonPath"].split(".")[-1]
        request[item["ParamName"]] = values[reference]
    return request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact")
    args = parser.parse_args()
    artifact = Path(args.artifact or (
        REPO_DIR / "output" / "competition-adp" / "final" / CONTRACT["generated"]["fileName"]
    )).resolve()
    workflow = load_workflow(artifact)
    nodes = {node["NodeName"]: node for node in workflow["Nodes"]}
    normalizer = nodes["查询参数归一化"]

    week = run_code(normalizer, {
        "date_text": "第1周", "week": 1, "weekday": 0, "time_scope": "week",
        "period_start": 0, "period_end": 0, "academic_body": {},
    })
    assert week["transport_route"] == "WEEK"
    week_request = serialize_request(nodes["课表查询-WEEK"], {
        **week, "entity_type": "teacher", "entity_name": "教师003",
    })
    assert week_request == {
        "entityType": "teacher", "entityName": "教师003", "week": 1,
        "periodStart": 1, "periodEnd": 10,
    }
    assert "weekday" not in week_request
    assert "date" not in week_request

    day = run_code(normalizer, {
        "date_text": "", "week": 1, "weekday": 2, "time_scope": "day",
        "period_start": 0, "period_end": 0, "academic_body": {},
    })
    assert day["transport_route"] == "DAY"
    day_request = serialize_request(nodes["课表查询-DAY"], {
        **day, "entity_type": "teacher", "entity_name": "教师003",
    })
    assert day_request["week"] == 1 and day_request["weekday"] == 2
    assert "date" not in day_request

    date = run_code(normalizer, {
        "date_text": "明天", "week": 0, "weekday": 0, "time_scope": "day",
        "period_start": 0, "period_end": 0,
        "academic_body": {"success": True, "items": [{
            "inSemester": True, "resolvedDate": "2026-09-01", "week": 1, "weekday": 2,
        }]},
    })
    assert date["transport_route"] == "DATE"
    date_request = serialize_request(nodes["课表查询-DATE"], {
        **date, "entity_type": "teacher", "entity_name": "教师003",
    })
    assert date_request["date"] == "2026-09-01"
    assert "week" not in date_request and "weekday" not in date_request

    action_contract = json.loads((NATIVE_DIR / "action-contract.json").read_text(encoding="utf-8"))
    risk = action_contract["cases"][0]["expected"][2]["message"]
    assert risk == "检查教师003第1周周一是否存在时间冲突或跨校区赶场"
    assert __import__("re").match(action_contract["canonical03TeacherRiskPattern"], risk)
    print("ADP Transport Contract: PASS (WEEK omit, DAY, DATE, 03 handoff)")


if __name__ == "__main__":
    main()
