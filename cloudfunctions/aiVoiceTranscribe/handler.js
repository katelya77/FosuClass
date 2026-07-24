// aiVoiceTranscribe 核心逻辑（依赖注入，可本地测试）
// 契约（与 miniprogram/services/aiVoiceInputService.js 对齐）：
//   入参: { fileID, durationMs, fileSize, format, deleteAfterUse }
//   返回: { text } 成功 / { success: false, code, message } 失败
// 安全：腾讯云 ASR 密钥只从云函数环境变量读取，绝不进代码与日志。

const ALLOWED_FORMATS = ["mp3", "wav", "amr", "silk", "m4a", "pcm"];
const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 一句话识别内联上限 3MB
const MAX_DURATION_MS = 60000; // 一句话识别上限 60s
const MIN_DURATION_MS = 400;

function makeError(code, message) {
  return { success: false, code, message };
}

function normalizeInput(event = {}) {
  const fileID = String(event.fileID || "").trim();
  const durationMs = Number(event.durationMs || 0) || 0;
  const fileSize = Number(event.fileSize || 0) || 0;
  const format = String(event.format || "").toLowerCase().trim();
  const deleteAfterUse = event.deleteAfterUse !== false;
  return { fileID, durationMs, fileSize, format, deleteAfterUse };
}

function validateInput(input) {
  if (!input.fileID) return makeError("AI_VOICE_FILE_REQUIRED", "缺少语音文件");
  if (!ALLOWED_FORMATS.includes(input.format)) {
    return makeError("AI_VOICE_FORMAT_UNSUPPORTED", "语音格式不支持");
  }
  if (input.durationMs && input.durationMs > MAX_DURATION_MS) {
    return makeError("AI_VOICE_TOO_LONG", "语音超过 60 秒上限");
  }
  if (input.durationMs && input.durationMs < MIN_DURATION_MS) {
    return makeError("AI_VOICE_TOO_SHORT", "录音时间太短");
  }
  if (input.fileSize && input.fileSize > MAX_FILE_SIZE_BYTES) {
    return makeError("AI_VOICE_FILE_TOO_LARGE", "语音文件过大");
  }
  return null;
}

function getAsrCredentials(env = process.env) {
  const secretId = String(env.TENCENT_ASR_SECRET_ID || "").trim();
  const secretKey = String(env.TENCENT_ASR_SECRET_KEY || "").trim();
  if (!secretId || !secretKey) return null;
  return { secretId, secretKey };
}

// deps: { downloadFile(fileID)->Buffer, sentenceRecognition(params)->{text}, deleteFile(fileID) }
async function transcribeEvent(event, deps = {}, env = process.env) {
  const input = normalizeInput(event);
  const invalid = validateInput(input);
  if (invalid) return invalid;

  const credentials = getAsrCredentials(env);
  if (!credentials) {
    return makeError("AI_VOICE_NOT_CONFIGURED", "语音识别服务未配置");
  }
  if (typeof deps.downloadFile !== "function" || typeof deps.sentenceRecognition !== "function") {
    return makeError("AI_VOICE_INTERNAL", "语音识别依赖缺失");
  }

  let buffer;
  try {
    buffer = await deps.downloadFile(input.fileID);
  } catch (error) {
    return makeError("AI_VOICE_DOWNLOAD_FAILED", "语音文件读取失败");
  }
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from((buffer && buffer.fileContent) || []);
  if (!data.length) return makeError("AI_VOICE_DOWNLOAD_FAILED", "语音文件为空");
  if (data.length > MAX_FILE_SIZE_BYTES) return makeError("AI_VOICE_FILE_TOO_LARGE", "语音文件过大");

  if (input.deleteAfterUse && typeof deps.deleteFile === "function") {
    // 异步清理，失败不影响转写
    Promise.resolve()
      .then(() => deps.deleteFile(input.fileID))
      .catch(() => {});
  }

  try {
    const result = await deps.sentenceRecognition({
      dataBase64: data.toString("base64"),
      format: input.format,
      credentials,
    });
    const text = String((result && result.text) || "").trim();
    if (!text) return makeError("AI_VOICE_EMPTY_RESULT", "没有识别到文字");
    return { text };
  } catch (error) {
    return makeError("AI_VOICE_ASR_FAILED", "语音识别失败");
  }
}

module.exports = {
  ALLOWED_FORMATS,
  MAX_DURATION_MS,
  MAX_FILE_SIZE_BYTES,
  getAsrCredentials,
  normalizeInput,
  transcribeEvent,
  validateInput,
};
