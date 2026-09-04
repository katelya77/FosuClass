const axios = require("axios");
const safetyGuard = require("../safetyGuard");

async function generateStructured(options = {}) {
  if (!options.baseUrl || !options.apiKey) {
    const error = new Error("Structured provider is not configured");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const messages = (Array.isArray(options.messages) ? options.messages : []).slice(0, 6).map((item) => ({
    role: item && (item.role === "system" || item.role === "assistant") ? item.role : "user",
    content: safetyGuard.redactSensitiveText(String(item && item.content || "")).slice(0, 5000),
  }));
  const started = Date.now();
  try {
    const requestBody = {
      stream: false,
      max_tokens: Math.max(128, Math.min(2000, Number(options.maxTokens || 800) || 800)),
      temperature: 0,
      messages,
      response_format: { type: "json_object" },
    };
    const models = Array.isArray(options.models) ? options.models.filter(Boolean).slice(0, 8) : [];
    if (models.length) requestBody.models = models;
    else requestBody.model = options.model;
    if (options.providerRouting && typeof options.providerRouting === "object") {
      requestBody.provider = options.providerRouting;
    }
    const response = await axios.post(
      `${String(options.baseUrl).replace(/\/+$/, "")}/chat/completions`,
      requestBody,
      {
        timeout: Math.max(50, Math.min(30000, Number(options.timeoutMs || 8000) || 8000)),
        signal: options.signal || undefined,
        httpAgent: options.httpAgent || undefined,
        httpsAgent: options.httpsAgent || undefined,
        headers: Object.assign({
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        }, options.headers || {}),
      }
    );
    const content = response.data && response.data.choices && response.data.choices[0]
      && response.data.choices[0].message && response.data.choices[0].message.content;
    if (!String(content || "").trim()) {
      const error = new Error("Structured provider returned an empty response");
      error.code = "INVALID_PROVIDER_JSON";
      throw error;
    }
    return {
      content: String(content),
      text: String(content),
      provider: options.provider,
      resolvedModel: String(response.data && response.data.model || ""),
      latencyMs: Date.now() - started,
      usage: response.data && response.data.usage || null,
    };
  } catch (error) {
    if (error && error.code === "INVALID_PROVIDER_JSON") throw error;
    const wrapped = new Error("Structured provider request failed");
    wrapped.code = typeof options.classifyError === "function"
      ? options.classifyError(error)
      : String(error && error.code || "PROVIDER_REQUEST_FAILED");
    wrapped.status = error && error.response && error.response.status;
    wrapped.latencyMs = Date.now() - started;
    throw wrapped;
  }
}

module.exports = {
  generateStructured,
};
