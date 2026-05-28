# FosuClass 本地同步器 (fosu-sync-client)

本工具是 **佛大课表 FosuClass** 小程序项目的本地教务数据同步客户端。

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
   访问 `https://class.katelya.eu.org/api/admin/sync/status`，若返回结果中 `success` 为 `true`，且 `catalogUpdatedAt`、`collegesCount`、`majorsCount`、`classScheduleCount` 显示了您的同步时间及正确条目数，说明 VPS 已成功接收并写入静态缓存。

2. **验证微信小程序展示**：
   打开小程序中的“查找佛大课表”页面，切换到“班级” Tab，如能正确拉出刚刚同步的学院和年级，并在底端看到类似 “数据更新于：xxxx-xx-xx xx:xx” 的提示，即代表同步链路大功告成！
