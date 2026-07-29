/**
 * Lightweight user-memory retrieval — keyword/entity rank, no vector DB.
 * Returns at most 5 items relevant to the current goal.
 */

const { isExpired } = require("./memoryPolicy");
const { normalizeWorkingMemory } = require("./workingMemory");

const MAX_RETRIEVE = 5;

function tokensFromText(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[\s,，。！？、；：:/\-_|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1)
    .slice(0, 24);
}

function scoreMemory(item, query = {}) {
  if (!item || isExpired(item)) return -1;
  let score = 0;
  const key = String(item.key || "");
  const value = String(item.value == null ? "" : item.value);
  const wm = normalizeWorkingMemory(query.workingMemory || {});
  const messageTokens = tokensFromText(query.message || query.goal || "");
  const goal = String(query.goal || query.intentName || "");

  // 1. Entity association with current conversation
  if (key === "campus" && (wm.campus || /校区|空教室|天气|自习|路线/.test(goal + (query.message || "")))) {
    score += 5;
  }
  if (key === "preferredBuilding" && /空教室|自习|教室|楼/.test(query.message || goal)) score += 4;
  if (key === "preferredClassName" && /课表|班级|有课/.test(query.message || goal)) score += 5;
  if (key === "preferredName" && /叫|名字|称呼/.test(query.message || "")) score += 6;
  if (key === "defaultReminderLeadMinutes" && /提醒|上课前/.test(query.message || goal)) score += 5;
  if (key === "preferPersonalSchedule" && /课表|有课|下一节/.test(query.message || goal)) score += 3;
  if (key === "answerDetailLevel") score += 1;
  if ((key === "college" || key === "major" || key === "grade") && /课表|班级|专业|学院|年级|推荐|课|培养/.test(query.message || goal)) score += 3;

  // 2. Explicit corrections
  if (item.correction || item.reasonCode === "user_correction") score += 4;

  // 3. Keyword overlap
  const blob = `${key} ${value}`.toLowerCase();
  messageTokens.forEach((tok) => {
    if (tok.length >= 2 && blob.includes(tok)) score += 1;
  });

  // 4. Recency
  const updated = Date.parse(item.updatedAt || item.expiresAt || 0);
  if (Number.isFinite(updated)) {
    const ageHours = (Date.now() - updated) / 3600000;
    if (ageHours < 24) score += 2;
    else if (ageHours < 168) score += 1;
  }

  // 5. Confidence
  score += Math.min(2, Number(item.confidence || 0) * 2);

  return score;
}

function retrieveUserMemories(userMemories = [], query = {}, limit = MAX_RETRIEVE) {
  const max = Math.min(MAX_RETRIEVE, Math.max(1, Number(limit) || MAX_RETRIEVE));
  const list = Array.isArray(userMemories) ? userMemories : [];
  return list
    .map((item) => ({ item, score: scoreMemory(item, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((row) => row.item);
}

module.exports = {
  MAX_RETRIEVE,
  scoreMemory,
  retrieveUserMemories,
  tokensFromText,
};
