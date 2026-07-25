// 第七章：aiVoiceTranscribe handler 本地行为验证（mock deps，不伪造部署成功）
const handler = require("../cloudfunctions/aiVoiceTranscribe/handler");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}

const ENV_WITH_CRED = { TENCENT_ASR_SECRET_ID: "sid", TENCENT_ASR_SECRET_KEY: "skey" };
const VALID = { fileID: "cloud://test/voice.mp3", durationMs: 3000, fileSize: 50000, format: "mp3" };

function makeDeps(overrides = {}) {
  const calls = { deleteFile: 0, downloadFile: 0, sentenceRecognition: 0 };
  return {
    calls,
    downloadFile: async () => { calls.downloadFile++; return Buffer.from("fake-audio"); },
    sentenceRecognition: async () => { calls.sentenceRecognition++; return { text: "明天第一节课是什么" }; },
    deleteFile: async () => { calls.deleteFile++; },
    ...overrides,
  };
}

(async () => {
  let r = await handler.transcribeEvent({ ...VALID, fileID: "" }, makeDeps(), ENV_WITH_CRED);
  check("缺 fileID -> AI_VOICE_FILE_REQUIRED", r.code === "AI_VOICE_FILE_REQUIRED");

  r = await handler.transcribeEvent({ ...VALID, format: "exe" }, makeDeps(), ENV_WITH_CRED);
  check("非法格式 -> AI_VOICE_FORMAT_UNSUPPORTED", r.code === "AI_VOICE_FORMAT_UNSUPPORTED");

  r = await handler.transcribeEvent({ ...VALID, durationMs: 90000 }, makeDeps(), ENV_WITH_CRED);
  check("超 60s -> AI_VOICE_TOO_LONG", r.code === "AI_VOICE_TOO_LONG");

  r = await handler.transcribeEvent(VALID, makeDeps(), {});
  check("缺 ASR 凭据 -> AI_VOICE_NOT_CONFIGURED", r.code === "AI_VOICE_NOT_CONFIGURED");

  const deps = makeDeps();
  r = await handler.transcribeEvent(VALID, deps, ENV_WITH_CRED);
  check("正常转写返回 {text}", typeof r.text === "string" && r.text.length > 0, JSON.stringify(r).slice(0, 80));
  await new Promise((res) => setTimeout(res, 30)); // 等待异步删除
  check("deleteAfterUse 默认 true -> 临时音频已删除", deps.calls.deleteFile === 1, "deleteFile calls=" + deps.calls.deleteFile);

  const deps2 = makeDeps();
  r = await handler.transcribeEvent({ ...VALID, deleteAfterUse: false }, deps2, ENV_WITH_CRED);
  await new Promise((res) => setTimeout(res, 30));
  check("deleteAfterUse=false -> 不删除", deps2.calls.deleteFile === 0);

  const deps3 = makeDeps({ downloadFile: async () => { throw new Error("io"); } });
  r = await handler.transcribeEvent(VALID, deps3, ENV_WITH_CRED);
  check("下载失败 -> AI_VOICE_DOWNLOAD_FAILED", r.code === "AI_VOICE_DOWNLOAD_FAILED");

  const deps4 = makeDeps({ sentenceRecognition: async () => { throw new Error("asr down"); } });
  r = await handler.transcribeEvent(VALID, deps4, ENV_WITH_CRED);
  check("ASR 失败 -> AI_VOICE_ASR_FAILED", r.code === "AI_VOICE_ASR_FAILED");

  console.log("---");
  console.log("pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FATAL " + e.message); process.exit(1); });
