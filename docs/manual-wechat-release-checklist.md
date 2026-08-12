# 微信开发者工具与上线手动验收清单

本文用于完成自动化无法代替的人工步骤：微信开发者工具配置、真机预览、生产全量数据上传、正式 release 发布/回滚和后台复制按钮人工核验。

相关背景文档：

- `docs/wechat-platform-setup.md`：微信平台能力和服务器域名配置。
- `docs/sync-runbook.md`：校园网同步、Staging、发布和回滚主流程。
- `docs/relay-agent.md`：接力同步代理操作。
- `docs/cache-versioning.md`：releaseVersion、缓存和 Last Known Good 规则。

## 0. 安全边界

手动操作前先确认这些规则：

- 不把 `AppSecret`、上传密钥、`ADMIN_PASSWORD`、`ADMIN_TOKEN`、`ADMIN_API_TOKEN`、relay token 写入仓库、文档、截图或沟通记录。
- 185MB 级别全量 JSON 不走网页上传，只使用 `npm run sync:local-upload` 的 gzip 分片上传。
- 小程序只读取正式 release；Staging 和 relay upload area 不会自动影响线上用户。
- 发布前必须看 diff、counts、blockers、warnings；发布后必须跑 API 验证。
- 网络失败时应保留 Last Known Good 缓存，不允许出现全校页或课表页白屏。

## 1. 微信开发者工具安装与导入

1. 安装微信开发者工具稳定版，并用有该小程序开发权限的微信号登录。
2. 打开仓库根目录：

   ```text
   C:\Users\Katelya\Documents\VScode\FosuClass
   ```

3. 导入现有小程序项目，不要新建空项目。
4. 确认项目配置：

   | 项目 | 当前值 |
   | --- | --- |
   | AppID | `wx450dc86653f5907b` |
   | 项目名 | `FosuClass` |
   | 小程序根目录 | `miniprogram/` |
   | 项目配置文件 | `project.config.json` |
   | 本机私有配置 | `project.private.config.json` |

5. 进入“详情 / 本地设置”，确认：

   - 开发调试时可临时关闭“校验合法域名”，但真机预览和提审前必须打开。
   - ES6 转 ES5、增强编译、压缩 WXML/WXSS/JS 按项目配置执行。
   - 不上传 source map，除非你明确需要排查线上堆栈。
   - 不把上传密钥或个人路径写入 `project.config.json`。

6. 如需命令行能力，进入“设置 / 安全设置”，开启“服务端口”。该端口只用于本机工具控制，不要暴露到公网。

常见 Windows CLI 路径：

```powershell
C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat
C:\Program Files\Tencent\微信web开发者工具\cli.bat
$env:LOCALAPPDATA\Programs\微信开发者工具\cli.bat
```

先用当前工具版本确认命令语法：

```powershell
$ProjectRoot = "C:\Users\Katelya\Documents\VScode\FosuClass"
$Cli = "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
& $Cli --help
& $Cli --preview --help
```

常见 CLI 示例：

```powershell
# 打开项目
& $Cli -o $ProjectRoot

# 生成预览二维码到本地图片
& $Cli -p $ProjectRoot --preview-qr-output image@"$ProjectRoot\output\wechat-preview-qr.png"

# 上传体验版代码。版本号和备注按实际发布填写。
& $Cli -u "2.1.0@$ProjectRoot" --upload-desc "v2.1.0 微信平台适配、缓存稳定性和空教室查询"
```

如果 CLI 不可用，直接使用开发者工具界面的“编译 / 预览 / 上传”按钮完成同样操作。

## 2. 微信公众平台配置

进入微信公众平台对应小程序后台，检查“开发管理 / 开发设置”。

### 2.1 服务器域名

| 类型 | 值 |
| --- | --- |
| request 合法域名 | `https://class.katelya.eu.org` |
| downloadFile 合法域名 | `https://class.katelya.eu.org` |
| uploadFile 合法域名 | 暂不需要 |
| socket/udp/tcp | 暂不需要 |

保存后在真机预览中确认 `/api/fosu/app-config`、`/api/fosu/bootstrap`、`/api/fosu/search-index`、`/api/fosu/schedule-detail`、`/api/fosu/empty-classrooms` 都能访问。

### 2.2 平台能力

如果后台能看到这些能力入口，可以按下面配置；如果入口暂不可用，本轮代码会自动降级到普通 API。

| 能力 | 建议 URL | 验收点 |
| --- | --- | --- |
| 数据预拉取 | `https://class.katelya.eu.org/api/fosu/prefetch` | 返回 active release 的轻量元信息，不返回完整课表。 |
| 数据周期性更新 | `https://class.katelya.eu.org/api/fosu/periodic-data` | 返回 active manifest、最近 release 摘要和 empty-room index 元信息。 |
| 普通链接二维码 | 见 `docs/wechat-platform-setup.md` | 能打开课表详情和空教室页，缺少 `releaseVersion` 时回退 active release。 |

## 3. 真机预览验收

在开发者工具点击“预览”，用开发者或体验者微信扫码。至少覆盖下面路径：

| 场景 | 操作 | 预期 |
| --- | --- | --- |
| 冷启动 | 首次打开小程序 | 不白屏，能显示当前 active release 的学期和版本。 |
| 全校页 | 进入“全校”，搜索班级、教师、教室、课程 | 搜索结果有数据，点击能进入课表详情。 |
| 课表详情 | 打开带 `releaseVersion` 的详情页 | 当前周课程优先展示，非活跃课程不覆盖当前周课程。 |
| 空教室 | 打开 `pages/empty-room/empty-room` | 能按日期、节次、教学楼查询，结果来自预生成索引。 |
| 空教室收藏 | 收藏常用教学楼和教室，再重启小程序 | 收藏仍存在，点击收藏能快速筛选或打开教室课表。 |
| 网络失败 | 先成功加载一次，再断网或切弱网刷新 | 页面保留 Last Known Good 缓存，有错误提示但不清空页面。 |
| 分享路径 | 分享课表详情或空教室页再打开 | query 参数能解析，缺少旧版本数据时有可理解的回退提示。 |

建议在开发者工具里新增编译模式：

```text
pages/school/school
pages/empty-room/empty-room?building=C7&sections=3-4
pages/schedule-view/schedule-view?type=classroom&id=C7-101&term=2025-2026-2&releaseVersion=RELEASE_VERSION
```

把 `RELEASE_VERSION` 替换成 `/api/fosu/app-config` 当前返回的 `dataVersion.releaseVersion`。

## 4. 生产全量数据上传

只在已连接校园网或学校 VPN 的电脑上执行。

```powershell
cd C:\Users\Katelya\Documents\VScode\FosuClass
npm run login

$env:SYNC_CLASS_SCOPE="all"
$env:SYNC_RESOURCE_SCOPES="classSchedules,teacherSchedules,classroomSchedules,courseSchedules,classrooms,teachers,courses"
$env:SYNC_GRADES="2026,2025,2024,2023,2022"
$env:SYNC_MAX_CONCURRENCY="1"
$env:SYNC_REQUEST_DELAY_MS="900"

npm run sync:current-term
npm run test:course-normalizer

$env:ADMIN_API_TOKEN="YOUR_ADMIN_API_TOKEN"
npm run sync:local-upload -- --file=./staging/2026-2027-1-full.json --server=https://class.katelya.eu.org
```

上传完成后的状态应为 `pending-review`。失败时可安全重跑同一个 `sync:local-upload` 命令；不要改用网页上传大文件。

上传后检查：

- 上传记录显示 gzip 大小、原始大小、chunk 数和 hash 校验通过。
- schema 没有缺字段。
- counts 符合预期，尤其是班级、教师、教室、课程表和空教室索引。
- 没有 `blockers`；`warnings` 已逐条确认。

## 5. 正式发布

登录后台：

```text
https://class.katelya.eu.org/admin/dashboard
https://class.katelya.eu.org/admin/sync
```

发布前检查：

1. Staging 的 `term`、`releaseVersion`、`generatedAt` 正确。
2. diff 中大规模删除符合预期；如果变化率超过 30%，确认是新学期正常替换后再强制发布。
3. `classScheduleCount`、`teacherScheduleCount`、`classroomScheduleCount`、`courseScheduleCount`、`classroomCount`、`teacherCount`、`courseCount`、`collegeCount`、`gradeCount` 没有异常归零。
4. 空教室索引已生成，后台没有提示 runtime 解析大 JSON。
5. 当前周课程优先级相关测试已通过：

   ```powershell
   npm run test:timetable-current-week-priority
   npm run test:timetable-inactive-does-not-cover-active
   npm run test:empty-room-index-build
   npm run test:empty-room-api
   npm run test:empty-room-cache
   npm run test:empty-room-current-section
   npm run test:miniprogram-cache-version
   ```

点击“发布为正式版本”后，立刻执行：

```powershell
Invoke-RestMethod https://class.katelya.eu.org/api/fosu/app-config
Invoke-RestMethod https://class.katelya.eu.org/api/fosu/bootstrap
Invoke-RestMethod "https://class.katelya.eu.org/api/fosu/search-index?type=class"
Invoke-RestMethod "https://class.katelya.eu.org/api/fosu/empty-classrooms?date=2026-06-02&week=13&weekday=2&sections=3-4&building=C7"
Invoke-RestMethod "https://class.katelya.eu.org/api/fosu/client-diagnosis"
```

验收点：

- `app-config` 的 active `releaseVersion` 等于刚发布版本。
- `bootstrap`、`search-index`、`schedule-detail` 和 `empty-classrooms` 不报 404/500。
- `client-diagnosis` 没有 active release 或 derived index 缺失告警。
- 真机重新打开小程序后读取新 release；旧缓存不会覆盖新版本。

## 6. 回滚演练

在后台“版本发布历史与回滚控制”中选择前一个稳定 release，点击“一键回滚”。

回滚后检查：

```powershell
Invoke-RestMethod https://class.katelya.eu.org/api/fosu/app-config
Invoke-RestMethod "https://class.katelya.eu.org/api/fosu/client-diagnosis"
```

确认：

- active `releaseVersion` 已切回目标历史版本。
- 当前版本被自动备份，后续仍可恢复。
- 小程序端能感知新 active 指针，并隔离旧版本缓存。

演练完成后，如无需保持回滚状态，再发布回最新稳定版本。

## 7. 接力同步人工操作

当你的电脑不在校园网时，在后台创建 relay task，把命令发给在校同学：

```powershell
npm run sync:relay-agent -- --server=https://class.katelya.eu.org --token=RELAY_TOKEN --term=2026-2027-1
```

接力同学只需要：

1. 在校园网电脑运行命令。
2. 按提示登录教务系统。
3. 等待生成 `./staging/{term}-full.json`。
4. 看摘要无误后输入 `yes`，让代理 gzip 分片上传。

管理员随后必须手动：

1. 在后台查看 relay upload area。
2. 将可信上传“设为 Staging”。
3. 重复第 5 节正式发布流程。

relay token 不能发布、不能回滚、不能访问 `/api/admin/*`，只用于读取任务和上传指定学期 Staging。

## 8. 后台复制按钮人工核验

自动化已能点击复制按钮，但浏览器权限不允许读取系统剪贴板。请手动确认：

1. 打开 `https://class.katelya.eu.org/admin/sync`。
2. 依次点击同步中心里的 CLI 命令复制按钮。
3. 粘贴到记事本或本地终端草稿，不要直接执行。
4. 检查命令包含正确的 `--server`、`--term`、`--output` 或 `--file`。
5. 确认命令里没有明文密码、没有真实 `ADMIN_API_TOKEN`、没有 relay token 泄露到页面文案。
6. 确认按钮点击后页面不报错，后台页面不白屏。

## 9. 最终完成判定

全部勾选后，本轮未自动完成的外部任务才算闭环：

- [ ] 微信开发者工具已安装、登录，并可打开 `FosuClass` 项目。
- [ ] 服务端口已按需开启，CLI 或界面预览可用。
- [ ] 微信公众平台服务器域名已配置。
- [ ] 真机预览通过全校页、课表详情、空教室、收藏、分享和弱网回退。
- [ ] 生产全量 Staging JSON 已通过 CLI gzip 分片上传。
- [ ] 后台 Staging diff/counts/blockers/warnings 已人工审核。
- [ ] 正式 release 已发布并通过 API 验证。
- [ ] 回滚流程至少演练一次，或明确记录本次不演练的原因。
- [ ] 后台复制按钮的剪贴板内容已人工确认。
- [ ] 没有任何 token、密码、上传密钥或 AppSecret 被提交到仓库。
