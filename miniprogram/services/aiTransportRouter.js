const request = require("../utils/request");
const cloudbaseConfig = require("../config/cloudbase");
const { classifyAiRoute } = require("../shared/aiRouteClassifier");
const cloudbaseHunyuanService = require("./cloudbaseHunyuanService");

const METRICS_KEY = "FOSU_AI_GENERATIVE_METRICS";
const GENERIC_SUGGESTIONS = ["如何导入个人课表", "查教室明天是否有课", "今天有什么课"];
const INVALID_TEXT_TOKENS = new Set(["[object Object]", "undefined", "null", "NaN"]);

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, maxLength) {
  let text = String(value == null ? "" : value);
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\b(?:javascript|data|file|wxfile):[^\s，。；;]*/gi, "[链接已省略]")
    .replace(/\bhttps?:\/\/[^\s，。；;]+/gi, "[链接已省略]")
    .trim();
  if (!text || INVALID_TEXT_TOKENS.has(text)) return "";
  return text.slice(0, maxLength || 1200);
}

function readStorage(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === undefined || value === "" ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    // local anonymous metrics are best-effort only.
  }
}

function recordMetric(metric) {
  const source = readStorage(METRICS_KEY, []);
  const list = Array.isArray(source) ? source : [];
  const safe = {
    provider: String(metric.provider || "unknown").slice(0, 40),
    latencyMs: Math.max(0, Math.round(Number(metric.latencyMs || 0) || 0)),
    totalTokens: Math.max(0, Math.round(Number(metric.totalTokens || 0) || 0)),
    success: metric.success === true,
    fallback: metric.fallback === true,
    errorCode: String(metric.errorCode || "").slice(0, 80),
    intentName: String(metric.intentName || "").slice(0, 80),
    at: nowIso(),
  };
  writeStorage(METRICS_KEY, list.concat(safe).slice(-80));
  return safe;
}

function normalizeOracleResponse(response) {
  return Object.assign({
    success: true,
    answer: "",
    cards: [],
    suggestions: [],
    toolCalls: [],
    taskSteps: [],
    evidence: null,
    safety: {},
    metrics: {},
  }, response || {});
}

function buildEvidence(context = {}, extra = {}) {
  return {
    term: context.term || context.selectedTerm || "",
    releaseVersion: context.releaseVersion || "",
    currentWeek: context.currentTeachingWeek || "",
    checkedAt: nowIso(),
    sources: extra.sources || [],
  };
}

function buildSafety(provider, options = {}) {
  return {
    redacted: true,
    provider,
    desiredProvider: options.desiredProvider || provider,
    resolvedProvider: provider,
    mode: options.mode || "tool-grounded",
    externalProviderUsed: options.externalProviderUsed === true,
    fallbackReason: options.fallbackReason || "",
    providerDecisionReason: options.providerDecisionReason || "",
  };
}

function buildMetrics(startTime, intentName, options = {}) {
  return {
    latencyMs: Math.max(0, Date.now() - startTime),
    intentName,
    externalProviderUsed: options.externalProviderUsed === true,
    fallback: options.fallback === true,
    totalTokens: Number(options.totalTokens || 0) || 0,
  };
}

function buildGenericCard(providerLabel, subtitle) {
  return {
    type: "generic",
    title: "AI 生成内容，仅供参考",
    subtitle: subtitle || "课表信息仅供参考，以学校教务系统为准。",
    badges: [providerLabel].filter(Boolean),
    items: [],
    actions: [],
  };
}

function buildLocalProjectFallback(message, context, startTime, intentName, reason) {
  const answer = [
    "生成式问答暂时不可用，已切换到规则降级回答。",
    "佛课小表用于查课、找空教室、导入个人 XLS 课表和查看数据状态；课表事实由确定性工具提供，不由模型编造。",
    "课表信息仅供参考，以学校教务系统为准。",
  ].join("\n");
  recordMetric({
    provider: "mock",
    latencyMs: Date.now() - startTime,
    totalTokens: 0,
    success: true,
    fallback: true,
    errorCode: reason || "LOCAL_FALLBACK",
    intentName,
  });
  return {
    success: true,
    answer,
    cards: [buildGenericCard("规则降级", "生成式模型不可用，校园工具仍可继续使用。")],
    suggestions: GENERIC_SUGGESTIONS,
    toolCalls: [],
    taskSteps: [
      { key: "understand", label: "已理解需求", status: "done" },
      { key: "fallback", label: "已切换备用回答", status: "done" },
    ],
    evidence: buildEvidence(context, { sources: ["local-project-knowledge"] }),
    safety: buildSafety("mock", {
      mode: "fallback-mock",
      fallbackReason: reason || "local_fallback",
      providerDecisionReason: "CloudBase and Oracle providers unavailable",
    }),
    metrics: buildMetrics(startTime, intentName, { fallback: true }),
  };
}

function buildSensitiveFallback(context, startTime, intentName) {
  const answer = "我不能接收或处理学号、密码、登录凭证、API Key 等敏感信息。请不要在聊天里输入这些内容；查课和课表同步可以继续使用校园工具。";
  recordMetric({
    provider: "mock",
    latencyMs: Date.now() - startTime,
    totalTokens: 0,
    success: true,
    fallback: true,
    errorCode: "SENSITIVE_REDACTED",
    intentName,
  });
  return {
    success: true,
    answer,
    cards: [buildGenericCard("规则降级", "已拦截敏感信息，不会发送给模型。")],
    suggestions: ["怎么导入个人课表？", "数据会上传吗？"],
    toolCalls: [{ name: "safety_guard", status: "skipped", summary: "敏感内容已脱敏" }],
    taskSteps: [{ key: "safety", label: "已完成安全拦截", status: "done" }],
    evidence: buildEvidence(context, { sources: ["client-safety-guard"] }),
    safety: buildSafety("mock", { mode: "fallback", fallbackReason: "sensitive_redacted" }),
    metrics: buildMetrics(startTime, intentName, { fallback: true }),
  };
}

function shouldDisableGenerativeInClient() {
  if (cloudbaseConfig.AI_CLIENT_EXPRESSION_LAYER_ENABLED !== true) return true;
  if (cloudbaseConfig.AI_TOOL_ONLY_MODE === true) return true;
  const envVersion = (() => {
    try {
      const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
      return info && info.miniProgram && info.miniProgram.envVersion || "";
    } catch (error) {
      return "";
    }
  })();
  return !cloudbaseHunyuanService.isGenerativeAllowedForEnv(cloudbaseConfig, envVersion);
}

async function callOracle(oracleChat, safeMessage, context, callbacks = {}) {
  if (callbacks.onStatus) callbacks.onStatus({ type: "query-tools", text: "正在查询课表" });
  if (oracleChat) return oracleChat(safeMessage, context);
  return request.post("/api/ai/agent/chat", { message: safeMessage, context }, {
    showLoading: false,
    silentError: true,
    timeout: 28000,
    retries: 2,
    retryBaseDelayMs: 420,
    retryMaxDelayMs: 1800,
    dedupe: false,
  });
}

async function chat(input = {}) {
  const startTime = Date.now();
  const rawMessage = String(input.message || "");
  const redact = input.redactSensitiveText || ((text) => String(text || ""));
  const safeMessage = redact(rawMessage).slice(0, 2000);
  const context = input.context || {};
  const callbacks = input.options && input.options.callbacks || input.callbacks || {};
  const history = input.history || [];
  const route = classifyAiRoute(safeMessage, context);
  if (callbacks.onStatus) callbacks.onStatus({ type: "understanding", text: "正在理解问题", route });

  if (safeMessage !== rawMessage && /\[已脱敏\]/.test(safeMessage)) {
    return buildSensitiveFallback(context, startTime, route.intentName);
  }

  if (route.route === "oracle-tool") {
    const response = normalizeOracleResponse(await callOracle(input.oracleChat, safeMessage, context, callbacks));
    if (callbacks.onStatus) callbacks.onStatus({ type: "tool-used", text: "已使用工具结果" });
    return response;
  }

  if (shouldDisableGenerativeInClient()) {
    try {
      return normalizeOracleResponse(await callOracle(input.oracleChat, safeMessage, context, callbacks));
    } catch (error) {
      return buildLocalProjectFallback(safeMessage, context, startTime, route.intentName, "AI_CLIENT_EXPRESSION_LAYER_DISABLED");
    }
  }

  try {
    if (callbacks.onStatus) callbacks.onStatus({ type: "calling-hunyuan", text: "正在调用混元" });
    const result = await cloudbaseHunyuanService.generate({
      message: safeMessage,
      context,
      history,
      intentName: route.intentName,
    }, callbacks);
    const answer = safeText(result.text, 1400) || "我已经整理好回答。";
    recordMetric({
      provider: "cloudbase-hunyuan",
      latencyMs: Date.now() - startTime,
      totalTokens: result.totalTokens || 0,
      success: true,
      fallback: false,
      errorCode: "",
      intentName: route.intentName,
    });
    return {
      success: true,
      answer,
      cards: [buildGenericCard("腾讯混元", "AI 生成内容仅用于说明和帮助，不作为课表事实来源。")],
      suggestions: GENERIC_SUGGESTIONS,
      toolCalls: [],
      taskSteps: [
        { key: "understand", label: "已理解需求", status: "done" },
        { key: "hunyuan", label: "已调用混元", status: "done" },
        { key: "complete", label: "已完成", status: "done" },
      ],
      evidence: buildEvidence(context, { sources: ["cloudbase-hunyuan"] }),
      safety: buildSafety("cloudbase-hunyuan", {
        desiredProvider: "cloudbase-hunyuan",
        externalProviderUsed: true,
        providerDecisionReason: route.reason,
      }),
      metrics: buildMetrics(startTime, route.intentName, {
        externalProviderUsed: true,
        totalTokens: result.totalTokens || 0,
      }),
    };
  } catch (hunyuanError) {
    const errorCode = hunyuanError && (hunyuanError.code || hunyuanError.errCode || hunyuanError.message) || "CLOUDBASE_AI_FAILED";
    if (callbacks.onStatus) {
      callbacks.onStatus({
        type: "fallback-oracle",
        text: hunyuanError && hunyuanError.concurrentLimit
          ? "当前使用人数较多，已切换备用回答"
          : "混元暂不可用，正在切换备用回答",
        errorCode,
      });
    }
    try {
      const oracle = normalizeOracleResponse(await callOracle(input.oracleChat, safeMessage, context, callbacks));
      oracle.safety = Object.assign({}, oracle.safety || {}, {
        fallbackReason: oracle.safety && oracle.safety.fallbackReason || errorCode,
        hunyuanFallbackReason: errorCode,
      });
      oracle.metrics = Object.assign({}, oracle.metrics || {}, {
        fallback: true,
        intentName: oracle.metrics && oracle.metrics.intentName || route.intentName,
      });
      recordMetric({
        provider: oracle.safety.resolvedProvider || oracle.safety.provider || "oracle",
        latencyMs: Date.now() - startTime,
        totalTokens: oracle.metrics.totalTokens || 0,
        success: true,
        fallback: true,
        errorCode,
        intentName: route.intentName,
      });
      return oracle;
    } catch (oracleError) {
      return buildLocalProjectFallback(safeMessage, context, startTime, route.intentName, oracleError && (oracleError.code || oracleError.message) || errorCode);
    }
  }
}

module.exports = {
  METRICS_KEY,
  buildGenericCard,
  chat,
  recordMetric,
  safeText,
  shouldDisableGenerativeInClient,
};
