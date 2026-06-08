const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_REASONING_MODEL = "deepseek-v4-pro";
const ALLOWED_CARD_TYPES = "empty_room/schedule/teacher/course/diagnosis/guide/reminder/generic";
const ALLOWED_ACTION_TYPES = "navigate/copy/retry/bind/noop";
const ENV_PATH = path.resolve(__dirname, "../../../../.env");

let cachedEnvFileValues = null;

function parseEnvLineValue(value) {
  let text = String(value || "").trim();
  const hashIndex = text.search(/\s+#/);
  if (hashIndex >= 0) text = text.slice(0, hashIndex).trim();
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  return text;
}

function readEnvFileValues() {
  if (String(process.env.AI_PROVIDER_IGNORE_ENV_FILE || "").toLowerCase() === "true") return {};
  if (cachedEnvFileValues) return cachedEnvFileValues;
  cachedEnvFileValues = {};
  try {
    if (!fs.existsSync(ENV_PATH)) return cachedEnvFileValues;
    const text = fs.readFileSync(ENV_PATH, "utf8");
    text.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const index = trimmed.indexOf("=");
      if (index <= 0) return;
      const key = trimmed.slice(0, index).trim();
      cachedEnvFileValues[key] = parseEnvLineValue(trimmed.slice(index + 1));
    });
  } catch (error) {
    cachedEnvFileValues = {};
  }
  return cachedEnvFileValues;
}

function configuredEnv(name, fallback = "") {
  const envFileValues = readEnvFileValues();
  const value = process.env[name] || envFileValues[name];
  return value === undefined || value === null || value === "" ? fallback : value;
}

function firstConfiguredKey() {
  return configuredEnv("AI_API_KEY") ||
    configuredEnv("DEEPSEEK_API_KEY") ||
    configuredEnv("FOSUCLASS_DEEPSEEK_API_KEY") ||
    "";
}

function numberEnv(name, fallback, min, max) {
  const value = Number(configuredEnv(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function boolEnv(name, fallback) {
  const raw = configuredEnv(name);
  if (raw === undefined || raw === null || raw === "") return fallback;
  return String(raw).toLowerCase() === "true";
}

function buildSystemPrompt() {
  return [
    "你是佛课小表 AI 校园管家。",
    "你只能基于 user content 中的 toolResults 和最小上下文回答，不得编造课程、教师、教室、空教室或数据状态事实。",
    "如果 toolResults 没有给出确定事实，必须明确说明无法从项目工具确认，并给出可操作的下一步。",
    "必须输出严格 JSON object，不要输出 markdown、解释性前后缀或代码块。",
    "JSON 顶层字段只能是 answer、cards、suggestions。",
    "answer 必须是字符串。",
    `cards 必须是数组，每个 card.type 只能是 ${ALLOWED_CARD_TYPES}。`,
    `actions 的 type 只能是 ${ALLOWED_ACTION_TYPES}。`,
    "不要输出学号、密码、Cookie、token、Authorization、原始 XLS、base64 或任何密钥。",
  ].join("\n");
}

function parseJsonFromText(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
}

function parseJsonCodeBlock(text) {
  const value = String(text || "");
  const match = value.match(/```json\s*([\s\S]*?)```/i) || value.match(/```\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch (error) {
    return null;
  }
}

async function generate({ message, intent, toolResults }) {
  const apiKey = firstConfiguredKey();
  if (!apiKey) {
    const error = new Error("DeepSeek provider is not configured.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const baseUrl = String(configuredEnv("AI_BASE_URL", DEFAULT_BASE_URL)).replace(/\/+$/, "");
  const requestedModel = configuredEnv("AI_MODEL", DEFAULT_MODEL);
  const reasoningModel = configuredEnv("AI_REASONING_MODEL", DEFAULT_REASONING_MODEL);
  const thinkingEnabled = boolEnv("AI_THINKING_ENABLED", false);
  const model = thinkingEnabled && /pro/i.test(requestedModel) ? requestedModel : requestedModel || reasoningModel;
  const timeout = numberEnv("AI_TIMEOUT_MS", 15000, 1000, 60000);
  const maxTokens = numberEnv("AI_MAX_TOKENS", 1200, 128, 4096);
  const temperature = numberEnv("AI_TEMPERATURE", 0.1, 0, 2);
  const body = {
    model,
    stream: false,
    max_tokens: maxTokens,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(),
      },
      {
        role: "user",
        content: JSON.stringify({
          message,
          intent: intent && intent.name,
          toolResults,
        }),
      },
    ],
  };
  if (thinkingEnabled && /pro/i.test(model)) {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = configuredEnv("AI_REASONING_EFFORT", "medium");
  }

  const response = await axios.post(`${baseUrl}/chat/completions`, body, {
    timeout,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const content = response.data &&
    response.data.choices &&
    response.data.choices[0] &&
    response.data.choices[0].message &&
    response.data.choices[0].message.content;
  const parsed = parseJsonFromText(content) ||
    (boolEnv("AI_PROVIDER_JSON_REPAIR", true) ? parseJsonCodeBlock(content) : null);
  if (!parsed || typeof parsed !== "object") {
    const error = new Error("DeepSeek provider returned invalid JSON.");
    error.code = "INVALID_PROVIDER_JSON";
    throw error;
  }
  return Object.assign({ provider: "deepseek" }, parsed);
}

module.exports = {
  buildSystemPrompt,
  firstConfiguredKey,
  generate,
  name: "deepseek",
  parseJsonCodeBlock,
  parseJsonFromText,
};
