/**
 * Unified context assembly entry for Planner and Response paths.
 */

const { buildPlannerContext } = require("./plannerContextBuilder");
const { buildResponseContext } = require("./responseContextBuilder");
const { estimateTokens, getBudget } = require("./contextBudget");
const { compressMessages } = require("./contextCompressor");
const { buildToolCatalog } = require("./toolContextBuilder");

function assemble(kind, input = {}) {
  if (kind === "planner") {
    const ctx = buildPlannerContext(input);
    return {
      kind: "planner",
      ...ctx,
      toolCatalog: buildToolCatalog(input.availableTools || []),
    };
  }
  if (kind === "response") {
    return {
      kind: "response",
      ...buildResponseContext(input),
    };
  }
  // generic minimal
  const hist = compressMessages(input.messages || [], 4, 100);
  return {
    kind: "generic",
    sections: ["conversation"],
    truncatedSections: hist.compressionUsed ? ["conversation"] : [],
    contextTokenEstimate: hist.tokenEstimate,
    compressionUsed: hist.compressionUsed,
    messages: hist.messages,
  };
}

module.exports = {
  assemble,
  buildPlannerContext,
  buildResponseContext,
  estimateTokens,
  getBudget,
  buildToolCatalog,
};
