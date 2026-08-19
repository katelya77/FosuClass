"use strict";
// R50.2B action-builder —— 官方 sys.chat Widget Action 构造器（2026-08-19）
//
// 规则：
//  - 只产出 { type: "sys.chat", payload: { query } }（Tencent Widget 官方协议）。
//  - query 必须是用户语义自然语言，重新进入 User Turn → Main → Child 路由；
//    禁止携带实体 ID / lessonId / NodeID / VarBizID / queryId / JSON 内部协议。
//  - 场景续接文案确定性生成（无随机、无模型），并做泄漏兜底校验。
const { isClean } = require("./envelope.js");

const FORBIDDEN_QUERY_PATTERNS = [
  /lessonid/i,
  /courseid/i,
  /roomid/i,
  /campusid/i,
  /entityid/i,
  /[\w-]+-[\w-]+/i,
  /queryid/i,
  /nodeid/i,
  /varbizid/i,
  /token/i,
  /authorization/i,
];

function cleanQuery(text) {
  return String(text).replace(/[\r\n]+/g, " ").trim();
}

function buildSysChatAction({ id, label, query }) {
  const cleaned = cleanQuery(query);
  if (!id || !label || !cleaned) {
    return { ok: false, errors: ["id/label/query 必填"], action: null };
  }
  for (const pattern of FORBIDDEN_QUERY_PATTERNS) {
    if (pattern.test(cleaned)) {
      return { ok: false, errors: [`query 含内部标识：${pattern.source}`], action: null };
    }
  }
  const action = {
    id: String(id),
    type: "sys.chat",
    label: String(label),
    payload: { query: cleaned },
  };
  const leak = isClean(action);
  if (!leak.ok) {
    return { ok: false, errors: ["action 泄漏内部字段"], action: null };
  }
  return { ok: true, errors: [], action };
}

/**
 * 按 variant 生成确定性续接动作（用户语义，无内部标识）。
 * raw 仅用于读取可公开展示的实体名称与周次文本。
 */
function buildFollowUpActions(variant, { raw, title } = {}) {
  const entityName = raw && raw.resolvedEntity && raw.resolvedEntity.name ? raw.resolvedEntity.name : "";
  const weekText = raw && raw.window && raw.window.weekStart
    ? raw.window.weekStart === raw.window.weekEnd
      ? `第${raw.window.weekStart}周`
      : `第${raw.window.weekStart}-${raw.window.weekEnd}周`
    : "";
  const scope = entityName ? `${entityName}` : "";
  const weekScope = weekText ? `${weekText}` : "";

  const plans = {
    schedule: [
      { id: "schedule-followup", label: "检查这周的风险", query: `检查${scope}${weekScope}是否存在时间冲突或跨校区赶场`.trim().replace(/检查$/, "检查课表") },
      { id: "schedule-week", label: "看下一个教学周", query: `查看${scope}第2周的课表`.trim() },
    ],
    space: [
      { id: "space-other-day", label: "换一天看看", query: "换一天再查空教室" },
      { id: "space-campus", label: "看另一个校区", query: "查看另一个校区的空教室" },
    ],
    collaboration: [
      { id: "collab-weekday", label: "只看工作日", query: "只看工作日的共同空闲时段" },
      { id: "collab-more", label: "再找更多时段", query: "多找几个共同空闲时段" },
    ],
    risk: [
      { id: "risk-resolve", label: "看看怎么调整", query: `针对冲突给出调课建议` },
      { id: "risk-other-week", label: "检查其他周", query: "检查另一个教学周的风险" },
    ],
    reschedule: [
      { id: "reschedule-simulate", label: "再模拟一个时段", query: `再模拟一个调课时段` },
      { id: "reschedule-execute", label: "怎么正式调课", query: "正式调课需要怎么操作" },
    ],
    ranking: [
      { id: "ranking-top1", label: "查看第1名的课表", query: `查看排名第1的${rankingSubject(raw)}的课表` },
      { id: "ranking-more", label: "看前5名", query: "查看前5名的排行" },
    ],
    overview: [
      { id: "overview-week", label: "查看第1周课表", query: "查看第1周校园课表" },
      { id: "overview-risk", label: "检查教学风险", query: "检查第1周校园教学风险" },
    ],
    empty: [
      { id: "empty-broaden", label: "扩大范围再试", query: "换一个教学周再查课表" },
    ],
    error: [
      { id: "error-retry", label: "重试", query: "再查一次" },
      { id: "error-rephrase", label: "换一种问法", query: "换一种问法查询" },
    ],
    message: [
      { id: "message-browse", label: "查看课表", query: `查看${scope}的课表`.trim() },
    ],
  };
  const candidates = plans[variant] || [];
  const actions = [];
  for (const candidate of candidates) {
    const built = buildSysChatAction(candidate);
    if (built.ok) actions.push(built.action);
  }
  return actions;
}

function rankingSubject(raw) {
  return raw && raw.summary && raw.summary.metric === "utilizationRate" ? "教室" : "教师";
}

module.exports = {
  buildSysChatAction,
  buildFollowUpActions,
  FORBIDDEN_QUERY_PATTERNS,
};