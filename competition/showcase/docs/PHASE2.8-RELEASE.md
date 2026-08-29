# Phase 2.8 — Final Visual Convergence + Judge Portal Release

## 范围

本轮只收敛 `competition/showcase/`（4173）与 `competition/demo-portal/`（4174）的比赛展示层，并新增 `competition/brand/auroraqua.css` 作为同源品牌 tokens。未修改 ADP Runtime、Agent、CampusTools、Widget 数据契约或 `competition-demo-v3` verified fixture 事实。

## 视觉收敛

- 同源品牌：warm-white / coral / rose / peach / lavender / liquid glass / jelly radius / soft shadow / spring easing。
- 4174 产品化：一句核心价值、超大“问问小序”、四个一步体验场景、自然语言任务引导、问题→查询→验证→结论、真实 ADP 主舞台。
- 4173 电影化：品牌聚合 Opening、五节点协作 Architecture、四个单焦点 Hero、真实运行链路 Reliability、Judge Portal Closing handoff。
- Record Mode 默认隐藏 Director HUD、控制条和数据角标；`recordHud=1` 才显式开启录制提示。
- 390px 竖屏 Showcase 使用品牌化横屏提示；Portal 在 390px 仍保持自然语言任务与真实 ADP 主舞台。

## 品牌素材

六张用户提供的 PNG 以英文名原样复制到 `competition/demo-portal/public/branding/`。Agent/插件图片均使用 `object-contain`，聊天背景只作为低透明光场使用。它们实际进入 Portal 首页、Agent/CampusTools 关系条、案例、能力、About、Experience，以及 loading/blocked/external 状态；Showcase 的 Opening、Architecture、Closing/竖屏提示复用同一素材源。

## ADP 策略

- HTTP 本地预览：真实 iframe 内嵌完整体验 URL；不读取或修改跨域 DOM。
- HTTPS→HTTP：渲染 iframe 前检测 mixed-content，直接进入品牌化 fallback，不出现空白 iframe。
- fallback 同时提供完整体验与 WebIM 备用入口，并保留当前案例、上下文和操作步骤。
- 未来 HTTPS ADP 只需替换 `src/lib/adp.ts` 的公开 URL 或公开 URL 环境变量，不改页面。
- 当前 URL 不需要 AppKey，因此浏览器代码与 bundle 均未接入凭据。

## 验证记录

```text
4173 npm test                 11 files / 67 tests passed
4173 npm run build            passed
4173 node qa-layout.mjs       passed
4173 node qa-multires.mjs     1920x1080 / 1600x900 / 1366x768 OK

4174 npm ci                   passed（停止占用 node_modules 的旧 preview 后复跑）
4174 npm test                 3 files / 11 tests passed
4174 npm run build            passed
4174 npm run qa:capture       QA FRAME CLEAN
```

浏览器人工/自动截图复核覆盖 1920×1080、1440×900、1366×768、390×844。最终页面横向/纵向溢出为 0，破图为 0，采集到的 console error/warning 为 0。ADP 本地 HTTP 实测 iframe=1；强制模拟公网 fallback 实测 iframe=0，两个外开 URL 均存在。

1920×1080 有界面浏览器对 Opening 动画采样 2.51 秒，共 154 帧，约 61.3 FPS，console error 为 0。无 GPU 的 headless 模式只作为布局检查，不用它替代真实窗口性能结论。

生产 `dist/` 扫描结果：无 localhost / 127.0.0.1、AppKey、API key、Authorization、Bearer、Secret 或 Token。公开 ADP 默认地址集中在 `src/lib/adp.ts`。

## Cloudflare Pages

```text
Production branch: deploy/demo-portal
Root:              competition/demo-portal
Build:             npm ci && npm run build
Output:            dist
Node:              20
```

hash router 不需要 SPA rewrite。详细配置见 `docs/DEPLOYMENT.md`。

## 回滚

视觉层回滚：Cloudflare Pages 将 Production branch/commit 指向前一个成功构建，或 revert 本轮展示层提交。由于没有修改 ADP Runtime 与业务事实源，回滚静态站不会影响校园业务运行时。
