// ADR-0007：本地确定性 encoder 权威实现（deterministic-local-v2）。
//
// 一体化 / public 模式的向量基线：归一化词元 + CJK bigram + 稳定 hash 投影
// （sha256 前 4 字节取模）+ 固定维度 + L2 归一化。相同文本在任何进程、
// 机器、arm64/amd64 上产生相同向量（无进程随机 hash、无遍历顺序漂移）。
//
// 本文件是单一事实源：agent-runtime 的 semanticMemory（P3 记忆检索）与
// RAG 检索链共同消费，禁止复制第二份实现。tokenization（含别名表）属于
// encoder 语义的一部分：任何变化都会改变向量空间 → ENCODER_VERSION 递增
// 并触发索引重建（ADR-0007 §3）。
//
// v1 → v2（P4d golden query 实测驱动，ADR-0007 §8 修正案）：
// v1 的 latin 词元把尾随标点（"appearance."）与连字符复合词（"two-factor"）
// 整体胶合，且保留单字符噪声词元（"a"/"I"），对英文语料造成系统性误配。
// v2：latin 词元剥离首尾标点、连字符复合词追加拆分词元、丢弃无数字的
// 单字符词元；CJK run/bigram 与别名表逐位不变。v1 全部黄金值（CJK 与
// 干净 latin 输入）在 v2 下逐位保持——单源测试同时充当 v1→v2 稳定性证明。
//
// 质量口径：这是「离线检索基线」，不是神经语义 embedding 的等价物；
// 提升幅度以 golden query set 对照如实报告（ADR-0007 §5）。

const crypto = require("crypto");

const ENCODER_VERSION = "deterministic-local-v2";
const VECTOR_DIMENSIONS = 64;
const HASH_ALGORITHM = "sha256-u32be-mod";
const TOKENIZER = "nfkc-lower-alnum-cjkbigram-alias-v2";
const ALIASES = Object.freeze({
  校区: ["campus", "仙溪", "江湾"],
  楼栋: ["building", "教学楼", "自习室", "空教室"],
  课表: ["schedule", "课程", "上课", "班级"],
  提醒: ["reminder", "提前", "分钟"],
  称呼: ["name", "名字", "叫我"],
  回答: ["answer", "回复", "简洁", "详细"],
});

// v2 latin 词元：剥首尾标点；连字符复合词保留整体并追加拆分词元；
// 无数字的单字符词元（"a"/"I"）视为英语停用词噪声丢弃。
function addLatinTokens(text, tokens) {
  (text.match(/[a-z0-9][a-z0-9_.-]*/g) || []).forEach((raw) => {
    const token = raw.replace(/^[_.-]+|[_.-]+$/g, "");
    if (!token) return;
    if (token.length < 2 && !/\d/.test(token)) return;
    tokens.add(token);
    if (token.includes("-")) {
      token.split("-").forEach((part) => {
        if (part.length >= 2 || /\d/.test(part)) tokens.add(part);
      });
    }
  });
}

function tokenizeSemantic(value) {
  const text = String(value == null ? "" : value).toLowerCase().normalize("NFKC");
  const tokens = new Set();
  addLatinTokens(text, tokens);
  const cjkRuns = text.match(/[\u3400-\u9fff]+/g) || [];
  cjkRuns.forEach((run) => {
    if (run.length <= 4) tokens.add(run);
    for (let index = 0; index < run.length - 1; index += 1) tokens.add(run.slice(index, index + 2));
  });
  Object.entries(ALIASES).forEach(([root, aliases]) => {
    if (text.includes(root) || aliases.some((alias) => text.includes(alias))) {
      tokens.add(root);
      aliases.forEach((alias) => tokens.add(alias));
    }
  });
  return Array.from(tokens).slice(0, 128);
}

function featureIndex(token) {
  return crypto.createHash("sha256").update(String(token)).digest().readUInt32BE(0) % VECTOR_DIMENSIONS;
}

function encodeSemanticVector(value) {
  const vector = Array.from({ length: VECTOR_DIMENSIONS }, () => 0);
  tokenizeSemantic(value).forEach((token) => {
    vector[featureIndex(token)] += 1;
  });
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!norm) return vector;
  return vector.map((item) => Number((item / norm).toFixed(6)));
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return 0;
  const size = Math.min(left.length, right.length, VECTOR_DIMENSIONS);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    const a = Number(left[index] || 0);
    const b = Number(right[index] || 0);
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

function lexicalSimilarity(left, right) {
  const leftTokens = new Set(tokenizeSemantic(left));
  const rightTokens = new Set(tokenizeSemantic(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return overlap / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function semanticScores(query, document, storedVector) {
  const queryVector = encodeSemanticVector(query);
  return Object.freeze({
    lexical: Number(lexicalSimilarity(query, document).toFixed(6)),
    vector: Number(cosineSimilarity(queryVector, storedVector || encodeSemanticVector(document)).toFixed(6)),
  });
}

// 索引 manifest 描述：随每个 RAG 索引持久化，encoder 版本漂移必须触发重建。
function encoderManifest() {
  return Object.freeze({
    encoderType: ENCODER_VERSION,
    dimensions: VECTOR_DIMENSIONS,
    hashAlgorithm: HASH_ALGORITHM,
    tokenizer: TOKENIZER,
  });
}

module.exports = Object.freeze({
  ENCODER_VERSION,
  HASH_ALGORITHM,
  TOKENIZER,
  VECTOR_DIMENSIONS,
  cosineSimilarity,
  encodeSemanticVector,
  encoderManifest,
  lexicalSimilarity,
  semanticScores,
  tokenizeSemantic,
});
