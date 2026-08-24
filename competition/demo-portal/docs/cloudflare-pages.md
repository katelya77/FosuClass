# Cloudflare Pages · Judge Portal

## Production configuration

- Production branch: `deploy/demo-portal`
- Root directory: `competition/demo-portal`
- Build command: `npm ci && npm run build`
- Build output: `dist`
- Node.js: `20`
- Router: hash router（刷新不会依赖服务端 SPA rewrite）

## ADP HTTPS relay

当前公开 ADP 真机为 HTTP。Judge Portal 在 HTTPS 页面自动把 iframe 切换到同源 Pages Function：

- `/adp-chat-client/*`：官方完整应用及其同前缀 API；
- `/webim/*`：官方 WebIM 静态资源；
- `/adp-origin/*`：仅供 WebIM 运行时配置使用的固定上游入口；
- `/adp-relay-health`：iframe 渲染前健康检查。

中继只连接固定公开上游，不接受任意目标；拒绝 ADP 管理、Swagger/OpenAPI、admin 等路径；不转发 Cookie、Authorization 或 Set-Cookie；除小型 `webim/config.js` 的公开域名重写外，响应体保持流式传输。Cloudflare Worker 不能直接 `fetch` IP literal，因此服务端使用固定 DNS 主机名解析到同一公开 ADP 地址；浏览器外开地址仍保持官方 IP URL。中继不可用时页面保留案例与上下文，并自动显示官方外开入口，不出现空白 iframe。

如果 ADP 后续提供官方 HTTPS 地址，只需把公开 `VITE_ADP_EMBED_URL` / `VITE_ADP_WEBIM_URL` 改为 HTTPS 地址；`resolveAdpConfig` 会停止使用 relay，页面无需改动。这两个变量只能放公开访问 URL，不能放 AppKey、token、clientId 或其他凭据。

## Secret boundary

当前公开体验 URL 不需要 AppKey。若未来确需调用官方服务端 API，只能在 Cloudflare Dashboard 以 Function Secret 配置，并从 Pages Function 服务端读取；禁止使用 `VITE_*`、HTML、React、Git 或浏览器存储传递 Secret。

## Local verification

```text
npm ci
npm test
npm run build
npx wrangler pages dev dist --port 4175
npm run qa:final
```
