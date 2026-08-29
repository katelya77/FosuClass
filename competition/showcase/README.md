# 校园智序 · 小序 — Competition Showcase Web（Phase 1）

> 纯展示层（presentation layer）：**只读消费**已核验的 ADP / CampusTools 事实，
> 不承载任何业务计算。Runtime proof 永远来自腾讯云智能 ADP 真机。

## 快速开始

```bash
npm install
npm run dev       # http://127.0.0.1:5173
npm run build     # tsc --noEmit && vite build
npm run preview   # http://127.0.0.1:4173
npm test          # vitest
```

## URL 契约

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `mode` | `record` | 录制模式：隐藏全部开发控制、无滚动条 |
| `data` | `fixture` / `live` | 占位快照 / ADP 实时；UI 徽标显式区分 |
| `autoplay` | `1` / `0` | 自动播放（record 默认开） |
| `scene` | 场景 ID | 直接跳转场景 |
| `t` | 秒数 | 起始时间（截图/调试） |

推荐录屏入口：

```
http://127.0.0.1:4173/?mode=record&data=fixture&autoplay=1
```

详见 `docs/RECORDING-MODE.md`。

## 目录速览

```text
src/
├─ app/            ShowcaseApp 装配
├─ components/
│  ├─ primitives/  Panel / Badge / SceneHeader / motion 助手
│  ├─ visual/      AmbientBackground · CampusTemporalGraph · BrandLockup
│  ├─ director/    SceneTransition · DebugPanel · ProgressRail · RecordHUD
│  └─ adp/         AdpLiveFrame（唯一 iframe Adapter）+ config
├─ scenes/         Opening · Architecture · 4×Hero · Reliability · Closing
├─ director/       timeline · useDirector · types
├─ stores/         directorStore（zustand）
├─ data/           VerifiedFixture 契约 + provenance 校验
├─ fixtures/       Phase 1 全部为显式 placeholder
└─ styles/         tokens.css · typography.css · globals.css
```

`contracts/` 目录属于 R51 公共决策回执契约，本应用不修改、只遵守。

## 数据纪律（摘要）

- 动态校园事实只能来自真实 ADP / CampusTools 已核验输出或 Runtime Golden 导出 fixture；
- Phase 1 一律 `source: 'placeholder'` + `verified: false`，UI 以「占位示意数据」明示；
- fixture 与 live 的视觉呈现绝不混淆（见左下角常驻徽标）；
- 禁止任何凭据进入 `VITE_*` / `src/**` / 提交历史（见 `.env.example` 注释）。

## Runtime 冻结边界

本目录只允许读写自身与 `competition/showcase/**`；
严禁改动 `competition/adp-kit/runtime|prompts|tools|widget`、Agent 拓扑、
CampusTools 算法、既有 Widget ID 与生产配置。