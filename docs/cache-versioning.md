# FosuClass 缓存与版本规则

## activeSnapshot

小程序所有全校页、搜索页和详情页都应以同一个 activeSnapshot 为准：

```json
{
  "term": "2025-2026-2",
  "releaseVersion": "2026-06-01T23-44-37",
  "scheduleUpdatedAt": "2026-06-02T13:43:00.000Z",
  "catalogUpdatedAt": "2026-06-02T13:43:00.000Z",
  "cacheEpoch": 1780378986408
}
```

`releaseVersion` 是缓存和 API 的唯一版本主键。`scheduleUpdatedAt` 和 `catalogUpdatedAt` 只用于 UI 展示，不得拼进请求版本，也不得覆盖 `releaseVersion`。

## 小程序缓存 key

当前 schema 使用 `school:v4` 前缀。升级结构时递增 schema 版本，旧缓存自动失效。

- `school:v4:index:${term}:${releaseVersion}:${type}:${hash(params)}`
- `school:v4:detail:${term}:${releaseVersion}:${type}:${id}`
- `school:v4:filters:${term}:${releaseVersion}`

读取规则：

1. 有同版本缓存时先显示缓存。
2. 后台静默刷新同一个 `releaseVersion`。
3. 刷新失败时保留已有数据。
4. timeout、noRelease、empty 必须区分；timeout 不代表暂无同步数据。
5. 最近查看旧版本只能标记为旧版本，不能决定当前 activeSnapshot。

## API 缓存

- `/api/fosu/app-config`、不带 `releaseVersion` 的 `/api/fosu/bootstrap` 和 `/api/fosu/search-index` 使用 `no-store`，确保 active 指针实时。
- 带 `releaseVersion` 的 `/api/fosu/search-index` 可 `public, max-age=300`。
- 带 `releaseVersion` 的 `/api/fosu/schedule-detail` 可 `public, max-age=3600`。
- `/api/fosu/search-index` 只返回轻量索引；完整排课由 `/api/fosu/schedule-detail` 按需读取 derived schedule 文件。

## 发布后的版本一致性

发布 release 后需要确认三件事：

1. `releaseService.getActiveReleaseInfo().releaseVersion` 等于新版本。
2. derived indexes 已存在，`class/teacher/classroom/course` 都能读取。
3. 小程序端 activeSnapshot 中 `term` 和 `releaseVersion` 来自同一响应链路，不混用旧缓存的更新时间。

排查入口：

```powershell
Invoke-RestMethod "https://class.katelya.eu.org/api/fosu/client-diagnosis"
```
