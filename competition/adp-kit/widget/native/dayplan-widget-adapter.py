def main(params: dict) -> dict:
    body = params.get("tool_body") if isinstance(params, dict) else {}
    body = body if isinstance(body, dict) else {}

    def obj(value):
        return value if isinstance(value, dict) else {}

    def arr(value):
        return value if isinstance(value, list) else []

    empty = {
        "route": "fallback", "title": "", "subtitle": "", "timeText": "", "queryId": "",
        "dataVersion": "", "summary": {"lessonCount": 0, "gapCount": 0, "studySuggestionCount": 0, "hasCrossCampus": False},
        "items": [], "actions": [],
    }
    evidence = obj(body.get("evidence"))
    if body.get("success") is not True or body.get("dataVersion") != "competition-demo-v1" or evidence.get("verified") is not True:
        return empty
    items = []
    for value in arr(body.get("items")):
        source = obj(value)
        source_type = str(source.get("type") or "")
        item_type = "risk" if source_type in ("tip", "warning") else source_type
        if item_type not in ("lesson", "gap", "study", "risk"):
            item_type = "study"
        items.append({
            "type": item_type,
            "lessonId": str(source.get("lessonId") or ""),
            "courseName": str(source.get("courseName") or ""),
            "periodText": str(source.get("periodText") or ""),
            "startTime": str(source.get("startTime") or ""),
            "endTime": str(source.get("endTime") or ""),
            "campusName": str(source.get("campusName") or ""),
            "roomName": str(source.get("roomName") or ""),
            "teachers": [str(item) for item in arr(source.get("teachers"))],
            "suggestion": str(source.get("suggestion") or source.get("text") or ""),
            "studyRooms": [str(item) for item in arr(source.get("studyRooms"))],
        })
    query = obj(body.get("query"))
    resolved = obj(body.get("resolvedEntity"))
    summary = obj(body.get("summary"))
    lessons = [item for item in items if item["type"] == "lesson"]
    gaps = [item for item in items if item["type"] == "gap"]
    studies = [item for item in items if item["type"] == "study" or item["studyRooms"]]
    risks = [item for item in items if item["type"] == "risk"]
    return {
        "route": "widget", "title": "小序 · 今日校园计划",
        "subtitle": str(resolved.get("name") or "匿名演示用户"),
        "timeText": str(query.get("date") or ""), "queryId": str(body.get("queryId") or ""),
        "dataVersion": str(body.get("dataVersion") or ""),
        "summary": {
            "lessonCount": int(summary.get("lessonCount") or len(lessons)),
            "gapCount": len(gaps), "studySuggestionCount": len(studies),
            "hasCrossCampus": summary.get("hasCrossCampus") is True or bool(risks),
        },
        "items": items,
        "actions": [
            {"id": "dayplan-empty-room", "type": "sys.chat", "label": "找空教室", "message": "根据今天的空档查找合适的空教室"},
            {"id": "dayplan-change-date", "type": "sys.chat", "label": "换个日期", "message": "请重新选择校园计划日期"},
        ],
    }
