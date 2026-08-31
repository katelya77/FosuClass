# Cloudflare Pages · Judge Portal

## Production configuration

- Production branch: `deploy/demo-portal`
- Root directory: `competition/demo-portal`
- Build command: `npm ci && npm run build`
- Build output: `dist`
- Node.js: `20`
- Router: hash router（刷新不会依赖服务端 SPA rewrite）

## Native ADP SSE

Judge Portal 不再嵌入旧版 HTTP iframe，也不向浏览器公开 ADP 上游地址。页面只调用同源 `/api/adp/chat`；Pages Function 在服务端发起当前 ADP SSE 请求，浏览器直接渲染最新 `Widget.View`。已核验回放是独立、明确标注为非实时的兜底入口，不会冒充 Live 成功结果。

## Secret boundary

Native ADP API Mode 由 `/api/adp/chat` 的 Pages Function 代理官方 SSE。生产环境必须在 Cloudflare Dashboard 的 Pages Secret 中配置 `ADP_APP_KEY`；本机仅允许写入已被 Git 忽略的 `.dev.vars`。前端只发送消息、会话标识与 Widget Action，不接收也不保存密钥。严禁使用 `VITE_*`、HTML、React、Git、日志或浏览器存储传递 Secret。

当前大赛发布空间的调用入口由服务端 Function 受控维护；如部署方后续调整入口，只能在服务端更新，不得写入前端 Bundle、提交材料或浏览器存储。

## Local verification

```text
npm ci
npm test
npm run build
npx wrangler pages dev dist --port 4175
npm run qa:final
```
