# OpenResty 静态 Release 安全配置

`deploy/openresty/fosu-static-security.conf` 是给 1Panel 站点 `server {}` 块使用的 include 模板。只应作为片段引入，不要覆盖 1Panel 生成的完整站点配置。

## 能力检查 / Capability check

启用 ticket 模式前，先在服务器上确认 OpenResty 能力：

```bash
openresty -V 2>&1 | grep -E 'http_lua|auth_request'
openresty -t
```

如果 Lua HMAC 模块不可用，请继续使用 `public` 或 `observe`，或者采用文档中的 `auth_request` 回退方案，并设置短超时和微缓存。不要让每个静态文件正文都绕回 Node 处理。

## 模式说明

- `public`：当前兼容行为，静态文件公开读取。
- `observe`：正常返回文件，同时添加观测响应头并收集日志。
- `ticket`：请求必须带 `X-Fosu-Static-Ticket` 才能读取受保护静态文件。

## 启用顺序

1. API 先以 `observe` 模式部署。
2. 确认 `/api/admin/security/status` 状态正常。
3. 将 OpenResty include 以 `observe` 模式接入。
4. 验证真实小程序 session bootstrap。
5. 验证 ticket 签发和带请求头的静态资源访问。
6. 配置 Cloudflare，避免受保护响应被公开缓存。
7. 切换到 `ticket`。

回退配置：

```env
FOSU_SECURITY_MODE=observe
FOSU_STATIC_ACCESS_MODE=public
FOSU_OPENRESTY_STATIC_SECURITY_MODE=public
```
