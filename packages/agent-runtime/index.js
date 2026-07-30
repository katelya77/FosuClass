const { createAgentRuntime } = require("./src/agentRuntime");
const {
  CONTEXT_SCHEMA_VERSION,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  SECTION_ORDER,
  createContextAssembler,
  estimateContextTokens,
} = require("./src/contextAssembler");
const {
  VECTOR_DIMENSIONS,
  cosineSimilarity,
  encodeSemanticVector,
  lexicalSimilarity,
  semanticScores,
  tokenizeSemantic,
} = require("./src/semanticMemory");

module.exports = Object.freeze({
  CONTEXT_SCHEMA_VERSION,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  SECTION_ORDER,
  VECTOR_DIMENSIONS,
  cosineSimilarity,
  createAgentRuntime,
  createContextAssembler,
  encodeSemanticVector,
  estimateContextTokens,
  lexicalSimilarity,
  semanticScores,
  tokenizeSemantic,
});
