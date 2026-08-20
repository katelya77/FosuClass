"use strict";

const { selectFinalOutcome } = require("../mission/final-outcome-selector.js");

const SAFE_FALLBACK = "当前结果暂时无法以卡片展示。";

function safeFallback(text) {
  if (typeof text !== "string" || !text.trim()) return SAFE_FALLBACK;
  if (/[{}]|queryId|dataHash|dataVersion|authorization|token/i.test(text)) return SAFE_FALLBACK;
  return text.trim();
}

function validResultCard(card, validateResultCard) {
  if (!card || typeof card !== "object" || card.verified !== true) return false;
  if (typeof validateResultCard !== "function") return false;
  const validation = validateResultCard(card);
  return Boolean(validation && validation.ok === true);
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
      fallbackText: safeFallback(fallbackText),
    };
  }
  return { mode: "widget", selectedOutcome, resultCard: selectedCard, fallbackText: "" };
}

module.exports = { SAFE_FALLBACK, safeFallback, validResultCard, selectFinalPresentation };
