def main(params: dict) -> dict:
    time_scope = str(params.get("time_scope") or "day").strip().lower()
    raw_week = params.get("week")
    raw_weekday = params.get("weekday")
    academic = params.get("academic_body") or {}

    def to_int(v):
        try:
            if v is None or v == "":
                return None
            return int(v)
        except Exception:
            return None

    week = to_int(raw_week)
    if week is not None and not 1 <= week <= 20:
        week = None

    weekday = to_int(raw_weekday)
    if weekday is not None and not 1 <= weekday <= 7:
        weekday = None

    p_start = to_int(params.get("period_start"))
    p_end = to_int(params.get("period_end"))
    # ADP 对可选 INT 的空值可能序列化为 0；无节次限制时使用 1-10 表示整日，避免 0-0 误过滤。
    if p_start is None or p_start < 1:
        p_start = 1
    if p_end is None or p_end < 1:
        p_end = 10

    items = academic.get("items") or []
    ctx = items[0] if isinstance(items, list) and items else {}
    academic_success = academic.get("success") is True
    in_semester = ctx.get("inSemester") is True

    # 显式“第N周”由业务工具直接校验；其余日期由 get_academic_context 确定性换算。
    query_date = ""
    query_week = None
    query_weekday = None

    if week is not None:
        query_week = week
        if time_scope == "week":
            query_weekday = None
        else:
            query_weekday = weekday
    elif academic_success and in_semester:
        if time_scope == "week" and ctx.get("week") is not None:
            query_week = to_int(ctx.get("week"))
            query_weekday = None
        else:
            query_date = str(ctx.get("resolvedDate") or "")
    else:
        # 让 query_schedule 返回结构化错误；不能伪造一个有效日期。
        query_date = str(ctx.get("resolvedDate") or "")

    if query_week is not None and query_weekday is None:
        transport_route = "WEEK"
    elif query_week is not None and query_weekday is not None:
        transport_route = "DAY"
    else:
        # 有效相对/绝对日期走独立 DATE Tool；无效日期也走 DATE Tool，
        # 由冻结 CampusTools 返回结构化错误，不能伪造 week/weekday。
        transport_route = "DATE"

    return {
        "transport_route": transport_route,
        "query_date": query_date,
        "query_week": query_week,
        "query_weekday": query_weekday,
        "period_start": p_start,
        "period_end": p_end,
        "academic_success": academic_success,
        "in_semester": in_semester,
        "resolved_date": str(ctx.get("resolvedDate") or ""),
        "resolved_week": to_int(ctx.get("week")),
        "resolved_weekday": to_int(ctx.get("weekday")),
    }
