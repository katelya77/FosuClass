# Target Architecture State

> **Status: Superseded for the admin frontend.** ADR-0002 is superseded and the Legacy-only admin is retained. The Vue topology below is preserved as historical design context; the Express modular monolith, Release Pack, Term, and Active Pointer decisions remain current.

## Target topology

```text
原生微信小程序
        ↓
模块化 Express 单体 API  (server/src/modules/* + 兼容壳)
        ↓
Release Pack 数据平面 + 控制平面 Repository
        ↓
Vue 3 + Vite + TypeScript 后台静态 SPA  (server/public/admin-app/)
```

后台运行时 **不需要 SSR**。静态构建产物由 Express 提供。

## Principles

1. **绞杀者迁移**：新旧后台并行，Feature Flag 控制，可快速回退
2. **API 路径不变**：`/api/admin/*` 契约向后兼容
3. **数据平面不变**：Release Pack + Active Pointer + LKG
4. **非微服务**：保持模块化单体
5. **渐进 TypeScript**：优先 admin-web 与 contract，后端旧模块可留 JS
6. **Tier 隔离**：Tier 3 失败不得阻塞 Tier 0

## Frontend target

| Item | Decision |
|------|----------|
| Stack | Vue 3 + Vite + TypeScript + Vue Router + Pinia（仅跨页状态） |
| Path (migration) | `/admin-next/*` |
| Path (final) | `/admin/*`；旧后台 `/admin-legacy/*` |
| Build out | `server/public/admin-app/` |
| Design system | Campus Operations Studio：暖白浅色 / 冷调墨黑深色；品牌红 + 钴蓝主操作 |
| No | iframe 包裹旧后台、廉价 Admin Template、Emoji 导航 |

## Backend target

```text
server/src/modules/
  auth/ dashboard/ catalog/ sync/ staging/ release/ runtime/
  term/ quality/ content/ feedback/ campus-map/ assistant/
  provider/ security/ settings/ audit/ backups/ jobs/
```

Each domain eventually:

```text
routes → controller → service → repository → schema / errors / tests
```

`routes/admin.js` 成为薄聚合层或被替换为 `modules/*/routes` 挂载，**禁止复制两套业务实现**。

## Auth target

Scoped Service Tokens（兼容旧全权 token 作为 `admin:full`）：

```text
staging:init | staging:chunk | staging:finalize
release:build | release:publish
static:sync | static:verify
relay:manage | admin:full
```

- Cookie 会话：全权 + CSRF 强制
- Scoped token：仅声明范围
- 审计日志：记录 operator identity、auth method、scope set

## Data plane target

| Plane | Technology | Role |
|-------|------------|------|
| 课表数据平面 | Release Pack + 静态文件 | 小程序读取 |
| 控制平面（未来） | PostgreSQL（可选） | 审计、作业、配置、权限 |
| 当前控制数据 | JSON files under `data/` / `storage/` | 渐进保留 |

**不**一次性把全部 JSON 迁入数据库。

## Migration stages

| Phase | Outcome |
|------:|---------|
| 0 | 审计、ADR、架构守卫 |
| 1 | P0 安全与接口稳定 |
| 2 | admin-web 基础壳 |
| 3 | 核心运营页 UI/UX |
| 4 | 后端按领域拆分 |
| 5 | 剩余后台页迁移 |
| 6 | 切换 `/admin` + 验收 + Legacy 回退 |

## Non-goals

- uni-app / Taro 全面迁移
- NestJS 全面迁移
- 微服务 / Kubernetes
- 一次性全量 JS→TS
- 重写采集与发布链路
