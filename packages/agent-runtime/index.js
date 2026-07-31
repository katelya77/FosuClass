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
const { canonicalJson, sha256Digest } = require("./src/configKernel/canonical");
const { createConfigKernel } = require("./src/configKernel/kernel");
const {
  REPOSITORY_METHODS,
  createConfigKernelFileRepository,
} = require("./src/configKernel/fileRepository");
const { runConfigKernelRepositoryConformance } = require("./src/configKernel/repositoryConformance");
const { createMemoryPolicyPublicationAdapter } = require("./src/memoryPolicyPublicationAdapter");

module.exports = Object.freeze({
  CONTEXT_SCHEMA_VERSION,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  REPOSITORY_METHODS,
  SECTION_ORDER,
  VECTOR_DIMENSIONS,
  canonicalJson,
  cosineSimilarity,
  createAgentRuntime,
  createConfigKernel,
  createConfigKernelFileRepository,
  createContextAssembler,
  createMemoryPolicyPublicationAdapter,
  encodeSemanticVector,
  estimateContextTokens,
  lexicalSimilarity,
  runConfigKernelRepositoryConformance,
  semanticScores,
  sha256Digest,
  tokenizeSemantic,
});
