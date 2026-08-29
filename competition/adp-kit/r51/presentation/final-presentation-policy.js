"use strict";

// Fail-safe presentation contract（Final Convergence）：
//   - 正常 Widget 支持环境 → mode=widget（返回同一 verified result-card projection）。
//   - Widget 不可渲染 / 校验失败 → mode=text，文本 fallback 必须从**同一** verified
//     result projection 确定性派生（标题/副标题/摘要/区块行），禁止模型重新编造事实，
//     禁止只输出占位句、裸 JSON、schema、版本号或内部协议。
//   - clarification / confirmation / static_knowledge / chat 不进入 Widget。
const { selectFinalOutcome } = require("../mission/final-outcome-selector.js");
const { buildTextFallback } = require("../../widget/native/campus-result-unified-v1/payload-validator.js");

const SAFE_FALLBACK = "当前结果暂时无法以卡片展示。";

function safeFallback(text) {
  if (typeof text !== "string" || !text.trim()) return SAFE_FALLBACK;
  if (/[{}]|queryId|dataHash|dataVersion|authorization|token|sourceTool|rankContext/i.test(text)) return SAFE_FALLBACK;
  return text.trim();
}

function validResultCard(card, validateResultCard) {
  if (!card || typeof card !== "object" || card.verified !== true) return false;
  if (typeof validateResultCard !== "function") return false;
  const validation = validateResultCard(card);
  return Boolean(validation && validation.ok === true);
}

// 从同一 projection 派生可读文本；只有确实派生不出业务内容时才回退到调用方提供的 fallbackText。
function fallbackFromProjection(card, fallbackText) {
  if (card && typeof card === "object" && !Array.isArray(card)) {
    const derived = buildTextFallback(card);
    if (typeof derived === "string" && derived.trim()) {
      const cleaned = safeFallback(derived);
      if (cleaned !== SAFE_FALLBACK) return cleaned;
    }
  }
  return safeFallback(fallbackText);
}

function selectFinalPresentation({
  responseClass,
  mission,
  capabilityToolMap,
  resultCards,
  resultCard,
  validateResultCard,
  fallbackText,
} = {}) {
  if (responseClass === "clarification" || responseClass === "confirmation") {
    return { mode: "clarify", selectedOutcome: null, resultCard: null, fallbackText: "" };
  }
  if (responseClass === "static_knowledge") {
    return { mode: "message", selectedOutcome: null, resultCard: null, fallbackText: "" };
  }
  if (responseClass !== "dynamic_result") {
    return { mode: "text", selectedOutcome: null, resultCard: null, fallbackText: safeFallback(fallbackText) };
  }

  const selectedOutcome = mission ? selectFinalOutcome(mission, capabilityToolMap || {}) : null;
  const selectedCard = selectedOutcome && resultCards
    ? resultCards[selectedOutcome.toolName]
    : resultCard;
  if (!validResultCard(selectedCard, validateResultCard)) {
    return {
      mode: "text",
      selectedOutcome,
      resultCard: null,
      fallbackText: fallbackFromProjection(selectedCard, fallbackText),
    };
  }
  return { mode: "widget", selectedOutcome, resultCard: selectedCard, fallbackText: "" };
}

module.exports = {
  SAFE_FALLBACK,
  safeFallback,
  fallbackFromProjection,
  validResultCard,
  selectFinalPresentation,
};
