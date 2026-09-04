# OpenRouter 免费模型路由（trial / dev）

OpenRouter 是小序体验版与开发版的可选理解/规划 Provider。正式版 `public` 仍被服务端硬护栏固定为 `mock + tool-only`，不会调用 OpenRouter 或任何外部生成式模型。

## 运行链

默认候选顺序（2026-09-04 的可用目录快照）为：

1. `z-ai/glm-5.2:free`
2. `nvidia/nemotron-3-super-120b-a12b:free`
3. `liquid/lfm-2.5-2.6b:free`
4. `openrouter/free`

免费模型清单会变化，以上不是永久可用承诺。后台可随时编辑 `OPENROUTER_MODELS`；末尾的 `openrouter/free` 会由 OpenRouter 在当前可用免费模型中动态选择。请求使用有序 `models` 回退，并开启 `allow_fallbacks`。结构化理解/规划阶段还会设置 `require_parameters=true`，避免路由到不支持请求参数的端点；`data_collection=deny` 用于排除声明收集数据的端点。

官方参考：

- <https://openrouter.ai/docs/guides/routing/routers/free-router>
- <https://openrouter.ai/docs/guides/routing/model-fallbacks>
- <https://openrouter.ai/docs/guides/routing/provider-selection>

## 配置与安全

在后台“Provider 控制台”选择 OpenRouter，填写轮换后的 API Key、模型顺序和超时并保存。Key 只进入服务端加密运行时配置，接口仅返回“已配置”和尾号，不回显明文。聊天、Trace、普通日志、文档和测试快照不得包含 Key。

相关键：

- `OPENROUTER_ENABLED`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODELS`
- `OPENROUTER_TIMEOUT_MS`
- `OPENROUTER_MAX_TOKENS`

Provider 失败时先由 OpenRouter 在候选模型之间切换；整个平台请求仍失败时，服务端 Provider Chain 会继续切换到下一 Provider，最终保留确定性 `mock` 工具结果。

## 移除与恢复

内置外部 Provider 可从后台运行时注册表移除。移除会：

- 从 trial/dev 主链、阶段分配和影子链中撤销该 Provider；
- 保留已加密凭据，不做不可逆擦除；
- 写入后台审计并清理旧熔断状态；
- 保持 public 的 `mock` 安全锚点不变。

恢复只重新注册 Provider，不会自动设为主 Provider；管理员需重新选择并保存后才会参与调用。
