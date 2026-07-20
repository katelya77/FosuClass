const { safeText, MAX_SUMMARY } = require("./conversationSchema");

function buildConversationSummary(input = {}) {
  const intent = safeText(input.intent || input.lastIntent || "", 80);
  const target = safeText(input.targetName || input.lastTargetName || input.q || "", 80);
  const week = input.week || input.lastWeek;
  const weekday = input.weekday || input.lastWeekday;
  const tool = safeText(input.toolSource || input.lastSource || "", 80);
  const parts = [];
  if (intent) parts.push(`最近任务 ${intent}`);
  if (target) parts.push(`对象 ${target}`);
  if (week) parts.push(`第${week}周`);
  if (weekday) parts.push(`周${weekday}`);
  if (tool) parts.push(`来源 ${tool}`);
  if (!parts.length) {
    return safeText(input.fallback || "用户进行了校园任务咨询。", MAX_SUMMARY);
  }
  return safeText(`${parts.join("，")}。`, MAX_SUMMARY);
}

function buildTitleFromMessage(message = "") {
  const text = safeText(message, 40).replace(/\s+/g, " ").trim();
  if (!text) return "新对话";
  return text.length >= 8 ? text : `任务：${text}`;
}

module.exports = {
  buildConversationSummary,
  buildTitleFromMessage,
};
