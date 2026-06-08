const axios = require("axios");

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

async function generate({ message, intent, toolResults }) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    const error = new Error("DeepSeek provider is not configured.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const baseUrl = String(process.env.AI_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = process.env.AI_MODEL || "deepseek-v4-flash";
  const timeout = Number(process.env.AI_TIMEOUT_MS || 15000) || 15000;
  const response = await axios.post(`${baseUrl}/chat/completions`, {
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "你是佛课小表的校园服务智能体。只能基于工具结果回答，不得编造课程、教师、教室或空教室事实。输出 JSON：answer,cards,suggestions。",
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
  }, {
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
  const parsed = parseJsonFromText(content);
  if (!parsed || typeof parsed !== "object") {
    const error = new Error("DeepSeek provider returned invalid JSON.");
    error.code = "INVALID_PROVIDER_JSON";
    throw error;
  }
  return Object.assign({ provider: "deepseek" }, parsed);
}

module.exports = {
  generate,
  name: "deepseek",
};
