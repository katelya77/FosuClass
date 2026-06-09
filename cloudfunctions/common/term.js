const TERM_ID_RE = /^\d{4}-\d{4}-[12]$/;

function normalizeTerm(value) {
  const term = String(value || "").trim();
  if (!TERM_ID_RE.test(term)) return "";
  const [startYear, endYear] = term.split("-").map(Number);
  return endYear === startYear + 1 ? term : "";
}

function resolveTerm(input) {
  const source = input || {};
  const term = normalizeTerm(source.term || source.semester || source.xnxqh || source.xnxq || "");
  if (!term) {
    const error = new Error("TERM_REQUIRED");
    error.code = "TERM_REQUIRED";
    throw error;
  }
  return term;
}

function termCachePart(value) {
  return normalizeTerm(value) || "unknown-term";
}

module.exports = {
  normalizeTerm,
  resolveTerm,
  termCachePart,
};
