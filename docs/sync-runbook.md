# FosuClass 同步运维手册

## 边界

`100.fosu.edu.cn` 只能从校园网或本机 VPN 访问。不要把 VPS 改造成抓取器，不要在 VPS 上安装校园 VPN。VPS 只接收 Staging、校验、构建 Release、同步静态文件、切换 runtime pointer 和对外服务。

## 常用命令

日常同步：

```powershell
npm run sync:daily -- --term=2025-2026-2
```

单维度同步：

```powershell
npm run sync:daily:classes -- --term=2025-2026-2
npm run sync:daily:teachers -- --term=2025-2026-2
npm run sync:daily:classrooms -- --term=2025-2026-2
npm run sync:daily:courses -- --term=2025-2026-2
```

自定义同步范围：

```powershell
npm run sync:scopes -- --term=2025-2026-2 --include=classSchedules,teacherSchedules
```

上传本地暂存文件：

```powershell
npm run sync:upload-staging -- --file=.\staging\2025-2026-2-full.json --term=2025-2026-2
```

恢复中断任务：

```powershell
npm run sync:resume -- --run-id=RUN_ID
```

## 日常生产流程

1. 本机校园网采集 100 网数据。
2. 按学期和 runId 写入隔离缓存。
3. 生成 Staging JSON 与旁路元数据。
4. CLI gzip 分片上传。
5. 服务端校验 hash、契约计数、来源口径和数据质量。
6. 构建不可变 Release。
7. 构建并同步 OpenResty 静态目录。
8. readiness 检查通过后切换 active pointer。
9. 小程序探针验证 manifest、索引、教学周历和空教室数据。

任何阶段失败都不得切换 active，旧线上版本继续可用。

## 计数契约

所有后台显示、发布比较和上传摘要使用 v2 Resource Count Contract。目录实体、课表文档和课程事件是三个不同指标，不能互相 fallback。旧 Release 缺少 v2 时现场从 snapshot 或 release pack index 派生，并标记 `derivedFromLegacy=true`。

## 教师直抓门禁

教师页如果没有教师下拉框而退到学院请求，且结果里的教师名称出现 `23示例专业班`、`临班0`、课程名或教室名，当前数据只能作为诊断 Staging 保存，不能普通发布。不要把旧 active 1007 直接写成实时发现候选数；只能作为 `legacyBaseline` 对照。

## 学期周数规则

学期配置优先级：

1. 显式 `--total-weeks`
2. 同学期 Term Registry
3. 已验证本地 Term Config
4. 新学期无配置时报错

`2025-2026-2` 的配置为：

```json
{
  "termStartDate": "2026-03-09",
  "weekStart": "monday",
  "totalWeeks": 19
}
```

CLI 与 Registry 冲突时默认采用 Registry；只有显式 `--override-term-config` 才允许覆盖。

## 运行产物

以下目录和文件是本机运行产物，不提交：

- `tools/fosu-sync-client/.cache/`
- `tools/fosu-sync-client/.debug/`
- `tools/fosu-sync-client/.session/`
- `tools/fosu-sync-client/staging/`
- `staging/`
- `server/storage/releases/`
- `server/storage/public/`
- `server/storage/snapshots/`
- `*.har`
- `*.log`
