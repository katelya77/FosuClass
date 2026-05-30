# FosuClass 校园网同步自动化

FosuClass 的长期数据链路采用“校园网采集 Agent + VPS 快照服务”：

1. 校园网或 EasyConnect 环境中的 Windows 电脑运行 `tools/fosu-sync-client`。
2. 同步器登录 `100.fosu.edu.cn`，抓取 catalog、majors、class schedules，并可从班级课表派生教师、教室、课程资源索引。
3. 同步器生成完整 release snapshot，上传到 `https://class.katelya.eu.org`。
4. VPS 校验 release 完整性，只有校验通过才切换 active release；失败时线上继续使用旧快照。

## 手动运行

```powershell
cd C:\Users\Katelya\Documents\VScode\FosuClass\tools\fosu-sync-client
npm install
npm run login
npm run sync:release
```

常用环境变量：

```powershell
$env:ADMIN_API_TOKEN="和 VPS 一致的管理员 token"
$env:PREFERRED_SEMESTER="2025-2026-2"
$env:SYNC_UPLOAD_CHUNK_SIZE="10"
$env:SYNC_DISABLE_PROXY="true"
$env:SYNC_RELEASE_INCLUDE_RESOURCES="true"
```

如果上传阶段因为 `ECONNRESET`、TLS socket disconnected 或本地代理中断，可不重新抓取，直接继续上传本地缓存：

```powershell
npm run sync:upload-cache
```

## Windows 任务计划程序

推荐让任务计划程序执行脚本：

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\Users\Katelya\Documents\VScode\FosuClass\tools\fosu-sync-client\scripts\sync-release.ps1"
```

脚本会自动：

- 切换到 `tools/fosu-sync-client` 目录。
- 清理 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 等代理环境变量。
- 设置 `SYNC_DISABLE_PROXY=true` 和合理的上传 chunk size。
- 执行 `npm run sync:release`。
- 将日志写入 `tools/fosu-sync-client/logs/sync-release-yyyyMMdd-HHmmss.log`。

## 建议定时策略

- 开学前两周到开学前：每天凌晨同步一次。
- 正常学期：每周一凌晨同步一次。
- 临近期末：每周一次即可。

如果电脑不在校园网、EasyConnect 未连接，或 `100.fosu.edu.cn` 临时不可访问，同步任务会失败并退出；VPS 不会激活不完整 release，线上旧快照会继续服务小程序。

## Release 校验

VPS 激活 release 前会校验：

- `catalog.colleges.length > 0`
- `majorsCount > 0`
- `classScheduleCount > 0`
- 每个 class schedule 有 `className` 或 `title`
- `courses` 是数组
- 课程条目具备星期、节次、课程名等关键字段

管理员可查看：

```powershell
curl.exe -H "x-admin-token: $env:ADMIN_API_TOKEN" https://class.katelya.eu.org/api/admin/release/status
curl.exe -H "x-admin-token: $env:ADMIN_API_TOKEN" https://class.katelya.eu.org/api/admin/release/list
curl.exe -H "x-admin-token: $env:ADMIN_API_TOKEN" https://class.katelya.eu.org/api/admin/sync/status
```

## 日常运维命令

查看线上状态：

```powershell
curl https://class.katelya.eu.org/api/health
curl https://class.katelya.eu.org/api/fosu/bootstrap
curl https://class.katelya.eu.org/api/admin/sync/status
```

Windows 校园网环境清理代理：

```powershell
Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:ALL_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:http_proxy -ErrorAction SilentlyContinue
Remove-Item Env:https_proxy -ErrorAction SilentlyContinue
Remove-Item Env:all_proxy -ErrorAction SilentlyContinue
$env:SYNC_DISABLE_PROXY="true"
```

小规模测试资源同步：

```powershell
$env:SYNC_RESOURCE_LIMIT="20"
$env:SYNC_RESOURCE_MAX_CONCURRENCY="1"
$env:SYNC_RESOURCE_REQUEST_DELAY_MS="1000"
npm run sync:resources
```

正式同步资源：

```powershell
Remove-Item Env:SYNC_RESOURCE_LIMIT -ErrorAction SilentlyContinue
npm run sync:resources
```

离线快照发布：

```powershell
$env:SYNC_RELEASE_OFFLINE="true"
npm run sync:release
```

查看反馈：

```text
浏览器打开：https://class.katelya.eu.org/admin/feedback
输入 ADMIN_API_TOKEN 查看。
```
