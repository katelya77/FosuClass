# 佛课小表 FosuClass

面向佛山大学的课表微信小程序，内置「小佛助手」校园任务型 Agent；仓库同时包含一套可独立部署、可后台配置、可开源复用的 Agent 平台运行时。MIT License。

## 这是什么

- **课表小程序与校园助手**：原生微信小程序提供课表查看、今日提醒、空教室查询、教师课表与校园服务入口；小佛助手以工具优先架构回答校园任务，所有课程事实只来自确定性工具。
- **平台化 Agent 运行时**：服务端 Agent Kernel 已拆分为九个 `packages/*` 运行时包与一个 `plugins/fosu-campus` 校园插件，通过 `apps/agent-admin` 控制面完成 Provider、Skill、MCP、RAG、Memory、Run Trace 的草稿、校验、发布与回滚。通用内核不依赖佛大名称，可被其他项目复用。
- **Release Pack 是唯一事实源**：全校课表索引、个人课表摘要与教学周等事实只来自受控 Release Pack 与确定性工具；生成式模型不能成为课表事实源，public 正式版外部 Provider 调用恒为 0。

## 仓库布局

| 目录 | 说明 |
| --- | --- |
| `miniprogram/` | 微信小程序前端（原生，无框架） |
| `server/` | Express 后端：公开 API、管理后台、Agent Kernel、Run/RunEvent 协议 |
| `packages/` | 平台化运行时九个包：`agent-protocol`、`agent-runtime`、`agent-sdk`、`provider-runtime`、`skill-runtime`、`mcp-runtime`、`rag-runtime`、`tool-runtime`、`ui-schema` |
| `plugins/fosu-campus/` | 佛大校园插件：校园工具、Release Pack 接入与卡片 schema |
| `apps/agent-server/` | 平台服务装配入口（standalone 拓扑使用） |
| `apps/agent-admin/` | Agent 控制面静态页，生产经 `/admin/agent-platform/` 挂载 |
| `cloudfunctions/` | CloudBase 云函数（国内数据面） |
| `shared/` | 小程序与后端共享的学期、周次与同步逻辑 |
| `tools/` | 本地同步器、发布器、验证脚本与开发工具 |
| `deploy/` | 部署配置：`openresty/` 反代、`standalone/` 平台 compose |
| `staging/` | 待审核的全量数据暂存区 |
| `docs/` | 文档：`adr/` 架构决策、`deployment/` 部署手册、`xiaofu-agent/` 助手专档 |
| `specs/` | 产品规格、任务拆解与执行治理记录 |

## 快速开始

### A. 本地后端

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

编辑 `server/.env`：设定 `DATA_SOURCE_MODE=cache-first`、`ADMIN_API_TOKEN`（同步鉴权）、`ADMIN_PASSWORD` 或 `ADMIN_TOKEN`（后台登录）。服务默认运行在 `http://localhost:3000`，管理后台在 `http://localhost:3000/admin`。

首次启动后需注入初始课表数据：按 [本地同步器 README](tools/fosu-sync-client/README.md) 登录校园网并运行 `npm run sync:all`。

### B. 小程序调试

微信开发者工具中勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」，再把 `miniprogram/config/api.js` 的 `API_BASE_URL` 切到 `http://localhost:3000`。

### C. 一体化容器（生产同款）

生产默认形态：单个容器同时运行 API、Agent Runtime 与 Admin 控制面。本地复现：

```bash
cd server
docker compose up -d --build
curl http://127.0.0.1:3000/api/health
```

### D. Standalone 平台拓扑（可选）

多进程拓扑：`agent-server + agent-worker + postgres/pgvector + redis`，配置见 `deploy/standalone/docker-compose.yml` 与 `deploy/standalone/.env.example`，按 [开发者快速上手](docs/deployment/developer-quickstart.md) 操作。**该拓扑当前为可选交付，生产环境仍使用一体化容器。**

## 小佛助手与 Agent 平台

### 三种运行策略

- **public（正式版）**：纯确定性链路，外部 Provider 调用恒为 0；本地规则 + 已发布知识库 + 工具卡片。
- **trial/dev strict_model_first（默认）**：每个通过安全守卫的用户 Turn 先由真实 Provider 输出严格 DecisionContract（GoalContract V2 + 实体/约束 + Skill 候选 + 计划骨架），服务端再经能力清单五因子交集解析并校验工具；Provider 失败时保留确定性结果。
- **adaptive**：允许高置信简单任务走快路径。策略可在控制面切换，并展示每次请求的真实路径；规则命中不会冒充模型理解。

### Agent 控制面

后台侧边栏「系统与安全 → Agent 控制面」，地址 `/admin/agent-platform/`。六个域均走 `draft → validate → test → publish → hot reload` 发布流水线，支持回滚：

- **Provider**：主模型、fallback、阶段模型、真实 probe、延迟/错误/熔断；
- **Skill**：草稿、Schema、允许工具、测试、发布、回滚；
- **MCP**：Streamable HTTP / 受控 stdio、鉴权、工具发现、超时、写确认；
- **RAG**：摄取、分块、BM25 + 向量、rerank、引用、版本与发布/回滚；
- **Memory**：策略、容量、TTL、检索与用户数据管理；
- **Run Trace / Eval**：Goal、计划、工具、验证、耗时与 fallback，不展示密钥或隐藏推理。

### Run 协议与小程序 SDK

在线语义请求的唯一决策核心是服务端 Agent Kernel。客户端通过 `POST /api/ai/agent/runs` 创建 Run，再以 cursor 订阅 RunEvent；Loading / Thinking 状态只来自服务端真实事件，客户端不猜测。`packages/agent-sdk` 为小程序提供可恢复 Run 协议与版本协商，UI 只消费通用 UI Schema（text、markdown、plan、tool_progress、list/detail/schedule、clarification、confirmation、error）；`agent.v1` 保持向后兼容，新增字段进入 `agent.v2`。

### 插件开发

外部开发者可按 [开发者快速上手](docs/deployment/developer-quickstart.md) 创建 Provider、Skill、Tool、MCP 与知识库插件。配置发布只接受经过校验的声明式插件，禁止直接加载任意未审计 JS。

### Engine Adapter

`AgentEngineAdapter` 是 Engine 的单一权威契约（ADR 0008）。当前 Fosu Runtime 经 Engine Registry 通过该契约成为唯一默认 Engine 并通过完整 conformance suite；OpenAI Agents SDK 与 Pi Agent Core 两个实验 Adapter **尚未实现（deferred）**，只保留契约映射与研究记录，见 [Engine Adapter 研究](docs/xiaofu-agent/engine-adapter-research.md)。

## 数据面：Release Pack 与去中心化同步

佛山大学强智教务网 `100.fosu.edu.cn` 仅限校园网内网（VPN）访问，海外 VPS 不应安装 EasyConnect（账号风控与合规风险）。因此本项目采用「多维护者本地同步 + 用户贡献课表 + 管理员审核 + 后端缓存」的去中心化架构：

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

- **本地同步器**：由管理员或志愿维护者在连接 EasyConnect 后运行；诊断脚本在 DNS 解析出校内 IP 后，即使 Node TLS 握手失败，也能借助 Playwright 浏览器完成登录与同步。
- **用户自发贡献**：学生可通过「设置 → 贡献班级课表」粘贴本地导出的课表数据；贡献默认进入待审核状态，管理员核对通过后合并发布，避免对单一维护者学号的长期依赖。
- **第三方 HAR 警示**：分析表明某些第三方小程序直接在非受控服务器上收集学生学号与密码，存在极高安全隐患。FosuClass 严禁使用或依赖任何第三方接口。

### 全校课表 Staging 同步主命令

生产全量同步走「本机校园网采集 → CLI 分片上传 → 后台审核发布」链路：

```powershell
npm run sync:local-campus -- --term=2025-2026-2 --start=2026-03-09 --output=./staging/2025-2026-2-full.json --include=classSchedules,teacherSchedules,classroomSchedules,courseSchedules,classrooms,teachers,courses --class-scope=all --grades=2025,2024,2023,2022,2021 --concurrency=1 --delay-ms=900
npm run sync:local-upload -- --file=./staging/2025-2026-2-full.json --server=https://class.katelya.eu.org
```

`sync:local-upload` 会 gzip 并分片上传大体积 JSON，只进入 VPS Staging 区，不会自动发布；管理员在 `/admin/sync` 检查 diff、质量提示和熔断提示后手动发布正式 release。接力同学使用 `npm run sync:relay-agent -- --server=https://class.katelya.eu.org --token=RELAY_TOKEN --term=2025-2026-2`，无需后台密码。

### 校园代理 Agent（实验功能）

公网服务器无法直连教务网时，可在任何能连通校园网的设备（宿舍电脑、N100 小主机、树莓派、校内服务器）上部署代理 Agent，主服务 `server/.env` 配置：

```bash
CAMPUS_AGENT_ENABLED=true
CAMPUS_AGENT_BASE_URL=http://your-agent-host:port
CAMPUS_AGENT_TOKEN=your_secure_agent_token_here
```

### 个人课表导入

个人课表同步 V1 的主路径是客户端直连：手机已连接校园网或校园 VPN 时，学号和密码只留在个人课表同步页，小程序直接读取 100 网课表，class 后端只解析非凭据的课表响应。旧的 `/diagnose`、`/session/start`、`/session/verify-slider`、`/session/login-and-sync` 仍返回 `410 XLS_ONLY`。XLS 导入始终保留，只解析课程名、教师、教室、星期、节次、教学周和学期元数据，不接收教务密码，也不把原始 XLS/base64 交给外部 Provider。

## 可靠性与缓存策略

- 小程序优先读取静态 Release Pack、runtime pointer 和 last-known-good 缓存；网络超时、403、504 或 Cloudflare 异常会进入 runtime circuit breaker，先保留可用课表和教师目录；网络或新数据加载失败时永远保留上一份可用数据。
- 公共 API 的 `/app-config`、`/runtime/active`、`/sync/status`、`/sync/releases` 只走 manifest、summary 等小 JSON fast-path；CLI 分片上传的 finalize 接口只返回 `202 Accepted` 与后台 job，解析与安全检查全部在 Release Worker 中执行。
- 全校页搜索采用 cache-first、同 `releaseVersion` 快速路径与分页渲染，避免索引命中较多时卡住视图层；个人 XLS 课表绑定后写入 `FOSU_PERSONAL_SCHEDULE_CACHE`，页面内优先走内存快速路径。
- staging 发布保留 active/staging/legacy 安全边界，教师目录缺失时显式标记 `not-counted`，不会把教师课表数量冒充教师目录数量。
- Release Pack 的版本校验、静态源回退、缓存和 last-known-good 是硬约束，任何改动不得破坏。

## 运行模式与合规

小佛助手支持三种 Provider 模式：

- **mock 演示模式**：`AI_AGENT_ENABLED=false` 或 `AI_PROVIDER=mock`，不调用外部 Provider，适合断网、无 key 或安全演示；可演示空教室、今日课表、教师课表、导入指引、加载失败排查等核心场景。
- **国产 Provider 脱敏调用模式**：`AI_PROVIDER=deepseek` 或 `AI_PROVIDER=coze`，只使用脱敏后的消息、工具结果和最小上下文；DeepSeek 默认 `deepseek-v4-flash`，复杂说明书或离线分析可切换 `deepseek-v4-pro`。
- **境内部署生产模式**：迁移到境内云、校内服务器或微信云托管并完成备案；是否满足「数据不出境」以服务器 region、Provider region 和实际数据链路为准。

脱敏纪律：学号、密码、Cookie、JSESSIONID、ticket、Authorization、token、文件 base64 和完整原始文件内容永远不交给外部 Provider；个人课表摘要默认关闭，用户开启后也只传课程名、教师、教室、星期、节次、教学周等最小字段；日志只记录脱敏摘要、工具名和状态。公开正式版保持 `AI_TOOL_ONLY_MODE=true` 时，校园工具仍可正常使用。

## Provider 配置

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

密钥管理要求：不提交 key，不在日志打印 key，只通过环境变量或未跟踪的 `server/.env` 注入；发现泄露立即轮换。更多说明见 [Provider 配置](docs/model-provider-config.md)。

## 部署

### 生产：一体化容器 + GitHub Actions（当前形态）

生产为单 VPS 上的一体化容器（`fosuclass-api`），经 1Panel OpenResty 反代对外提供 `https://class.katelya.eu.org`。推荐用 GitHub Actions 自动部署——VPS 侧不需要访问 GitHub 私有仓库，也不用在服务器上执行 `git clone/pull`。

在仓库 **Settings → Secrets and variables → Actions** 配置：

- `VPS_HOST`：VPS 公网 IP（必须）
- `VPS_USER`：登录用户名（必须，例如 `ubuntu`）
- `VPS_SSH_KEY`：SSH 私钥内容（必须）
- `VPS_APP_DIR`：应用运行目录（必须，例如 `/home/ubuntu/FosuClass`）
- `ADMIN_PASSWORD`：后台登录主密码（必须，兼作派生密钥）
- `ADMIN_API_TOKEN`：可选，数据同步鉴权 Token；留空时由 `ADMIN_PASSWORD` SHA-256 派生
- `ADMIN_TOKEN`：可选，后台静态 Token，配置后额外支持 API 登录或 Bearer 鉴权

向 `main` 分支 push 或在 Actions 页手动触发即开始部署：Runner 检出代码、前置检查 Secrets、上传 `server/`（忽略 `node_modules` 与 `.env`）、在 VPS 生成 `server/.env`、执行 `docker compose up -d --build`，最后以 `curl -f http://127.0.0.1:18318/api/health` 完成健康检查。服务器侧验证：

```bash
curl http://127.0.0.1:18318/api/health
# {"success": true, "message": "FosuClass API is running"}
```

1Panel 侧只需一条反向代理：域名 `class.katelya.eu.org` → `http://127.0.0.1:18318`，并绑定 SSL 证书。容器端口已限制在 `127.0.0.1` 环回，安全组只需放行 80/443/22。

### Standalone 平台部署（可选）

多架构平台镜像（amd64 + arm64）发布在 GHCR：`ghcr.io/katelya77/fosu-agent-platform`。1Panel 与 Oracle ARM 的完整部署手册见 [docs/deployment/1panel.md](docs/deployment/1panel.md) 与 [docs/deployment/oracle-arm.md](docs/deployment/oracle-arm.md)，覆盖健康检查、迁移、持久卷、备份、升级与回滚。

### CloudBase 国内数据面

预留 CloudBase 环境 `cloud1-d3g17rpe7566d3d5c`，承载已验证的公开静态 JSON（不承载原始 XLS、staging 大 JSON 或管理员文件）。Release Pack 读取顺序为本地缓存、last-known-good、CloudBase Hosting、Oracle 静态目录、Oracle 兼容 API。小程序端经 `miniprogram/config/cloudbase.js` 集中管理 Hosting 与发布开关；代码不猜测域名，也不提交任何 SecretId、SecretKey、Token 或 API Key。常用命令：

```bash
npm install -g @cloudbase/cli
tcb login
npm run cloudbase:hosting:detail
npm run cloudbase:release:dry-run -- --release-version <releaseVersion>
npm run cloudbase:release:verify -- --release-version <releaseVersion> --hosting-base-url https://your-cloudbase-hosting-domain
```

发布手册见 [CloudBase Release Pack 发布手册](docs/cloudbase-release-deploy.md) 与 [CloudBase 混合架构](docs/cloudbase-hybrid-architecture.md)。

### 微信小程序合法域名

生产正式环境在小程序管理后台「开发管理 → 开发设置 → 服务器域名 → request 合法域名」添加 `https://class.katelya.eu.org`，并确保发布前 `miniprogram/config/api.js` 指向同一域名。

## 测试与质量门禁

改动 Agent、协议、运行模式、Provider、工具、Skill、知识库控制边界或小程序助手路由时，至少运行：

```bash
npm run test:agent-foundation
npm run test:agent-regression
npm run test:ai-competition
npm run test:agent-final-convergence
```

涉及会话记忆、知识库控制面或 MCP 时加跑 `npm run test:agent-phase2`；涉及 Run Events、Readiness、记忆前端闭环时加跑 `npm run test:agent-phase3`。交付前必须完整通过：

```bash
npm run test:agent-release-gate
npm run test:no-ai-secret-committed
```

本地接口冒烟脚本：

```bash
npm run test-health            # 接口健康
npm run test-catalog           # 学院/年级目录
npm run test-major             # 专业列表联动
npm run test-class-schedule    # 行政班级课表
npm run test-teacher-schedule  # 教师课表
npm run test:app-config-admin  # 公开 app-config 与后台公告
```

完整门禁说明见 [AGENTS.md](AGENTS.md)，验收口径与证据模板见 [最终交付报告](docs/xiaofu-agent/product-platform-final-report.md) 与 [P8 人工验收清单](docs/xiaofu-agent/product-platform-p8-manual-acceptance.md)。

## 文档索引

**平台与架构**

- [CONTEXT.md](CONTEXT.md)：项目单一上下文，模块边界与事实源约定
- [产品化平台审计](docs/xiaofu-agent/product-platform-audit.md) 与 [最终交付报告](docs/xiaofu-agent/product-platform-final-report.md)
- [ADR 0001–0008](docs/adr/)：原生小程序、管理后台 SPA、模块化 Express 单体、Release Pack 数据面、作用域 Token、Memory-to-Provider 边界、本地 Encoder 向量基线、Engine Adapter 契约

**部署与运维**

- [开发者快速上手](docs/deployment/developer-quickstart.md)（插件开发从这里开始）
- [1Panel 部署手册](docs/deployment/1panel.md) 与 [Oracle ARM 部署手册](docs/deployment/oracle-arm.md)
- [Oracle ARM / Docker Provider 部署说明](docs/oracle-arm-deploy-ai.md)
- [本地同步器 README](tools/fosu-sync-client/README.md)

**小佛助手**

- [助手文档总览](docs/xiaofu-agent/README.md)
- [统一模型优先架构](docs/xiaofu-agent/unified-model-first-architecture.md)
- [会话记忆](docs/xiaofu-agent/conversation-memory.md) 与 [Run Events](docs/xiaofu-agent/agent-run-events.md)
- [Engine Adapter 研究](docs/xiaofu-agent/engine-adapter-research.md)

**参赛与合规**

- [校园查询参赛设计](docs/competition-2026-agent-design.md)
- [校园查询合规说明](docs/ai-agent-compliance.md)
- [5 分钟演示脚本](docs/demo-script-5min.md)
- [Provider 配置](docs/model-provider-config.md)

## 安全规范与要求

1. **绝对禁止**将填有真实教务账号密码的 `server/.env` 提交到仓库（该文件已被 `.gitignore` 忽略）。
2. 后端日志对密码、Cookie、JSESSIONID 和 ticket 做了拦截脱敏；开发中严禁主动打印上述敏感字段。
3. 小程序前端不保存任何服务级密码，也不直连 `100.fosu.edu.cn`。
4. 后端接口内置 API 限流与缓存机制，以保护佛大教务网免受高频请求压力。
5. 密钥、Token、登录票据不得进入代码、文档、测试快照、PR 描述或聊天输出；发现泄露立即轮换。

## License

[MIT](LICENSE)
