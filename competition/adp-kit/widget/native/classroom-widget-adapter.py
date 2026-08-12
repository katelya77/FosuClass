def main(params: dict) -> dict:
    body = params.get("tool_body") if isinstance(params, dict) else {}
    body = body if isinstance(body, dict) else {}

    def obj(value):
        return value if isinstance(value, dict) else {}

    def arr(value):
        return value if isinstance(value, list) else []

    def integer(value, default=0):
        if isinstance(value, bool):
            return default
        try:
            return int(value)
        except Exception:
            return default

    empty = {
        "route": "fallback", "title": "", "timeText": "", "queryId": "",
        "dataVersion": "", "filters": [], "summary": {
            "totalCount": 0, "shownCount": 0, "hiddenCount": 0, "empty": True,
        }, "items": [], "actions": [],
    }
    evidence = obj(body.get("evidence"))
    if body.get("success") is not True or body.get("dataVersion") != "competition-demo-v1" or evidence.get("verified") is not True:
        return empty
    query = obj(body.get("query"))
    items = []
    for value in arr(body.get("items")):
        item = obj(value)
        items.append({
            "roomName": str(item.get("roomName") or ""),
            "campusName": str(item.get("campusName") or ""),
            "building": str(item.get("building") or ""),
            "capacity": integer(item.get("capacity")),
            "roomType": str(item.get("roomType") or ""),
            "periodText": str(item.get("periodText") or ""),
            "date": str(item.get("date") or query.get("date") or ""),
        })
    week = integer(query.get("week"))
    weekday = integer(query.get("weekday"))
    date = str(query.get("date") or "")
    period_start = integer(query.get("periodStart") or query.get("startPeriod"))
    period_end = integer(query.get("periodEnd"))
    time_text = " · ".join(value for value in [
        date or (f"第{week}周" if week else ""),
        (f"周{'一二三四五六日'[weekday - 1]}" if 1 <= weekday <= 7 else ""),
        (f"第{period_start}-{period_end}节" if period_start and period_end else ""),
    ] if value)
    filters = []
    for key, label in [("campus", "校区"), ("building", "教学楼"), ("minCapacity", "容量")]:
        value = query.get(key)
        if value not in (None, "", 0):
            filters.append({"id": key, "label": label, "value": str(value)})
    return {
        "route": "widget", "title": "小序 · 空教室", "timeText": time_text,
        "queryId": str(body.get("queryId") or ""), "dataVersion": str(body.get("dataVersion") or ""),
        "filters": filters,
        "summary": {"totalCount": len(items), "shownCount": len(items), "hiddenCount": 0, "empty": len(items) == 0},
        "items": items,
        "actions": [
            {"id": "classroom-change-time", "type": "sys.chat", "label": "换个时段", "message": "请重新选择空教室查询时段"},
            {"id": "classroom-change-campus", "type": "sys.chat", "label": "换个校区", "message": "请重新选择空教室查询校区"},
        ],
    }
