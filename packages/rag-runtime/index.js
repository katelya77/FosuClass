// packages/rag-runtime 公共出口（通用平台包，无任何校园业务耦合）。
const localEncoder = require("./src/localEncoder");
const textProcessing = require("./src/textProcessing");
const bm25 = require("./src/bm25");
const fusion = require("./src/fusion");
const ingestion = require("./src/ingestion");
const ragRuntime = require("./src/ragRuntime");
const { createRagPublicationAdapter, FORBIDDEN_DOCUMENT_KINDS } = require("./src/ragPublicationAdapter");

module.exports = Object.freeze({
  // localEncoder（ADR-0007 单源）
  ENCODER_VERSION: localEncoder.ENCODER_VERSION,
  VECTOR_DIMENSIONS: localEncoder.VECTOR_DIMENSIONS,
  encoderManifest: localEncoder.encoderManifest,
  encodeSemanticVector: localEncoder.encodeSemanticVector,
  cosineSimilarity: localEncoder.cosineSimilarity,
  tokenizeSemantic: localEncoder.tokenizeSemantic,
  // 文本处理 / 检索原语
  cleanText: textProcessing.cleanText,
  chunkDocument: textProcessing.chunkDocument,
  buildBm25Index: bm25.buildBm25Index,
  bm25Search: bm25.bm25Search,
  rrfFuse: fusion.rrfFuse,
  deterministicRerank: fusion.deterministicRerank,
  DEFAULT_RERANK_WEIGHTS: fusion.DEFAULT_RERANK_WEIGHTS,
  // 摄取
  ingestDocuments: ingestion.ingestDocuments,
  validateDocumentUri: ingestion.validateDocumentUri,
  INGEST_LIMITS: ingestion.INGEST_LIMITS,
  // 索引生命周期
  buildIndex: ragRuntime.buildIndex,
  queryIndex: ragRuntime.queryIndex,
  serializeIndex: ragRuntime.serializeIndex,
  parseIndex: ragRuntime.parseIndex,
  checkIndexCompatibility: ragRuntime.checkIndexCompatibility,
  RAG_INDEX_FORMAT: ragRuntime.RAG_INDEX_FORMAT,
  QUERY_MODES: ragRuntime.QUERY_MODES,
  UNSUPPORTED_VECTOR_HITS_ALLOWED: ragRuntime.UNSUPPORTED_VECTOR_HITS_ALLOWED,
  // 发布适配器
  createRagPublicationAdapter,
  FORBIDDEN_DOCUMENT_KINDS,
});
