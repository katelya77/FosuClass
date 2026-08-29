def main(params: dict) -> dict:
    body = params.get("tool_body") if isinstance(params, dict) else {}
    body = body if isinstance(body, dict) else {}

    def arr(value):
        return value if isinstance(value, list) else []

    def obj(value):
        return value if isinstance(value, dict) else {}

    def integer(value, default=0):
        if isinstance(value, bool):
            return default
        try:
            return int(value)
        except Exception:
            return default

    empty = {
        "route": "fallback", "title": "", "timeText": "", "queryId": "",
        "dataVersion": "", "summary": {}, "items": [], "rushWarnings": [], "actions": [],
    }
    evidence = obj(body.get("evidence"))
    if (
        body.get("success") is not True
        or body.get("dataVersion") != "competition-demo-v1"
        or evidence.get("verified") is not True
    ):
        return empty

    compared = arr(body.get("compared"))
    first = obj(compared[0]) if compared else {}
    second = obj(compared[1]) if len(compared) > 1 else first
    first_name = str(first.get("name") or "对象1")
    second_name = str(second.get("name") or first_name)
    summary_in = obj(body.get("summary"))
    conflicts = [value for value in arr(body.get("items")) if isinstance(value, dict)]
    warnings = [value for value in arr(body.get("rushWarnings")) if isinstance(value, dict)]
    self_compare = summary_in.get("selfCompare") is True
    title = (
        f"{first_name} · 课程安排风险检查"
        if self_compare else f"{first_name} vs {second_name} · 课程冲突比较"
    )
    query = obj(body.get("query"))
    date = str(query.get("date") or "")
    week = integer(query.get("week"), 0)
    weekday_name = ""
    if warnings:
        weekday_name = str(obj(warnings[0]).get("weekdayName") or "")
    elif conflicts:
        weekday_name = str(obj(conflicts[0]).get("weekdayName") or "")
    time_text = " · ".join(value for value in [
        date or (f"第{week}周" if week else ""), weekday_name,
    ] if value)

    actions = []
    if self_compare and first_name:
        weekday = integer(query.get("weekday"), 0)
        weekday_cn = ["", "一", "二", "三", "四", "五", "六", "日"]
        if week and 1 <= weekday <= 7:
            actions.append({
                "id": "conflict-self-schedule", "type": "sys.chat", "label": "查看当天课表",
                "message": f"查询{first_name}第{week}周周{weekday_cn[weekday]}的课",
            })
        elif week:
            actions.append({
                "id": "conflict-self-week", "type": "sys.chat", "label": "查看整周课表",
                "message": f"查询{first_name}第{week}周的课表",
            })
    actions.append({
        "id": "conflict-change-target", "type": "sys.chat", "label": "换对象比较",
        "message": f"把{first_name}换一个对象继续比较冲突",
    })

    return {
        "route": "widget",
        "title": title,
        "timeText": time_text,
        "queryId": str(body.get("queryId") or ""),
        "dataVersion": str(body.get("dataVersion") or ""),
        "summary": {
            "conflictCount": integer(summary_in.get("conflictCount"), len(conflicts)),
            "hasConflict": summary_in.get("hasConflict") is True,
            "firstBusySlots": integer(summary_in.get("firstBusySlots")),
            "secondBusySlots": integer(summary_in.get("secondBusySlots")),
            "selfCompare": self_compare,
            "rushWarningCount": integer(summary_in.get("rushWarningCount"), len(warnings)),
        },
        "items": conflicts,
        "rushWarnings": warnings,
        "actions": actions[:3],
    }
