# 冷启动运行时

冷启动流程现在会先解析一个轻量的 active runtime 指针，再加载体积较大的 Release 索引，避免小程序启动阶段被大 JSON 阻塞。

## 启动流程

1. 如果本地存在 active release 缓存，优先读取本地缓存。
2. 无 session 依赖地请求 `/static/runtime/active.json`。
3. 必要时回退到 `/api/fosu/runtime/active`，再回退到动态 `app-config`。
4. 立即应用 `termConfig`，让页面可以先渲染日期和学期标签。
5. 后台通过 singleflight 任务加载 `bootstrap`、公告、session 预热和 Release 索引。
6. `periodic-data` 至少延后到应用启动 10 秒后再加载。

## 运行时指针内容

Runtime 指针在 Release 成功激活后生成，只包含以下轻量信息：

- term
- release version
- cache epoch
- term config
- static URLs

它不包含敏感用户信息，因此可以作为公开静态 JSON 提供访问。

## 开发诊断

开发和测试环境可通过 `X-Fosu-Request-Stats` 查看诊断信息：

```json
{
  "requestId": "mabc-123",
  "route": "/api/fosu/bootstrap",
  "totalMs": 12,
  "fileReadCount": 2,
  "jsonParseCount": 2,
  "payloadBytes": 4096,
  "cacheHit": true,
  "source": "release-bootstrap",
  "releaseVersion": "2026-...",
  "term": "2025-2026-2"
}
```

诊断信息不会记录 session、ticket、cookie、OpenID、token 等敏感值。
