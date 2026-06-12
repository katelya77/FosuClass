# FosuClass 故障排查

## app-config 超时

现象：全校页打开慢，公告或数据版本没有刷新。

处理：app-config timeout 不能阻塞全校页。页面应继续使用 bootstrap 或本地 activeSnapshot，状态标记为 `timeout`，不要标记为 `noRelease`。

## bootstrap 超时

现象：学院/专业筛选迟迟不出现。

处理：优先显示同版本 `school:v4:filters:${term}:${releaseVersion}` 缓存，并提示“网络较慢，正在继续加载”。刷新失败时保留缓存，不清空筛选项。

## search-index 超时

现象：搜索结果误显示“暂无同步数据”。

处理：timeout 只表示网络超时。只有服务端明确返回 `NO_ACTIVE_RELEASE`、`NO_SCHEDULE_SYNCED` 或空索引时，才展示暂无数据文案。

## 旧版本缓存

现象：最近查看里打开旧课表后，当前查询被旧版本污染。

处理：旧版本条目必须带 `releaseVersion` 和“旧版本”标识。点击时先尝试用当前 active `search-index` 映射；找不到再提示“新版本中未找到对应课表”。

## 灰色课程覆盖本周课程

现象：未开启“隐藏非当前周课程”时，非本周灰卡盖住本周彩色卡。

处理：检查 `miniprogram/utils/course.js` 的 `buildScheduleColumns`。重叠的 inactive 课程必须折叠到 active primary card 的 `inactiveConflictLabel`，不得作为独立绝对定位卡渲染。

验证：

```powershell
npm run test:timetable-current-week-priority
npm run test:timetable-inactive-does-not-cover-active
npm run test:timetable-hide-inactive-courses
```

## Staging 上传失败

现象：185MB JSON 网页上传卡死、反向代理断开或 hash mismatch。

处理：全量文件使用 CLI：

```powershell
npm run sync:local-upload -- --file=./staging/2025-2026-2-full.json --server=https://class.katelya.eu.org
```

失败后可安全重跑。若出现本机代理错误，清理代理环境变量或设置 `SYNC_DISABLE_PROXY=true`。

## Release 发布失败

现象：后台提示发布失败或要求二次确认。

处理：先看 Staging diff 和 safety warnings。课程数下降超过阈值时必须人工确认新学期更替是否合理。发布后运行：

```powershell
npm run test:release-publish-safety
npm run test:release-index-rebuild
```

## 接力 agent 失败

现象：接力同学 token 无效、上传被拒绝或无法访问校园网。

处理：

- 确认 token 未过期、未吊销、未超过上传次数。
- 确认 term 与任务 term 一致。
- 确认 Staging JSON 不包含 password、cookie、ticket、session、token 等敏感字段。
- 无法访问校园网时使用 mock 测试验证 relay 链路：

```powershell
npm run test:relay-agent
```

## 诊断 API

## 全校页第一次进入空白

现象：

- 微信开发者工具日志出现 `wx.request failed`。
- 全校页提示网络较慢或课表索引加载失败。
- 再次重试偶尔能加载。

处理：

1. 确认小程序请求层使用 release-pack index 的长 timeout 和 retry。
2. 确认 `/api/fosu/release-pack/manifest` 不带 releaseVersion 时返回 `no-store`。
3. 确认 active manifest 包含 `releaseVersion`、`cacheEpoch`、`forceRefreshToken`。
4. 确认设置页“高级诊断”里 last-good releaseVersion 存在。
5. 运行：

```powershell
npm run verify:release-live -- --server=https://class.katelya.eu.org --term=2025-2026-2
```

有 last-good 时，全校页应先显示本地缓存，不应空白。

## Release Pack 不健康

现象：后台发布失败，或 `/api/admin/sync/releases/check-availability` 显示 Release Pack Fail。

处理：

```powershell
npm run test:release-publish-requires-healthy-pack
npm run test:release-pack-build
npm run test:release-pack-manifest
npm run test:release-pack-index
npm run test:release-pack-detail
```

健康检查必须通过 manifest、四类 index、四类 detail、empty-room、hash/size。pack 不健康禁止发布为 active。

## 小程序没有识别新 Release

处理：

1. 打开 `/api/fosu/release-pack/manifest`，确认 `releaseVersion/cacheEpoch/forceRefreshToken` 已变化。
2. 打开 `/api/fosu/app-config`，确认同样包含 active release 信息。
3. 设置页进入“数据版本详情”，开发版/体验版展开“高级诊断”。
4. 点击“重新拉取 manifest”或“安全刷新数据”。

客户端不能只比较 `updatedAt`。如果 `releaseVersion` 不变但 `cacheEpoch` 或 `forceRefreshToken` 变化，也会执行安全刷新流程。

## 发布后验证失败

`verify:release-live` 中 manifest 超过 2s、index/empty-room 超过 8s、detail 超过 5s 时会给 warning。warning 不一定代表数据错误，但需要在中国大陆网络和真机环境复测。

`/api/fosu/client-diagnosis` 不默认显示在 UI，仅用于排查。重点看：

- `activeReleaseVersion`
- `term`
- `indexExists`
- `releaseCounts`
- `indexCounts`
- `cacheStatus`
- `serverTime`
