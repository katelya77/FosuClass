# Device / DevTools verification report

trialVersion: 1.0.0-trial-20260725
appid: wx450dc86653f5907b

## Automated / production (PASS — 23/23)

- Status island CSS: width 100%, no extra 8rpx, reduced-motion, collapse/expand same-width
- Composer: align-items center, absolute float, composerInsetPx loop, keyboard height sync
- Geometry DOM snapshot: full-width centered (≤4rpx), last-msg gap 12px (~24rpx) in range
- Teacher search: prod schema 3; 陈芳 全校=1 / 动科=1 / 人文=0
- Schedule navigation: 4 types → schedule-view; unique teacher action「打开教师课表」
- Voice reasonCodes: UNDECIDED can retry; DENIED openSetting; ASR separate
- Trial package ~1.72MB; formal review not submitted

## Phone-only (require manual trial)

WeChat DevTools CLI service port is not listening (cannot auto-screenshot).

| # | Check | How on trial 1.0.0-trial-20260725 |
|---|-------|-------------------------------------|
| 1 | 状态岛收展同宽 | 点状态岛 |
| 2 | 滚底末卡间距 | 长对话后滚底 |
| 3 | 胶囊按钮居中 | 看 +/麦/发送 |
| 4 | 陈芳三组 | 全校页学院筛选 |
| 5 | 打开教师课表 | Agent 唯一结果主按钮 |
| 6 | 麦克风授权 | 首次/拒绝/设置返回 |
| 7 | 短录音转写 | 填框且不自动发送 |

## ASR

CloudBase aiVoiceTranscribe deployed; real short-audio requires phone trial mic.
