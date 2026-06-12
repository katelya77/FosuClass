# OpenResty 静态 Ticket 模式

`FOSU_STATIC_ACCESS_MODE=public` 是默认值。只有在 OpenResty 或 CDN 能可靠校验 ticket 时，才启用 `ticket` 模式。

## 票据契约

Ticket 是一个 HMAC token，包含：

- `releaseVersion`
- `pathPrefix`
- `exp`
- `iat`
- `nonce`

Ticket 不包含敏感用户信息。

## Node.js 辅助函数

```js
const {
  createStaticAccessTicket,
  verifyStaticAccessTicket,
} = require("./server/src/utils/staticAccessTicket");

const ticket = createStaticAccessTicket({
  releaseVersion: "2026-06-05T12-39-28",
  pathPrefix: "/index/class/",
  ttlSeconds: 300,
});
```

## OpenResty / CDN 安全模式

推荐使用以下安全模式之一：

- 在 CDN 边缘层完成 HMAC 校验，再进入缓存查找。
- 对受保护路径关闭公开边缘缓存。
- 使用支持鉴权校验的 CDN 功能，并确保共享缓存键不会绕过授权状态。

不要只在源站鉴权，同时又允许 CDN 将已授权响应公开缓存给匿名请求。

## 来源页防护

Referer 拦截可以降低第三方网页盗链，但它不是主要安全机制。微信小程序请求可能没有可用的 Referer，因此不能依赖 Referer 做核心鉴权。
