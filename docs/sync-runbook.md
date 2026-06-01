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
npm run sync:local-campus -- --term=2026-2027-1 --start=2026-09-01 --output=./staging/2026-2027-1-full.json --include=classSchedules,teacherSchedules,classroomSchedules,courseSchedules,classrooms,teachers,courses --class-scope=all --grades=2026,2025,2024,2023,2022 --concurrency=1 --delay-ms=900
```

该命令访问 `100.fosu.edu.cn`，抓取全校课程表并生成 Staging JSON。它不会上传，也不会发布线上 release。

生成后运行：

```powershell
npm run test:course-normalizer
npm run sync:local-upload -- --file=./staging/2026-2027-1-full.json --server=https://class.katelya.eu.org
```

`sync:local-upload` 会先 gzip，再按默认 8MB 分片上传到 `/api/admin/staging/upload/*`，适合 100MB+ 全量 JSON。上传只进入 VPS Staging 区。管理员仍需在后台查看校验结果、diff 和变动熔断提示。

网页小文件上传只用于临时测试。全校全量 Staging JSON 一律使用 CLI 分片上传，避免浏览器、反向代理或 Node body limit 拦截。

## 发布

在后台 `/admin/dashboard` 的“同步中心”里检查 Staging 预览：

1. 确认 term、releaseVersion、generatedAt 正确。
2. 检查行政班、教师、教室、课程数量。
3. 检查 diff，尤其是删除的行政班列表。
4. 如果变动率超过 30%，确认这是新学期正常更替后再勾选强制发布。
5. 点击“发布为正式版本”。

发布会先备份旧 release，再激活当前 Staging。小程序只读取正式 release 数据。

## 回滚

在“版本发布历史与回滚控制”里选择历史 release，点击“一键回滚”。回滚前会再次备份当前版本，回滚后会触碰小程序配置版本。

## 接力同步

当本人电脑不在校园网时，创建 relay task，把运行命令发给在校同学：

```powershell
npm run sync:relay-agent -- --server=https://class.katelya.eu.org --token=RELAY_TOKEN --term=2026-2027-1
```

relay token 只能读取接力任务和上传 Staging JSON，不能访问 `/api/admin/*`，不能发布、回滚、查看反馈或读取敏感配置。接力上传后只进入 relay upload area，管理员必须手动“设为 Staging”并再次发布。

接力代理会自动定位源码版或打包版的 `login.js`/`sync.js`，在校园网电脑本地生成 `./staging/{term}-full.json`，确认后同样走 gzip 分片上传。

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
