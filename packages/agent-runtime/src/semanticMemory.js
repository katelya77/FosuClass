// ADR-0007：encoder 权威实现已收敛到 packages/rag-runtime（单一事实源）。
// 本模块保持原有导出形状，委托同一实现——P3 记忆检索零回归由
// tools/test-agent-rag-encoder-single-source.js 的黄金值对照锁定。
const encoder = require("../../rag-runtime/src/localEncoder");

module.exports = {
  ENCODER_VERSION: encoder.ENCODER_VERSION,
  VECTOR_DIMENSIONS: encoder.VECTOR_DIMENSIONS,
  cosineSimilarity: encoder.cosineSimilarity,
  encodeSemanticVector: encoder.encodeSemanticVector,
  lexicalSimilarity: encoder.lexicalSimilarity,
  semanticScores: encoder.semanticScores,
  tokenizeSemantic: encoder.tokenizeSemantic,
};
