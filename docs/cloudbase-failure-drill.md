# CloudBase Mock 故障测试与真实 Smoke

## Mock 测试目标

验证 Oracle、CloudBase、AI Provider 任一方故障时，小程序核心课表仍可用，页面不清空、不无限 loading。

`npm run cloudbase:failure-drill` 使用 `mockEnv` 和 `wx.mockRequest`，只验证客户端降级逻辑，不代表真实云端故障演练。真实网络、DNS、HTTP、content-type、latency、hash/size 和 Oracle/CloudBase pointer 一致性必须运行：

```bash
npm run cloudbase:live-smoke
```

## 场景 1：Oracle 正常，CloudBase 正常

预期：

- CloudBase Hosting 是静态 Release Pack 主源。
- Oracle 静态源是备用源。
- 事实查询走 Oracle 工具 Agent。
- 生成式帮助优先走 CloudBase 混元。

验证：

```bash
npm run test:cloudbase-static-origin
npm run test:cloudbase-ai-router
```

## 场景 2：Oracle 停止

操作：

- 暂停 Oracle API 或断开 `https://class.katelya.eu.org`。
- 保持 CloudBase Hosting 可访问。

预期：

- 新用户仍能从 CloudBase Hosting 获取当前 Release Pack。
- 已缓存用户继续使用 last-known-good。
- 开放式 AI 根据配置继续用混元，或友好降级。
- 管理、导入、贡献等动态功能提示维护，不拖垮课表页面。

## 场景 3：CloudBase 停止

操作：

- 临时清空 `CLOUDBASE_HOSTING_BASE_URL`，或阻断 CloudBase Hosting 域名。
- 保持 Oracle 静态目录可访问。

预期：

- 小程序快速跳过 CloudBase 源。
- 自动读取 Oracle `/static/runtime/active.json` 和 `/static/releases`。
- 混元不可用时 AI 回退 Oracle DeepSeek/Coze 或 mock。

回滚配置：

```js
CLOUDBASE_HOSTING_ENABLED: false
CLOUDBASE_AI_ENABLED: false
```

## 场景 4：两端都停止

操作：

- 同时阻断 CloudBase Hosting 和 Oracle。
- 本机保留已有 last-known-good。

预期：

- 页面继续显示最近一次已验证的课表。
- 不清空列表。
- 不出现无限 loading。
- 显示缓存或维护提示。

## 场景 5：新 Release 验证失败

操作：

```bash
npm run cloudbase:release:dry-run -- --release-version <badReleaseVersion>
```

预期：

- 本地验证或隐私扫描失败。
- 不上传 `runtime/active.json`。
- 旧 active pointer 保持可用。

## 场景 6：发布中断

操作：

- 模拟 `tcb hosting deploy releases/{releaseVersion}` 上传成功但远端抽样验证失败。

预期：

- `runtime/active.json` 不更新。
- 小程序仍读取旧版本。
- 运维人员可重试版本上传或删除半成品版本目录。

## 场景 7：混元并发受限

操作：

- 模拟 CloudBase 返回 `EXCEED_CONCURRENT_REQUEST_LIMIT`。

预期：

- 小程序端最多重试一次。
- 仍失败后立即回退 Oracle Provider 或 mock。
- 页面显示“当前使用人数较多，已切换备用回答”。
- 不重复消耗 Token。

## 生产切换前检查清单

- CloudBase Hosting 域名已由 `tcb hosting detail -e cloud1-d3g17rpe7566d3d5c` 确认。
- 微信公众平台已配置 CloudBase Hosting 和 Oracle 域名。
- Release Pack 隐私扫描通过。
- CloudBase 远端验证通过。
- Oracle 静态源回退验证通过。
- last-known-good 场景验证通过。
- 生成式 AI 合规开关符合当前版本类型。
- 用户明确允许切换生产读取顺序。

## 一键关闭路径

关闭 CloudBase 静态主源：

```js
CLOUDBASE_HOSTING_ENABLED: false
```

关闭混元：

```js
CLOUDBASE_AI_ENABLED: false
```

公开版关闭开放式生成：

```js
AI_GENERATIVE_PUBLIC_ENABLED: false
AI_TOOL_ONLY_MODE: true
```

回到 Oracle Provider：

```bash
AI_PROVIDER=deepseek
# 或
AI_PROVIDER=mock
```
