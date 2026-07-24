# aiVoiceTranscribe 云函数

小佛助手语音转文字闭环的服务端一环：录音文件 → 腾讯云 ASR 一句话识别 → 文本。

```
小程序端录音 (mp3, ≤60s)
  → wx.cloud.uploadFile  → 云存储 voice-transient/
  → wx.cloud.callFunction("aiVoiceTranscribe", { fileID, ... })
  → 本函数：下载文件 → base64 → 腾讯云 ASR SentenceRecognition → { text }
  → 端上填入输入框（绝不自动发送），临时文件双侧删除
```

## 部署步骤

1. **开通腾讯云 ASR**：腾讯云控制台 → 语音识别 → 开通服务；CAM 创建子用户密钥，仅授予 `QcloudASRFullAccess`。
2. **配置环境变量**（密钥只在这里出现，绝不进代码/仓库/小程序）：
   - `TENCENT_ASR_SECRET_ID`
   - `TENCENT_ASR_SECRET_KEY`
3. **上传部署**（二选一）：
   - 微信开发者工具：右键本目录 → 上传并部署：云端安装依赖
   - CLI：`tcb fn deploy aiVoiceTranscribe --dir cloudfunctions/aiVoiceTranscribe -e cloud1-d3g17rpe7566d3d5c`
4. **云存储权限**：确认安全规则允许登录用户向 `voice-transient/` 上传与自己删除。
5. **小程序端开关**：`miniprogram/config/cloudbase.js` 中 `AI_VOICE_PROVIDER = "cloudbase-function"`。

## 契约

入参：`{ fileID, durationMs, fileSize, format, deleteAfterUse }`
返回：成功 `{ text }`；失败 `{ success: false, code, message }`（code 见 handler.js）

格式白名单：mp3 / wav / amr / silk / m4a / pcm；≤60s；≤3MB。

## 本地验证

```bash
node tools/test-ai-voice-transcribe.js   # 依赖注入测试，无需真实密钥
```
