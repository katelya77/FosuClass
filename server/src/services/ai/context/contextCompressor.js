/**
 * Context compression helpers — summary of history, slot extraction, strip noise.
 */

const safetyGuard = require("../safetyGuard");
const { estimateTokens, truncateToBudget } = require("./contextBudget");

function compressMessages(messages = [], maxMessages = 4, maxTokensPerMessage = 120) {
  const list = Array.isArray(messages) ? messages.slice(-maxMessages) : [];
  const out = [];
  let total = 0;
  list.forEach((msg) => {
    const role = msg.role === "assistant" ? "assistant" : "user";
    const cut = truncateToBudget(
      safetyGuard.redactSensitiveText(String(msg.content || msg.text || "")),
      maxTokensPerMessage
    );
    total += estimateTokens(cut.text);
    out.push({ role, content: cut.text, truncated: cut.truncated });
  });
  return { messages: out, tokenEstimate: total, compressionUsed: list.some((_, i) => out[i] && out[i].truncated) };
}

function summarizeSlots(slots = {}) {
  if (!slots || typeof slots !== "object") return "";
  const keys = ["campus", "building", "weekday", "period", "teacher", "course", "classroom", "q"];
  const parts = [];
  keys.forEach((key) => {
    if (slots[key] != null && String(slots[key]).trim()) {
      parts.push(`${key}=${safetyGuard.redactSensitiveText(String(slots[key])).slice(0, 40)}`);
    }
  });
  return parts.join("; ").slice(0, 200);
}

function compressToolResults(toolResults = [], maxTools = 6, maxSummary = 160) {
  const list = (Array.isArray(toolResults) ? toolResults : []).slice(0, maxTools);
  return list.map((item) => ({
    name: String(item.name || "").slice(0, 60),
    status: String(item.status || "").slice(0, 20),
    summary: safetyGuard.redactSensitiveText(String(item.summary || "")).slice(0, maxSummary),
    // never pass full result payloads to planner
  }));
}

function compressObservations(observations = [], max = 8) {
  return (Array.isArray(observations) ? observations : []).slice(0, max).map((o) => ({
    tool: String(o.tool || "").slice(0, 60),
    status: String(o.status || "").slice(0, 20),
    factCount: Number(o.factCount || 0) || 0,
    code: String(o.code || "").slice(0, 40),
    summary: safetyGuard.redactSensitiveText(String(o.summary || "")).slice(0, 80),
  }));
}

module.exports = {
  compressMessages,
  summarizeSlots,
  compressToolResults,
  compressObservations,
};
