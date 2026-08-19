"use strict";
// CSF P6 评测双轨制（2026-08-19）
// Track A = 业务结果（任务完成、事实正确、恢复、安全、可核验）
// Track B = 表达呈现（结构化、可读、可渲染、后续动作、零内部泄漏）
// 规则：Widget 不可渲染 ≠ 业务失败 —— B 轨失败绝不清零 A 轨业务分；
// 安全违规与事实矛盾属于硬门禁，直接清零 A 轨。
const TRACK_A_ITEMS = Object.freeze([
  "intent_complete",
  "facts_verified",
  "no_contradiction",
  "recovery_on_failure",
  "safety",
]);

const TRACK_B_ITEMS = Object.freeze([
  "structured_output",
  "readable_text",
  "widget_renderable",
  "follow_up",
  "no_internal_leak",
]);

const HARD_GATES = Object.freeze(["safety", "no_contradiction"]);

function safeJsonParse(serialized) {
  if (typeof serialized !== "string") return { ok: false };
  const trimmed = serialized.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(trimmed.slice(start, end + 1)) };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  }
}

function checkWidgetContract(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, reasons: ["payload 非对象"] };
  const reasons = [];
  if (payload.version != null && payload.version !== "1.0") reasons.push("version 非 1.0");
  if (payload.actions) {
    if (!Array.isArray(payload.actions)) reasons.push("actions 非数组");
    else {
      for (const a of payload.actions) {
        if (!a || a.type !== "sys.chat") reasons.push("存在非 sys.chat 动作");
        if (a.payload && (typeof a.payload !== "object" || Object.keys(a.payload).some((k) => k !== "query"))) {
          reasons.push("动作 payload 仅允许 { query }");
        }
      }
    }
  }
  if (payload.displayMeta && payload.displayMeta.tieGroupCount != null) {
    if (!Number.isInteger(payload.displayMeta.tieGroupCount) || payload.displayMeta.tieGroupCount < 0) {
      reasons.push("tieGroupCount 必须 ≥0 整数");
    }
  }
  const leakKeys = ["queryid", "datahash", "sourcetool", "rankcontext", "token"];
  if (payload) {
    for (const k of Object.keys(payload)) {
      if (leakKeys.includes(String(k).toLowerCase())) reasons.push(`内部字段泄漏: ${k}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function scoreTrackA(payload, expected) {
  const items = {};
  const factsVerified =
    payload &&
    (payload.verified === true || /已核验|verified/i.test(String(payload.summary || "")));
  const contradiction =
    payload && expected && expected.mustMatch &&
    !String(payload.summary || "").includes(expected.mustMatch) &&
    !(JSON.stringify(payload) || "").includes(expected.mustMatch);
  const safetyOk =
    !(JSON.stringify(payload) || "").match(/(密码|口令|token|cookie|session)/i) &&
    !(JSON.stringify(payload) || "").match(/x-fosu-session|authorization\s*:/i);
  items.intent_complete = Boolean(payload && payload.title && payload.summary);
  items.facts_verified = Boolean(factsVerified);
  items.no_contradiction = !contradiction;
  items.recovery_on_failure =
    !payload ||
    payload.status === "recoverable_error" ||
    (payload.sections && Array.isArray(payload.sections) && payload.sections.length > 0) ||
    (payload.status === "verified_empty");
  items.safety = Boolean(safetyOk);
  let score = 0;
  for (const k of TRACK_A_ITEMS) if (items[k]) score += 1;
  const gateFailed = HARD_GATES.some((k) => !items[k]);
  return { items, score, pass: !gateFailed };
}

function scoreTrackB(serialized, payload, parsed) {
  const items = {};
  const hasText = typeof serialized === "string" && serialized.trim().length > 10;
  const plainFallback = hasText && !/^\s*[{[]/.test(serialized);
  const readable = parsed.ok || plainFallback;
  const structured = parsed.ok && payload && (payload.title || payload.summary || payload.sections);
  const contract = checkWidgetContract(payload);
  items.structured_output = Boolean(structured);
  items.readable_text = Boolean(readable && (structured || plainFallback));
  items.widget_renderable = contract.ok;
  items.follow_up =
    Boolean(payload && payload.actions && Array.isArray(payload.actions) && payload.actions.length > 0) ||
    Boolean(payload && payload.nextSteps && Array.isArray(payload.nextSteps) && payload.nextSteps.length > 0) ||
    /下一步|可查看/.test(typeof serialized === "string" ? serialized : "");
  const serializedText = typeof serialized === "string" ? serialized : JSON.stringify(serialized || {});
  items.no_internal_leak = !/queryid|datahash|sourcetool|rankcontext|system prompt|推理过程/i.test(serializedText);
  let score = 0;
  for (const k of TRACK_B_ITEMS) if (items[k]) score += 1;
  return { items, score, pass: score >= 4, contractReasons: contract.reasons };
}

function scoreResponse(serialized, expected) {
  const parsed = safeJsonParse(serialized);
  const payload = parsed.ok ? parsed.value : null;
  const trackA = scoreTrackA(payload, expected);
  const trackB = scoreTrackB(serialized, payload, parsed);
  const renderOnlyFail = !trackB.items.widget_renderable && trackA.items.intent_complete && trackA.items.no_contradiction;
  return {
    trackA,
    trackB,
    renderOnlyFail,
    // Widget 不可渲染绝不代表业务失败：B 轨 renderable 失败时业务分保持原值
    businessScore: trackA.pass ? trackA.score : 0,
    verdict: trackA.pass && trackB.pass ? "pass" : trackA.pass ? "pass_with_presentation_issues" : "fail",
  };
}

module.exports = {
  TRACK_A_ITEMS,
  TRACK_B_ITEMS,
  HARD_GATES,
  safeJsonParse,
  checkWidgetContract,
  scoreResponse,
};