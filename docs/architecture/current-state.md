# Current Architecture State

**Baseline commit:** `5d7eb469`  
**Audit date:** 2026-07-17  
**Branch:** `grok/admin-modernization`

## System overview

```text
原生微信小程序 (miniprogram/)
        ↓ HTTP / static
Node.js + Express 单体 (server/)
        ↓
Release Pack 数据平面 + Runtime Pointer
        ↓
Oracle 静态目录 / CloudBase 静态托管
        ↓
小程序 Last-known-good 缓存读取
```

## Runtime surfaces

| Surface | Path | Tech | Notes |
|--------|------|------|-------|
| 微信小程序 | `miniprogram/` | 原生 WXML/WXSS/JS | Tier 0 用户端，不可替换 |
| API 后端 | `server/src/` | Express (JS) | 模块边界弱，路由文件过大 |
| 旧后台 UI | `server/src/routes/adminPages.js` | 内联 HTML/CSS/JS 字符串 | ~16.9k 行单文件 |
| 管理 API | `server/src/routes/admin.js` | Express routes | ~6.1k 行，领域混杂 |
| 同步工具 | `tools/fosu-sync-client/`, `tools/fosu-publisher/` | Node CLI | 使用 `ADMIN_API_TOKEN` |
| 云函数 | `cloudfunctions/` | 微信云开发 | 部分实时/导入链路 |

## Files over 500 lines (server/src)

| Lines | File | Risk |
|------:|------|------|
| 16966 | `routes/adminPages.js` | 后台 UI 全部内联，无法组件化、难测 |
| 6135 | `routes/admin.js` | 路由/业务/文件 I/O 混杂；存在重复路由 |
| 3787 | `services/releaseService.js` | Tier 0 核心，变更需极谨慎 |
| 1819 | `services/fosuApaasImporter.js` | 个人导入 |
| 1302 | `services/ai/toolRegistry.js` | Tier 3 |
| 1235 | `routes/fosu.js` | 公共读 API |
| 1228 | `services/stagingUploadService.js` | Staging 分片上传 |
| 1187 | `services/fosuApaasImportService.js` | 个人导入服务 |
| 1116 | `services/scheduleImportNormalizer.js` | 课表规范化 |
| ≥500 | 其余 18 个 services/utils | 中等 |

## Critical findings

### 1. Duplicate route: `GET /api/admin/sync/status`

- First registration (~L3053): `verifyAdminWriteAccess`，返回精简同步/快照计数
- Second registration (~L4981): `adminAuth.verifyAdminAccess`，返回生命周期/静态同步/指纹等完整状态
- Express 只生效**先注册**的处理器；后注册的完整实现**永远不会被调用**
- 影响：后台 Sync Center 可能读到残缺状态字段

### 2. `ADMIN_API_TOKEN` 权限过大

- `adminAuth.isStaticAdminTokenValid` 将 `ADMIN_TOKEN` 与 `ADMIN_API_TOKEN` 同等对待
- `verifyAdminWriteAccess` 接受任意有效 token，等同完整管理员
- 同步/发布工具 token 可调用公告、备份删除、安全配置等无关写操作

### 3. 浏览器分片上传 CSRF 缺口

- Cookie 会话的状态变更要求 CSRF（`x-fosu-csrf`）
- 但 `verifyAdminCsrf` 对 `admin-token` 方法直接放行
- 浏览器若误用 token 头，或某些上传路径未统一走 CSRF 中间件，存在 CSRF 风险面

### 4. Snapshot 临时文件并发覆盖

- `/snapshot/upload` 固定写入 `snapshots/temp_upload.json` / `temp_upload.json.gz`
- 并发上传会互相覆盖；`/snapshot/activate` 可能激活错误快照

### 5. Snapshot 与 Backup 下载路径不一致

- Backup：`GET /api/admin/backups` + `GET /api/admin/backups/download?filename=`
- Snapshot：无对称的 list/download API；历史在 `storage/snapshots/history/`，靠文件系统访问
- 运营体验与权限边界不统一

### 6. 审计日志身份不明确

- `writeAuditLog` 固定 `operator: "admin"`，仅记录 `authMethod` 与匿名 IP
- 无法区分 cookie 会话、scoped token、全权 token

### 7. 启动配置有效性检查不足

- `config.js` 派生 `ADMIN_API_TOKEN` 并加载 env
- 生产环境仅在请求时检查 `ADMIN_TOKEN`/`ADMIN_PASSWORD`
- 缺少启动期校验：token 冲突、scope 配置、危险默认值告警

### 8. 同步文件 I/O 与全局缓存

- `admin.js` 中 `fs.*Sync` 约 108 处
- `global.cachedSnapshotMeta` / `global.cachedSnapshotData` 共约 8 处引用
- 事件循环阻塞风险；测试隔离差

### 9. 环境变量分散读取

- 主入口：`server/src/config.js`
- 另有：`process.env` 直接读取于 services、AI provider store、app.js body limits
- 缺少统一校验层

### 10. Tier 3 → Tier 0 反向依赖风险

- `admin.js` 直接 require AI agent/provider/campus-map 服务
- 任一 AI 模块加载失败可能影响整个 admin router 挂载
- 需在模块化阶段做 fail-open 隔离

## Auth model (current)

| Mechanism | Purpose | Scopes |
|-----------|---------|--------|
| Cookie session + CSRF | Web 后台 | 全权 `admin` |
| `ADMIN_TOKEN` header/bearer | 备用全权 | 全权 |
| `ADMIN_API_TOKEN` | 同步工具 | **实际全权（缺陷）** |
| Relay tokens | 接力代理 | 上传相关 |

## Data plane

- Staging JSON → Release Pack build → Static sync → URL verify → Active Pointer
- Last-known-good 与 Runtime Pointer 保障小程序读路径
- PostgreSQL **未**作为课表数据平面

## What must not break (Tier 0)

课表采集、规范化、Staging、Release Pack、静态同步、URL 验证、Active Pointer、小程序读取、Last-known-good、个人课表导入、学期生命周期。

## Conclusion for modernization

渐进式绞杀者：保留 Express 单体与 Release Pack；新建 Vue 3 SPA 后台；按领域拆分 `admin.js`；scoped service token；禁止 admin 巨石文件继续膨胀。
