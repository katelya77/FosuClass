/**
 * Token budget tables for Planner / Response Composer / Retrieval.
 * Estimates are character-based (≈ 1 token per 2 CJK chars or 4 Latin chars).
 */

const BUDGETS = Object.freeze({
  planner: {
    total: 2200,
    system: 400,
    runtime: 200,
    conversation: 400,
    task: 400,
    tools: 450,
    workingMemory: 200,
    userMemories: 150,
    retrieved: 0,
  },
  response: {
    total: 4000,
    system: 500,
    runtime: 200,
    conversation: 900,
    task: 300,
    tools: 1200,
    retrieved: 600,
  },
  retrieval: {
    total: 800,
    query: 200,
    chunks: 600,
  },
});

function estimateTokens(text) {
  const s = String(text || "");
  if (!s) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 2 + other / 4);
}

function getBudget(kind = "response") {
  return Object.assign({}, BUDGETS[kind] || BUDGETS.response);
}

function truncateToBudget(text, maxTokens) {
  const raw = String(text || "");
  if (estimateTokens(raw) <= maxTokens) return { text: raw, truncated: false };
  // rough cut: 2 chars per token for mixed CJK
  const maxChars = Math.max(40, maxTokens * 2);
  return {
    text: `${raw.slice(0, maxChars)}…`,
    truncated: true,
  };
}

module.exports = {
  BUDGETS,
  estimateTokens,
  getBudget,
  truncateToBudget,
};
