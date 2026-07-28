# 自定义 Provider 平台（CCSwitch 式）

## 能力

后台「AI Provider」页支持在不改代码的情况下接入任意 **OpenAI 兼容** 或 **Anthropic 协议** 的第三方端点：

- 多条目管理：label / protocol / baseUrl / apiKey / model / enabled / strictJsonMode。
- 一键「获取模型列表」：`GET {baseUrl}/models`（OpenAI 走 `Authorization: Bearer`，Anthropic 走 `x-api-key` + `anthropic-version: 2023-06-01`）。
- 设为主 Provider：保存后 `AI_PROVIDER=custom-openai|custom-anthropic`，理解 / 规划 / 回复各阶段也可单独指定。
- 条目列表整体作为 `AI_CUSTOM_PROVIDERS` 存入加密运行时配置（`AI_CONFIG_ENCRYPTION_KEY`），脱敏视图只暴露 `apiKeyConfigured` 与 `apiKeyLast4`，密钥永不回显。

## 运行时装配

- `server/src/services/ai/customProviderStore.js`：清洗（强制 https、Anthropic 自动补 `/v1`）、加密序列化、`resolveEntry`（activeId 优先 → 同协议首个可用条目）、`fetchModelList`。
- `server/src/services/ai/providers/customOpenaiProvider.js` / `customAnthropicProvider.js`：`generate` / `generateStructured` / `testConnection`；未配置时 fail-closed（`NOT_CONFIGURED`），绝不静默落到外部调用。
- `providerChainService` 注册 `custom-openai` / `custom-anthropic`（别名 `openai-compatible` / `anthropic` / `claude`），指标、熔断、探测与内置 Provider 完全同源。
- 管理路由在 `server/src/modules/ai-provider/routes.js`：`custom-provider/save`（写权限 + 审计）、`custom-provider/delete`、`fetch-models`。

## 安全边界

- public（正式版）环境外部 Provider 调用恒为 0；自定义 Provider 同样受 `providerChainService` 的 public 锁死约束（契约测试 group7）。
- baseUrl 强制 https；密钥只用于出站请求，不进日志、不进 Trace、不进快照。
- 保存 / 删除走 `verifyAdminWriteAccess`（CSRF + Origin + scope）并写审计日志。

## 验证

- 离线契约：`tools/test-custom-providers.js`（7 组，随 `test:agent-foundation` 运行）。
- 真实链路：`server/scripts/verify-custom-provider.js`（容器内运行；注册条目 → 真实 `GET /models` → trial 全阶段切到 custom-openai → 真实 `agentService.chat` → 探测 → `finally` 恢复原配置）。通过 `Deploy to VPS` 工作流的 `verify_custom_openai` 输入触发。

## 排障

- 探测失败先看后台「调用日志」窗口的分类（`unauthorized` / `not_found` / 网络类）。
- Anthropic 端点填到域名即可（如 `https://api.anthropic.com`），`/v1` 会自动补全。
- `strictJsonMode` 关闭时，OpenAI 兼容端点结构化请求自动退化为无 `response_format` 的普通请求（适配不支持 JSON mode 的网关）。
