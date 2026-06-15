const axios = require("axios");
const deepseekProvider = require("./deepseekProvider");

const DEFAULT_BASE_URL = "https://cloud1-d3g17rpe7566d3d5c.api.tcloudbasegateway.com/v1/ai/cloudbase";
const DEFAULT_MODEL = "hy3-preview";

function firstConfiguredKey() {
  return process.env.CLOUDBASE_OPENAI_API_KEY || "";
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return String(raw).toLowerCase() === "true";
}

function numberEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function classifyHttpError(error) {
  return deepseekProvider.classifyHttpError(error);
}

async function generate({ message, intent, toolResults, projectKnowledge }) {
  if (!boolEnv("CLOUDBASE_OPENAI_ENABLED", false)) {
    const error = new Error("CloudBase OpenAI provider is disabled.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const apiKey = firstConfiguredKey();
  if (!apiKey) {
    const error = new Error("CloudBase OpenAI provider is not configured.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const baseUrl = String(process.env.CLOUDBASE_OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = process.env.CLOUDBASE_OPENAI_TEXT_MODEL || DEFAULT_MODEL;
  const timeout = numberEnv("CLOUDBASE_OPENAI_TIMEOUT_MS", 15000, 1000, 60000);
  const maxTokens = numberEnv("CLOUDBASE_OPENAI_MAX_TOKENS", 1200, 128, 4096);
  const useJsonMode = deepseekProvider.shouldUseJsonMode(intent);
  const body = {
    model,
    stream: false,
    max_tokens: maxTokens,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: deepseekProvider.buildSystemPrompt(
          intent && (intent.name === "project_qa" || intent.name === "conversational_help")
            ? projectKnowledge
            : "",
          { useJsonMode }
        ),
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
  if (useJsonMode) body.response_format = { type: "json_object" };

  let response;
  try {
    response = await axios.post(`${baseUrl}/chat/completions`, body, {
      timeout,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const wrapped = new Error("CloudBase OpenAI provider request failed.");
    wrapped.code = classifyHttpError(error);
    wrapped.status = error && error.response && error.response.status;
    throw wrapped;
  }
  const content = response.data &&
    response.data.choices &&
    response.data.choices[0] &&
    response.data.choices[0].message &&
    response.data.choices[0].message.content;
  if (!useJsonMode) {
    const parsedTextMode = deepseekProvider.parseJsonFromText(content);
    if (parsedTextMode && typeof parsedTextMode === "object") {
      return Object.assign({ provider: "cloudbase-openai" }, parsedTextMode);
    }
    return Object.assign(deepseekProvider.wrapTextResponse(content), { provider: "cloudbase-openai" });
  }
  const parsed = deepseekProvider.parseJsonFromText(content) || deepseekProvider.parseJsonCodeBlock(content);
  if (!parsed || typeof parsed !== "object") {
    const error = new Error("CloudBase OpenAI provider returned invalid JSON.");
    error.code = "INVALID_PROVIDER_JSON";
    throw error;
  }
  return Object.assign({ provider: "cloudbase-openai" }, parsed);
}

module.exports = {
  classifyHttpError,
  firstConfiguredKey,
  generate,
  name: "cloudbase-openai",
};
