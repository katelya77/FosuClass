# FosuClass 个人课表同步状态

## 当前结论

v0.5 起，FosuClass 已彻底下线“学号 + 密码”个人课表同步方案，只保留 XLS 导入。

- 小程序 `/pages/personal-sync/personal-sync` 仅展示 XLS/XLSX 文件导入。
- 后端 `server/src/routes/personal.js` 仅保留 `POST /api/fosu/personal/import-xls`。
- 旧接口 `/diagnose`、`/session/start`、`/session/verify-slider`、`/session/login-and-sync` 返回 `410 XLS_ONLY`。
- AI 助手只引导 XLS 导入，不要求也不接收教务密码。

## 安全边界

XLS 导入只解析课程名、教师、教室、星期、节次、教学周和学期元数据。原始 XLS 内容、文件 base64、学号、密码、Cookie、token 不会发送给 AI Provider。

个人课表摘要默认关闭。用户在 AI 页单独开启后，也只发送最小课程字段；后端仍受 `AI_ALLOW_PERSONAL_CONTEXT` gate 和 `safetyGuard` 保护。

## 验收

```bash
npm run test:personal-routes-xls-only-server
npm run test:import-personal-xls
npm run test:security-full
```
