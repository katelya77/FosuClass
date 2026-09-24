# FosuClass 个人课表同步状态

## 当前结论

Personal Sync V1 的主路径是 Client Direct：用户手机连接佛山大学校园网或校园 VPN 后，在个人课表同步页完成本人授权，由小程序直接登录学校统一认证并读取 100 网个人课表。学校学号和密码只留在当次页面内存里。`class.katelya.eu.org` 只接收课表页面响应，负责解析和生成与原来一致的预览。

- 小程序 `/pages/personal-sync/personal-sync` 保留学号同步、预览整理、确认导入，以及 XLS 导入。
- Client Direct 调用 `POST /api/schedule-import/fosu/direct/preview`。请求体只有课表响应，不包含学校密码、Cookie 或登录票据。
- XLS 导入始终保留。
- 旧接口 `/diagnose`、`/session/start`、`/session/verify-slider`、`/session/login-and-sync` 仍返回 `410 XLS_ONLY`，不作为这条线路的入口。
- `/api/schedule-import/fosu/public-key`、`/preview/start`、`/preview/status` 保留给以后的 Server Relay，Client Direct 默认不调用。
- Outbound Campus Agent 只保留来源名称，本阶段不实现。
- 学校要求验证码或滑块时，本次直接失败并提示改用 XLS，不自动破解。

## 安全边界

学校凭据只存在于个人课表同步页的当次输入和客户端直连调用栈。同步结束或失败后清空密码和内存 Cookie。

这些内容不会发给 class 后端、CloudBase、AI、日志、Storage、埋点或最近导入缓存：

- 学校密码
- Cookie、CASTGC、JSESSIONID
- ticket、execution、pwdEncryptSalt

AI 助手不得要求用户在对话里发送密码，也不得读取个人课表页的密码字段。用户自己在个人课表同步页输入密码，和 AI 接触密码，是两件不同的事。

XLS 导入只解析课程名、教师、教室、星期、节次、教学周和学期元数据。原始 XLS 内容、文件 base64、学号、密码、Cookie、token 不会发送给 AI Provider。

个人课表摘要默认关闭。用户在 AI 页单独开启后，也只发送最小课程字段；后端仍受 `AI_ALLOW_PERSONAL_CONTEXT` gate 和 `safetyGuard` 保护。

## 验收

```bash
npm run test:fosu-direct-cookie-jar
npm run test:fosu-direct-password-crypto
npm run test:fosu-direct-redirect
npm run test:fosu-direct-client
npm run test:fosu-direct-preview-route
npm run test:personal-sync-direct-mode
npm run test:personal-sync-xls-only
npm run test:personal-routes-xls-only-server
npm run test:import-personal-xls
npm run test:security-full
```
