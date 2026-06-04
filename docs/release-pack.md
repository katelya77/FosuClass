# Release Pack 架构说明

Release Pack 是小程序读取全校课表的主路径。它按 releaseVersion 隔离缓存，避免旧数据污染新版本。

## 目录结构

- `manifest.json`：active release 元数据，包含 `term`、`releaseVersion`、`cacheEpoch`、`forceRefreshToken`、`counts`、`packStatus`、`minClientCacheSchema`。
- `index/class.json`
- `index/teacher.json`
- `index/classroom.json`
- `index/course.json`
- `detail/class/*.json`
- `detail/teacher/*.json`
- `detail/classroom/*.json`
- `detail/course/*.json`
- `empty-room/index.json`

## 客户端读取规则

小程序启动或进入全校页时先读本地 active/last-good manifest。已有缓存时先展示本地数据，不等待网络。

后台静默请求 active manifest。客户端必须比较：

- `releaseVersion`
- `cacheEpoch`
- `forceRefreshToken`

如果三者没有变化，不切换缓存。如果有变化，客户端先下载并校验新版本四类 index，成功后才写入本地 active/last-good，再清理多余旧版本缓存。

## 缓存键

客户端使用 `fosu:v5:*`：

- `fosu:v5:manifest:{term}`
- `fosu:v5:last-good:{term}`
- `fosu:v5:active-release`
- `fosu:v5:index:{term}:{releaseVersion}:{type}`
- `fosu:v5:detail:{term}:{releaseVersion}:{type}:{id}`
- `fosu:v5:empty-room:{term}:{releaseVersion}`

不要在下载新版本前清空旧版本缓存。

## 服务端发布门槛

active release 必须通过 Release Pack health check：

- manifest 存在且 releaseVersion 一致。
- 四类 index 存在且 count 大于 0。
- 四类 detail 文件存在且数量大于 0。
- empty-room/index 存在。
- manifest 中记录的 hash/size 与当前文件一致。
- counts 不为 0。

健康检查失败时禁止成为 active release。

## Cache-Control

- `/api/fosu/release-pack/manifest` 不带 `releaseVersion` 时必须 `no-store`。
- `/api/fosu/app-config` 和 `/api/fosu/bootstrap` 必须 `no-store`。
- 带 `releaseVersion` 的 index/detail/empty-room 可以 `public, max-age=...`。
- 小程序请求静态 pack 资源时必须携带 releaseVersion。

## 发布后验证

```powershell
npm run verify:release-live -- --server=https://class.katelya.eu.org --term=2025-2026-2
```

脚本会检查 health、app-config、bootstrap、active manifest、四类 index、empty-room，并抽样四类 detail。
