# CloudBase MCP Test Report

日期：2026-07-08

目标环境：`cloud1-d3g17rpe7566d3d5c`

## 安装与注册结果

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `npm i @cloudbase/cloudbase-mcp -g` | 未完成 | npm 返回 `EEXIST`，本机已有 `C:\Users\Katelya\AppData\Roaming\npm\cloudbase-mcp`，本次未使用 `--force` 覆盖。 |
| `codex mcp add cloudbase --env INTEGRATION_IDE=Codex -- cmd /c cloudbase-mcp` | 成功 | Codex 返回 `Added global MCP server 'cloudbase'.` |
| `npx skills add tencentcloudbase/cloudbase-skills -y` | 成功 | 已安装 `cloudbase` skill 到项目 `.agents/skills/cloudbase`。 |
| `cmd /c cloudbase-mcp --help` | 失败 | 本地全局入口缺少 `@cloudbase/cloudbase-mcp` 模块依赖。 |
| `npx -y @cloudbase/cloudbase-mcp@latest --help` | 可启动 | 命令正常退出，未输出帮助文本。 |
| `codex mcp list` | 已启用 | `cloudbase` MCP 处于 enabled 状态。 |

## MCP 可用性

MCP `resources/list` 与 `resources/templates/list` 返回 `Method not found`，但通过 `tool_search` 成功暴露了 CloudBase MCP 工具，包括：

- `auth`
- `searchKnowledgeBase`
- `queryGateway`
- `queryHosting`
- `callCloudApi`
- `manageAppAuth`
- `queryAgents`
- `manageAgents`
- `managePgDatabase`
- `queryPgStorage`
- `readNoSqlDatabaseContent`

## 环境状态

`auth status` 与 `auth set_env` 均确认当前环境可用：

- `auth_status`: `READY`
- `env_status`: `READY`
- `current_env_id`: `cloud1-d3g17rpe7566d3d5c`

`DescribeEnvs` 只读检查结果：

- 环境状态：`NORMAL`
- 区域：`ap-shanghai`
- 来源：`miniapp`
- 套餐：个人版
- 数据库：`tnt-dqt0voeii`，`RUNNING`
- 云存储：`636c-cloud1-d3g17rpe7566d3d5c-1442900641`，`NORMAL`
- 静态托管：`cloud1-d3g17rpe7566d3d5c-1442900641.tcloudbaseapp.com`，`online`
- 环境元信息：`ai_la_inspire_plan=enable`

## 网关与托管

`queryGateway listDomains`：

- HTTP 服务已开启：`EnableService=true`
- 默认服务域名：`cloud1-d3g17rpe7566d3d5c.service.tcloudbase.com`
- 源站域名：`cloud1-d3g17rpe7566d3d5c.tcbaccess-in.tencentcloudbase.com`

`queryGateway listRoutes`：

- 默认 CDN 域名：`cloud1-d3g17rpe7566d3d5c-1442900641.ap-shanghai.app.tcloudbase.com`
- 已启用路由：`/fosu-import-relay`
- 上游资源：SCF `fosuImportRelay`
- 路由认证：`EnableAuth=false`

`queryHosting status`：

- 静态托管已启用
- 状态：`online`
- 托管域名：`cloud1-d3g17rpe7566d3d5c-1442900641.tcloudbaseapp.com`

## 大模型接口与模型信息

通过 CloudBase MCP `searchKnowledgeBase(mode=openapi, apiName=ai_model)` 读取到统一 AI 模型 HTTP API：

- 调用入口：`https://{envId}.api.tcloudbasegateway.com/v1/ai/{provider}/{path}`
- 支持 OpenAI Chat Completions：`chat/completions`
- 支持 OpenAI Responses：`responses`
- 支持 Anthropic Messages：`v1/messages`
- 内置 provider：`cloudbase`、`hunyuan-v3`
- OpenAI Responses 支持模型：`hy3-preview`
- 常见错误码包括：`AI_MODEL_CONFIG_MISSING`、`AI_MODEL_DISABLED`、`AI_MODEL_NOT_SUPPORTED`、`EXCEED_TOKEN_QUOTA_LIMIT`

通过官方文档检索确认：

- CloudBase 工具链使用 `hy3-preview` 作为 OpenAI Base URL 场景中的模型名称。
- 小程序 `wx.cloud.extend.AI.createModel("cloudbase")` 示例也使用 `hy3-preview`。

当前 MCP 没有暴露“列出某环境已启用模型分组”的专用只读工具，因此本次无法通过 MCP 直接枚举控制台模型配置。后续真实可用性以 `tools/test-live-ai-providers.js` 的 HTTP 调用结果为准。

## 结论

CloudBase MCP 已注册并可调用，目标环境、网关、静态托管均可读且状态正常。全局 `cloudbase-mcp` 可执行文件存在依赖缺失，建议后续在可维护窗口清理旧入口或使用 `npm i @cloudbase/cloudbase-mcp -g --force` 重新安装。本次不强制覆盖，避免破坏用户现有全局命令。
