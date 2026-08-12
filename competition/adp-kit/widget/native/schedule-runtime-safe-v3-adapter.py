def main(params: dict) -> dict:
    def obj(v):
        return v if isinstance(v, dict) else {}

    params = obj(params)
    body = obj(params.get("tool_body"))
    expected_version = "competition-demo-v1"
    total_weeks = 20

    def arr(v):
        return v if isinstance(v, list) else []

    def s(v):
        return str(v or "")

    def bounded_int(v, lower, upper):
        if isinstance(v, bool) or v in (None, ""):
            return None
        text = str(v).strip()
        if not text.isdigit():
            return None
        value = int(text)
        return value if lower <= value <= upper else None

    def weekday_name(v):
        n = bounded_int(v, 1, 7)
        names = ["一", "二", "三", "四", "五", "六", "日"]
        return f"周{names[n-1]}" if n is not None else ""

    def location_text(item):
        return " · ".join([
            x for x in [
                s(item.get("campusName")),
                s(item.get("building")),
                s(item.get("roomName")),
            ] if x
        ])

    def meta_text(item):
        time_text = ""
        if s(item.get("startTime")) and s(item.get("endTime")):
            time_text = f"{s(item.get('startTime'))}-{s(item.get('endTime'))}"
        teachers = "、".join([s(x) for x in arr(item.get("teachers")) if s(x)])
        classes = "、".join([s(x) for x in arr(item.get("classes")) if s(x)])
        return " · ".join([x for x in [time_text, teachers, classes] if x])

    def schedule_message(entity_name, week, weekday=None):
        if weekday is None:
            return f"查询{entity_name}第{week}周的课表"
        return f"查询{entity_name}第{week}周{weekday_name(weekday)}的课"

    def next_teaching_day(week, weekday):
        if weekday < 7:
            return week, weekday + 1, f"看{weekday_name(weekday + 1)}"
        if week < total_weeks:
            return week + 1, 1, "看下周一"
        # 学期最后一周周日不越界：固定回退到最后一周周六。
        return week, 6, "看周六"

    def build_actions(entity_type, entity_name, week, weekday):
        if entity_type not in ("teacher", "room", "class", "course") or not entity_name:
            return None
        if week is None:
            return None

        if weekday is None:
            target_days = [1, 3, 5]
            return [
                {
                    "label": f"看{weekday_name(day)}",
                    "message": schedule_message(entity_name, week, day),
                }
                for day in target_days
            ]

        next_week, next_weekday, next_label = next_teaching_day(week, weekday)
        actions = [
            {
                "label": "查看整周",
                "message": schedule_message(entity_name, week),
            },
            {
                "label": next_label,
                "message": schedule_message(entity_name, next_week, next_weekday),
            },
        ]

        if entity_type == "teacher":
            actions.append({
                "label": "检查风险",
                "message": (
                    f"检查{entity_name}第{week}周{weekday_name(weekday)}"
                    "是否存在时间冲突或跨校区赶场"
                ),
            })
        else:
            actions.append({
                "label": "看周一",
                "message": schedule_message(entity_name, week, 1),
            })
        return actions

    evidence = obj(body.get("evidence"))
    items_all = arr(body.get("items"))
    ready = (
        body.get("success") is True
        and s(body.get("dataVersion")) == expected_version
        and evidence.get("verified") is True
        and len(items_all) > 0
    )

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
    if not ready:
        return empty

    entity = obj(body.get("resolvedEntity"))
    query = obj(body.get("query"))
    entity_name = s(entity.get("name")).strip()
    entity_type = s(entity.get("type")).strip()
    data_version = s(body.get("dataVersion"))
    query_id = s(body.get("queryId"))

    q_week = bounded_int(query.get("week"), 1, total_weeks)
    raw_weekday = query.get("weekday")
    q_weekday = None if raw_weekday in (None, "") else bounded_int(raw_weekday, 1, 7)
    if q_week is None or (raw_weekday not in (None, "") and q_weekday is None):
        return empty

    actions = build_actions(entity_type, entity_name, q_week, q_weekday)
    if not actions or len(actions) != 3:
        return empty

    q_date = s(query.get("date"))
    time_parts = [f"第{q_week}周"]
    wd = weekday_name(q_weekday)
    if wd:
        time_parts.append(wd)
    if q_date:
        time_parts.append(q_date)

    item0 = items_all[0] if len(items_all) > 0 and isinstance(items_all[0], dict) else {}
    item1 = items_all[1] if len(items_all) > 1 and isinstance(items_all[1], dict) else {}
    shown = 2 if len(items_all) >= 2 else 1

    return {
        "route": "widget",
        "title": f"{entity_name} · 课表",
        "timeText": " · ".join(time_parts),
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
