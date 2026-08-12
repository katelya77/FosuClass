def main(params: dict) -> dict:
    body = params.get("tool_body") if isinstance(params, dict) else {}
    body = body if isinstance(body, dict) else {}
    academic = params.get("academic_body") if isinstance(params, dict) else {}
    academic = academic if isinstance(academic, dict) else {}
    scope = str(params.get("transport_scope") or "").strip().upper()

    def arr(value):
        return value if isinstance(value, list) else []

    def obj(value):
        return value if isinstance(value, dict) else {}

    def integer(value, lower, upper):
        if isinstance(value, bool) or value in (None, ""):
            return None
        text = str(value).strip()
        if not text.isdigit():
            return None
        parsed = int(text)
        return parsed if lower <= parsed <= upper else None

    def weekday_name(value):
        number = integer(value, 1, 7)
        names = ["一", "二", "三", "四", "五", "六", "日"]
        return f"周{names[number - 1]}" if number is not None else ""

    if scope not in ("WEEK", "DAY", "DATE"):
        return {"result": "查询范围未通过校验。", "status": "verification_failed", "verified": False}
    if body.get("success") is not True:
        error = obj(body.get("error"))
        code = str(error.get("code") or "TOOL_ERROR")
        message = str(error.get("message") or "查询工具暂时无法完成本次任务")
        return {
            "result": f"### 本次查询暂未通过工具校验\n错误码：`{code}`\n说明：{message}",
            "status": "tool_error",
            "verified": False,
        }

    evidence = obj(body.get("evidence"))
    version = str(body.get("dataVersion") or "")
    if version != "competition-demo-v1" or evidence.get("verified") is not True:
        return {"result": "查询结果未通过证据校验。", "status": "verification_failed", "verified": False}

    query = obj(body.get("query"))
    entity = obj(body.get("resolvedEntity"))
    name = str(entity.get("name") or params.get("entity_name") or "当前对象")
    items = arr(body.get("items"))
    week = integer(query.get("week"), 1, 20)
    weekday = integer(query.get("weekday"), 1, 7)
    date = str(query.get("date") or "")

    if scope == "WEEK":
        if week is None:
            return {"result": "教学周未通过校验。", "status": "verification_failed", "verified": False}
        scope_text = f"第{week}周 · 整周"
    elif scope == "DAY":
        if week is None or weekday is None:
            return {"result": "教学周或星期未通过校验。", "status": "verification_failed", "verified": False}
        scope_text = " · ".join(value for value in [f"第{week}周", weekday_name(weekday), date] if value)
    else:
        contexts = arr(academic.get("items"))
        context = obj(contexts[0]) if contexts else {}
        date = str(context.get("resolvedDate") or context.get("date") or date)
        week = integer(context.get("week"), 1, 20)
        weekday = integer(context.get("weekday"), 1, 7)
        if academic.get("success") is not True or context.get("inSemester") is not True or not date or week is None or weekday is None:
            return {"result": "日期教学上下文未通过校验。", "status": "verification_failed", "verified": False}
        scope_text = f"{date} · {weekday_name(weekday)} · 第{week}周"

    lines = [f"### {name} · 课表查询结果", f"查询范围：{scope_text}", ""]
    if not items:
        lines.extend(["没有查询到符合当前条件的课程。", "", f"核验：已通过 · 数据版本 `{version}`"])
        return {"result": "\n".join(lines), "status": "empty", "verified": True}
    for index, item in enumerate(items, 1):
        item = obj(item)
        lines.append(f"**{index}. {item.get('courseName') or '未命名课程'}**")
        item_time = " ".join(value for value in [
            str(item.get("date") or ""), str(item.get("weekdayName") or ""),
            str(item.get("periodText") or ""),
        ] if value)
        if item_time:
            lines.append(f"- 时间：{item_time}")
        place = " · ".join(value for value in [
            str(item.get("campusName") or ""), str(item.get("building") or ""),
            str(item.get("roomName") or ""),
        ] if value)
        if place:
            lines.append(f"- 地点：{place}")
        lines.append("")
    lines.append(f"核验：已通过 · 数据版本 `{version}` · `verified=true`")
    return {"result": "\n".join(lines).strip(), "status": "success", "verified": True}
