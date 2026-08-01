// 受控摄取（P4d）：inline 文本 + 受控网页抓取。
//
// 安全不变量：
// - URI 仅 https 公网主机：拒 userinfo / IP 字面量 / localhost / .local / 尾点混淆；
// - 抓取全程可注入 fetcher（测试不触网）；重定向 ≤3 次且每跳重新校验；
// - 响应 ≤512KB、≤10s、仅文本类 Content-Type；HTML 用确定性基线剥离器转文本；
// - 结构化校园事实 kind 永远拒绝（负向测试锁定：课表/教室/教师/教学周等
//   事实只能走 Tool，不得经摄取进入知识索引，AGENTS.md 事实源铁律）；
// - 已知边界：URL 校验不做 DNS 解析后 IP 归属检查（DNS rebinding 到内网
//   不在一体化模式防护范围，证据文档如实声明；standalone 部署可在出口代理层补）。

const crypto = require("crypto");
const { cleanText } = require("./textProcessing");

const INGEST_LIMITS = Object.freeze({
  maxDocuments: 200,
  maxInlineChars: 20000,
  maxFetchBytes: 512 * 1024,
  fetchTimeoutMs: 10000,
  maxRedirects: 3,
  maxTitleChars: 120,
  maxTags: 8,
  maxTagChars: 24,
});

// 结构化校园事实 kind（禁摄取）。这是通用领域词表，不含任何特定机构名称。
const FORBIDDEN_DOCUMENT_KINDS = Object.freeze([
  "schedule",
  "course_schedule",
  "personal_schedule",
  "classroom",
  "empty_classroom",
  "teacher",
  "course",
  "teaching_week",
  "school_calendar",
  "exam",
  "score",
]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

// https 公网 URL 校验（与 provider/mcp 同规则族）：拒 userinfo，主机去尾点，
// 禁 IP 字面量 / localhost / .local / IPv6。返回归一化 { url, host } 或 null。
function parsePublicHttpsUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (_) {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = String(url.hostname || "").replace(/\.+$/, "").toLowerCase();
  if (!host || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === "localhost" || host.endsWith(".local")) return null;
  if (host.includes(":")) return null;
  return { url: url.toString(), host };
}

function validateDocumentUri(value) {
  const parsed = parsePublicHttpsUrl(value);
  if (!parsed) {
    return { ok: false, error: "uri must be a public https URL (no userinfo/IP literal/localhost)" };
  }
  return { ok: true, url: parsed.url, host: parsed.host };
}

// 确定性基线 HTML→文本：去 script/style/注释 → 标签折空白 → 常见实体解码 →
// 空白压缩。不是完整可读性抽取（无 cheerio 依赖）；作为摄取基线如实记录。
function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function isTextualContentType(value) {
  const type = String(value || "").toLowerCase();
  return !type
    || type.startsWith("text/")
    || type.includes("json")
    || type.includes("markdown")
    || type.includes("xml")
    || type.includes("html");
}

async function defaultFetch(url, options = {}) {
  if (typeof fetch !== "function") {
    throw codedError("RAG_FETCH_UNAVAILABLE", "global fetch is not available in this runtime");
  }
  // AbortController 由调用方（fetchDocumentText）持有：单跳时限覆盖
  // 响应头等待 + body 读取全程。无外部 signal 时退回本地 header 时限。
  let signal = options.signal;
  let controller = null;
  let timer = null;
  if (!signal) {
    controller = new AbortController();
    signal = controller.signal;
    timer = setTimeout(() => controller.abort(), options.timeoutMs || INGEST_LIMITS.fetchTimeoutMs);
  }
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual", // 重定向由调用方逐跳校验，禁止 fetch 内部自动跟随
      signal,
      headers: { "user-agent": "agent-platform-rag-ingestion/0.1", accept: "text/*,application/json,application/markdown" },
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBoundedBody(response, maxBytes, options = {}) {
  const signal = options.signal;
  const assertNotAborted = () => {
    if (signal && signal.aborted) throw codedError("RAG_INGEST_TIMEOUT", "body read exceeded the fetch deadline");
  };
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw codedError("RAG_INGEST_TOO_LARGE");
    assertNotAborted();
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    assertNotAborted();
    const { done, value } = await reader.read();
    if (done) break;
    received += value ? value.byteLength : 0;
    if (received > maxBytes) {
      try { await reader.cancel(); } catch (_) { /* 忽略取消失败 */ }
      throw codedError("RAG_INGEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  // 收尾再查：abort 后对端正常 close 的竞态（done 先于下一次循环顶检查
  // 到达）同样按超时归类——本跳已超出总时限。
  assertNotAborted();
  return Buffer.concat(chunks.map((piece) => Buffer.from(piece))).toString("utf8");
}

// 受控抓取：逐跳校验重定向；返回清洗后文本。所有失败抛 codedError，由调用方归类。
// 时限语义：每一跳一个总时限（fetchTimeoutMs），经 AbortController 贯穿
// 响应头等待与 body 读取——慢滴 body 不再能永久挂住构建队列。边界如实说明：
// 挂死（永不 resolve）的 body 只在 fetcher 尊重 signal 时可被打断（默认
// defaultFetch 走 undici，signal 生效）；注入的测试 fetcher 至少受
// 逐 chunk aborted 检查约束（慢滴场景覆盖）。
async function fetchDocumentText(uri, options = {}) {
  const fetcher = options.fetcher || defaultFetch;
  const maxBytes = options.maxFetchBytes || INGEST_LIMITS.maxFetchBytes;
  const timeoutMs = options.fetchTimeoutMs || INGEST_LIMITS.fetchTimeoutMs;
  let current = validateDocumentUri(uri);
  if (!current.ok) throw codedError("RAG_INGEST_URL_INVALID", current.error);
  for (let hop = 0; hop <= INGEST_LIMITS.maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(current.url, { timeoutMs, signal: controller.signal });
      const status = Number(response && response.status) || 0;
      if (status >= 300 && status < 400) {
        if (hop >= INGEST_LIMITS.maxRedirects) throw codedError("RAG_INGEST_REDIRECT_LIMIT");
        const location = response.headers && typeof response.headers.get === "function"
          ? response.headers.get("location")
          : "";
        const next = parsePublicHttpsUrl(new URL(String(location || ""), current.url).toString());
        if (!next) throw codedError("RAG_INGEST_REDIRECT_INVALID", "redirect target failed public https validation");
        current = next;
        continue;
      }
      if (status !== 200) throw codedError("RAG_INGEST_HTTP_ERROR", `unexpected status ${status}`);
      const contentType = response.headers && typeof response.headers.get === "function"
        ? response.headers.get("content-type")
        : "";
      if (!isTextualContentType(contentType)) throw codedError("RAG_INGEST_CONTENT_TYPE", `unsupported content-type: ${contentType}`);
      const raw = await readBoundedBody(response, maxBytes, { signal: controller.signal });
      const text = /html/i.test(String(contentType || "")) ? htmlToText(raw) : cleanText(raw);
      const cleaned = cleanText(text);
      if (!cleaned) throw codedError("RAG_INGEST_EMPTY");
      return cleaned.slice(0, INGEST_LIMITS.maxInlineChars * 4);
    } catch (error) {
      // 超时可分类（AbortError 无 code，统一映射为 RAG_INGEST_TIMEOUT）。
      if (controller.signal.aborted || (error && error.name === "AbortError")) {
        throw codedError("RAG_INGEST_TIMEOUT", `fetch exceeded ${timeoutMs}ms (headers or body)`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw codedError("RAG_INGEST_REDIRECT_LIMIT");
}

function contentHashOf(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 32);
}

/**
 * 摄取一组声明式文档 → 归一化可索引文档。
 * 输入 doc: { docId, title, kind?, text? | uri?, tags? }（text/uri 二选一）。
 * 返回 { documents, failures }：单文档失败不拖垮整批，failure 带 errorClass。
 */
async function ingestDocuments(docs = [], options = {}) {
  const list = Array.isArray(docs) ? docs : [];
  if (list.length > INGEST_LIMITS.maxDocuments) {
    throw codedError("RAG_INGEST_TOO_MANY", `documents exceed ${INGEST_LIMITS.maxDocuments}`);
  }
  const documents = [];
  const failures = [];
  for (const raw of list) {
    try {
      const docId = String(raw && raw.docId || "").trim();
      if (!docId) throw codedError("RAG_INGEST_DOC_ID_REQUIRED");
      const kind = String(raw && raw.kind || "note").trim().toLowerCase() || "note";
      if (FORBIDDEN_DOCUMENT_KINDS.includes(kind)) {
        throw codedError("RAG_INGEST_KIND_FORBIDDEN", `structured campus facts must come from Tools, not ingestion: ${kind}`);
      }
      const title = String(raw && raw.title || "").trim().slice(0, INGEST_LIMITS.maxTitleChars);
      const tags = (Array.isArray(raw && raw.tags) ? raw.tags : [])
        .map((tag) => String(tag || "").trim().slice(0, INGEST_LIMITS.maxTagChars))
        .filter(Boolean)
        .slice(0, INGEST_LIMITS.maxTags);
      let text;
      let source;
      if (raw.text !== undefined && raw.text !== null) {
        text = cleanText(raw.text).slice(0, INGEST_LIMITS.maxInlineChars);
        if (!text) throw codedError("RAG_INGEST_EMPTY");
        source = Object.freeze({ type: "inline" });
      } else if (raw.uri !== undefined && raw.uri !== null) {
        text = await fetchDocumentText(String(raw.uri), options);
        source = Object.freeze({ type: "uri", uri: validateDocumentUri(String(raw.uri)).url });
      } else {
        throw codedError("RAG_INGEST_SOURCE_REQUIRED", "document needs exactly one of text/uri");
      }
      documents.push(Object.freeze({
        docId,
        title: title || docId,
        kind,
        tags: Object.freeze(tags),
        text,
        source,
        contentHash: contentHashOf(text),
      }));
    } catch (error) {
      failures.push(Object.freeze({
        docId: String(raw && raw.docId || "").trim() || null,
        errorClass: String(error && error.code || "RAG_INGEST_FAILED"),
        message: String(error && error.message || "").slice(0, 200),
      }));
    }
  }
  return Object.freeze({ documents: Object.freeze(documents), failures: Object.freeze(failures) });
}

module.exports = Object.freeze({
  INGEST_LIMITS,
  FORBIDDEN_DOCUMENT_KINDS,
  validateDocumentUri,
  fetchDocumentText,
  ingestDocuments,
  htmlToText,
  contentHashOf,
});
