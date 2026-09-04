const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

async function run() {
  const js = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js");
  const wxml = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml");
  const wxss = read("miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss");
  const appJson = JSON.parse(read("miniprogram/app.json"));
  const cloudbaseConfig = read("miniprogram/config/cloudbase.js");
  const cloudbaseManifest = read("cloudbaserc.json");

  assert(
    wxml.includes('confirm-type="search"') || wxml.includes('confirm-type="send"'),
    "textarea must request search/send confirm key"
  );
  assert(wxml.includes('confirm-hold="{{false}}"'), "confirm-hold must be false");
  assert(wxml.includes('show-confirm-bar="{{false}}"'), "mobile confirm bar must be hidden");
  assert(wxml.includes('bindconfirm="onComposerConfirm"'), "textarea confirm must query");
  assert(wxml.includes('bindcompositionstart="onCompositionStart"'), "IME composition start must be tracked");
  assert(wxml.includes('bindcompositionend="onCompositionEnd"'), "IME composition end must be tracked");
  assert(wxml.includes('bindtap="onSubmit"'), "query button must use onSubmit");
  assert(!wxml.includes("newline-btn"), "explicit newline button must be removed");
  assert(!/voice|microphone|stop-wave/i.test(wxml), "assistant UI must not expose voice controls");

  assert(js.includes("const SEND_DEDUPE_MS = 420"), "send dedupe window must be 300-500ms");
  assert(js.includes("onComposerConfirm(event)"), "confirm handler missing");
  assert(js.includes("if (this._isComposing) return;"), "IME composition must not send");
  assert(js.includes("this.sendMessage(value == null ? this.data.inputValue : value"), "confirm and button must share sendMessage");
  assert(js.includes("this._lastSubmitText === message"), "duplicate send guard missing");
  assert(js.includes("if (!message || this.data.sending) return;"), "empty/sending guard missing");
  assert(js.includes('inputValue: ""'), "successful send must clear input");
  assert(!/voice|recorder|recording|recognizing/i.test(js), "assistant page logic must not initialize recording or transcription");
  assert(!/\.voice-btn|\.voice-status/.test(wxss), "assistant styles must not retain voice controls");
  assert(!appJson.permission || !appJson.permission["scope.record"], "app must not request record permission");
  assert(!/AI_VOICE_|aiVoiceTranscribe/.test(cloudbaseConfig), "client configuration must not retain voice capability flags");
  assert(!/aiVoiceTranscribe/.test(cloudbaseManifest), "CloudBase manifest must not deploy the retired voice function");
  assert(wxml.includes("composer-pill") || wxml.includes("composer-icon"), "composer must be unified pill");
  assert(wxml.includes("描述任务，可带上时间和地点"), "composer should guide users to provide actionable slots");

  console.log("test-ai-assistant-text-input passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
