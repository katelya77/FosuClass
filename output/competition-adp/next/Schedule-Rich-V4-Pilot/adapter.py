"""Schedule Rich V4 side-by-side adapter.

This module maps verified RuntimeSafe V3 output into the pending array-based
Widget contract. It does not own a Tencent WidgetID and is not injected into
01-Schedule-Final until a real Rich V4 export is recorded.
"""

import runpy
from pathlib import Path


ROOT = Path(__file__).resolve().parent
V3 = runpy.run_path(str(ROOT.parent / "schedule-runtime-safe-v3-adapter.py"))
BOUNDED_INT = V3["_bounded_int"]
VALID_DATE = V3["_valid_date"]
BUILD_ACTION_PROTOCOL = V3["build_action_protocol"]


def _object(value):
    return value if isinstance(value, dict) else {}


def _array(value):
    return value if isinstance(value, list) else []


def _text(value):
    return str(value or "")


def _empty():
    return {
        "route": "fallback",
        "title": "",
        "timeText": "",
        "queryId": "",
        "dataVersion": "",
        "summary": {
            "totalCount": 0,
            "entityType": "",
            "entityName": "",
            "scope": "WEEK",
        },
        "items": [],
        "actions": [],
    }


def _canonical_context(scope, query, academic):
    week = weekday = None
    date = ""
    if scope == "WEEK":
        week = BOUNDED_INT(query.get("week"), 1, 20)
    elif scope == "DAY":
        week = BOUNDED_INT(query.get("week"), 1, 20)
        weekday = BOUNDED_INT(query.get("weekday"), 1, 7)
        raw_date = query.get("date")
        date = VALID_DATE(raw_date) if raw_date not in (None, "") else ""
    elif scope == "DATE":
        contexts = _array(academic.get("items"))
        context = _object(contexts[0]) if contexts else {}
        tool_date = VALID_DATE(query.get("date"))
        date = VALID_DATE(context.get("resolvedDate") or context.get("date"))
        week = BOUNDED_INT(context.get("week"), 1, 20)
        weekday = BOUNDED_INT(context.get("weekday"), 1, 7)
        if (
            academic.get("success") is not True
            or context.get("inSemester") is not True
            or not tool_date
            or tool_date != date
        ):
            return None
    if week is None or (scope in ("DAY", "DATE") and weekday is None):
        return None
    return week, weekday, date


def _rich_item(value, fallback_date=""):
    item = _object(value)
    weekday = BOUNDED_INT(item.get("weekday"), 1, 7)
    date = VALID_DATE(item.get("date") or fallback_date)
    if weekday is None or not date:
        return None
    start = _text(item.get("startTime"))
    end = _text(item.get("endTime"))
    time_text = _text(item.get("timeText")) or (f"{start}-{end}" if start and end else "")
    return {
        "weekday": weekday,
        "date": date,
        "periodText": _text(item.get("periodText")),
        "courseName": _text(item.get("courseName")),
        "campusName": _text(item.get("campusName")),
        "building": _text(item.get("building")),
        "roomName": _text(item.get("roomName")),
        "timeText": time_text,
        "teachers": [_text(entry) for entry in _array(item.get("teachers")) if _text(entry)],
        "classes": [_text(entry) for entry in _array(item.get("classes")) if _text(entry)],
    }


def _rich_action(index, action):
    payload = _object(action.get("payload"))
    query = _text(payload.get("query") or action.get("message"))
    intent = _text(payload.get("intent"))
    if not query or intent not in {
        "schedule_day", "schedule_week", "schedule_choose_day", "schedule_risk_check",
    }:
        return None
    return {
        "id": f"{intent}-{index + 1}",
        "type": "sys.chat",
        "label": _text(action.get("label")),
        "query": query,
        "intent": intent,
        "entityType": _text(payload.get("entityType")),
        "entityName": _text(payload.get("entityName")),
        "week": payload.get("week"),
        "weekday": payload.get("weekday"),
        "date": _text(payload.get("date")),
    }


def main(params: dict) -> dict:
    params = _object(params)
    body = _object(params.get("tool_body"))
    academic = _object(params.get("academic_body"))
    scope = _text(params.get("transport_scope")).strip().upper()
    entity = _object(body.get("resolvedEntity"))
    query = _object(body.get("query"))
    evidence = _object(body.get("evidence"))
    source_items = _array(body.get("items"))
    entity_type = _text(entity.get("type")).strip()
    entity_name = _text(entity.get("name")).strip()
    if (
        scope not in ("WEEK", "DAY", "DATE")
        or body.get("success") is not True
        or body.get("dataVersion") != "competition-demo-v1"
        or evidence.get("verified") is not True
        or entity_type not in ("teacher", "room", "class", "course")
        or not entity_name
        or not source_items
    ):
        return _empty()

    context = _canonical_context(scope, query, academic)
    if context is None:
        return _empty()
    week, weekday, date = context

    if scope == "DAY" and not date:
        for source in source_items:
            date = VALID_DATE(_object(source).get("date"))
            if date:
                break

    items = [_rich_item(source, date) for source in source_items]
    if any(item is None for item in items):
        return _empty()

    actions = BUILD_ACTION_PROTOCOL(
        entity_type, entity_name, week, weekday, date, scope,
        [item["weekday"] for item in items], [item["date"] for item in items],
    )
    rich_actions = [_rich_action(index, action) for index, action in enumerate(actions or [])]
    if len(rich_actions) != 3 or any(action is None for action in rich_actions):
        return _empty()

    weekday_names = ["一", "二", "三", "四", "五", "六", "日"]
    if scope == "WEEK":
        time_text = f"第{week}周 · 整周"
    elif scope == "DATE":
        time_text = f"{date} · 周{weekday_names[weekday - 1]} · 第{week}周"
    else:
        parts = [f"第{week}周", f"周{weekday_names[weekday - 1]}"]
        if date:
            parts.append(date)
        time_text = " · ".join(parts)

    return {
        "route": "widget",
        "title": f"{entity_name} · 课表",
        "timeText": time_text,
        "queryId": _text(body.get("queryId")),
        "dataVersion": "competition-demo-v1",
        "summary": {
            "totalCount": len(items),
            "entityType": entity_type,
            "entityName": entity_name,
            "scope": scope,
        },
        "items": items,
        "actions": rich_actions,
    }
