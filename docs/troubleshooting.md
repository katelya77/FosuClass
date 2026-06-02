# FosuClass 故障排查

## app-config timeout

现象：全校页打开慢，公告或数据版本没有刷新。

处理：app-config timeout 不能阻塞全校页。页面应继续使用 bootstrap 或本地 activeSnapshot，状态标记为 `timeout`，不要标记为 `noRelease`。

## bootstrap timeout

现象：学院/专业筛选迟迟不出现。

处理：优先显示同版本 `school:v4:filters:${term}:${releaseVersion}` 缓存，并提示“网络较慢，正在继续加载”。刷新失败时保留缓存，不清空筛选项。

## search-index timeout

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

## release 发布失败

现象：后台提示发布失败或要求二次确认。

处理：先看 Staging diff 和 safety warnings。课程数下降超过阈值时必须人工确认新学期更替是否合理。发布后运行：

```powershell
npm run test:release-publish-safety
npm run test:release-index-rebuild
```

## relay agent 失败

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

`/api/fosu/client-diagnosis` 不默认显示在 UI，仅用于排查。重点看：

- `activeReleaseVersion`
- `term`
- `indexExists`
- `releaseCounts`
- `indexCounts`
- `cacheStatus`
- `serverTime`
