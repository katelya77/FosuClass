# 安全与访问控制

## 边界说明

小程序客户端能够读取的静态 JSON，不能被描述为“绝对保密”。CORS、Referer、User-Agent、限流和短期票据可以提高滥用成本，但无法阻止服务端代理、抓包或伪造客户端。

因此，不要在文档、演示或宣传中使用“无法被盗取”“绝对防护”这类说法。更准确的表达是：系统通过分层鉴权、短期凭证、限流和日志脱敏降低批量滥用风险。

## 动态 API 控制

- 生产环境动态 API 的 CORS 不应使用 `Access-Control-Allow-Origin: *`。
- 管理后台来源通过 `FOSU_ALLOWED_ADMIN_ORIGINS` 配置。
- 公共浏览器来源通过 `FOSU_ALLOWED_PUBLIC_ORIGINS` 配置。
- 管理写请求需要校验 session/token；如果请求带 Origin，还要校验 Origin。
- 动态公共 API 使用 body 大小限制、速率限制和可选的小程序 session 校验。
- session 模式可通过环境策略关闭、监控/可选启用或强制启用。
- 不要把 HMAC secret、AppSecret 或固定 API key 写入小程序代码。

## 静态资源控制

- 默认模式是公开静态 Release Pack，以保证访问速度。
- 可选 ticket 模式使用短生命周期 HMAC ticket，并绑定 Release 与路径前缀。
- OpenResty 或 CDN 必须在返回受保护路径前完成 ticket 校验。
- 如果 CDN 在没有逐请求校验或安全缓存键的情况下公开缓存受保护响应，ticket 保护会失效。

## 日志脱敏

日志必须脱敏以下内容：

- `ADMIN_API_TOKEN`
- Relay token
- Session cookie
- `Authorization`
- 微信 AppSecret
- Cookie 请求头
- 本地敏感路径
- 密码和数据库凭据
