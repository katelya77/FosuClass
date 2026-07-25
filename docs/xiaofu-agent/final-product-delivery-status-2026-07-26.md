# Final delivery status — 小佛助手最终可交付收敛

Date: 2026-07-26
main HEAD: (see git after commit)

## 代码完成
**完成** — PR #34 已合并；后续 keyboard inset / upload helper 已上 main

## Release Pack 发布
**完成**
- rebuild job `release-pack-rebuild-1785007757034-0x1b0v` **success**
- manifest.teacherIndexSchemaVersion = **3**
- static teacher index: 1133 rows with collegeCodes + normalizedName + schema 3
- 陈芳验收: 全校=1 / 动物科技学院=1 / 人文学院=0

## CI
**完成** (PR #34 + main green)

## VPS/GHCR
**完成**

## CloudBase 部署
**完成（函数）** aiVoiceTranscribe 已部署（≠ ASR 成功）

## 体验版上传
**未完成** — miniprogram-ci 编译打包成功，上传被微信拒绝：
- errCode -10008 invalid ip: **146.235.201.244**
- 请把该 IP 加入代码上传 IP 白名单后执行：`npm run upload:wechat-trial`
- 正式审核：**未提交**
- version 拟用：`1.0.0-trial-20260725`

## 真机验证
**未完成** — 依赖体验版

## ASR 真音频
**未完成** — 依赖体验版麦克风
