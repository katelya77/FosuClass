"""Primitive-only adapter for the deterministic Campus Overview Hero card."""


def main(params: dict) -> dict:
    body = params.get("tool_body") if isinstance(params, dict) else {}
    body = body if isinstance(body, dict) else {}

    def obj(value):
        return value if isinstance(value, dict) else {}

    def arr(value):
        return value if isinstance(value, list) else []

    def text(value, fallback="—"):
        value = str(value if value is not None else "").strip()
        return value or fallback

    def number(value):
        try:
            return int(value)
        except Exception:
            return 0

    def percent(value):
        try:
            return f"{float(value) * 100:.1f}%"
        except Exception:
            return "0.0%"

    def protocol(query, intent, **context):
        clean_query = str(query or "").replace("|", " ").replace("\n", " ").strip()
        parts = [f"query={clean_query}", f"intent={intent}"]
        for key in ("entityType", "entityName", "week", "weekday", "date"):
            value = context.get(key)
            if value not in (None, "", 0):
                parts.append(f"{key}={str(value).replace('|', ' ')}")
        return f"{clean_query}\n【小序ActionV2】" + "|".join(parts)

    empty = {
        "title": "小序 · 校园教学态势",
        "windowText": "等待核验",
        "phaseText": "暂无可展示的确定性指标",
        "verifiedText": "未核验",
        "weekCountText": "—", "lessonCountText": "—", "teacherCountText": "—",
        "roomCountText": "—", "campusCountText": "—",
        "campusALoadText": "—", "campusAFreeText": "—",
        "campusBLoadText": "—", "campusBFreeText": "—", "peakSlotText": "—",
        "teacher0Name": "—", "teacher0LoadText": "—",
        "teacher1Name": "—", "teacher1LoadText": "—",
        "teacher2Name": "—", "teacher2LoadText": "—",
        "conflictCountText": "—", "rushCountText": "—", "continuousLoadText": "—",
        "riskSummaryText": "指标未通过 CampusTools 核验，不展示推测值",
        "action0Label": "重新查看", "action0Message": protocol("重新查看校园教学态势", "campus_overview"),
        "action1Label": "查空教室", "action1Message": protocol("查找第1周校园空教室", "classroom_find", week=1),
        "action2Label": "查看课表", "action2Message": protocol("查看第1周校园课表", "schedule_week", week=1),
        "action3Label": "检查风险", "action3Message": protocol("检查第1周校园教学风险", "schedule_risk_check", week=1),
        "footerText": "RuntimeSafe V1 · 等待 CampusTools 核验",
    }
    for week in range(1, 5):
        for day in ("Mon", "Tue", "Wed", "Thu", "Fri"):
            empty[f"w{week}{day}Text"] = "—"

    evidence = obj(body.get("evidence"))
    if body.get("success") is not True or body.get("dataVersion") != "competition-demo-v1" or evidence.get("verified") is not True:
        return empty
    items = arr(body.get("items"))
    if not items or not isinstance(items[0], dict):
        return empty

    overview = obj(items[0])
    window = obj(overview.get("window"))
    preparation = obj(window.get("preparationPeriod"))
    summary = obj(overview.get("summary"))
    matrix = arr(overview.get("matrix"))
    campus = arr(overview.get("campusResources"))
    teachers = arr(overview.get("teacherLoadTop"))
    risks = obj(overview.get("risks"))
    peak = obj(overview.get("peakSlot"))

    output = dict(empty)
    output.update({
        "windowText": f"{text(window.get('windowStart'))} ～ {text(window.get('windowEnd'))}",
        "phaseText": f"{text(preparation.get('startDate'))}～{text(preparation.get('endDate'))} 准备期无教学安排 · {text(window.get('teachingStart'))} 起进入教学周",
        "verifiedText": "已核验 · competition-demo-v1",
        "weekCountText": f"{number(summary.get('weekCount'))} 个教学周",
        "lessonCountText": f"{number(summary.get('lessonOccurrences'))} 次课程",
        "teacherCountText": f"{number(summary.get('teacherCount'))} 位教师",
        "roomCountText": f"{number(summary.get('roomCount'))} 间空间",
        "campusCountText": f"{number(summary.get('campusCount'))} 个校区",
        "peakSlotText": f"高峰：第{number(peak.get('week'))}周{text(peak.get('weekdayName'))}第{number(peak.get('period'))}节 · {number(peak.get('lessonCount'))} 次课程",
        "conflictCountText": f"时间冲突 {number(risks.get('conflictCount'))}",
        "rushCountText": f"跨校区赶场 {number(risks.get('rushCount'))}",
        "continuousLoadText": f"连续课风险 {number(risks.get('continuousLoadCount'))}",
    })

    day_keys = ("Mon", "Tue", "Wed", "Thu", "Fri")
    for week_index, week_row in enumerate(matrix[:4], start=1):
        for day_index, day in enumerate(arr(obj(week_row).get("days"))[:5]):
            output[f"w{week_index}{day_keys[day_index]}Text"] = str(number(obj(day).get("lessonCount")))

    for index, item in enumerate(campus[:2]):
        item = obj(item)
        prefix = "campusA" if index == 0 else "campusB"
        output[f"{prefix}LoadText"] = (
            f"{text(item.get('campusName'))} · {number(item.get('lessonOccurrences'))} 次课程 · "
            f"占用率 {percent(item.get('occupancyRate'))}"
        )
        output[f"{prefix}FreeText"] = (
            f"可用教室时段 {number(item.get('freeRoomPeriodUnits'))} · "
            f"≥60人资源可用率 {percent(item.get('largeRoomAvailabilityRate'))}"
        )

    for index in range(3):
        item = obj(teachers[index]) if index < len(teachers) else {}
        output[f"teacher{index}Name"] = text(item.get("teacherName"))
        output[f"teacher{index}LoadText"] = (
            f"{number(item.get('lessonOccurrences'))} 次课程 · {number(item.get('periodUnits'))} 节次"
        )

    risk_teacher = text(obj(teachers[1] if len(teachers) > 1 else {}).get("teacherName"), "教师003")
    output["riskSummaryText"] = (
        f"共 {number(risks.get('rushCount'))} 个跨校区赶场、"
        f"{number(risks.get('continuousLoadCount'))} 个连续课负载；可从{risk_teacher}开始钻取"
    )
    top_teacher = text(obj(teachers[0] if teachers else {}).get("teacherName"), "教师002")
    output.update({
        "action0Label": "查看第1周",
        "action0Message": protocol("查看第1周校园课表", "schedule_week", week=1),
        "action1Label": "查空教室",
        "action1Message": protocol("查找第1周校园空教室", "classroom_find", week=1),
        "action2Label": "看教师负载",
        "action2Message": protocol(f"查看{top_teacher}第1周的课表", "schedule_week", entityType="teacher", entityName=top_teacher, week=1),
        "action3Label": "检查风险",
        "action3Message": protocol(f"检查{risk_teacher}第1周是否存在时间冲突或跨校区赶场", "schedule_risk_check", entityType="teacher", entityName=risk_teacher, week=1),
        "footerText": f"数据版本 competition-demo-v1 · 查询编号 {text(body.get('queryId'), '无')} · RuntimeSafe V1",
    })
    return output
