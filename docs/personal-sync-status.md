# FosuClass 个人课表同步状态

## 当前结论

Personal Sync V2 的自动同步只有两条来源：当前启用的校园网直连（client-direct），以及尚未实现的远程同步（campus-agent，`enableCampusAgentSync=false`）。用户在个人课表同步页输入学号和学校密码。学校凭据只留在当次页面内存。`class.katelya.eu.org` 只接收课表页面响应，负责解析和预览。

- 小程序首页是一个同步按钮。XLS、班级课表、手动添加课程是其他导入方式，不是第三条自动同步线路。
- Client Direct 调用 `POST /api/schedule-import/fosu/direct/preview`。请求体只有课表响应。
- APaaS、CloudBase relay、Oracle fallback 和服务端代登录已经从运行时删除。
- `/api/schedule-import/fosu` 只保留 `direct/preview`、`recent`、`recent/confirm`、`confirm`、`cancel`。
- campus-agent 调用会返回 `CAMPUS_AGENT_NOT_AVAILABLE`，不会伪造成功。
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
