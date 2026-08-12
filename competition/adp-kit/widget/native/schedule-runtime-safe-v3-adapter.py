def _bounded_int(v, lower, upper):
    if isinstance(v, bool) or v in (None, ""):
        return None
    text = str(v).strip()
    if not text.isdigit():
        return None
    value = int(text)
    return value if lower <= value <= upper else None


def _weekday_name(v):
    n = _bounded_int(v, 1, 7)
    names = ["一", "二", "三", "四", "五", "六", "日"]
    return f"周{names[n - 1]}" if n is not None else ""


def _valid_date(v):
    text = str(v or "").strip()
    parts = text.split("-")
    if len(parts) != 3 or [len(part) for part in parts] != [4, 2, 2]:
        return ""
    if not all(part.isdigit() for part in parts):
        return ""
    year, month, day = [int(part) for part in parts]
    if not 1 <= month <= 12:
        return ""
    leap = year % 400 == 0 or (year % 4 == 0 and year % 100 != 0)
    month_days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return text if 1 <= day <= month_days[month - 1] else ""


def _action(label, query, intent, entity_type, entity_name, week, weekday=None, date=""):
    return {
        "label": label,
        "message": query,
        "payload": {
            "query": query,
            "intent": intent,
            "entityType": entity_type,
            "entityName": entity_name,
            "week": week,
            "weekday": weekday,
            "date": date,
        },
    }


def build_action_protocol(entity_type, entity_name, week, weekday, date, transport_scope, item_weekdays=None):
    """Build Action Protocol V2; current RuntimeSafe Widget projects payload.query only."""
    if entity_type not in ("teacher", "room", "class", "course") or not entity_name:
        return None
    if week is None or transport_scope not in ("WEEK", "DAY", "DATE"):
        return None

    choose_query = f"【小序操作:选择课表日期】{entity_name}|第{week}周"
    choose = _action(
        "选择日期", choose_query, "schedule_choose_day",
        entity_type, entity_name, week,
    )
    week_query = f"查询{entity_name}第{week}周的课表"
    week_action = _action(
        "查看整周", week_query, "schedule_week",
        entity_type, entity_name, week,
    )

    candidate_days = [
        value for value in (item_weekdays or [])
        if _bounded_int(value, 1, 7) is not None
    ]
    recent_weekday = candidate_days[0] if candidate_days else (weekday or 1)
    recent_query = f"查询{entity_name}第{week}周{_weekday_name(recent_weekday)}的课"
    recent = _action(
        "返回最近一天", recent_query, "schedule_day",
        entity_type, entity_name, week, recent_weekday,
    )

    if transport_scope == "WEEK":
        actions = [choose]
        if entity_type == "teacher":
            risk_query = f"检查{entity_name}第{week}周是否存在时间冲突或跨校区赶场"
            actions.append(_action(
                "本周风险", risk_query, "schedule_risk_check",
                entity_type, entity_name, week,
            ))
        else:
            actions.append(recent)
        actions.append(recent if entity_type == "teacher" else week_action)
        return actions

    if weekday is None:
        return None
    actions = [week_action, choose]
    if entity_type == "teacher":
        risk_query = (
            f"检查{entity_name}第{week}周{_weekday_name(weekday)}"
            "是否存在时间冲突或跨校区赶场"
        )
        actions.append(_action(
            "检查风险", risk_query, "schedule_risk_check",
            entity_type, entity_name, week, weekday, date,
        ))
    else:
        actions.append(recent)
    return actions


def main(params: dict) -> dict:
    def obj(v):
        return v if isinstance(v, dict) else {}

    def arr(v):
        return v if isinstance(v, list) else []

    def s(v):
        return str(v or "")

    def location_text(item):
        return " · ".join([
            value for value in [
                s(item.get("campusName")),
                s(item.get("building")),
                s(item.get("roomName")),
            ] if value
        ])

    def meta_text(item):
        time_text = ""
        if s(item.get("startTime")) and s(item.get("endTime")):
            time_text = f"{s(item.get('startTime'))}-{s(item.get('endTime'))}"
        teachers = "、".join([s(value) for value in arr(item.get("teachers")) if s(value)])
        classes = "、".join([s(value) for value in arr(item.get("classes")) if s(value)])
        return " · ".join([value for value in [time_text, teachers, classes] if value])

    empty = {
        "route": "fallback",
        "title": "",
        "timeText": "",
        "statusText": "",
        "courseCountText": "",
        "shownCount": 1,
        "listStatusText": "",
        "item0PeriodText": "",
        "item0CourseName": "",
        "item0LocationText": "",
        "item0MetaText": "",
        "item1PeriodText": "",
        "item1CourseName": "",
        "item1LocationText": "",
        "item1MetaText": "",
        "action0Label": "",
        "action0Message": "",
        "action1Label": "",
        "action1Message": "",
        "action2Label": "",
        "action2Message": "",
        "footerText": "",
    }

    params = obj(params)
    body = obj(params.get("tool_body"))
    academic = obj(params.get("academic_body"))
    scope = s(params.get("transport_scope")).strip().upper()
    evidence = obj(body.get("evidence"))
    items_all = arr(body.get("items"))
    if (
        scope not in ("WEEK", "DAY", "DATE")
        or body.get("success") is not True
        or s(body.get("dataVersion")) != "competition-demo-v1"
        or evidence.get("verified") is not True
        or len(items_all) == 0
    ):
        return empty

    entity = obj(body.get("resolvedEntity"))
    query = obj(body.get("query"))
    entity_name = s(entity.get("name")).strip()
    entity_type = s(entity.get("type")).strip()
    if entity_type not in ("teacher", "room", "class", "course") or not entity_name:
        return empty

    q_week = None
    q_weekday = None
    q_date = ""
    if scope == "WEEK":
        q_week = _bounded_int(query.get("week"), 1, 20)
        # Tencent ADP may expose an omitted optional INT output as 0. It is a
        # sentinel only in this already-routed WEEK response branch.
        if q_week is None:
            return empty
    elif scope == "DAY":
        q_week = _bounded_int(query.get("week"), 1, 20)
        q_weekday = _bounded_int(query.get("weekday"), 1, 7)
        raw_date = query.get("date")
        q_date = _valid_date(raw_date) if raw_date not in (None, "") else ""
        if q_week is None or q_weekday is None:
            return empty
    else:
        academic_items = arr(academic.get("items"))
        context = obj(academic_items[0]) if academic_items else {}
        tool_date = _valid_date(query.get("date"))
        q_date = _valid_date(context.get("resolvedDate") or context.get("date"))
        q_week = _bounded_int(context.get("week"), 1, 20)
        q_weekday = _bounded_int(context.get("weekday"), 1, 7)
        if (
            academic.get("success") is not True
            or context.get("inSemester") is not True
            or not tool_date or not q_date or tool_date != q_date
            or q_week is None or q_weekday is None
        ):
            return empty

    if scope == "DAY" and not q_date:
        for item in items_all:
            if isinstance(item, dict):
                q_date = _valid_date(item.get("date"))
                if q_date:
                    break

    item_weekdays = [item.get("weekday") for item in items_all if isinstance(item, dict)]
    actions = build_action_protocol(
        entity_type, entity_name, q_week, q_weekday, q_date, scope, item_weekdays,
    )
    if not actions or len(actions) != 3:
        return empty

    if scope == "WEEK":
        time_text = f"第{q_week}周 · 整周"
    elif scope == "DATE":
        time_text = " · ".join([q_date, _weekday_name(q_weekday), f"第{q_week}周"])
    else:
        time_text = " · ".join([
            value for value in [f"第{q_week}周", _weekday_name(q_weekday), q_date] if value
        ])

    item0 = items_all[0] if len(items_all) > 0 and isinstance(items_all[0], dict) else {}
    item1 = items_all[1] if len(items_all) > 1 and isinstance(items_all[1], dict) else {}
    shown = 2 if len(items_all) >= 2 else 1
    data_version = s(body.get("dataVersion"))
    query_id = s(body.get("queryId"))

    return {
        "route": "widget",
        "title": f"{entity_name} · 课表",
        "timeText": time_text,
        "statusText": f"已核验 · {data_version}",
        "courseCountText": f"{len(items_all)} 条课程",
        "shownCount": shown,
        "listStatusText": f"显示 {shown} 条",
        "item0PeriodText": s(item0.get("periodText")) or "课程",
        "item0CourseName": s(item0.get("courseName")) or "未命名课程",
        "item0LocationText": location_text(item0),
        "item0MetaText": meta_text(item0),
        "item1PeriodText": s(item1.get("periodText")) or "课程",
        "item1CourseName": s(item1.get("courseName")) or "未命名课程",
        "item1LocationText": location_text(item1),
        "item1MetaText": meta_text(item1),
        "action0Label": actions[0]["label"],
        "action0Message": actions[0]["message"],
        "action1Label": actions[1]["label"],
        "action1Message": actions[1]["message"],
        "action2Label": actions[2]["label"],
        "action2Message": actions[2]["message"],
        "footerText": f"数据版本 {data_version} · 查询编号 {query_id}",
    }
