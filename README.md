# 佛课小表

用于课程表查看与今日上课提醒的原生微信小程序。

## 性能与缓存策略

- 小程序优先读取静态 Release Pack、runtime pointer 和 last-known-good 缓存；网络超时、403、504 或 Cloudflare 异常会进入 runtime circuit breaker，先保留可用课表和教师目录。
- 公共 API 的 `/app-config`、`/runtime/active`、`/sync/status`、`/sync/releases` 只走 manifest、summary、upload-record-index 等小 JSON fast-path；`getActiveReleaseInfoFast()` 只暴露压缩版 manifest 与 summary 兼容字段，不读取大 snapshot。
- CLI 分片上传的 `/api/admin/staging/upload/finalize` 只返回 `202 Accepted` 和后台 job，JSON parse、canonical hash、深度安全检查全部在 Release Worker 中执行。
- 全校页搜索结果采用 cache-first、同 `releaseVersion` 快速路径与分页渲染；命中同版本索引缓存后不再立即重复请求 API，触底或点击“加载更多”再追加，避免教师、课程、教室索引命中较多时卡住小程序视图层。
- 个人 XLS 课表绑定后会写入 `FOSU_PERSONAL_SCHEDULE_CACHE`，页面内优先走内存快速路径，减少大课表对象反复从小程序 storage 反序列化。
- 校园服务管家的常用任务图标使用小程序本地 SVG 静态资源，更多任务分组打开时按需渲染，并写入 runtime 缓存，降低首屏节点数和连续点击瞬时请求。
- staging 发布保留 active/staging/legacy 安全边界，教师目录缺失时显式标记 `not-counted`，不会把教师课表数量冒充教师目录数量。

## 2026 校园服务管家版本

本仓库已新增“校园服务管家”能力，定位为《佛课小表·校园服务管家：面向佛山大学的课程与空间服务工具》，用于整合课表、空教室、个人课表、校园信息和常用入口查询。

### 校园服务管家功能

- 小程序新增 `pages/ai-assistant/ai-assistant` 页面，支持快捷查询、查询输入、结构化结果卡片和一键跳转操作。
- 后端新增 `POST /api/ai/agent/chat`，响应稳定包含 `answer`、`cards`、`toolCalls`、`suggestions`、`safety` 和 `serverTime`。
- 校园服务管家采用“工具优先”架构：先识别意图和槽位，再调用 Release Pack、全校索引、空教室、今日课表摘要、数据诊断等确定性工具，最后整理中文卡片。
- 课程类卡片会优先展示具体上课时间段，例如 `08:00-09:25`，节次信息保留在副标题中，避免只显示“第几节”。
- 默认 `mockProvider` 可在无外部 Provider 凭证的情况下演示“现在有空教室吗”“今天还有课吗”“查老师课表”“怎么导入个人课表”“为什么数据加载失败”等核心场景；配置 DeepSeek/Coze 后，项目知识说明和复杂解释会调用外部 Provider，课程事实仍只来自工具结果。

### 架构图文字版

```
微信小程序校园服务管家页
  -> /api/ai/agent/chat
  -> safetyGuard 脱敏与上下文白名单
  -> 意图识别与槽位抽取
  -> toolRegistry 确定性工具
  -> Release Pack / 空教室索引 / 全校查询 / 今日课表摘要 / 数据诊断
  -> mock / deepseek / coze Provider
  -> 结构化卡片 + 后续操作
```

### 参赛演示版本说明

校园服务管家支持三种运行模式：

- 本地/评审机 mock 演示模式：`AI_AGENT_ENABLED=false` 或 `AI_PROVIDER=mock`，不调用外部 Provider，适合断网、无 key 或安全演示。
- 国产 Provider 脱敏调用模式：`AI_PROVIDER=deepseek` 或 `AI_PROVIDER=coze`，只使用脱敏后的消息、工具结果和最小上下文；DeepSeek 默认使用 `deepseek-v4-flash`，复杂说明书或离线分析可切换 `deepseek-v4-pro`。
- 境内部署生产模式：未来迁移到境内云、校内服务器或微信云托管并完成备案；是否满足“数据不出境”以服务器 region、Provider region 和实际数据链路为准。

参赛演示不把学号、密码、Cookie、JSESSIONID、ticket、Authorization、token、文件 base64 或完整原始文件内容交给外部 Provider。个人课表摘要默认关闭，用户开启后也只传递课程名、教师、教室、星期、节次、教学周等最小字段，日志只记录脱敏后的摘要、工具名和状态。

Oracle ARM、海外 VPS、1Panel 和 GitHub Actions 说明保留为开发/运维方案，不等同于境内合规部署。比赛现场建议使用 mock/local 演示，或配置合规的国产 Provider。

### Provider 配置

本机一键配置 DeepSeek：

```powershell
powershell -ExecutionPolicy Bypass -File tools/configure-ai-provider-local.ps1
```

Oracle ARM / Linux 开发运维环境：

```bash
FOSUCLASS_DEEPSEEK_API_KEY=your_local_key sh tools/configure-ai-provider-linux.sh
```

验证当前 Provider：

```bash
npm run verify:ai-provider
npm run test:ai-competition
```

密钥管理要求：不要提交 key，不在日志打印 key，只通过环境变量或未跟踪的 `server/.env` 本地文件注入；发现泄露应立即轮换。

更多说明见：

- [校园查询参赛设计](docs/competition-2026-agent-design.md)
- [校园查询合规说明](docs/ai-agent-compliance.md)
- [5 分钟演示脚本](docs/demo-script-5min.md)
- [Provider 配置](docs/model-provider-config.md)
- [Oracle ARM / Docker Provider 部署说明](docs/oracle-arm-deploy-ai.md)
- [CloudBase 混合架构](docs/cloudbase-hybrid-architecture.md)
- [CloudBase Release Pack 发布手册](docs/cloudbase-release-deploy.md)
- [CloudBase 混元接入说明](docs/cloudbase-ai-hunyuan.md)
- [CloudBase 故障演练](docs/cloudbase-failure-drill.md)

### CloudBase 国内数据面

本仓库已预留 CloudBase 环境 `cloud1-d3g17rpe7566d3d5c`。小程序端通过 `miniprogram/config/cloudbase.js` 集中管理 CloudBase Hosting、混元配置、比赛模式和公开发布开关。当前已通过 `tcb hosting detail -e cloud1-d3g17rpe7566d3d5c` 查询到 Hosting 域名 `https://cloud1-d3g17rpe7566d3d5c-1442900641.tcloudbaseapp.com`；代码不会猜测域名，也不会提交任何 SecretId、SecretKey、Token 或 API Key。

Release Pack 读取顺序为本地缓存、last-known-good、CloudBase Hosting、Oracle 静态目录、Oracle 兼容 API。CloudBase 只承载已验证的公开静态 JSON，不承载原始 XLS、staging 大 JSON、上传分片或管理员文件。

常用命令：

```bash
npm install -g @cloudbase/cli
tcb login
npm run cloudbase:hosting:detail
npm run cloudbase:release:dry-run -- --release-version <releaseVersion>
npm run cloudbase:release:verify -- --release-version <releaseVersion> --hosting-base-url https://your-cloudbase-hosting-domain
```

增强说明只处理项目问答、使用帮助和复杂解释；今日课程、教师课表、教室课表、空教室、教学周等事实仍只来自确定性工具。公开正式版资质未确认时，保持 `AI_GENERATIVE_PUBLIC_ENABLED=false` 或 `AI_TOOL_ONLY_MODE=true`，校园工具仍可正常使用。

## 长期数据演进与去中心化方案

由于佛山大学强智教务网 `100.fosu.edu.cn` 仅限校园网内网（VPN）访问，且海外 Oracle VPS 服务器不建议也不应安装 EasyConnect（可能导致学校账号风控拦截、安全合规问题与异常登录），因此本项目采用**去中心化的“多维护者本地同步 + 用户贡献课表 + 管理员审核 + 后端缓存”的长期演进架构**。

### 1. 核心架构逻辑
```
[ 维护者本地同步器 (EasyConnect环境) ] --(Playwright抓取)--> [ 佛大教务网 ]
                       |
                   (上传缓存数据)
                       v
         [ 海外 VPS 后端 (纯缓存模式) ] <--(审核合并)---- [ 用户自发贡献/导入 ]
                       |
                   (读取缓存)
                       v
            [ 微信小程序 FosuClass ]
```

- **本地同步器**：由管理员或多名志愿维护者在连接了学校 EasyConnect 后运行。诊断脚本 `diagnose.js` 在 DNS 解析出校内 IP（如 `172.16.x.x`）后，即使 Node 发生 TLS 握手失败，也能利用 Playwright 浏览器（开启忽略证书参数）成功实现手动登录与数据同步。
- **用户自发贡献**：当某些班级的课表数据未被同步时，学生可以通过小程序端“设置 -> 贡献班级课表”功能，粘贴本地导出的课表数据。贡献数据默认进入待审核状态，待管理员在后台核对通过后合并发布，从而彻底免去对单一维护者学号的长期依赖。
- **第三方 HAR 警示**：虽然我们对第三方已有小程序（如“伴你上课”）的抓包 HAR 文件进行了脱敏分析，以对齐数据结构，但分析表明其直接在非受控第三方服务器上收集学生的学号与密码，存在极高安全隐患。**FosuClass 正式方案中严禁使用或依赖任何第三方接口。**

### 2. 预留“校园代理 Agent”机制（实验功能）

针对公网服务器（如 Oracle VPS 等）无法访问 `100.fosu.edu.cn` 的限制，本项目预留了“校园代理 Agent”转发架构。

#### 代理部署硬件推荐
后续您可以在以下任意能够连通学校内网（如直接处于校园网环境，或保持 EasyConnect VPN 在线）的设备上部署专属代理 Agent：
- **宿舍闲置电脑 / 笔记本**
- **N100 软路由 / 小主机**
- **树莓派 / 玩客云 / 各种开发板**
- **校内闲置服务器**

#### 主服务配置
在公网运行的 FosuClass 主服务 `server/.env` 中配置以下环境变量即可激活：
```bash
# 是否开启代理转发 (true / false)
CAMPUS_AGENT_ENABLED=true
# 校园网内 Agent 代理服务的公网/局域网暴露地址
CAMPUS_AGENT_BASE_URL=http://your-agent-host:port
# 主服务与 Agent 之间的鉴权 Token
CAMPUS_AGENT_TOKEN=your_secure_agent_token_here
```

#### 个人课表导入说明

v0.5 起个人课表后端仅保留 `POST /api/fosu/personal/import-xls`。学号密码同步、滑块验证和登录抓取接口已下线；旧客户端访问 `/diagnose`、`/session/start`、`/session/verify-slider`、`/session/login-and-sync` 会收到 `410 XLS_ONLY`，提示改用 XLS 导入。

XLS 导入只解析课程名、教师、教室、星期、节次、教学周和学期元数据，不接收教务密码，也不会把原始 XLS/base64 交给外部 Provider。

---

## 本地运行后端 (server)

1. 进入后端目录并安装依赖：
   ```bash
   cd server
   npm install
   ```

2. 准备本地开发环境变量：
   ```bash
   cp .env.example .env
   ```
   编辑 `server/.env`：
   - 设定 `DATA_SOURCE_MODE=cache-first`
   - 设定 `ADMIN_API_TOKEN`（您自定义的同步鉴权 Token，如 `test-token-123`）
   - 设定 `ADMIN_PASSWORD` 或 `ADMIN_TOKEN`（用于访问 `http://localhost:3000/admin` 管理后台）

3. 运行本地开发服务：
   ```bash
   npm run dev
   ```
   服务将默认运行在 `http://localhost:3000`。
   
4. **运行本地同步器同步数据**：
   本地启动后端后，需运行同步器向本地后端注入初始数据。请参阅 [本地同步器 README](file:///c:/Users/Katelya/Documents/VScode/FosuClass/tools/fosu-sync-client/README.md) 引导登录并运行 `npm run sync:all` 进行同步。

### 全校课表 Staging 同步主命令

生产全量数据同步走“本机校园网采集 -> CLI 分片上传 -> 后台审核发布”链路：

```powershell
npm run sync:local-campus -- --term=2025-2026-2 --start=2026-03-09 --output=./staging/2025-2026-2-full.json --include=classSchedules,teacherSchedules,classroomSchedules,courseSchedules,classrooms,teachers,courses --class-scope=all --grades=2025,2024,2023,2022,2021 --concurrency=1 --delay-ms=900
npm run sync:local-upload -- --file=./staging/2025-2026-2-full.json --server=https://class.katelya.eu.org
```

`sync:local-upload` 会 gzip 并按分片上传大体积 JSON，只进入 VPS Staging 区，不会自动发布。管理员需要在 `/admin/sync` 检查 diff、质量提示和熔断提示后手动发布正式 release。接力同学使用 `npm run sync:relay-agent -- --server=https://class.katelya.eu.org --token=RELAY_TOKEN --term=2025-2026-2`，无需后台密码。

### 运行本地接口测试

可以使用预设脚本对本地运行的接口进行验证：

```bash
# 测试接口健康状态
npm run test-health

# 测试获取学院/年级目录选项 (Catalog)
npm run test-catalog

# 测试根据学院和年级联动获取专业列表
npm run test-major

# 测试获取行政班级课表
npm run test-class-schedule

# 测试获取教师课表
npm run test-teacher-schedule

# 测试公开 app-config 与后台公告 API（需后端已配置 ADMIN_TOKEN 或 ADMIN_API_TOKEN）
npm run test:app-config-admin
```

---

## 1Panel VPS 生产环境部署指南

通过 1Panel 的反向代理网站机制与 Docker 容器实现一键上线。

### 1. Cloudflare DNS 配置
登录您的 Cloudflare 后台，为您的域名 `katelya.eu.org` 添加一条 A 记录：
- **类型**：`A`
- **名称**：`class` (即 `class.katelya.eu.org`)
- **内容**：`146.235.201.244` (您的服务器公网 IP)
- **代理状态**：**仅限 DNS (DNS only)**。

### 2. 服务器安全组端口开放
请确保您的 VPS 安全组/防火墙已开放以下端口：
- `80` (HTTP) 和 `443` (HTTPS) — 供 1Panel 内置的 OpenResty 监听。
- `22` (SSH) — 供管理登录。
- **注意**：无需公网放行 `18318`，此端口已被限制在本地 `127.0.0.1` 环回接口；无需公网放行 `3000`，本服务不会占用宿主机的 3000 端口。

### 3. VPS 部署步骤 (通过 GitHub Actions 自动部署)

本项目推荐使用 GitHub Actions 进行自动部署，特别适用于私有仓库，因为 **VPS 侧不需要拥有访问 GitHub 私有仓库的权限，也不用在服务器上执行 `git clone/pull`**。

#### GitHub Actions 自动部署配置

1. 在 GitHub 仓库的 **Settings** -> **Secrets and variables** -> **Actions** 中添加以下 Repository Secrets：
    - `VPS_HOST`：您的 VPS 公网 IP (必须，例如 `146.235.201.244`)
    - `VPS_USER`：登录 VPS 的用户名 (必须，例如 `ubuntu`)
    - `VPS_SSH_KEY`：您的 SSH 私钥内容 (必须，用于免密登录 VPS)
    - `VPS_APP_DIR`：在 VPS 上的应用运行目录位置 (必须，例如 `/home/ubuntu/FosuClass`)
    - `ADMIN_PASSWORD`：Web 管理后台登录密码 (必须，用作后台主密码及派生密钥)
    - `ADMIN_API_TOKEN`：可选，数据同步鉴权密钥 Token。若留空，后台会自动依据 `ADMIN_PASSWORD` 进行 SHA-256 派生，用于强智同步脚本认证。
    - `ADMIN_TOKEN`：可选，后台管理静态 Token，若配置则额外支持使用该 Token 进行 API 登录或 Bearer 鉴权。

2. 部署机制说明：
   - **触发方式**：当您向 `main` 分支执行 `git push` 或者在 GitHub 仓库的 Actions 页面手动触发 `workflow_dispatch` 时，工作流将自动运行。
   - **运行流程**：
     1. GitHub Actions 在 Runner 上检出代码，并前置检查所有必须的 Secrets 是否存在。
     2. 将 `server/` 目录上传到 VPS 的 `${VPS_APP_DIR}/server` 目录下，且自动忽略 `node_modules`、`.env` 等多余或开发相关文件。
     3. 在 VPS 上自动生成 `server/.env` 配置文件（密码通过 GitHub Actions 变量直接安全写入，不打印在控制台日志中）。
     4. 执行 `docker compose up -d --build` (如果 `ubuntu` 账号缺少 Docker 权限，会自动 fallback 使用 `sudo docker compose`)。
     5. 容器启动后，会在本地执行健康检查 `curl -f http://127.0.0.1:18318/api/health` 验证无误后完成部署。

3. 服务器端本地验证：
   在 VPS 上，执行以下命令验证容器健康状态：
   ```bash
   curl http://127.0.0.1:18318/api/health
   ```
   如果返回以下 JSON，说明运行成功：
   ```json
   {
     "success": true,
     "message": "FosuClass API is running"
   }
   ```

### 4. 1Panel 配置反向代理与 SSL
1. 打开 1Panel 后台 -> 进入 **“网站”** -> **“反向代理”** 面板。
2. 点击 **“创建反向代理”**，代理域名填入 `class.katelya.eu.org`，代理地址填入 `http://127.0.0.1:18318`。
3. 成功创建后，为其申请并绑定 **HTTPS/SSL 证书**（可使用 1Panel 内建的 Let's Encrypt 证书自动申请）。
4. 在外网浏览器通过 `https://class.katelya.eu.org/api/health` 即可验证反代成功。

---

## 微信小程序配置

### 1. 本地调试
在微信开发者工具中，可以临时勾选：
- **开发设置** → 勾选“**不校验合法域名、web-view（业务域名）、TLS版本以及HTTPS证书**”

随后，可在 `miniprogram/config/api.js` 中把 `API_BASE_URL` 切换为 `http://localhost:3000`，即可直连本地后端进行调试。

### 2. 生产正式环境
在微信小程序管理后台配置合法请求域名：
- **开发管理** → **开发设置** → **服务器域名** → **request合法域名**，添加：
  `https://class.katelya.eu.org`

确保在发布正式版前，将 `miniprogram/config/api.js` 中的域名设为 `https://class.katelya.eu.org`。

---

## 安全规范与要求

1. **绝对禁止**将填有真实教务账号密码的 `server/.env` 提交到 GitHub 仓库（该文件已被 `.gitignore` 自动忽略）。
2. 后端日志对密码、Cookie、JSESSIONID 和 ticket 进行了拦截脱敏，严禁在开发中主动通过 `console.log` 打印上述敏感字段。
3. 小程序前端不保存任何服务级密码，也不做直连 100.fosu.edu.cn 的操作。
4. 后端接口内置了 API 限流与缓存机制，以保护佛大教务网免受高频请求压力。
