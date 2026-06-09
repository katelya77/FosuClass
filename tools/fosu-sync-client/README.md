# FosuClass 本地同步器 (fosu-sync-client)

本工具是 **佛课小表 FosuClass** 小程序项目的本地教务数据同步客户端。

## 为什么需要此同步器？

1. **教务网内网限制**：佛山大学强智教务网 `100.fosu.edu.cn` 仅限校园网内网或连接校园 EasyConnect VPN 访问。外网（包括本项目的海外 Oracle VPS 服务器）无法直接解析或建立网络连接。
2. **安全与风控合规**：海外 VPS 不应也无法稳定运行校园 VPN，否则可能触发学校账号风控与网络安全审查。
3. **新的同步架构**：
   ```
   [ 本地电脑 (已连 VPN) ] --(抓取)--> [ 佛大教务网 ]
            |
        (上传数据)
            v
   [ 海外 VPS 服务器 ] --(读取缓存)--> [ 微信小程序 FosuClass ]
   ```

---

## 安装与配置步骤 (Windows 环境)

### 1. 准备环境
- 请确保本机已安装 [Node.js](https://nodejs.org/) (推荐 v18+)。
- 在运行本工具前，**必须先启动并登录佛山大学 EasyConnect VPN**。

### 2. 配置项目
进入工具目录，复制配置文件样例并根据实际情况修改：
```bash
cd tools/fosu-sync-client
copy .env.example .env
```

修改 `.env` 中的以下配置项：
- `ADMIN_API_TOKEN`：填入在 VPS 部署时配置的管理员 API 同步 Token（需保持一致）。
- `FOSU_SYNC_AUTH_MODE`：设置为 `playwright-manual`（推荐模式，弹出浏览器手动登录）或 `manual-cookie`（手动在浏览器中复制 Cookie 填入下方的 `FOSU_MANUAL_COOKIE`）。

### 3. 安装依赖与 Playwright 浏览器
```bash
npm install
npx playwright install chromium
```

---

## 运行同步任务

在命令行中支持执行以下命令：

### 1. 网络连接诊断
检测您的网络环境是否能解析并访问内网教务系统：
```bash
npm run diagnose
```
> **注意**：由于强智教务网老旧的 SSL/TLS 握手协议，Node.js 直接请求可能会报错 `NODE_TLS_HANDSHAKE_FAILED`，这不代表网络不通。**只要 DNS 能成功解析出以 `172.16` 等开头的内网 IP，脚本就会判定诊断通过**，允许您继续运行 Playwright 抓取，因为浏览器可成功绕过该 SSL 兼容问题。

### 2. 浏览器级深度诊断 (推荐)
如果您对网络连接存疑，可以运行浏览器级诊断命令：
```bash
npm run diagnose:browser
```
> 该命令将启动 Playwright 界面浏览器访问 `http://100.fosu.edu.cn`。本同步客户端已进行升级，会**优先尝试启动您本机的系统 Edge 浏览器或 Chrome 浏览器**，无需像以前那样必须通过 `npx playwright install chromium` 额外下载 Playwright 自带的 Chromium 引擎。

### 3. 登录教务系统 (仅 playwright-manual 模式需要)
打开一个可见的系统浏览器，引导您手动进行账号登录：
```bash
npm run login
```
> **说明**：程序将自动为您跳转至教务网。请手动输入您的学号、密码，并完成验证码或滑块验证。成功登录进入系统主页后，浏览器将自动关闭，并将会话信息安全保存至本地 `.session/session.json` 中（已在 `.gitignore` 中默认过滤，严禁提交到 Git）。

### 4. 自动发现教务接口
新增的自动化嗅探工具，用于动态探索佛大教务处的 API 结构：
```bash
npm run discover:fosu
```
> 该脚本会自动加载已保存的登录态，并依次自动访问教务桌面、个人课表、班级课表、教师课表、教室课表和课程课表等 6 大核心页面，在后台静默收集指向 `100.fosu.edu.cn` 的请求。
> 
> **注意：安全隐私脱敏**。此命令会自动对所有网络包进行**完全脱敏**处理：不保存任何 Cookie、JSESSIONID、CAS ticket 或是具体学号密码值，只记录请求的 method、path、参数名称和响应内容长度特征。输出报告路径为：
> - `tools/fosu-sync-client/.debug/fosu-endpoints.json`
> - `tools/fosu-sync-client/.debug/fosu-endpoints.md`

### 5. 竞品 HAR 静态分析
新增离线 HAR 包分析命令，用以分析并评估已有竞品（如第三方“伴你上课”小程序）的底层接口实现与合规风险：
```bash
npm run analyze:har
```
> 运行后会解析 `docs/captures/ProxyPin5-29_00_52_53.har`，生成详尽的脱敏竞品分析报告：
> - 报告输出路径：`docs/captures/third-party-bnsk-analysis.md`
> - 分析说明：其 `/fosu/post.php` 接口需要在请求体中直接提交学生的学号 (`acc`) 与密码 (`pwd`) 到作者个人的第三方服务器，这存在巨大的用户隐私泄露和账号被风控冻结的安全风险。FosuClass 绝不调用或依赖此类第三方接口。

### 6. 开始数据同步
本同步客户端现在采用**浏览器级抓取方案**（在 Playwright 上下文内调用 evaluate fetch 或 DOM 模拟操作），彻底解决了 Node 的 SSL 握手局限。
```bash
npm run sync:all
```
> 一键执行：
> - **同步基础 Catalog 目录**：访问班级、教师、教室、课程页面，汇总全校完整的学院、学期、年级和周次配置，上传至 VPS 并缓存为 `last-catalog.json`。
> - **联动同步 Majors 专业选项**：通过 Playwright 自适应抓取（Ajax 自动 fetch，如失败自动 Fallback 到 DOM 下拉框联动操作读取 options），获取专业，缓存为 `last-majors.json`。
> - **同步 Class Schedules 班级课表**：
>   - **班级定位**：访问个人课表页自动识别当前登录学生的行政班级名称。
>   - **阶段过滤（防止暴力抓取导致风控）**：第一阶段仅同步当前登录学生所属专业、动物科技学院 2025 级所有专业、以及名称包含“动物医学/动物科学”的班级课表。
>   - **限流限速**：每次专业请求间隔 800 - 1500ms 随机延迟。
>   - **断点续传**：已成功同步的专业会记录在 `.debug/sync-progress.json`，若中断可再次运行，直接从断点处继续抓取。
>   - **Raw HTML 留底**：抓取的 HTML 会保存在 `.debug/raw-pages/` 供离线分析。

### 6.1 发布完整 release 快照

```bash
npm run sync:release
```

`sync:release` 会完整执行 catalog、majors、class schedules 抓取，生成离线快照，上传到 VPS 的 release 存储，并在服务端校验通过后激活。任一步失败都不会切换线上 active release，旧快照会继续可用。

如果只需要从本地 `.debug/class-schedules-latest.json` 继续上传，不重新打开浏览器抓取：

```bash
npm run sync:upload-cache
```

资源维度基础框架：

```bash
npm run sync:teachers
npm run sync:classrooms
npm run sync:courses
npm run sync:resources
```

Windows 定时任务说明见 `tools/fosu-sync-client/docs/sync-automation.md`。

---

### 7. 学期选择与常见问题配置

本同步客户端支持手动指定当前需要同步的学期，并要求在采集前提供完整 `termConfig`，以防止教务系统未来排课或垃圾测试学期影响抓取结果。

#### 1) 学期选择配置
- 采集新学期必须显式传入 `--term`、`--term-start-date` 和 `--total-weeks`。脚本不会为未来学期猜测开学日期。
- 如果日志中出现 `2028-2029-1` 这种异常的未来远期学期，说明教务处的默认首选项有误。请在您的本地 `.env` 文件中配置明确的 `PREFERRED_SEMESTER`，并在采集命令中传入开学日期：
  ```env
  PREFERRED_SEMESTER=2026-2027-1
  ```
- **配置与运行结果示例**：
  配置好后，运行同步任务时会显示以下日志：
  ```text
  term: 2026-2027-1
  semesterText: 2026-2027学年第一学期
  termStartDate: 2026-09-07
  totalWeeks: 20
  source: cli
  ```
- 采集命令示例：
  ```bash
  npm run sync:local-campus -- --term=2026-2027-1 --term-start-date=2026-09-07 --total-weeks=20 --fresh
  ```
  上述日期仅为示例，必须由管理员按校历人工确认。
- 若配置的学期在教务页面下拉菜单中找不到，脚本将打印所有可选学期并安全中止，拒绝同步，从而确保缓存数据准确性。

#### 2) "缺失 majorName" 与空专业名过滤
- 在同步专业（`sync:majors`）时，若之前出现 `"数据校验未通过：缺失 majorName"` 错误，这是因为教务系统下拉选择框中存在一些隐藏的空 option（如 `--请选择--`、`全部` 等），在联动解析时它们被当作真实专业数据抓取了。
- 当前版本已对客户端和服务端均进行了严格的数据清洗升级：
  - 客户端和服务端将自动识别并跳过空专业名、占位符选项。
  - 对于缺失 `majorCode` 但专业名称有效的数据，系统会自动为其计算 md5 stable hash 作为 `majorCode`。
  - 清洗后的原始抓取数据和最终上传数据，分别保存在本工具目录下的 `.debug/last-majors-raw.json` 与 `.debug/last-majors-upload.json` 中，以便开发者排查。

---

### 8. 专业同步的高级过滤与自定义年级

为了避免因教务系统存在数十个毕业已久的远古年级而引发大量的垃圾数据抓取（例如 1990级、2001级等），本工具在运行 `sync:majors` 时支持通过环境变量来动态限定年级范围。

#### 环境变量说明

- `SYNC_GRADE_RANGE`：控制同步年级范围，可选值如下：
  - `active` (默认值)：只同步当前在校的最近 5 个本科年级。例如当前学期是 `2025-2026-2`，则提取起始学年 `2025`，只保留 `2021` 至 `2025` 五个年级。
  - `recent4`：只同步最近 4 个年级（即 `2022` 至 `2025`）。
  - `custom`：使用自定义的年级列表，配合下面的 `SYNC_GRADES` 变量使用。
  - `all`：同步教务下拉菜单里展示的所有年级（全量历史年级）。**必须同时设置 `CONFIRM_FULL_SYNC=true` 才能运行，否则为了避免过多请求导致风控，脚本将强行终止**。
- `SYNC_GRADES`：配合 `SYNC_GRADE_RANGE=custom` 使用，逗号分隔多个年级，例如 `2023,2024,2025`。
- `CONFIRM_FULL_SYNC`：在 `SYNC_GRADE_RANGE=all` 时必须显式设为 `true`。

#### 使用示例

**在 Linux/macOS/Git Bash 环境下运行：**

```bash
# 默认模式（等价于 active）
npm run sync:majors

# 自定义只同步 2023, 2024, 2025 三个年级
SYNC_GRADE_RANGE=custom SYNC_GRADES=2023,2024,2025 npm run sync:majors

# 全量同步历史年级（需要二次确认开关）
SYNC_GRADE_RANGE=all CONFIRM_FULL_SYNC=true npm run sync:majors
```

**在 Windows PowerShell 环境下运行：**

```powershell
# 自定义同步年级
$env:SYNC_GRADE_RANGE="custom"
$env:SYNC_GRADES="2021,2022,2023,2024,2025"
npm run sync:majors

# 重置环境变量
$env:SYNC_GRADE_RANGE=$null
$env:SYNC_GRADES=$null
```

**在 Windows CMD 命令提示符环境下运行：**

```cmd
set SYNC_GRADE_RANGE=custom
set SYNC_GRADES=2023,2024
npm run sync:majors
```

---

## 长期数据来源设计与多维贡献策略

为了项目不长期单点依赖开发者的个人学号，且符合“不在海外 VPS 安装 EasyConnect”、“不缓存普通用户密码”的安全底线，FosuClass 采取以下两阶段的可持续数据生态：

### 阶段 1：多管理员/有条件贡献者本地运行同步
任何能够连接 EasyConnect 校园 VPN 的同学，均可以通过克隆本项目，在本地运行同步客户端：
1. 运行 `npm run login` 填入个人或借用学号登录。
2. 运行 `npm run sync:all`，即可将数据上传并合并到公共课表缓存中。
由于有断点续传和阶段限流保护，整个过程可控、合规、安全。

### 阶段 2：用户端小程序自主“贡献课表”（已预留）
小程序端在 `pages/settings` 页面中预留了“**贡献班级课表**”入口，学生同步或获取自己课表后：
1. 可以一键复制/粘贴符合 courses 结构的 JSON 数据，填写学期、年级、学院、专业与班级提交。
2. 后端接收 `POST /api/contribute/schedule`，数据被自动打上 `reviewed: false` 标记，默认对其他用户不可见。
3. 管理员在后台审核并调用 `POST /api/admin/review/contributions` （批准 `approve`），该班级课表便会安全合并入公共 `class-schedules.json`，该班级的所有其他同学无需连 VPN 即可通过“缓存优先”直接加载该课表。
4. 在贡献和审核的整个网络传输与持久化流程中，**绝不记录任何 Cookie、密码和学号等隐私信息**，确保绝对安全边界。

---

## 验证与监控

1. **验证 VPS 接收状态**：
   使用 `x-admin-token: ADMIN_API_TOKEN` 访问 `https://class.katelya.eu.org/api/admin/sync/status`，若返回结果中 `success` 为 `true`，且 `catalogUpdatedAt`、`collegesCount`、`majorsCount`、`classScheduleCount` 显示了您的同步时间及正确条目数，说明 VPS 已成功接收并写入静态缓存。

2. **验证微信小程序展示**：
   打开小程序中的“查找课表”页面，切换到“班级” Tab，如能正确拉出刚刚同步的学院和年级，并在底端看到类似 “数据更新于：xxxx-xx-xx xx:xx” 的提示，即代表同步链路大功告成！

3. **PowerShell 调试与验证命令**：

   在 PowerShell 中运行以下命令，以本地验证数据抓取和清洗结果：

   - **检查 `.env` 是否能被正常读取**：
     ```powershell
     node -e "require('dotenv').config(); console.log(process.env.PREFERRED_SEMESTER, process.env.SYNC_GRADES)"
     ```

   - **检查原始抓取的专业数据**：
     ```powershell
     node -e "const fs=require('fs');const p='.debug/last-majors-raw.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));const arr=j.items||j.majors||j.data||j;console.log(arr.length);console.log(Object.keys(arr[0]||{}));console.dir(arr.slice(0,5),{depth:10});"
     ```

   - **检查清洗后准备上传的专业数据**：
     ```powershell
     node -e "const fs=require('fs');const p='.debug/last-majors-upload.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));const arr=j.items||j.majors||j.data||j;console.log('total=',arr.length);console.log('empty=',arr.filter(x=>!String(x.majorName||x.name||x.rawLabel||'').trim()).length);console.dir(arr.slice(0,5),{depth:10});"
     ```
