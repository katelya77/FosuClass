// aiVoiceTranscribe 云函数 handler 测试（依赖注入，无需真实云环境/密钥）
// 运行: node tools/test-ai-voice-transcribe.js

const assert = require("assert");
const path = require("path");

const root = path.join(__dirname, "..");
const handler = require(path.join(root, "cloudfunctions/aiVoiceTranscribe/handler.js"));

const ENV = { TENCENT_ASR_SECRET_ID: "test-sid", TENCENT_ASR_SECRET_KEY: "test-sk" };
const AUDIO = Buffer.from("fake-audio-bytes");
const GOOD_DEPS = {
  downloadFile: async () => AUDIO,
  deleteFile: async () => {},
  sentenceRecognition: async () => ({ text: "明天第一节课在哪上" }),
};
const GOOD_EVENT = { fileID: "cloud://env/voice-transient/a.mp3", durationMs: 2000, fileSize: AUDIO.length, format: "mp3" };

// ---------- 1. 输入校验 ----------
{
  assert.strictEqual(handler.validateInput(handler.normalizeInput({})).code, "AI_VOICE_FILE_REQUIRED");
  assert.strictEqual(
    handler.validateInput(handler.normalizeInput({ fileID: "x", format: "exe" })).code,
    "AI_VOICE_FORMAT_UNSUPPORTED"
  );
  assert.strictEqual(
    handler.validateInput(handler.normalizeInput({ fileID: "x", format: "mp3", durationMs: 90000 })).code,
    "AI_VOICE_TOO_LONG"
  );
  assert.strictEqual(
    handler.validateInput(handler.normalizeInput({ fileID: "x", format: "mp3", durationMs: 100 })).code,
    "AI_VOICE_TOO_SHORT"
  );
  assert.strictEqual(
    handler.validateInput(handler.normalizeInput({ fileID: "x", format: "mp3", fileSize: 4 * 1024 * 1024 })).code,
    "AI_VOICE_FILE_TOO_LARGE"
  );
  assert.strictEqual(handler.validateInput(handler.normalizeInput(GOOD_EVENT)), null, "合法输入必须放行");
  handler.ALLOWED_FORMATS.forEach((format) => {
    assert.strictEqual(
      handler.validateInput(handler.normalizeInput({ fileID: "x", format })),
      null,
      `${format} 必须在格式白名单内`
    );
  });
}

// ---------- 2. 密钥只在服务端环境变量 ----------
{
  assert.strictEqual(handler.getAsrCredentials({}), null, "未配置密钥时必须判定未配置");
  assert.strictEqual(handler.getAsrCredentials({ TENCENT_ASR_SECRET_ID: "a" }), null, "缺一不可");
  assert.deepStrictEqual(handler.getAsrCredentials(ENV), { secretId: "test-sid", secretKey: "test-sk" });
}

// ---------- 3. 转写主流程 ----------
async function testFlow() {
  // 成功路径
  const ok = await handler.transcribeEvent(GOOD_EVENT, GOOD_DEPS, ENV);
  assert.deepStrictEqual(ok, { text: "明天第一节课在哪上" });

  // 未配置密钥
  const notConfigured = await handler.transcribeEvent(GOOD_EVENT, GOOD_DEPS, {});
  assert.strictEqual(notConfigured.code, "AI_VOICE_NOT_CONFIGURED");

  // 下载失败
  const downloadFailed = await handler.transcribeEvent(
    GOOD_EVENT,
    Object.assign({}, GOOD_DEPS, { downloadFile: async () => { throw new Error("boom"); } }),
    ENV
  );
  assert.strictEqual(downloadFailed.code, "AI_VOICE_DOWNLOAD_FAILED");

  // 空文件
  const emptyFile = await handler.transcribeEvent(
    GOOD_EVENT,
    Object.assign({}, GOOD_DEPS, { downloadFile: async () => Buffer.alloc(0) }),
    ENV
  );
  assert.strictEqual(emptyFile.code, "AI_VOICE_DOWNLOAD_FAILED");

  // ASR 失败不抛异常，返回结构化错误
  const asrFailed = await handler.transcribeEvent(
    GOOD_EVENT,
    Object.assign({}, GOOD_DEPS, { sentenceRecognition: async () => { throw new Error("asr down"); } }),
    ENV
  );
  assert.strictEqual(asrFailed.code, "AI_VOICE_ASR_FAILED");
  assert.strictEqual(asrFailed.success, false);

  // ASR 空结果
  const emptyResult = await handler.transcribeEvent(
    GOOD_EVENT,
    Object.assign({}, GOOD_DEPS, { sentenceRecognition: async () => ({ text: "  " }) }),
    ENV
  );
  assert.strictEqual(emptyResult.code, "AI_VOICE_EMPTY_RESULT");

  // deleteAfterUse：触发删除；删除失败不影响结果
  let deleted = "";
  const withDelete = await handler.transcribeEvent(
    Object.assign({}, GOOD_EVENT, { deleteAfterUse: true }),
    Object.assign({}, GOOD_DEPS, { deleteFile: async (fileID) => { deleted = fileID; throw new Error("ignore"); } }),
    ENV
  );
  assert.deepStrictEqual(withDelete, { text: "明天第一节课在哪上" }, "清理失败不得影响转写结果");
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(deleted, GOOD_EVENT.fileID, "deleteAfterUse 必须清理临时文件");

  // deleteAfterUse=false 不删除
  let deleteCalled = false;
  await handler.transcribeEvent(
    Object.assign({}, GOOD_EVENT, { deleteAfterUse: false }),
    Object.assign({}, GOOD_DEPS, { deleteFile: async () => { deleteCalled = true; } }),
    ENV
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(deleteCalled, false);

  // base64 传输给 ASR
  let captured = null;
  await handler.transcribeEvent(
    GOOD_EVENT,
    Object.assign({}, GOOD_DEPS, { sentenceRecognition: async (params) => { captured = params; return { text: "ok" }; } }),
    ENV
  );
  assert.strictEqual(captured.dataBase64, AUDIO.toString("base64"));
  assert.deepStrictEqual(captured.credentials, { secretId: "test-sid", secretKey: "test-sk" });
}

// ---------- 4. 端上契约对齐 ----------
{
  const serviceSource = require("fs").readFileSync(
    path.join(root, "miniprogram/services/aiVoiceInputService.js"), "utf8"
  );
  assert.ok(serviceSource.includes('"aiVoiceTranscribe"'), "小程序端默认函数名必须是 aiVoiceTranscribe");
  assert.ok(serviceSource.includes("fileID"), "小程序端必须传 fileID");
  assert.ok(serviceSource.includes("deleteAfterUse"), "小程序端必须传 deleteAfterUse");
  assert.ok(serviceSource.includes("payload.text"), "小程序端读取 text 字段");
}

testFlow()
  .then(() => console.log("test-ai-voice-transcribe passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
