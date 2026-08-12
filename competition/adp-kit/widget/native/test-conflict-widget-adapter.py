#!/usr/bin/env python3
import json
import runpy
from pathlib import Path


root = Path(__file__).resolve().parent
main = runpy.run_path(str(root / "conflict-widget-adapter.py"))["main"]
contract = json.loads((root / "conflict-widget-contract.json").read_text(encoding="utf-8"))
body = {
    "success": True,
    "queryId": "q-conflict-widget",
    "dataVersion": "competition-demo-v1",
    "query": {"week": 1, "weekday": 1, "date": ""},
    "compared": [{"type": "teacher", "name": "教师003"}, {"type": "teacher", "name": "教师003"}],
    "items": [],
    "rushWarnings": [{
        "entity": "教师003", "weekday": 1, "weekdayName": "周一",
        "from": {"courseName": "程序设计基础", "periodText": "第5-6节", "campusName": "校区A", "roomName": "A2-301"},
        "to": {"courseName": "计算机组成原理", "periodText": "第7-8节", "campusName": "校区B", "roomName": "B1-201"},
        "gapMinutes": 20,
    }],
    "summary": {"conflictCount": 0, "hasConflict": False, "firstBusySlots": 2, "secondBusySlots": 2, "selfCompare": True, "rushWarningCount": 1},
    "evidence": {"verified": True},
}
output = main({"tool_body": body})
assert output["route"] == "widget"
assert output["title"] == "教师003 · 课程安排风险检查"
assert output["summary"]["conflictCount"] == 0
assert output["summary"]["rushWarningCount"] == 1
assert len(output["rushWarnings"]) == 1
assert output["actions"][0]["message"] == "查询教师003第1周周一的课"
assert list(output)[1:] == [field["name"] for field in contract["fields"]]
assert contract["widgetId"] == "8d576e5af9b04fdd99804e7fcbff3644"
assert contract["sourceSha256"] == "04b3a057fb062877361f9f721e0031b4b4b91ae7ca5e751dd51ea220d89f4b9d"
body["evidence"]["verified"] = False
assert main({"tool_body": body})["route"] == "fallback"
print("Conflict Widget Adapter tests: PASS (0 overlap + 1 rush warning)")
