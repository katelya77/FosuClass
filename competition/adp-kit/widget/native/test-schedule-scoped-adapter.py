#!/usr/bin/env python3
"""Scope-aware response canonicalization regressions for Schedule Adapter."""

import copy
import runpy
from pathlib import Path


NATIVE_DIR = Path(__file__).resolve().parent
ADAPTER = runpy.run_path(str(NATIVE_DIR / "schedule-runtime-safe-v3-adapter.py"))["main"]


def body(query, items=None):
    return {
        "success": True,
        "queryId": "q-scoped-adapter",
        "dataVersion": "competition-demo-v1",
        "resolvedEntity": {"type": "teacher", "name": "教师003"},
        "query": query,
        "items": items or [{
            "weekday": 1,
            "date": "2026-08-31",
            "periodText": "第5-6节",
            "courseName": "程序设计基础",
            "campusName": "校区A",
            "building": "A2",
            "roomName": "A2-301",
            "startTime": "14:00",
            "endTime": "15:40",
            "teachers": ["教师003"],
            "classes": ["2025级A班"],
        }],
        "evidence": {"verified": True},
    }


def academic(date="2026-08-31", week=1, weekday=1):
    return {
        "success": True,
        "items": [{
            "resolvedDate": date,
            "date": date,
            "week": week,
            "weekday": weekday,
            "inSemester": True,
        }],
    }


def invoke(scope, tool_body, academic_body=None):
    return ADAPTER({
        "transport_scope": scope,
        "tool_body": tool_body,
        "academic_body": academic_body or {},
    })


week = invoke("WEEK", body({"week": 1, "weekday": 0, "date": ""}))
assert week["route"] == "widget", week
assert week["timeText"] == "第1周 · 整周"
assert "星期0" not in str(week) and "周0" not in str(week) and "weekday=0" not in str(week)
assert week["action0Label"] == "选择日期"
assert week["action0Message"] == "【小序操作:选择课表日期】教师003|第1周"
assert week["action1Label"] == "本周风险"

day_zero = invoke("DAY", body({"week": 1, "weekday": 0, "date": "2026-08-31"}))
assert day_zero["route"] == "fallback", day_zero

day = invoke("DAY", body({"week": 1, "weekday": 1, "date": "2026-08-31"}))
assert day["route"] == "widget", day
assert day["timeText"] == "第1周 · 周一 · 2026-08-31"
assert [day[f"action{i}Label"] for i in range(3)] == ["查看整周", "选择日期", "检查风险"]

date_body = body({"date": "2026-08-31", "week": 0, "weekday": 0})
date = invoke("DATE", date_body, academic())
assert date["route"] == "widget", date
assert date["timeText"] == "2026-08-31 · 周一 · 第1周"

bad_date = copy.deepcopy(date_body)
bad_date["query"]["date"] = "2026-02-30"
assert invoke("DATE", bad_date, academic(date="2026-02-30"))["route"] == "fallback"

print("Schedule scoped adapter tests: PASS (WEEK/DAY/DATE + sentinel fail-closed)")
