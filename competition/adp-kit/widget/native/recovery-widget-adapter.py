def main(params: dict) -> dict:
    body = params.get("tool_body") if isinstance(params, dict) else {}
    body = body if isinstance(body, dict) else {}

    def obj(value):
        return value if isinstance(value, dict) else {}

    def arr(value):
        return value if isinstance(value, list) else []

    evidence = obj(body.get("evidence"))
    if body.get("success") is True and body.get("dataVersion") == "competition-demo-v1" and evidence.get("verified") is True:
        return {"route": "primary", "title": "", "subtitle": "", "queryId": "", "dataVersion": "competition-demo-v1", "items": [], "error": {"code": "", "message": ""}, "actions": []}
    error = obj(body.get("error"))
    code = str(error.get("code") or "TOOL_FAILURE")
    details = obj(error.get("details"))
    candidates = arr(details.get("candidates")) or arr(details.get("suggestions"))
    base = {
        "title": "小序需要你确认一下", "subtitle": "选择后会继续刚才的校园任务",
        "queryId": str(body.get("queryId") or ""), "dataVersion": "competition-demo-v1",
        "items": [], "error": {"code": "", "message": ""},
        "actions": [{"id": "recovery-rephrase", "type": "sys.chat", "label": "重新描述", "message": "请重新描述刚才的校园任务"}],
    }
    if code == "AMBIGUOUS_ENTITY" and candidates:
        base["route"] = "choice"
        for index, value in enumerate(candidates[:8]):
            candidate = obj(value)
            name = str(candidate.get("name") or candidate.get("label") or "候选项")
            kind = str(candidate.get("type") or "entity")
            base["items"].append({
                "key": str(candidate.get("id") or f"candidate-{index + 1}"), "name": name, "type": kind,
                "description": str(candidate.get("description") or f"{kind} · {name}"),
                "action": {"id": f"choose-{index + 1}", "type": "sys.chat", "label": f"选择{name}", "message": f"使用{kind}“{name}”继续刚才的校园任务"},
            })
        return base
    base["route"] = "error"
    base["title"] = "小序暂时没能完成"
    base["subtitle"] = "你可以重试或补充条件"
    messages = {
        "MISSING_PARAM": "还缺少完成任务所需的条件。",
        "INVALID_PARAM": "部分条件无法识别，请调整后重试。",
        "ENTITY_NOT_FOUND": "没有找到对应的校园实体。",
        "TOOL_FAILURE": "校园工具暂时不可用，请稍后重试。",
    }
    base["error"] = {"code": code, "message": messages.get(code, "校园任务暂时无法完成，请稍后重试。")}
    base["actions"].insert(0, {"id": "recovery-retry", "type": "sys.chat", "label": "重试", "message": "请重试刚才的校园任务"})
    return base
