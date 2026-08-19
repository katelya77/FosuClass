# FosuClass 同步运维手册

## 边界

`100.fosu.edu.cn` 只能从校园网或本机 VPN 访问。不要把 VPS 改造成抓取器，不要在 VPS 上安装校园 VPN。VPS 只接收 Staging、校验、构建 Release、同步静态文件、切换 runtime pointer 和对外服务。

## 常用命令

日常同步：

```powershell
npm run sync:publish
```

当 `config/terms/<term>.json` 中 `preferred: true` 的学期领先线上 active 学期时（例如新学期 `2026-2027-1` 已配置但线上仍是 `2025-2026-2`），`sync:publish` 会自动切换到该新学期并升级为 full 全量采集（目录 network-only、强制刷新），无需手工加 `--mode=full --term=...`；需要固定其他学期仍用显式 `--term`。

深度全量模式（手工指定）：

```powershell
npm run sync:publish -- --mode=full --term=2026-2027-1
```

恢复中断任务：

```powershell
npm run sync:publish -- --mode=resume --run-id=RUN_ID
```

只重试 CloudBase 镜像：

```powershell
npm run sync:publish -- --mode=mirror-only
```

导出 CloudBase 人工上传包：

```powershell
npm run sync:export-cloudbase -- --release=<releaseVersion>
```

旧的 `sync:fresh`、`sync:quick`、`sync:release`、`sync:daily` 仍保留兼容，但控制台会显示 deprecated。后台命令手册和正常运维只推荐 `sync:publish`。

## 日常生产流程

1. 本机校园网采集 100 网数据。
2. 生成单一 Staging JSON 与 sidecar meta。
3. canonicalHash 与 active 一致时直接 no-change 结束。
4. CLI gzip 分片上传 Oracle。
5. Oracle 后台校验 hash、契约计数、来源口径和数据质量。
6. 构建不可变 Release Pack 并执行 Deep Health。
7. 同步 OpenResty 并激活 runtime pointer。
8. 自动镜像 CloudBase Hosting，先上传 release 目录，远端校验后最后覆盖 `runtime/active.json`。
9. 自动运行 Oracle/CloudBase live smoke，双源一致才显示发布成功。

任何阶段失败都不得切换 active，旧线上版本继续可用。

## CloudBase 人工包

CloudBase 镜像失败时，Oracle 已发布的 Release 不回滚，Publisher 会把状态标记为 `cloudbase-mirror-pending`，并生成：

- `dist/cloudbase-manual/<releaseVersion>/`
- `dist/FosuClass-CloudBase-<releaseVersion>.zip`

人工上传只进入 CloudBase 静态网站托管的文件管理：先上传 `releases/<releaseVersion>/`，验证 `manifest.json`，最后覆盖 `runtime/active.json`。禁止先上传 pointer，也不需要在云存储或数据库上传。

## 微信体验版验证

GitHub Actions 部署服务端不等于微信小程序代码已经上传。体验版验证步骤：

1. 在微信开发者工具打开项目。
2. 确认合法域名包含 `https://class.katelya.eu.org` 和 CloudBase Hosting 域名。
3. 上传体验版或预览，进入“设置 / 诊断”查看 `staticOrigin`、`staticOriginLabel`、`staticOriginUrl`、`cloudbaseReleaseVersion`、`oracleReleaseVersion`、`freshnessStatus`、`pointerSource`。
4. 确认 CloudBase first、Oracle fallback、双源 releaseVersion 一致。

不要自动提交正式版审核。

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
