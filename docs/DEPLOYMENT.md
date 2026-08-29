# 校园智序 · 小序 — Judge Portal 发布说明

本文对应 `competition/demo-portal/`（Phase 2.8 Final Visual Convergence）。Judge Portal 是纯静态评审前端；不包含 AppKey、Secret、Token、Authorization 或 Bearer 凭据。

## Cloudflare Pages

在 Cloudflare Pages 绑定 `deploy/demo-portal` 作为 Production branch，并使用：

```text
Root directory: competition/demo-portal
Build command:  npm ci && npm run build
Output:         dist
Node:           20
```

站点使用 hash router，页面刷新不会依赖服务端 SPA rewrite。仓库内的 `.node-version` 和 `package.json#engines` 均固定为 Node 20。

## 本机构建与预览

在 `competition/demo-portal/` 下执行：

```text
npm ci
npm test
npm run build
npm run preview   # http://127.0.0.1:4174
```

真实体验工作区：

```text
http://127.0.0.1:4174/?timeout=2200#/experience/query
```

本机 HTTP 页面可内嵌当前 HTTP ADP。录屏需要固定使用外部窗口时可访问：

```text
http://127.0.0.1:4174/?forceExternal=1#/experience/query
```

## ADP 地址与 mixed-content

公开地址只在 `src/lib/adp.ts` 集中配置：

```text
完整体验：http://101.42.184.216/adp-chat-client/#/app/2084871572396491520
备用 WebIM：http://101.42.184.216/webim/#/chat/uxjybB
```

它们是公开访问 URL，不是凭据。前端从不读取或修改跨域 iframe DOM，也不绕过 X-Frame-Options、CSP 或 mixed-content。

Cloudflare Pages 为 HTTPS，而当前 ADP 为 HTTP。页面会在渲染 iframe 前检测 HTTPS→HTTP mixed-content，并直接显示品牌化“打开小序完整体验”卡片，避免空白 iframe；评审案例、上下文和步骤仍保留。未来提供 HTTPS ADP 后，只需替换 `src/lib/adp.ts` 的公开 URL（或构建时设置下面的公开变量），页面会自动恢复 iframe：

```text
VITE_ADP_EMBED_URL=https://your-adp.example.com/adp-chat-client/#/app/...
VITE_ADP_WEBIM_URL=https://your-adp.example.com/webim/#/chat/...
```

Vite 变量会进入浏览器 bundle，只允许放公开 URL。AppKey、Secret、Token 和任何官方服务端凭据只能进入 server-side / Cloudflare Function Secret；当前体验 URL 不需要 AppKey，因此本项目没有接入。

## 路由

```text
#/                            首页
#/experience/query           查课表
#/experience/collaboration   找共同时间
#/experience/reschedule      模拟调课
#/experience/insight         看全校态势
#/cases                      演示案例
#/capability                 能力地图
#/about                      关于作品
```

## 发布前检查

- `npm ci && npm run build`、`npm test` 均通过。
- `dist/` 不含 localhost、真实 Secret、AppKey 或凭据。
- 公开 ADP URL 仅在配置模块出现。
- 1920×1080、1440×900、1366×768、390×844 无页面溢出或破图。
- HTTPS 页面显示外开卡片；HTTP 本地预览显示真实 iframe。
- 不部署 ADP Runtime，不修改 production，不 merge `main`。

回滚只需把 Cloudflare Pages 的 Production branch 切回先前分支/提交；ADP 与业务运行时不受该静态站回滚影响。
