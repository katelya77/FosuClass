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
4. 在 FosuClass 后台“AI 模型”填写：
   - 是否启用
   - 已发布 Bot ID
   - API Token（输入后不明文回显，加密保存）
   - 可选到期时间 `COZE_EXPIRES_AT`
5. 使用“测试 Coze 连接”。成功响应必须完成一次官方 Chat API 校验，而不是只检查字段非空。

说明文案：**请填写 API Token，不要填写学校账户密码。**

## 运行行为

- V3：创建 Chat → Retrieve → List Messages → 提取 Answer
- 到期：自动跳过，不再请求，进入下一 Provider 或本地能力
- `user_id`：`fosu-<HMAC>`，按 Principal + runtimeMode + deployEnv 隔离，永不传 OpenID 明文
- 仅传入脱敏问题、Intent、工具摘要、裁剪知识、最小会话摘要
- 连接诊断：区分 `TOKEN_INVALID`、`BOT_NOT_FOUND`、`BOT_NOT_PUBLISHED`、`PERMISSION_DENIED`、`RATE_LIMITED` 与 `TIMEOUT`
- Token：接口只返回“是否已配置”，输入后只显示掩码状态；不回传或记录完整值

## Bot 选择器边界

官方 Bot 列表接口需要 Workspace/Space ID，PAT 本身不足以确定查询范围。本轮因此不提供虚假的自动选择器；管理员从已发布 Bot 页面复制 Bot ID，再用连接测试实时验证。

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
