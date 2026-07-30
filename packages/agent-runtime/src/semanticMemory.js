const crypto = require("crypto");

const VECTOR_DIMENSIONS = 64;
const ALIASES = Object.freeze({
  校区: ["campus", "仙溪", "江湾"],
  楼栋: ["building", "教学楼", "自习室", "空教室"],
  课表: ["schedule", "课程", "上课", "班级"],
  提醒: ["reminder", "提前", "分钟"],
  称呼: ["name", "名字", "叫我"],
  回答: ["answer", "回复", "简洁", "详细"],
});

function tokenizeSemantic(value) {
  const text = String(value == null ? "" : value).toLowerCase().normalize("NFKC");
  const tokens = new Set();
  (text.match(/[a-z0-9][a-z0-9_.-]*/g) || []).forEach((token) => tokens.add(token));
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

module.exports = {
  VECTOR_DIMENSIONS,
  cosineSimilarity,
  encodeSemanticVector,
  lexicalSimilarity,
  semanticScores,
  tokenizeSemantic,
};
