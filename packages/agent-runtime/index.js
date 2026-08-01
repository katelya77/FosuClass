const { createAgentRuntime } = require("./src/agentRuntime");
const {
  CONTEXT_SCHEMA_VERSION,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  SECTION_ORDER,
  createContextAssembler,
  estimateContextTokens,
} = require("./src/contextAssembler");
const {
  ENCODER_VERSION,
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
const { createConfigKernelPgRepository } = require("./src/configKernel/pgRepository");
const { createMemoryPolicyPublicationAdapter } = require("./src/memoryPolicyPublicationAdapter");
const { AGENT_CORE_MIGRATIONS } = require("./src/persistence/agentCoreMigrations");
const { createMigrationRunner } = require("./src/persistence/migrations");
const {
  closePool,
  createPgPool,
  probe,
  query,
  withAdvisoryLock,
  withTransaction,
} = require("./src/persistence/pgClient");
const {
  ENGINE_CAPABILITY_KEYS,
  ENGINE_CONTRACT_VERSION,
  assertEngineCapability,
  createAgentEngine,
  engineTraceMetadata,
  isAgentEngine,
} = require("./src/engine/agentEngine");
const { createEngineRegistry } = require("./src/engine/engineRegistry");

module.exports = Object.freeze({
  AGENT_CORE_MIGRATIONS,
  CONTEXT_SCHEMA_VERSION,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  ENCODER_VERSION,
  ENGINE_CAPABILITY_KEYS,
  ENGINE_CONTRACT_VERSION,
  REPOSITORY_METHODS,
  SECTION_ORDER,
  VECTOR_DIMENSIONS,
  assertEngineCapability,
  canonicalJson,
  closePool,
  cosineSimilarity,
  createAgentEngine,
  createAgentRuntime,
  createConfigKernel,
  createConfigKernelFileRepository,
  createConfigKernelPgRepository,
  createContextAssembler,
  createEngineRegistry,
  createMemoryPolicyPublicationAdapter,
  createMigrationRunner,
  createPgPool,
  encodeSemanticVector,
  engineTraceMetadata,
  estimateContextTokens,
  isAgentEngine,
  lexicalSimilarity,
  probe,
  query,
  runConfigKernelRepositoryConformance,
  semanticScores,
  sha256Digest,
  tokenizeSemantic,
  withAdvisoryLock,
  withTransaction,
});
