#!/usr/bin/env python3
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.main

verified = {"success": True, "dataVersion": "competition-demo-v1", "queryId": "q1", "evidence": {"verified": True}}
classroom = load("classroom", "classroom-widget-adapter.py")
result = classroom({"tool_body": {**verified, "query": {"week": 1, "weekday": 1, "periodStart": 5, "periodEnd": 6},
    "items": [{"roomName": "A1-101", "campusName": "校区A", "building": "A1", "capacity": 60, "roomType": "多媒体", "periodText": "第5-6节", "date": "2026-08-31"}]}})
assert result["route"] == "widget" and result["summary"]["totalCount"] == 1

dayplan = load("dayplan", "dayplan-widget-adapter.py")
result = dayplan({"tool_body": {**verified, "query": {"date": "2026-09-04"}, "summary": {"lessonCount": 1, "hasCrossCampus": True},
    "items": [{"type": "lesson", "lessonId": "l1", "courseName": "数据结构", "teachers": ["教师003"]},
              {"type": "tip", "text": "跨校区赶场"}]}})
assert result["route"] == "widget" and result["summary"]["hasCrossCampus"] is True

recovery = load("recovery", "recovery-widget-adapter.py")
choice = recovery({"tool_body": {"success": False, "error": {"code": "AMBIGUOUS_ENTITY", "details": {"candidates": [{"id": "t1", "type": "teacher", "name": "教师001"}]}}}})
assert choice["route"] == "choice" and choice["items"][0]["action"]["type"] == "sys.chat"
error = recovery({"tool_body": {"success": False, "error": {"code": "INVALID_PARAM"}}})
assert error["route"] == "error" and error["error"]["code"] == "INVALID_PARAM"
assert recovery({"tool_body": verified})["route"] == "primary"
print("Native campus adapters: PASS (Classroom/DayPlan/Choice/Error)")
