// aiVoiceTranscribe 云函数入口（薄壳）
// 录音文件 → 腾讯云 ASR 一句话识别 → 文本
// 密钥：TENCENT_ASR_SECRET_ID / TENCENT_ASR_SECRET_KEY 只在云函数环境变量配置。

const cloud = require("wx-server-sdk");
const { AsrClient } = require("tencentcloud-sdk-nodejs/tencentcloud/services/asr/v20190614/asr_client");
const { transcribeEvent } = require("./handler");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const asrClientCache = {};

function getAsrClient(credentials) {
  const key = credentials.secretId;
  if (!asrClientCache[key]) {
    asrClientCache[key] = new AsrClient({
      credential: { secretId: credentials.secretId, secretKey: credentials.secretKey },
      region: "ap-guangzhou",
      profile: { httpProfile: { endpoint: "asr.tencentcloudapi.com" } },
    });
  }
  return asrClientCache[key];
}

async function downloadFile(fileID) {
  const res = await cloud.downloadFile({ fileID });
  return res && res.fileContent;
}

async function deleteFile(fileID) {
  await cloud.deleteFile({ fileList: [fileID] });
}

async function sentenceRecognition({ dataBase64, format, credentials }) {
  const client = getAsrClient(credentials);
  const res = await client.SentenceRecognition({
    ProjectId: 0,
    SubServiceType: 2, // 中文普通话通用
    EngSerViceType: "16k_zh",
    SourceType: 1, // base64 内联
    VoiceFormat: format === "pcm" ? "pcm" : format,
    Data: dataBase64,
    UsrAudioKey: `xiaofu-${Date.now()}`,
  });
  return { text: res && res.Result };
}

exports.main = async (event) => {
  try {
    return await transcribeEvent(event, { downloadFile, deleteFile, sentenceRecognition });
  } catch (error) {
    // 不打印密钥/文件内容，只回结构化错误码
    return { success: false, code: "AI_VOICE_INTERNAL", message: "语音识别服务异常" };
  }
};
