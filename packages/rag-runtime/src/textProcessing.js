// 文本清洗与确定性切块（P4d）。
//
// 切块确定性是索引可重建、digest 可校验的前提：同一 (docId, text, 参数)
// 在任何进程/架构下必须产生完全相同的 chunk 序列与 chunkId。
// chunkId 形态：`${docId}#c${order}`（order 从 0 起）。

const DEFAULT_CHUNK_CHARS = 400;
const DEFAULT_CHUNK_OVERLAP = 60;
const MAX_CHUNK_CHARS = 2000;

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

// 清洗：NFKC、去控制字符（保留换行）、压缩空行、去零宽字符。有界截断由调用方负责。
function cleanText(raw) {
  return String(raw == null ? "" : raw)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[​‌‍⁠]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitParagraphs(text) {
  const paragraphs = String(text || "").split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.length ? paragraphs : (String(text || "").trim() ? [String(text).trim()] : []);
}

// 超长段落硬切（带重叠），窗口起点严格递增，保证终止与确定性。
function sliceLongParagraph(paragraph, maxChars, overlap) {
  const slices = [];
  let start = 0;
  while (start < paragraph.length) {
    const end = Math.min(paragraph.length, start + maxChars);
    slices.push(paragraph.slice(start, end));
    if (end >= paragraph.length) break;
    start = end - Math.min(overlap, Math.floor(maxChars / 2));
  }
  return slices;
}

/**
 * 段落感知切块：按空行分段后贪心装入 ≤ maxChars 的窗口；单段超长则带重叠硬切。
 * 返回 [{ chunkId, docId, title, text, order }]。空文本返回空数组（不发明内容）。
 */
function chunkDocument(input = {}, options = {}) {
  const docId = String(input.docId || "").trim();
  if (!docId) throw codedError("RAG_CHUNK_DOC_ID_REQUIRED");
  const maxChars = Math.min(MAX_CHUNK_CHARS, Math.max(100, Number(options.maxChars) || DEFAULT_CHUNK_CHARS));
  const overlap = Math.max(0, Math.min(Math.floor(maxChars / 2), Number(options.overlap) || DEFAULT_CHUNK_OVERLAP));
  const title = String(input.title || "").trim().slice(0, 240);
  const text = cleanText(input.text);
  if (!text) return [];

  const units = [];
  splitParagraphs(text).forEach((paragraph) => {
    if (paragraph.length <= maxChars) {
      units.push(paragraph);
    } else {
      sliceLongParagraph(paragraph, maxChars, overlap).forEach((piece) => units.push(piece));
    }
  });

  const chunks = [];
  let buffer = "";
  const flush = () => {
    const piece = buffer.trim();
    buffer = "";
    if (!piece) return;
    const order = chunks.length;
    chunks.push({ chunkId: `${docId}#c${order}`, docId, title, text: piece, order });
  };
  units.forEach((unit) => {
    if (!buffer) {
      buffer = unit;
      return;
    }
    if (buffer.length + unit.length + 2 <= maxChars) {
      buffer = `${buffer}\n\n${unit}`;
    } else {
      flush();
      buffer = unit;
    }
  });
  flush();
  return chunks;
}

module.exports = Object.freeze({
  DEFAULT_CHUNK_CHARS,
  DEFAULT_CHUNK_OVERLAP,
  MAX_CHUNK_CHARS,
  cleanText,
  chunkDocument,
});
