# Module Boundaries

## Rule: dependency direction

```text
Tier 0 (schedule pipeline)
  ↑ may be used by
Tier 1 (query/read experiences)
  ↑ may be used by
Tier 2 (ops content)
  ↑ may be used by
Tier 3 (experimental AI)
```

**禁止** Tier 3 模块在加载期硬依赖并拖垮 Tier 0 路由挂载。

## Domain map

| Domain | Responsibility | Primary APIs / assets | Tier |
|--------|----------------|----------------------|------|
| auth | 登录、会话、CSRF、scoped token | `/api/admin/login`, session cookies | 0 |
| dashboard | 运营总览、下一步行动 | dashboard status aggregates | 1 |
| catalog | 学院/专业/班级/教师/教室资源 | catalog meta, resource CRUD | 1 |
| sync | 同步状态、历史、工具入口 | `/api/admin/sync/*` | 0 |
| staging | 分片上传、finalize、安全校验 | staging upload APIs | 0 |
| release | Release Pack 构建/发布/健康 | release + jobs | 0 |
| runtime | Active Pointer、LKG、readiness | runtime pointer, readiness | 0 |
| term | 学期生命周期、激活事务 | semester APIs | 0 |
| quality | 数据质量、忽略规则、诊断 | quality APIs | 1 |
| content | 公告、动态 | notices, news | 2 |
| feedback | 用户反馈 | feedback | 2 |
| campus-map | 地图版本、资源 | campus-map | 2 |
| assistant | 小佛助手知识库 | assistant kb | 3 |
| provider | AI Provider 配置 | ai provider | 3 |
| security | 安全模式、事件、限流 | security | 0/2 |
| settings | 应用配置 | app config | 1 |
| audit | 审计日志 | audit-logs | 2 |
| backups | 备份列表/下载/删除 | backups | 2 |
| jobs | 后台作业状态 | jobs | 0 |

## Shared kernels (allowed everywhere carefully)

- `utils/safeLogger`, `utils/clientIp`, `utils/jsonFileStore`
- `shared/resourceCountContract`, `shared/syncPlan`, course week rules
- `config`（未来：validated config）

## Forbidden couplings

| From | To | Why |
|------|-----|-----|
| release / staging | ai/provider | 发布链路不得依赖 AI |
| runtime pointer | campus-map | 地图故障不影响 Active |
| admin shell load | heavy AI require | 启动/页面加载失败隔离 |
| miniprogram schedule read | admin UI | 客户端不依赖后台页面 |

## File growth policy

| File | Soft max | Hard max (guard test) | Action when exceeded |
|------|---------:|----------------------:|----------------------|
| `routes/adminPages.js` | 17000 | 17500 | 仅做紧凑、可测试的 Legacy UI 改动 |
| `routes/admin.js` | 6200 | 6500 | 新路由必须进 `modules/*` |
| New domain modules | 400 | 800 | 继续拆分 service/repo |

Guard test: `tools/test-architecture-guards.js`

## API compatibility shell

在模块化过程中：

1. 保持 `/api/admin/*` 路径与响应字段兼容
2. 领域 router 挂到同一前缀
3. 旧 `admin.js` 逐步 `require` 领域路由或删除已迁移 handler
4. **禁止** 复制业务逻辑到两处

## Legacy frontend boundary

`server/src/routes/adminPages.js` 保留服务端输出的 Legacy HTML、CSS 与浏览器 JavaScript。

- 页面层只负责展示、可访问交互与调用现有 API。
- 业务语义继续位于共享 Router、Service、Repository 与模块中。
- 不引入第二套后台页面、独立前端框架或构建产物。
