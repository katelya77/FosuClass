def main(params: dict) -> dict:
    body = params.get("tool_body") or {}
    expected_version = "competition-demo-v1"

    def arr(v):
        return v if isinstance(v, list) else []

    def s(v):
        return str(v or "")

    def weekday_name(v):
        try:
            n = int(v)
        except Exception:
            return ""
        names = ["一", "二", "三", "四", "五", "六", "日"]
        return f"周{names[n-1]}" if 1 <= n <= 7 else ""

    evidence = body.get("evidence") or {}
    items_all = arr(body.get("items"))
    ready = (
        body.get("success") is True
        and s(body.get("dataVersion")) == expected_version
        and evidence.get("verified") is True
        and len(items_all) > 0
    )

    if not ready:
        return {
            "route": "fallback",
            "title": "",
            "timeText": "",
            "queryId": s(body.get("queryId")),
            "dataVersion": s(body.get("dataVersion") or expected_version),
            "summary": {
                "totalCount": 0,
                "shownCount": 0,
                "hiddenCount": 0,
                "entityType": "",
                "entityName": "",
            },
            "items": [],
            "actions": [],
        }

    entity = body.get("resolvedEntity") or {}
    query = body.get("query") or {}
    entity_name = s(entity.get("name") or "当前对象")
    entity_type = s(entity.get("type"))

    time_parts = []
    q_week = query.get("week")
    q_weekday = query.get("weekday")
    q_date = s(query.get("date"))
    if q_week not in (None, "", 0):
        time_parts.append(f"第{q_week}周")
    wd = weekday_name(q_weekday)
    if wd:
        time_parts.append(wd)
    if q_date:
        time_parts.append(q_date)
    if not time_parts:
        time_parts.append("当前查询范围")
    time_text = " · ".join(time_parts)

    items = []
    for item in items_all[:5]:
        item = item if isinstance(item, dict) else {}
        items.append({
            "lessonId": s(item.get("lessonId")),
            "courseName": s(item.get("courseName")),
            "periodText": s(item.get("periodText")),
            "startTime": s(item.get("startTime")),
            "endTime": s(item.get("endTime")),
            "date": s(item.get("date")),
            "weekdayName": s(item.get("weekdayName")),
            "campusName": s(item.get("campusName")),
            "building": s(item.get("building")),
            "roomName": s(item.get("roomName")),
            "teachers": [s(x) for x in arr(item.get("teachers"))],
            "classes": [s(x) for x in arr(item.get("classes"))],
        })

    actions = []
    if q_week not in (None, "", 0):
        actions.append({
            "id": "schedule-week",
            "type": "sys.chat",
            "label": "查看整周",
            "message": f"查看{entity_name}第{q_week}周整周课表",
        })
    else:
        actions.append({
            "id": "schedule-week",
            "type": "sys.chat",
            "label": "查看整周",
            "message": f"查看{entity_name}的整周课表",
        })

    actions.append({
        "id": "schedule-day",
        "type": "sys.chat",
        "label": "换一天",
        "message": f"换一天看看{entity_name}的课表",
    })

    if entity_type == "room":
        actions.append({
            "id": "schedule-room-free",
            "type": "sys.chat",
            "label": "查空闲时段",
            "message": f"帮我找{entity_name}的空闲时段",
        })
    elif entity_type == "teacher":
        if q_week not in (None, "", 0) and q_weekday not in (None, "", 0):
            risk_scope = f"第{q_week}周{weekday_name(q_weekday)}"
        elif q_date:
            risk_scope = q_date
        else:
            risk_scope = "当前查询范围"
        actions.append({
            "id": "schedule-risk",
            "type": "sys.chat",
            "label": "检查风险",
            "message": f"检查{entity_name}{risk_scope}是否存在时间冲突或跨校区赶场",
        })
    else:
        actions.append({
            "id": "schedule-compare",
            "type": "sys.chat",
            "label": "比较冲突",
            "message": f"以{entity_name}为第一对象，继续选择另一个对象比较当前查询范围的课程冲突",
        })

    return {
        "route": "widget",
        "title": f"{entity_name} · 课表",
        "timeText": time_text,
        "queryId": s(body.get("queryId")),
        "dataVersion": s(body.get("dataVersion")),
        "summary": {
            "totalCount": len(items_all),
            "shownCount": min(len(items_all), 5),
            "hiddenCount": max(len(items_all) - 5, 0),
            "entityType": entity_type,
            "entityName": entity_name,
        },
        "items": items,
        "actions": actions[:3],
    }
