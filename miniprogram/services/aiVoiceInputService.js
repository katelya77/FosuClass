const cloudbaseConfig = require("../config/cloudbase");
const platform = require("../utils/platform");

const DAILY_COUNTER_KEY = "FOSU_AI_VOICE_DAILY_COUNTER";
const MIN_DURATION_MS = 500;
const DEFAULT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const SUPPORTED_FORMATS = ["mp3", "aac", "wav", "m4a"];

function todayKey() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function makeError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function getWx(options = {}) {
  return options.wx || (typeof wx !== "undefined" ? wx : null);
}

function getConfig(overrides = {}) {
  return Object.assign({}, cloudbaseConfig, overrides || {});
}

function getEnvVersion(wxLike) {
  return platform.getMiniProgramEnvVersion(wxLike);
}

function isVoiceInputAvailable(config = getConfig(), wxLike = getWx()) {
  if (!config || config.AI_VOICE_INPUT_ENABLED !== true) return false;
  if (String(config.AI_VOICE_PROVIDER || "") !== "cloudbase-function") return false;
  if (!wxLike || typeof wxLike.getRecorderManager !== "function") return false;
  if (!wxLike.cloud || typeof wxLike.cloud.uploadFile !== "function" || typeof wxLike.cloud.callFunction !== "function") return false;
  if (getEnvVersion(wxLike) === "release" && !String(config.AI_VOICE_PROVIDER || "")) return false;
  return true;
}

function readCounter(wxLike) {
  try {
    const current = wxLike.getStorageSync(DAILY_COUNTER_KEY);
    if (!current || current.date !== todayKey()) return { date: todayKey(), count: 0 };
    return { date: current.date, count: Number(current.count || 0) || 0 };
  } catch (error) {
    return { date: todayKey(), count: 0 };
  }
}

function writeCounter(wxLike, counter) {
  try {
    wxLike.setStorageSync(DAILY_COUNTER_KEY, counter);
  } catch (error) {}
}

function assertDailyLimit(config, wxLike) {
  const limit = Number(config.AI_VOICE_DAILY_LIMIT || 0) || 0;
  const counter = readCounter(wxLike);
  if (limit > 0 && counter.count >= limit) {
    throw makeError("AI_VOICE_DAILY_LIMIT", "今日语音识别次数已达上限");
  }
  return counter;
}

function normalizeFormat(input) {
  const format = String(input || "mp3").replace(/^\./, "").toLowerCase();
  return SUPPORTED_FORMATS.includes(format) ? format : "";
}

function validateRecording(recording = {}, config = getConfig()) {
  const durationMs = Number(recording.durationMs || recording.duration || 0) || 0;
  if (durationMs < MIN_DURATION_MS) throw makeError("AI_VOICE_TOO_SHORT", "录音时间太短");
  const maxDuration = Number(config.AI_VOICE_MAX_DURATION_MS || 15000) || 15000;
  if (durationMs > maxDuration + 1000) throw makeError("AI_VOICE_TOO_LONG", "录音时间过长");
  const fileSize = Number(recording.fileSize || recording.size || 0) || 0;
  const maxFileSize = Number(config.AI_VOICE_MAX_FILE_SIZE_BYTES || DEFAULT_MAX_FILE_SIZE_BYTES) || DEFAULT_MAX_FILE_SIZE_BYTES;
  if (fileSize > maxFileSize) throw makeError("AI_VOICE_FILE_TOO_LARGE", "语音文件过大");
  const tempFilePath = String(recording.tempFilePath || "");
  if (!tempFilePath) throw makeError("AI_VOICE_FILE_MISSING", "录音文件不存在");
  const extMatch = tempFilePath.match(/\.([a-z0-9]+)(?:\?|$)/i);
  const format = normalizeFormat(recording.format || (extMatch && extMatch[1]) || "mp3");
  if (!format) throw makeError("AI_VOICE_FORMAT_UNSUPPORTED", "录音格式不支持");
  return { durationMs, fileSize, tempFilePath, format };
}

function uploadFile(wxLike, options) {
  return new Promise((resolve, reject) => {
    wxLike.cloud.uploadFile(Object.assign({}, options, {
      success: resolve,
      fail: reject,
    }));
  });
}

function callFunction(wxLike, options) {
  return new Promise((resolve, reject) => {
    wxLike.cloud.callFunction(Object.assign({}, options, {
      success: resolve,
      fail: reject,
    }));
  });
}

function deleteFile(wxLike, fileID) {
  if (!fileID || !wxLike.cloud || typeof wxLike.cloud.deleteFile !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    wxLike.cloud.deleteFile({
      fileList: [fileID],
      success: resolve,
      fail: resolve,
    });
  });
}

async function transcribeRecording(recording = {}, options = {}) {
  const wxLike = getWx(options);
  const config = getConfig(options.config);
  if (!isVoiceInputAvailable(config, wxLike)) {
    throw makeError("AI_VOICE_UNAVAILABLE", "当前环境暂不支持语音识别");
  }
  const validated = validateRecording(recording, config);
  const counter = assertDailyLimit(config, wxLike);
  const random = Math.random().toString(16).slice(2, 10);
  const cloudPath = `voice-transient/${Date.now()}-${random}.${validated.format}`;
  let fileID = "";
  try {
    const uploaded = await uploadFile(wxLike, {
      cloudPath,
      filePath: validated.tempFilePath,
    });
    fileID = uploaded && uploaded.fileID || "";
    if (!fileID) throw makeError("AI_VOICE_UPLOAD_FAILED", "语音上传失败");
    const result = await callFunction(wxLike, {
      name: options.functionName || "aiVoiceTranscribe",
      data: {
        fileID,
        durationMs: validated.durationMs,
        fileSize: validated.fileSize,
        format: validated.format,
        deleteAfterUse: true,
      },
    });
    const payload = result && (result.result || result.data) || {};
    const text = String(payload.text || payload.transcript || "").trim();
    if (!text) throw makeError("AI_VOICE_EMPTY_RESULT", "没有识别到文字");
    writeCounter(wxLike, { date: counter.date, count: counter.count + 1 });
    return {
      text,
      durationMs: validated.durationMs,
      provider: "cloudbase-function",
    };
  } finally {
    await deleteFile(wxLike, fileID);
  }
}

module.exports = {
  DAILY_COUNTER_KEY,
  MIN_DURATION_MS,
  getConfig,
  isVoiceInputAvailable,
  normalizeFormat,
  transcribeRecording,
  validateRecording,
};
