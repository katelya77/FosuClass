#!/usr/bin/env python3
"""Schedule Rich V4 full-array and Action Protocol V2 regressions."""

import copy
import runpy
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ADAPTER = runpy.run_path(str(ROOT / "schedule-rich-v4" / "adapter.py"))["main"]


ITEMS = [
    (1, "2026-08-31", "第5-6节", "程序设计基础"),
    (1, "2026-08-31", "第7-8节", "计算机组成原理"),
    (3, "2026-09-02", "第1-2节", "数据结构"),
    (4, "2026-09-03", "第3-4节", "程序设计基础实验"),
    (5, "2026-09-04", "第5-6节", "数据结构"),
]


def item(weekday, date, period, course):
    return {
        "weekday": weekday, "date": date, "periodText": period, "courseName": course,
        "campusName": "校区A", "building": "A1", "roomName": "A1-101",
        "startTime": "08:00", "endTime": "09:40",
        "teachers": ["教师003"], "classes": ["2025级A班"],
    }


def body(query, items=None):
    return {
        "success": True, "queryId": "q-rich-v4", "dataVersion": "competition-demo-v1",
        "resolvedEntity": {"type": "teacher", "name": "教师003"}, "query": query,
        "items": items or [item(*entry) for entry in ITEMS], "evidence": {"verified": True},
    }


def invoke(scope, tool_body, academic=None):
    return ADAPTER({"transport_scope": scope, "tool_body": tool_body, "academic_body": academic or {}})


week = invoke("WEEK", body({"week": 1, "weekday": 0, "date": ""}))
assert week["route"] == "widget", week
assert week["summary"]["totalCount"] == 5
assert len(week["items"]) == 5 and [entry["courseName"] for entry in week["items"]] == [entry[3] for entry in ITEMS]
assert week["timeText"] == "第1周 · 整周"
assert not any(token in str(week) for token in ("星期0", "周0", "weekday=0"))
assert next(action for action in week["actions"] if action["intent"] == "schedule_day")["date"] == "2026-08-31"

day_items = [item(*entry) for entry in ITEMS[:2]]
day = invoke("DAY", body({"week": 1, "weekday": 1, "date": "2026-08-31"}, day_items))
assert day["route"] == "widget" and len(day["items"]) == 2
assert day["timeText"] == "第1周 · 周一 · 2026-08-31"
for action in day["actions"]:
    assert set(action) == {"id", "type", "label", "query", "intent", "entityType", "entityName", "week", "weekday", "date"}
    assert action["query"] and action["entityName"] in action["query"]
    assert action["date"] == "2026-08-31"
risk = next(action for action in day["actions"] if action["intent"] == "schedule_risk_check")
assert risk["query"] == "检查教师003第1周周一是否存在时间冲突或跨校区赶场"

date = invoke("DATE", body({"date": "2026-08-31", "week": 0, "weekday": 0}, day_items), {
    "success": True,
    "items": [{"resolvedDate": "2026-08-31", "week": 1, "weekday": 1, "inSemester": True}],
})
assert date["route"] == "widget" and date["summary"]["scope"] == "DATE"
assert date["timeText"] == "2026-08-31 · 周一 · 第1周"

day_zero = invoke("DAY", body({"week": 1, "weekday": 0, "date": "2026-08-31"}, day_items))
assert day_zero["route"] == "fallback"
unverified = copy.deepcopy(body({"week": 1, "weekday": 1, "date": "2026-08-31"}, day_items))
unverified["evidence"]["verified"] = False
assert invoke("DAY", unverified)["route"] == "fallback"

print("Schedule Rich V4 adapter: PASS (WEEK 5/5 + DAY/DATE + Action Protocol V2 + fail-closed)")
