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

中继只连接固定公开上游，不接受任意目标；拒绝 ADP 管理、Swagger/OpenAPI、admin 等路径；不转发 Cookie、Authorization 或 Set-Cookie；除小型 `webim/config.js` 的公开域名重写外，响应体保持流式传输。Cloudflare Worker 不能用普通 `fetch` 访问 IP literal，因此 Function 使用 Cloudflare 官方 TCP socket 在服务端直连该固定公开地址，并解析 HTTP/1.1 响应；浏览器仍只访问 HTTPS Pages 域名。中继不可用时页面保留案例与上下文，并自动显示官方外开入口，不出现空白 iframe。

如果 ADP 后续提供官方 HTTPS 地址，只需把公开 `VITE_ADP_EMBED_URL` / `VITE_ADP_WEBIM_URL` 改为 HTTPS 地址；`resolveAdpConfig` 会停止使用 relay，页面无需改动。这两个变量只能放公开访问 URL，不能放 AppKey、token、clientId 或其他凭据。

## Secret boundary

Native ADP API Mode 由 `/api/adp/chat` 的 Pages Function 代理官方 SSE。生产环境必须在 Cloudflare Dashboard 的 Pages Secret 中配置 `ADP_APP_KEY`；本机仅允许写入已被 Git 忽略的 `.dev.vars`。前端只发送消息、会话标识与 Widget Action，不接收也不保存密钥。严禁使用 `VITE_*`、HTML、React、Git、日志或浏览器存储传递 Secret。

当前大赛发布空间的调用入口为举办方自部署的 ADP API。函数默认使用该发布入口；如部署方后续提供新的 HTTPS 入口，只在服务端修改 `ADP_API_URL`，不得写入前端 Bundle。

## Local verification

```text
npm ci
npm test
npm run build
npx wrangler pages dev dist --port 4175
npm run qa:final
```
