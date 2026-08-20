"""CampusResultUnified V8 adapter — 小序-校园智序结果卡（Campus Canvas，ADP 导入侧投影）。

输入必须是已经过服务端 envelope.js / variant-adapters.js / view-model.js 投影的
CampusResultEnvelope + WidgetViewModel（仅含公开展示字段）。本适配器只做形状核对
与内部字段剥离，不补全、不编造任何校园事实；发现内部协议字段时 fail closed
（返回空结果并标记 route=fallback）。

稳定化要点（fosuclass-adp-widget-contract/v8）：
- version 由本适配器确定性注入 "1.0"，不接收模型生成的研发版本号（缺省合法）；
- week-board 空日统一过滤（SSOT：投影层过滤空日，Widget 不接收空日）；
- tieGroupCount 无并列时省略；出现时必须为至少 1 的整数；
- 动作仅 sys.chat，payload 仅 { query }。

布局规则（与 r50.2/widget/view-model.js 一致）：
- layoutMode=week-board：整周/周范围课表；消费 weekBoardTitle / weekBoardSubtitle / days
  （days[i].label 对应 day0Label~day6Label 语义，blocks 为每日课程块）；
- layoutMode=result-card：风险 / 空教室 / 态势 / TopN / 调课模拟 / 空结果 / 错误 /
  单日明细等；消费 sections 结果卡字段。
- fail closed：week-board 请求但 days 清洗后为空 / 结构损坏 → 回退 layoutMode=result-card，
  仍保留 Envelope 事实内容（sections 兜底展示）。

与 schedule-rich-v4 的区别：本卡只消费 Envelope + ViewModel 公开字段，
payload 只含用户语义 query（官方 sys.chat），不携带意图标签/实体标识/
查询编号/节点标识/业务标识等内部标识。

设计约束：
- 禁止泄漏：查询编号 / 数据哈希 / 数据版本 / 来源工具 / 排名上下文 /
  时间上下文 / 节点标识 / 业务标识 / 令牌 / 授权信息 / 内部地址。
- WidgetID 只使用用户提供的真实腾讯 ADP 导出 ID，禁止生成或猜测。
"""

import json


ROUTE_WIDGET = "widget"
ROUTE_FALLBACK = "fallback"
WIDGET_ID = "601418106a374b2eb7de54c65a3de7e0"


ALLOWED_TOP_LEVEL = {
    "version",
    "variant",
    "status",
    "title",
    "subtitle",
    "verified",
    "summary",
    "context",
    "sections",
    "actions",
    "displayMeta",
    "layoutMode",
    "weekBoardTitle",
    "weekBoardSubtitle",
    "days",
}

ALLOWED_LAYOUT_MODES = {"result-card", "week-board"}

DAY_LABELS = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")

FORBIDDEN_SUBSTRINGS = (
    "queryid",
    "datahash",
    "dataversion",
    "sourcetool",
    "rankcontext",
    "temporalcontext",
    "nodeid",
    "varbizid",
    "authorization",
    "token",
    "secret",
    "credential",
    "password",
    "evidence",
    "computedat",
    "internalurl",
)

ALLOWED_VARIANTS = {
    "schedule",
    "space",
    "collaboration",
    "risk",
    "reschedule",
    "ranking",
    "overview",
    "empty",
    "error",
    "message",
}

ALLOWED_STATUS = {"success", "empty", "error"}
ALLOWED_SECTION_KINDS = {
    "metric",
    "timeline",
    "route",
    "recommendation",
    "ranking",
    "comparison",
    "entity-list",
    "notice",
    "prose",
}


def _object(value):
    return value if isinstance(value, dict) else {}


def _array(value):
    return value if isinstance(value, list) else []


def _text(value):
    return str(value or "")


VALUE_INTERNAL_MARKERS = (
    "queryid=",
    "queryid:",
    "datahash",
    "dataversion",
    "sourcetool",
    "rankcontext",
    "temporalcontext",
    "nodeid=",
    "nodeid:",
    "varbizid",
    "authorization:",
    "bearer ",
    "sk-",
    "internal.",
    "localhost",
    "127.0.0.1",
    "/api/",
)


def _has_internal_keys(node):
    """递归检查键名或字符串值是否含内部协议标记（fail closed）。"""
    if isinstance(node, dict):
        for key, value in node.items():
            if any(token in str(key).lower() for token in FORBIDDEN_SUBSTRINGS):
                return True
            if _has_internal_keys(value):
                return True
    elif isinstance(node, list):
        return any(_has_internal_keys(item) for item in node)
    elif isinstance(node, str):
        lowered = node.lower()
        return any(token in lowered for token in VALUE_INTERNAL_MARKERS)
    return False


def _clean_rows(rows):
    out = []
    for raw in _array(rows):
        row = _object(raw)
        label = _text(row.get("label"))
        value = _text(row.get("value"))
        if not label or not value:
            continue
        item = {"label": label, "value": value}
        badge = _text(row.get("badge"))
        hint = _text(row.get("hint"))
        if badge:
            item["badge"] = badge
        if hint:
            item["hint"] = hint
        out.append(item)
    return out


def _clean_sections(sections):
    if not isinstance(sections, list):
        return None
    out = []
    for raw in sections:
        if not isinstance(raw, dict) or not set(raw).issubset({"title", "kind", "note", "rows"}):
            return None
        section = raw
        title = _text(section.get("title"))
        raw_rows = section.get("rows")
        if not title or not isinstance(raw_rows, list):
            return None
        for row in raw_rows:
            if (
                not isinstance(row, dict)
                or not set(row).issubset({"label", "value", "badge", "hint"})
                or not _text(row.get("label"))
                or not _text(row.get("value"))
            ):
                return None
        rows = _clean_rows(raw_rows)
        item = {"title": title, "rows": rows}
        kind = section.get("kind")
        if kind is not None:
            if kind not in ALLOWED_SECTION_KINDS:
                return None
            item["kind"] = kind
        note = _text(section.get("note"))
        if note:
            item["note"] = note
        out.append(item)
    return out


def _clean_actions(actions):
    out = []
    for raw in _array(actions):
        action = _object(raw)
        action_type = _text(action.get("type"))
        label = _text(action.get("label"))
        payload = _object(action.get("payload"))
        query = _text(payload.get("query"))
        if action_type != "sys.chat" or not label or not query:
            continue
        out.append(
            {
                "id": _text(action.get("id")) or f"action-{len(out) + 1}",
                "type": "sys.chat",
                "label": label,
                "payload": {"query": query},
            }
        )
    return out


def _clean_display_meta(meta):
    meta = _object(meta)
    out = {}
    for key in ("simulated", "weekendMarked", "recoverable"):
        if isinstance(meta.get(key), bool):
            out[key] = meta[key]
    tie_note = _text(meta.get("tieNote"))
    if tie_note:
        out["tieNote"] = tie_note
    tie_count = meta.get("tieGroupCount")
    if isinstance(tie_count, int) and not isinstance(tie_count, bool) and tie_count >= 1:
        out["tieGroupCount"] = tie_count
    return out


def _clean_blocks(blocks):
    out = []
    for raw in _array(blocks):
        block = _object(raw)
        time = _text(block.get("time"))
        title = _text(block.get("title"))
        location = _text(block.get("location"))
        if not time or not title or not location:
            continue
        item = {"time": time, "title": title, "location": location}
        meta = _text(block.get("meta"))
        if meta:
            item["meta"] = meta
        out.append(item)
    return out


def _clean_days(days):
    out = []
    for raw in _array(days):
        day = _object(raw)
        label = _text(day.get("label"))
        if label not in DAY_LABELS:
            continue
        blocks = _clean_blocks(day.get("blocks"))
        if not blocks:
            continue
        out.append({"label": label, "blocks": blocks})
    return out


def main(params: dict) -> dict:
    params = _object(params)
    envelope = _object(params.get("envelope"))
    if not envelope or _has_internal_keys(envelope):
        return {"route": ROUTE_FALLBACK, "widgetId": None, "data": None}
    variant = _text(envelope.get("variant"))
    status = _text(envelope.get("status"))
    title = _text(envelope.get("title"))
    summary = _text(envelope.get("summary"))
    if (
        variant not in ALLOWED_VARIANTS
        or status not in ALLOWED_STATUS
        or not title
        or not summary
        or envelope.get("version", "1.0") != "1.0"
    ):
        return {"route": ROUTE_FALLBACK, "widgetId": None, "data": None}
    sections = _clean_sections(envelope.get("sections"))
    if sections is None:
        return {"route": ROUTE_FALLBACK, "widgetId": None, "data": None}
    data = {
        "version": "1.0",
        "variant": variant,
        "status": status,
        "title": title,
        "subtitle": _text(envelope.get("subtitle")),
        "verified": envelope.get("verified") is True,
        "summary": summary,
        "context": _text(envelope.get("context")),
        "sections": sections,
        "actions": _clean_actions(envelope.get("actions")),
        "displayMeta": _clean_display_meta(envelope.get("displayMeta")),
    }
    requested_layout = _text(envelope.get("layoutMode"))
    days = _clean_days(envelope.get("days"))
    if requested_layout in ALLOWED_LAYOUT_MODES:
        data["layoutMode"] = requested_layout
        data["weekBoardTitle"] = _text(envelope.get("weekBoardTitle"))
        data["weekBoardSubtitle"] = _text(envelope.get("weekBoardSubtitle"))
        data["days"] = days
        if requested_layout == "week-board" and (not data["weekBoardTitle"] or not days):
            data["layoutMode"] = "result-card"
            data["weekBoardTitle"] = ""
            data["weekBoardSubtitle"] = ""
            data["days"] = []
    else:
        data["layoutMode"] = "result-card"
        data["weekBoardTitle"] = ""
        data["weekBoardSubtitle"] = ""
        data["days"] = []
    return {"route": ROUTE_WIDGET, "widgetId": WIDGET_ID, "data": data}


if __name__ == "__main__":
    import sys

    raw = sys.stdin.buffer.read().decode("utf-8") if not sys.stdin.isatty() else ""
    payload = json.loads(raw) if raw else {}
    sys.stdout.buffer.write(json.dumps(main(payload), ensure_ascii=False).encode("utf-8"))
