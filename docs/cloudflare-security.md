# Cloudflare 缓存安全

## 公开模式

当使用 `FOSU_SECURITY_MODE=observe` 且 `FOSU_STATIC_ACCESS_MODE=public` 时，`/static/releases/*` 可以继续使用不可变公开缓存，以保证小程序读取速度。

## 源站 ticket 模式

如果由 OpenResty 在源站校验 `X-Fosu-Static-Ticket`，必须避免 Cloudflare 把第一次已授权响应变成匿名公开缓存命中。

受保护路径应采用以下策略之一：

- ticket 模式启用时，对 `/static/releases/*` 绕过缓存。
- 或者仅在边缘 Worker 校验同一个 ticket 后再缓存，并把授权状态纳入缓存键。
- 永远不要把 ticket 放进 URL query。
- 不要给 401/403 响应设置过长缓存 TTL。

推荐的受保护响应头：

```http
Cache-Control: private, no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

## 边缘 ticket 模式

只有 Cloudflare Worker 或等效边缘代码完成 HMAC 校验后，才适合在用户之间共享缓存静态对象。普通 Cache Rule 本身不能校验 HMAC。
