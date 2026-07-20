# Coze 临时 Provider

Coze 是 **临时可选** 表达层 Provider，不是长期主 Provider，也不是课表事实源。

## 认证方式（唯一允许）

- PAT
- Service Credential
- 官方 API Token

**禁止：**

- 学校/个人账号密码
- 浏览器 Cookie
- 企业网页登录 Session
- 自动化网页登录

## 后台填写

1. 在 Coze 控制台创建并发布 Agent/Bot（需支持 Open API）
2. 获取 Bot/Agent ID
3. 创建 API Token（PAT 或服务凭证）
4. 在 FosuClass Legacy 后台“查询服务”填写：
   - 是否启用
   - API Base URL（默认 `https://api.coze.cn`）
   - Bot/Agent ID
   - API Token（输入后不明文回显，加密保存）
   - 到期时间 `COZE_EXPIRES_AT`
   - Provider Chain 位置（建议 trial/dev：`primary,coze,mock`）
5. 使用“测试连接 / 一键诊断增强能力”

说明文案：**请填写 API Token，不要填写学校账户密码。**

## 运行行为

- V3：创建 Chat → Retrieve → List Messages → 提取 Answer
- 到期：自动跳过，不再请求，进入下一 Provider 或本地能力
- `user_id`：`fosu-<HMAC>`，按 Principal + runtimeMode + deployEnv 隔离，永不传 OpenID 明文
- 仅传入脱敏问题、Intent、工具摘要、裁剪知识、最小会话摘要

## 企业权限不足

- 401/403：检查 Token 范围与企业授权
- Bot 未发布：先发布再测
- 429：降低调用并依赖 circuit breaker

## 停用

- 关闭 `COZE_ENABLED`
- 或设置到期时间
- 或从 `AI_PROVIDER_CHAIN` 移除
- 清除 Token（后台支持替换/清除）

## 测试

- Mock：`npm run test:coze-provider-v3`
- Live：可选，缺环境变量时跳过，不使 CI 失败
