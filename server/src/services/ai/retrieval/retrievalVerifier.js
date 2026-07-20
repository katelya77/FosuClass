/**
 * Retrieval confidence and injection safety checks.
 */

const PROMPT_INJECTION_PATTERN = /(ignore\s+previous|system\s+prompt|developer\s+instruction|prompt\s+injection|忽略.*(规则|指令|系统)|泄露.*(prompt|提示)|覆盖.*(规则|指令))/i;

function verifyHits(hits = [], options = {}) {
  const list = Array.isArray(hits) ? hits : [];
  const minConfidence = Number(options.minConfidence || 0.15);
  const cleaned = list.filter((hit) => {
    const blob = `${hit.title || ""}\n${hit.excerpt || ""}`;
    if (PROMPT_INJECTION_PATTERN.test(blob)) return false;
    return true;
  });

  if (!cleaned.length) {
    return {
      ok: false,
      noAnswer: true,
      confidence: 0,
      hits: [],
      reason: "NO_RELIABLE_HIT",
    };
  }

  const top = cleaned[0];
  const confidence = Math.max(0, Math.min(1, Number(top.score) || 0));
  if (confidence < minConfidence) {
    return {
      ok: false,
      noAnswer: true,
      confidence,
      hits: cleaned.slice(0, 3),
      reason: "LOW_CONFIDENCE",
    };
  }

  return {
    ok: true,
    noAnswer: false,
    confidence,
    hits: cleaned,
    reason: "OK",
  };
}

module.exports = {
  verifyHits,
  PROMPT_INJECTION_PATTERN,
};
