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

当前应用属于 `adp.gaoxiaobang.com` 专属 ADP 环境，服务端只允许把 AppKey 发送到该环境的 HTTPS 对话端点。历史上的 `adp-origin.katelya.top` / `101.42.184.216` HTTP 中继已经移除；它不是 Pages 项目，也不得重新作为回退链路。

## Secret boundary

Native ADP API Mode 由 `/api/adp/chat` 的 Pages Function 代理官方 SSE。生产环境必须在 Cloudflare Dashboard 的 Pages Secret 中配置 `ADP_APP_KEY`；本机仅允许写入已被 Git 忽略的 `.dev.vars`。前端只发送消息、会话标识与 Widget Action，不接收也不保存密钥。严禁使用 `VITE_*`、HTML、React、Git、日志或浏览器存储传递 Secret。

当前大赛发布空间的调用入口由服务端 Function 受控维护；如部署方后续调整入口，只能在服务端更新，不得写入前端 Bundle、提交材料或浏览器存储。

Cloudflare Pages Secret 修改后不会改变已经构建完成的部署。每次轮换 `ADP_APP_KEY` 后都必须触发一次新的 Production 部署，并核对新部署绑定的 Git 提交，再运行生产 SSE 探针。

## Availability and operations

- `GET /api/adp/health` 是无模型调用的浅层检查：验证生产 Secret 已配置且形态正常，并验证专属 ADP HTTPS 前门可达；它不会发送 AppKey，也不能替代真实对话验收。
- `npm run qa:adp-smoke` 是深层检查：从正式域名发起一次最小真实对话，必须得到 HTTP 200、SSE 终态且 `errors` 为空。
- 复杂 CampusTools 任务允许最多 180 秒完成；不得因 55 秒固定超时误报失败。
- 发布验收顺序固定为：Cloudflare Git Check 成功 → 部署提交指纹一致 → `/api/adp/health` 为 200 → `qa:adp-smoke` 通过 → 关键业务问题通过。
- 若新版本失败，优先在 Pages 部署历史回滚到最近一次已通过上述探针的部署；Secret 不随代码回滚，需单独核对。
- 无法保证第三方 ADP 永不故障；长期可用依赖定时执行深层探针并在失败时告警。探针不得记录或回显 AppKey。

## Local verification

```text
npm ci
npm test
npm run build
npx wrangler pages dev dist --port 4175
npm run qa:adp-smoke
npm run qa:final
```
