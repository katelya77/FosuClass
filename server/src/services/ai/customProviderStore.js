const crypto = require("crypto");
const axios = require("axios");

/**
 * 自定义第三方 Provider（CCSwitch 式）：OpenAI / Anthropic 协议兼容端点。
 * 列表整体序列化为 JSON 存于 AI_CUSTOM_PROVIDERS（runtimeStore 按密钥加密）。
 * 条目结构：{ id, label, protocol, baseUrl, apiKey, model, enabled, strictJsonMode, createdAt, updatedAt }
 * 安全约束：apiKey 只在加密存储与出站请求中出现；publicView 永不回传明文。
 */

const PROTOCOLS = new Set(["openai", "anthropic"]);
const MAX_ENTRIES = 12;

function normalizeProtocol(value) {
  const protocol = String(value || "").trim().toLowerCase();
  if (["anthropic", "claude"].includes(protocol)) return "anthropic";
  return protocol === "openai" ? "openai" : "";
}

function normalizeBaseUrl(value, protocol) {
  let url = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(url)) return "";
  if (protocol === "anthropic" && !/\/v1$/i.test(url)) url += "/v1";
  return url.slice(0, 300);
}

function newEntryId() {
  return `cp_${crypto.randomBytes(6).toString("hex")}`;
}

function sanitizeEntry(raw = {}) {
  const protocol = normalizeProtocol(raw.protocol);
  const baseUrl = normalizeBaseUrl(raw.baseUrl, protocol);
  const entry = {
    id: String(raw.id || "").trim().slice(0, 40) || newEntryId(),
    label: String(raw.label || "").trim().slice(0, 40),
    protocol,
    baseUrl,
    apiKey: String(raw.apiKey || "").trim().slice(0, 400),
    model: String(raw.model || "").trim().slice(0, 120),
    enabled: raw.enabled !== false && String(raw.enabled) !== "false",
    strictJsonMode: raw.strictJsonMode !== false && String(raw.strictJsonMode) !== "false",
    createdAt: String(raw.createdAt || "").slice(0, 40),
    updatedAt: String(raw.updatedAt || "").slice(0, 40),
  };
  if (!entry.label) entry.label = entry.baseUrl ? new URL(entry.baseUrl).hostname : entry.id;
  return entry;
}

function isEntryUsable(entry) {
  return Boolean(entry && entry.enabled && entry.protocol && entry.baseUrl && entry.apiKey && entry.model);
}

function parseList(rawValue) {
  if (Array.isArray(rawValue)) return rawValue.map(sanitizeEntry).filter((entry) => entry.protocol && entry.baseUrl).slice(0, MAX_ENTRIES);
  const text = String(rawValue || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed)
      ? parsed.map(sanitizeEntry).filter((entry) => entry.protocol && entry.baseUrl).slice(0, MAX_ENTRIES)
      : [];
  } catch (error) {
    return [];
  }
}

function serializeList(list) {
  return JSON.stringify(parseList(list));
}

/** 后台展示用脱敏视图：永不包含 apiKey 明文。 */
function publicView(list) {
  return parseList(list).map((entry) => ({
    id: entry.id,
    label: entry.label,
    protocol: entry.protocol,
    baseUrl: entry.baseUrl,
    model: entry.model,
    enabled: entry.enabled,
    strictJsonMode: entry.strictJsonMode,
    apiKeyConfigured: Boolean(entry.apiKey),
    apiKeyLast4: entry.apiKey ? entry.apiKey.slice(-4) : "",
    usable: isEntryUsable(entry),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));
}

function listFromRuntimeConfig(runtimeConfig = {}) {
  const source = runtimeConfig || {};
  const raw = Object.prototype.hasOwnProperty.call(source, "AI_CUSTOM_PROVIDERS")
    ? source.AI_CUSTOM_PROVIDERS
    : process.env.AI_CUSTOM_PROVIDERS;
  return parseList(raw);
}

function activeIdFromRuntimeConfig(runtimeConfig = {}) {
  const source = runtimeConfig || {};
  const raw = Object.prototype.hasOwnProperty.call(source, "AI_CUSTOM_ACTIVE_ID")
    ? source.AI_CUSTOM_ACTIVE_ID
    : process.env.AI_CUSTOM_ACTIVE_ID;
  return String(raw || "").trim();
}

/**
 * 解析某协议当前生效条目：优先 activeId 命中的同协议条目，否则该协议第一个可用条目。
 * 返回 null 表示该协议无可用自定义 Provider。
 */
function resolveEntry(runtimeConfig = {}, protocol) {
  const normalizedProtocol = normalizeProtocol(protocol);
  if (!normalizedProtocol) return null;
  const list = listFromRuntimeConfig(runtimeConfig);
  const activeId = activeIdFromRuntimeConfig(runtimeConfig);
  if (activeId) {
    const active = list.find((entry) => entry.id === activeId && entry.protocol === normalizedProtocol && isEntryUsable(entry));
    if (active) return active;
  }
  return list.find((entry) => entry.protocol === normalizedProtocol && isEntryUsable(entry)) || null;
}

/**
 * 合并保存：incoming 为单条 entry；apiKey 留空 = 保留旧密钥；"__clear__" = 清除。
 * id 为空 = 新建。返回合并后的完整列表。
 */
function upsertEntry(existingList, incoming = {}) {
  const list = parseList(existingList);
  const now = new Date().toISOString();
  const entry = sanitizeEntry(incoming);
  const index = list.findIndex((item) => item.id === entry.id);
  if (index >= 0) {
    const previous = list[index];
    if (!incoming.apiKey) entry.apiKey = previous.apiKey;
    else if (String(incoming.apiKey) === "__clear__") entry.apiKey = "";
    entry.createdAt = previous.createdAt || now;
    entry.updatedAt = now;
    list[index] = entry;
  } else {
    entry.createdAt = now;
    entry.updatedAt = now;
    list.push(entry);
  }
  return list.slice(0, MAX_ENTRIES);
}

function removeEntry(existingList, id) {
  const target = String(id || "").trim();
  return parseList(existingList).filter((entry) => entry.id !== target);
}

function findEntry(existingList, id) {
  const target = String(id || "").trim();
  return parseList(existingList).find((entry) => entry.id === target) || null;
}

function modelArrayFromResponse(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const candidates = [
    payload.data,
    payload.models,
    payload.result,
    payload.data && payload.data.data,
    payload.data && payload.data.models,
    payload.result && payload.result.data,
    payload.result && payload.result.models,
  ];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

function modelIdFromItem(item) {
  if (typeof item === "string") return item.trim().slice(0, 180);
  if (!item || typeof item !== "object") return "";
  return String(item.id || item.model || item.slug || item.name || "").trim().slice(0, 180);
}

function parseExpiration(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isZeroPrice(value) {
  if (value == null || value === "") return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric === 0;
}

function normalizeOpenRouterItem(item) {
  const id = modelIdFromItem(item);
  if (!id) return null;
  const raw = item && typeof item === "object" ? item : {};
  const name = String(raw.name || id).trim().slice(0, 180);
  const pricing = raw.pricing && typeof raw.pricing === "object" ? raw.pricing : {};
  const free = /:free$/i.test(id) || (isZeroPrice(pricing.prompt) && isZeroPrice(pricing.completion));
  const architecture = raw.architecture && typeof raw.architecture === "object" ? raw.architecture : {};
  const outputModalities = Array.isArray(architecture.output_modalities)
    ? architecture.output_modalities
    : Array.isArray(raw.output_modalities)
      ? raw.output_modalities
      : [];
  const modalityText = String(architecture.modality || raw.modality || "").toLowerCase();
  const looksNonText = /(?:embed|rerank|tts|speech|transcri|image[-_ ]?(?:gen|edit)|video|audio)/i.test(`${id} ${name}`);
  const emitsText = outputModalities.length
    ? outputModalities.some((value) => String(value).toLowerCase() === "text")
    : /(?:->|\b)text\b/.test(modalityText) || !looksNonText;
  const expiresAtMs = parseExpiration(raw.expiration_date || raw.expirationDate || raw.expires_at || raw.expiresAt);
  const expired = Boolean(expiresAtMs && expiresAtMs <= Date.now());
  const supported = new Set((Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [])
    .map((value) => String(value).trim().toLowerCase()));
  const supportsStructured = supported.has("response_format") || supported.has("structured_outputs") || supported.has("json_schema");
  const supportsTools = supported.has("tools") || supported.has("tool_choice");
  const contextLength = Math.max(0, Number(raw.context_length || raw.contextLength || 0) || 0);
  let score = Math.min(30, Math.round(Math.log2(Math.max(1, contextLength))));
  if (supportsStructured) score += 50;
  if (supportsTools) score += 35;
  if (!/(?:preview|experimental|beta)/i.test(`${id} ${name}`)) score += 12;
  if (!expiresAtMs) score += 8;
  return {
    id,
    name,
    free,
    textOutput: emitsText && !looksNonText,
    expired,
    contextLength,
    supportsStructured,
    supportsTools,
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : "",
    score,
  };
}

function dedupeModelItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || !item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * 拉取端点模型列表（OpenAI GET /models；Anthropic GET /v1/models）。
 * OpenRouter 免费目录也通过官方 /models API 获取，不依赖网页 DOM 或爬虫。
 * 仅用于后台"获取模型"按钮；密钥只进出站请求，绝不写日志。
 */
async function fetchModelList(options = {}) {
  const protocol = normalizeProtocol(options.protocol);
  const baseUrl = normalizeBaseUrl(options.baseUrl, protocol || "openai");
  const apiKey = String(options.apiKey || "").trim();
  const openrouterFreeCatalog = String(options.catalog || "").trim().toLowerCase() === "openrouter-free";
  if (!protocol || !baseUrl || (!apiKey && !openrouterFreeCatalog)) {
    const error = new Error(openrouterFreeCatalog
      ? "protocol / baseUrl 均为必填。"
      : "protocol / baseUrl / apiKey 均为必填。");
    error.code = "bad_request";
    throw error;
  }
  const timeoutMs = Math.max(2000, Math.min(15000, Number(options.timeoutMs || 8000) || 8000));
  const url = protocol === "anthropic" ? `${baseUrl}/models` : `${baseUrl}/models`;
  const headers = protocol === "anthropic"
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : {};
  const started = Date.now();
  try {
    const response = await axios.get(url, { timeout: timeoutMs, headers });
    const data = modelArrayFromResponse(response.data);
    if (openrouterFreeCatalog) {
      const items = dedupeModelItems(data.map(normalizeOpenRouterItem).filter((item) => item && item.free && item.textOutput && !item.expired))
        .sort((a, b) => b.score - a.score || b.contextLength - a.contextLength || a.id.localeCompare(b.id))
        .slice(0, 200)
        .map(({ score, textOutput, expired, ...item }) => item);
      // The free router is the durable primary: OpenRouter can select a live
      // zero-cost text model as catalogue entries rotate. Keep concrete,
      // capability-ranked IDs as explicit fallbacks for transparency.
      const recommendedModels = ["openrouter/free"].concat(items.slice(0, 4).map((item) => item.id));
      return {
        models: items.map((item) => item.id),
        items,
        recommendedModels,
        source: "openrouter-free",
        latencyMs: Date.now() - started,
        fetchedAt: new Date().toISOString(),
      };
    }
    const models = Array.from(new Set(data.map(modelIdFromItem).filter(Boolean))).slice(0, 200);
    return {
      models,
      items: models.map((id) => ({ id, name: id })),
      recommendedModels: models.slice(0, 4),
      source: "provider-models",
      latencyMs: Date.now() - started,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    const status = error && error.response && error.response.status;
    const wrapped = new Error("获取模型列表失败。");
    wrapped.code = status === 401 || status === 403
      ? "unauthorized"
      : status === 404
        ? "not_found"
        : String(error && error.code || "fetch_failed");
    wrapped.status = status || 0;
    wrapped.latencyMs = Date.now() - started;
    throw wrapped;
  }
}

module.exports = {
  MAX_ENTRIES,
  activeIdFromRuntimeConfig,
  fetchModelList,
  findEntry,
  isEntryUsable,
  listFromRuntimeConfig,
  normalizeBaseUrl,
  modelArrayFromResponse,
  normalizeProtocol,
  parseList,
  publicView,
  removeEntry,
  resolveEntry,
  sanitizeEntry,
  serializeList,
  upsertEntry,
};
