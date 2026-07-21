/**
 * Long-press / overflow message actions for 小佛助手.
 * Keeps action labels and share summary generation free of secrets.
 */

const SENSITIVE_RE = /(学号|密码|cookie|token|authorization|openid|手机号|身份证)/i;

function assistantActions() {
  return [
    { id: "copy", label: "复制" },
    { id: "regenerate", label: "重新回答" },
    { id: "followup", label: "继续追问" },
    { id: "share", label: "分享结果" },
    { id: "feedback", label: "反馈问题" },
  ];
}

function userActions() {
  return [
    { id: "copy", label: "复制" },
    { id: "resend", label: "重新发送" },
    { id: "edit", label: "编辑后发送" },
    { id: "delete", label: "删除本机记录" },
  ];
}

function feedbackReasons() {
  return [
    { id: "unresolved", label: "没解决" },
    { id: "stale", label: "结果过时" },
    { id: "misunderstood", label: "理解错误" },
  ];
}

function actionSheetItemList(role) {
  const list = role === "user" ? userActions() : assistantActions();
  return list.map((item) => item.label);
}

function actionByLabel(role, label) {
  const list = role === "user" ? userActions() : assistantActions();
  return list.find((item) => item.label === label) || null;
}

/**
 * Build a share-safe summary for campus fact cards.
 * Strips personal identifiers; refuses if content looks sensitive.
 */
function buildShareSummary(message) {
  const source = message || {};
  const content = String(source.content || "").trim();
  if (SENSITIVE_RE.test(content)) {
    return {
      ok: false,
      reason: "内容可能包含敏感信息，已取消分享",
    };
  }

  const cards = Array.isArray(source.displayCards)
    ? source.displayCards
    : (Array.isArray(source.cards) ? source.cards : []);

  let title = "小佛助手 · 校园结果";
  let lines = [];

  if (content) {
    lines.push(content.slice(0, 120));
  }

  const first = cards[0];
  if (first) {
    const type = String(first.type || first.typeClass || "");
    if (/schedule|course|today/i.test(type)) title = "小佛助手 · 今日课程";
    else if (/empty|room|classroom/i.test(type)) title = "小佛助手 · 空教室";
    else if (/weather/i.test(type)) title = "小佛助手 · 校园天气";
    else if (/week|teaching/i.test(type)) title = "小佛助手 · 教学周";
    else if (/recommend|study|composite/i.test(type)) title = "小佛助手 · 推荐方案";

    if (first.title) lines.push(String(first.title).slice(0, 40));
    if (first.subtitle) lines.push(String(first.subtitle).slice(0, 40));
  }

  const body = lines.filter(Boolean).join("\n").slice(0, 200);
  if (!body) {
    return { ok: false, reason: "暂无可分享内容" };
  }

  return {
    ok: true,
    title,
    summary: body,
    path: "/packageXiaofu/pages/ai-assistant/ai-assistant",
  };
}

module.exports = {
  assistantActions,
  userActions,
  feedbackReasons,
  actionSheetItemList,
  actionByLabel,
  buildShareSummary,
};
