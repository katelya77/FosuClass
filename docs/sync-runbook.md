# FosuClass 同步与发布 Runbook

## 主流程

FosuClass 不再要求 VPS 直接访问 `100.fosu.edu.cn`，公网服务器无法访问学校内网是预期情况。标准链路是：

```mermaid
flowchart LR
  A["校园网电脑"] --> B["本地同步客户端"]
  B --> C["Staging JSON"]
  C --> D["VPS Staging 区"]
  D --> E["管理员校验 diff"]
  E --> F["正式 release"]
  F --> G["小程序读取 release 数据"]
```

VPS 只负责保存、校验、diff、预览、发布和回滚。教务系统登录、验证码、人机交互和校园网访问都留在本机或接力同学的电脑上。

## 本机校园网同步

在已连接校园网或学校 VPN 的电脑上运行：

```powershell
cd C:\Users\Katelya\Documents\VScode\FosuClass
$env:SYNC_CLASS_SCOPE="all"
$env:SYNC_RESOURCE_SCOPES="classSchedules,teacherSchedules,classroomSchedules,courseSchedules,classrooms,teachers,courses"
$env:SYNC_GRADES="2026,2025,2024,2023,2022"
$env:SYNC_MAX_CONCURRENCY="1"
$env:SYNC_REQUEST_DELAY_MS="900"
npm run sync:local-campus -- --term=2026-2027-1 --start=2026-09-01 --output=./staging/2026-2027-1-full.json --force-refresh
```

该命令访问 `100.fosu.edu.cn`，抓取全校课程表并生成 Staging JSON。它不会上传，也不会发布线上 release。

生成后运行：

```powershell
npm run test:course-normalizer
npm run sync:local-upload -- --file=./staging/2026-2027-1-full.json --server=https://class.katelya.eu.org
```

`sync:local-upload` 会先 gzip，再按默认 8MB 分片上传到 `/api/admin/staging/upload/*`，适合 100MB+ 或 185MB 级别全量 JSON。上传完成状态应为 `pending-review`，不会自动发布。上传失败时可以安全重跑同一命令；服务端会校验 gzip 大小、原始大小、hash、chunk 数、schema 和 counts。

网页小文件上传只用于临时测试。全校全量 Staging JSON 一律使用 CLI 分片上传，避免浏览器、反向代理或 Node body limit 拦截。

## 发布

在后台 `/admin/dashboard` 的“同步中心”里检查 Staging 预览：

1. 确认 term、releaseVersion、generatedAt 正确。
2. 检查 counts：`classScheduleCount`、`teacherScheduleCount`、`classroomScheduleCount`、`courseScheduleCount`、`classroomCount`、`teacherCount`、`courseCount`、`collegeCount`、`gradeCount`。
3. 检查 diff，尤其是删除的行政班列表。
4. 如果变动率超过 30%，确认这是新学期正常更替后再勾选强制发布。
5. 点击“发布为正式版本”。

发布会先备份旧 release，再激活当前 Staging，并重建 derived indexes。小程序只读取正式 release 数据。发布成功后至少检查：

```powershell
Invoke-RestMethod https://class.katelya.eu.org/api/fosu/app-config
Invoke-RestMethod https://class.katelya.eu.org/api/fosu/bootstrap
Invoke-RestMethod "https://class.katelya.eu.org/api/fosu/search-index?type=class"
Invoke-RestMethod "https://class.katelya.eu.org/api/fosu/empty-classrooms?date=2026-06-02&week=13&weekday=2&sections=3-4&building=C7"
Invoke-RestMethod "https://class.katelya.eu.org/api/fosu/client-diagnosis"
```

## 回滚

在“版本发布历史与回滚控制”里选择历史 release，点击“一键回滚”。回滚前会再次备份当前版本，回滚后会触碰小程序配置版本。

## 接力同步

当本人电脑不在校园网时，创建 relay task，把运行命令发给在校同学：

```powershell
npm run sync:relay-agent -- --server=https://class.katelya.eu.org --token=RELAY_TOKEN --term=2026-2027-1
```

relay token 只能读取接力任务和上传 Staging JSON，不能访问 `/api/admin/*`，不能发布、回滚、查看反馈或读取敏感配置。接力上传后只进入 relay upload area，管理员必须手动“设为 Staging”并再次发布。

接力代理会自动定位源码版或打包版的 `login.js`/`sync.js`，在校园网电脑本地生成 `./staging/{term}-full.json`，确认后同样走 gzip 分片上传。

## 稳定版标准流程

课程数据更新不靠提交小程序代码。小程序代码发布用于功能更新；全校课表数据更新主要靠后台 release 发布。

推荐维护流程：

1. 本地电脑连接校园网或 VPN。
2. 在项目根目录运行：

```powershell
cd C:\Users\Katelya\Documents\VScode\FosuClass
npm run sync:local-campus -- --term=2025-2026-2 --start=2026-03-09 --output=./staging/2025-2026-2-full.json --include=classSchedules,teacherSchedules,classroomSchedules,courseSchedules,classes,teachers,classrooms,courses --class-scope=all --grades=2025,2024,2023,2022,2021 --concurrency=1 --delay-ms=900
```

3. 上传 staging：

```powershell
npm run sync:local-upload -- --file=./staging/2025-2026-2-full.json --server=https://class.katelya.eu.org
```

4. 进入后台 `/admin/sync`。
5. 查看 staging counts 和 diff。
6. 点击“构建 Release Pack job”，等待 job 状态变为 `success`。
7. 点击 quick health；需要完整校验时点击 deep health job，不要等待同步长请求。
8. 发布正式版。
9. 发布后点击 verify job，确认静态 manifest、class index、empty-room index 可读。
10. 发布后执行本地读取验证：

```powershell
npm run verify:release-live -- --server=https://class.katelya.eu.org --term=2025-2026-2
```

11. 真机打开小程序，在设置页查看“数据版本详情”。开发版/体验版可进入“高级诊断”查看 active manifest、last-good、index 和 empty-room 缓存。

发布新课程数据后，小程序通过 active manifest + `releaseVersion/cacheEpoch/forceRefreshToken` 检测新版。旧缓存不会立即暴力清空，只有新版本 class 轻量 index 校验成功后才安全切换。如果服务器网络慢，小程序先展示 last-good，再后台刷新。静态 Release Pack 是主路径，Node API 是兜底路径。

## 静态 Release Pack 部署路线

A. 当前 VPS + OpenResty：`/static/releases/` alias 到 `server/storage/public/releases/`，配置一年 immutable cache，优先 `.br/.gz`。

B. Cloudflare：给 `/static/releases/*` 配 Cache Everything 和长 Edge TTL；`/api/fosu/app-config`、`/api/fosu/bootstrap`、`/api/fosu/release-pack/manifest` 必须保持 no-store。

C. 国内 CDN：将 `static-class.katelya.top` 接入腾讯云 COS/CDN 或其他国内对象存储/CDN，只同步 `server/storage/public/releases/*`。API 可以继续留在 `https://class.katelya.eu.org`。

```env
FOSU_API_BASE_URL=https://class.katelya.eu.org
FOSU_STATIC_RELEASE_BASE_URL=https://static-class.katelya.top/static/releases
```

## 开学季高频更新

大一新生开学季建议每天至少两次刷新：

1. 早上用 `sync:local-campus` 生成 Staging。
2. 上传到 VPS 后检查 diff。
3. 只在变动符合预期时发布。
4. 保留前一个稳定 release，必要时立即回滚。

## 常见故障

`VPS 无法访问 100.fosu.edu.cn`：正常。切换到本机校园网同步或接力代理端。

`Staging JSON 缺字段`：重新用 `sync:local-campus` 生成，确认包含 `schemaVersion`、`releaseVersion`、`term`、`termStartDate`、`generatedAt` 和 `classSchedules`。

`上传后小程序未更新`：确认是否已经点击发布，而不是只上传到 Staging；再检查 `/api/fosu/app-config` 的数据版本。

`185MB JSON 上传失败`：不要走网页上传。重跑 `npm run sync:local-upload`，确认网络代理没有劫持；如出现 `ECONNRESET` 或本机代理端口，先清理 `HTTP_PROXY`、`HTTPS_PROXY`，或设置 `SYNC_DISABLE_PROXY=true`。

`发布失败只显示笼统错误`：打开后台 Staging 预览和上传记录，复制真实 `message`、`blockers`、`warnings`；再用 `/api/fosu/client-diagnosis` 检查 active release 和索引是否存在。
