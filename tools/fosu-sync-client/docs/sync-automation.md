# FosuClass 校园网同步自动化

FosuClass 的数据采集与发布采用“校园网/EasyConnect 采集 + VPS 离线快照发布”的闭环架构：

1. 校园网或 EasyConnect 环境中的维护者运行 `tools/fosu-sync-client`。
2. 数据流依次抓取 `catalog` (学院/年级)、`majors` (专业映射)、`class` (班级课表)，并由班级课表本地缓存派生 `resources` (教师/教室/课程资源维度)。
3. 合并上述维度生成完整的 `release snapshot`（压缩包），并离线发布上传至 VPS 同步激活。
4. VPS 校验 release 完整性，成功后无缝切换小程序使用的 dataSource；若失败则安全回滚，不破坏线上。

---

## ⚠️ 核心概念与防误区说明

> [!IMPORTANT]
> 1. **`npm run sync:resources` 不是重新抓教务最新课表的命令！** 
>    它不会访问教务 100 网，它仅仅读取本地已抓取的缓存文件 `.debug/class-schedules-latest.json`，在本地派生教师、教室、课程资源维度的索引数据，并将其上传到 VPS。如果在本地缓存陈旧时直接运行，可能会导致上传旧资源数据。
> 2. **真正从教务系统抓取全校最新班级课表的是 `npm run sync:class`。**
> 3. **为保障数据新鲜度：**
>    `sync:resources` 内部会读取抓取清单 `.debug/class-schedules-manifest.json` 进行校验：
>    - 若清单文件不存在，或班级课表学期与 Preferred Semester 不匹配，默认会**阻止执行**并提示先抓取。
>    - 若缓存生成时间超过 24 小时，给出强警告。
>    - 若设置了 `SYNC_RESOURCES_REQUIRE_FRESH=true` 且缓存超过 6 小时，将直接抛出错误。

---

## 🚀 推荐维护流程

当需要同步更新课表时，推荐的完整维护步骤如下：

1. **环境准备**
   - 确认身处**校园网环境**或已成功连接 **EasyConnect VPN**。
   - **彻底关闭并清理 v2rayN 等系统代理**（本地代理环境变量若指向 `127.0.0.1:10808` 等会直接导致上传 VPS 失败）。
2. **执行同步**
   - **日常维护更新**（推荐）：直接运行 `scripts/sync-quick.ps1`，或执行 `npm run sync:quick`。同一学期内学院与专业配置基本不变，此指令只重新拉取全校课表并生成、发布最新快照。
   - **新学期首次同步**（推荐）：直接运行 `scripts/sync-fresh.ps1`，或执行 `npm run sync:fresh`。此指令会全新抓取 catalog 与 majors 关系、然后拉取课表、生成派生索引、打包并发布快照。
3. **验证激活**
   - 检查线上接口的返回状态，确认同步成功并激活：
     - `/api/fosu/bootstrap` —— 确认 `dataSource` 已更新，以及班级课表数量正确。
     - `/api/admin/sync/status` —— 确认 snapshotVersion 与本地同步时间戳一致。

---

## 🛠️ 同步指令速查表

| 指令 | 作用描述 | 推荐场景 | 是否访问教务网 |
| :--- | :--- | :--- | :--- |
| `npm run sync:fresh` | **一键完整同步**：环境预检 → 重新同步 catalog → 同步 majors → 重新抓全校班级课表 → 派生教师/教室/课程索引 → 离线发布快照 → 验证线上接口。 | 新学期开学首次更新，或基础院系/专业发生重大变动时使用。 | **是** |
| `npm run sync:quick` | **一键快速同步**：环境预检 → 重新抓全校班级课表 → 派生教师/教室/课程索引 → 离线发布快照 → 验证线上接口。 | 日常每周的课表常规更新，或临时更新。 | **是** |
| `npm run sync:resources` | **派生资源索引**：在本地基于新生成的班级课表派生教师、教室、课程维度的数据并上传。 | 仅当你想单独刷新并重新上传教师/教室/课程索引时使用。 | 否 |
| `npm run sync:release` | **离线发布快照**：仅将本地已缓存的 catalog, majors, classSchedules, resources 打包并作为 release 上传至 VPS 激活。 | 适合调试发布，或中途网络中断导致上传失败后的断点补发布。 | 否 |
| `npm run login` | **模拟登录**：打开 Playwright 浏览器以辅助获取教务系统 Session 会话 Cookie，保存到本地缓存。 | 登录态过期、EasyConnect 重连或 Session 失效后使用。 | **是** |

---

## ⚙️ 常用环境变量与配置

可在 `.env` 中或在命令行前配置以下环境变量：

```powershell
# VPS 管理员访问认证 Token
$env:ADMIN_API_TOKEN="your_admin_token_here"
# 目标拉取的学期标识
$env:PREFERRED_SEMESTER="2026-2027-1"
# 采集前必须由管理员按校历确认开学日期
$env:PREFERRED_TERM_START_DATE="2026-09-07"
# 上传 VPS 时单分块大小（默认 10）
$env:SYNC_UPLOAD_CHUNK_SIZE="10"
# 是否强制在上传 VPS 和进行 Playwright 操作时彻底删除代理，防污染
$env:SYNC_DISABLE_PROXY="true"
# 资源同步时的并发数和请求延迟
$env:SYNC_RESOURCE_MAX_CONCURRENCY="1"
$env:SYNC_RESOURCE_REQUEST_DELAY_MS="900"
# 允许 resources 派生时采用较旧的班级课表缓存学期数据
$env:SYNC_RESOURCES_ALLOW_STALE="true"
# 强制要求 resources 派生时的班级课表缓存必须在 6 小时内
$env:SYNC_RESOURCES_REQUIRE_FRESH="true"
```

---

## 🔎 线上接口状态验证

管理员或维护者可通过浏览器或 `curl` 命令查看当前 VPS 同步及快照版本状态：

- **验证服务健康与线上活跃快照：**
  ```bash
  curl https://class.katelya.eu.org/api/health
  ```
- **验证小程序 bootstrap 信息（包含当前版本、数据源及课表计数）：**
  ```bash
  curl https://class.katelya.eu.org/api/fosu/bootstrap
  ```
- **验证后台数据表同步状态与快照修改时间：**
  ```bash
  curl -H "x-admin-token: $your_token" https://class.katelya.eu.org/api/admin/sync/status
  ```
- **查看用户反馈内容：**
  在浏览器中打开：`https://class.katelya.eu.org/admin/feedback`
