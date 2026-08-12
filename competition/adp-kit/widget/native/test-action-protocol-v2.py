#!/usr/bin/env python3
"""Action Protocol V2 intent-first payload and text fallback contract."""

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CONTRACT = json.loads((ROOT / "action-protocol-v2.json").read_text(encoding="utf-8"))
SPEC = importlib.util.spec_from_file_location("schedule_adapter", ROOT / "schedule-runtime-safe-v3-adapter.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def actions(scope, weekday):
    return MODULE.build_action_protocol(
        "teacher", "教师003", 1, weekday, "2026-08-31", scope, [1, 3, 4, 5],
    )


day = actions("DAY", 1)
week = actions("WEEK", None)
allowed = set(CONTRACT["intents"])
for action in [*day, *week]:
    payload = action["payload"]
    assert set(CONTRACT["requiredPayloadFields"]) <= set(payload)
    assert payload["intent"] in allowed
    assert payload["entityType"] == "teacher"
    assert payload["entityName"] == "教师003"
    assert payload["week"] == 1
    assert "教师003" in payload["query"] and "第1周" in payload["query"]

assert [value["label"] for value in day] == ["查看整周", "选择日期", "检查风险"]
assert [value["payload"]["intent"] for value in day] == [
    "schedule_week", "schedule_choose_day", "schedule_risk_check",
]
assert [value["label"] for value in week] == ["选择日期", "本周风险", "返回最近一天"]
assert week[0]["message"] == "【小序操作:选择课表日期】教师003|第1周"
assert week[1]["payload"]["weekday"] is None

print("Action Protocol V2 tests: PASS (intent-first + standalone query fallback)")
