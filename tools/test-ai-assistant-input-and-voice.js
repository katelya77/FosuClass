const assert = require("assert");
const fs = require("fs");
const path = require("path");

const voiceService = require("../miniprogram/services/aiVoiceInputService");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function makeWxMock() {
  const calls = [];
  const storage = {};
  return {
    calls,
    getAccountInfoSync() {
      return { miniProgram: { envVersion: "trial" } };
    },
    getRecorderManager() {
      return {};
    },
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    cloud: {
      uploadFile(options) {
        calls.push({ type: "upload", options });
        options.success({ fileID: "cloud://voice-temp/file.mp3" });
      },
      callFunction(options) {
        calls.push({ type: "callFunction", options });
        options.success({ result: { text: "明天有课吗" } });
      },
      deleteFile(options) {
        calls.push({ type: "delete", options });
        options.success({ fileList: options.fileList });
      },
    },
  };
}

async function run() {
  const js = read("miniprogram/pages/ai-assistant/ai-assistant.js");
  const wxml = read("miniprogram/pages/ai-assistant/ai-assistant.wxml");
  const wxss = read("miniprogram/pages/ai-assistant/ai-assistant.wxss");

  assert(wxml.includes('confirm-type="send"'), "textarea must request send confirm key");
  assert(wxml.includes('confirm-hold="{{false}}"'), "confirm-hold must be false");
  assert(wxml.includes('show-confirm-bar="{{false}}"'), "mobile confirm bar must be hidden");
  assert(wxml.includes('bindconfirm="onComposerConfirm"'), "textarea confirm must send");
  assert(wxml.includes('bindcompositionstart="onCompositionStart"'), "IME composition start must be tracked");
  assert(wxml.includes('bindcompositionend="onCompositionEnd"'), "IME composition end must be tracked");
  assert(wxml.includes('bindtap="onSubmit"'), "button send must use onSubmit");
  assert(wxml.includes('bindtap="onInsertNewline"'), "explicit newline button must exist");
  assert(wxml.includes('bindtap="onVoiceTap"'), "voice button must exist");
  assert(wxml.includes('voiceRecognizing || sending'), "voice must be disabled while recognizing or sending");

  assert(js.includes("const SEND_DEDUPE_MS = 420"), "send dedupe window must be 300-500ms");
  assert(js.includes("onComposerConfirm(event)"), "confirm handler missing");
  assert(js.includes("if (this._isComposing) return;"), "IME composition must not send");
  assert(js.includes("this.sendMessage(value == null ? this.data.inputValue : value"), "confirm and button must share sendMessage");
  assert(js.includes("this._lastSubmitText === message"), "duplicate send guard missing");
  assert(js.includes("if (!message || this.data.sending) return;"), "empty/sending guard missing");
  assert(js.includes('inputValue: ""'), "successful send must clear input");
  assert(js.includes("录音时间太短"), "short recording message missing");
  assert(js.includes("识别完成"), "recognition completion state missing");
  assert(js.includes("识别失败"), "recognition failure state missing");
  assert(js.includes("wx.openSetting"), "permission denial must offer settings");
  assert(wxss.includes(".voice-btn") && wxss.includes(".newline-btn"), "voice/newline controls must be styled");

  assert.strictEqual(voiceService.isVoiceInputAvailable({ AI_VOICE_INPUT_ENABLED: false }, makeWxMock()), false);
  const config = {
    AI_VOICE_INPUT_ENABLED: true,
    AI_VOICE_PROVIDER: "cloudbase-function",
    AI_VOICE_MAX_DURATION_MS: 15000,
    AI_VOICE_DAILY_LIMIT: 3,
  };
  const wxMock = makeWxMock();
  assert.strictEqual(voiceService.isVoiceInputAvailable(config, wxMock), true);
  assert.throws(() => voiceService.validateRecording({
    tempFilePath: "tmp/short.mp3",
    durationMs: 300,
    fileSize: 1000,
  }, config), /录音时间太短/);

  const result = await voiceService.transcribeRecording({
    tempFilePath: "tmp/voice.mp3",
    durationMs: 1200,
    fileSize: 1000,
    format: "mp3",
  }, { wx: wxMock, config });
  assert.strictEqual(result.text, "明天有课吗");
  assert(wxMock.calls.some((call) => call.type === "upload"), "voice file must be uploaded for transcription");
  assert(wxMock.calls.some((call) => call.type === "callFunction" && call.options.name === "aiVoiceTranscribe"), "transcription function must be called");
  assert(wxMock.calls.some((call) => call.type === "delete"), "temporary voice file must be deleted");

  console.log("test-ai-assistant-input-and-voice passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
