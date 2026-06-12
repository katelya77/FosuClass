# FosuClass 后端 API 服务 (1Panel 友好版)

FosuClass Node.js API 服务。将对强智教务系统的页面请求、解析与规范化处理上提至 VPS 后端，为微信小程序提供实时、安全的教务 API 服务。

## 快路径与发布缓存

- 生产运行时保留 `runtime alias`、静态 URL 和 last-known-good 快照，前端优先读取 `/static/runtime/active.json` 与 Release Pack 静态文件。
- 公共 API 读取 manifest、summary、catalog、upload-record-index 等小 JSON，不在请求路径执行 `getReleasePackStatus()`、snapshot parse 或深层 detail 扫描。
- `getActiveReleaseInfoFast()` 返回压缩版 manifest、summary 和旧兼容字段，不返回完整 Release Pack 文件哈希清单。
- 带 `releaseVersion` 的 `/api/fosu/search-index` 视为不可变版本数据，返回一周公共缓存；小程序命中同版本缓存后走快速路径，不再重复请求同一索引。
- AI 工具读取课表详情时会为课程补充 `sectionText` 和 `timeText`，Provider 卡片优先展示具体时间段，节次作为辅助信息保留。
- deep health、staging finalize、Release Pack 重建等 CPU 密集任务由 worker 执行；主线程只负责小 JSON fetch、轻量状态聚合和响应。
- CLI 分片上传 finalize 路由只返回 `202 Accepted` 和 job 信息，worker 负责 JSON parse、canonical hash 和 safety summary。
- `server/storage/upload-record-index.json` 是上传记录统一索引，支持分页、`term` 过滤和 `status` 过滤，管理页列表不再逐个 hydrate manifest。

## 技术栈

- 核心框架：Node.js 18 + Express
- HTTP 客户端：Axios 1.6 + tough-cookie + axios-cookiejar-support (会话持久)
- HTML 解析：Cheerio (DOM 提取) + iconv-lite (GBK/GB2312 解码)
- 安全与监控：Helmet + CORS + express-rate-limit (接口防刷) + node-cache (内存缓存)

## 本地运行

1. 安装依赖：
   ```bash
   cd server
   npm install
   ```

2. 准备环境变量：
   ```bash
   cp .env.example .env
   ```
   修改 `.env` 中的参数：
   - 设定 `DATA_SOURCE_MODE=cache-first`（支持 cache-first、realtime、disabled）
   - 设定 `ADMIN_API_TOKEN`（数据同步 Token，供本地同步器推送数据时校验）
   - 设定 `ADMIN_PASSWORD` 或 `ADMIN_TOKEN`（Web 管理后台 `/admin` 登录使用）


3. 运行开发服务器：
   ```bash
   npm run dev
   ```
   服务将默认运行在 `http://localhost:3000`。

### 运行本地接口测试

可以使用预设脚本对本地运行的接口进行验证：

```bash
# 测试接口健康状态
npm run test-health

# 测试获取学院年级全校列表
npm run test-catalog

# 测试获取专业联动列表
npm run test-major

# 测试行政班级课表
npm run test-class-schedule

# 测试教师课表
npm run test-teacher-schedule
```

---

## 1Panel VPS 生产环境部署指南

如果您的 VPS 运行了 1Panel 面板来管理 Docker 和网站，或者宿主机的 3000 端口已被其他容器（如 DecoTV）占用，请遵循以下 1Panel 友好版部署流程。

### 1. Cloudflare DNS 配置

登录您的 Cloudflare 后台，为您托管的域名 `katelya.eu.org` 添加 DNS 记录：
- **类型**：`A` 记录
- **名称**：`class` (完整域名：`class.katelya.eu.org`)
- **内容**：`146.235.201.244` (您的 VPS 公网 IP)
- **代理状态**：**仅限 DNS (DNS only)**。
  *建议：先选择“仅限 DNS”，待 1Panel SSL 证书校验和代理正常后，再决定是否开启 Cloudflare 代理。如果开启 Cloudflare 代理，请确保 Cloudflare 的 SSL/TLS 模式设为 **Full** 或 **Full (strict)**。*

### 2. 服务器安全端口开放
请确保您的 VPS 或云安全组防火墙已放行：
- `80` (HTTP) 和 `443` (HTTPS) — 供 1Panel / OpenResty 接管。
- `22` (SSH) — 供远程部署。
- **无需放行** `18318` 端口：因为该端口在宿主机上只绑定在 `127.0.0.1` 环回地址，不对公网暴露，极大提高了安全性。
- **无需放行** `3000` 端口：该端口可以留给服务器上已运行的其他容器（如 DecoTV），不会与本服务冲突。

### 3. VPS 部署步骤 (通过 GitHub Actions 自动部署)

本项目推荐使用 GitHub Actions 进行自动部署，特别适用于私有仓库，因为 **VPS 侧不需要拥有访问 GitHub 私有仓库的权限，也不用在服务器上执行 `git clone/pull`**。

#### GitHub Actions 自动部署配置

1. 在 GitHub 仓库的 **Settings** -> **Secrets and variables** -> **Actions** 中添加以下 Repository Secrets：
    - `VPS_HOST`：您的 VPS 公网 IP (例如 `146.235.201.244`)
    - `VPS_USER`：登录 VPS 的用户名 (例如 `ubuntu`)
    - `VPS_SSH_KEY`：您的 SSH 私钥内容 (用于免密登录 VPS)
    - `VPS_APP_DIR`：在 VPS 上的应用运行目录位置 (例如 `/home/ubuntu/FosuClass`)
    - `ADMIN_API_TOKEN`：数据同步鉴权密钥 Token（本地同步器和 VPS 后端之间校验用的 Token）
    - `ADMIN_PASSWORD`：Web 管理后台登录密码
    - `ADMIN_TOKEN`：可选，后台 API Bearer Token；未配置时只使用 `ADMIN_PASSWORD` 登录

2. 部署机制说明：
   - **触发方式**：当您向 `main` 分支执行 `git push` 或者在 GitHub 仓库的 Actions 页面手动触发 `workflow_dispatch` 时，工作流将自动运行。
   - **运行流程**：
     1. GitHub Actions 在 Runner 上检出代码，并前置检查所有必须的 Secrets 是否存在。
     2. 将 `server/` 目录上传到 VPS 的 `${VPS_APP_DIR}/server` 目录下，且自动忽略 `node_modules`、`.env` 等多余或开发相关文件。
     3. 在 VPS 上自动生成 `server/.env` 配置文件（密码通过 GitHub Actions 变量直接安全写入，不打印在控制台日志中）。
     4. 执行 `docker compose up -d --build` (如果 `ubuntu` 账号缺少 Docker 权限，会自动 fallback 使用 `sudo docker compose`)。
     5. 容器启动后，会在本地执行健康检查 `curl -f http://127.0.0.1:18318/api/health` 验证无误后完成部署。

### 4. 本机验证 API 容器
容器成功启动后，在 VPS 终端执行：
```bash
curl http://127.0.0.1:18318/api/health
```
若返回类似以下 JSON 则代表容器工作正常：
```json
{
  "success": true,
  "message": "FosuClass API is running"
}
```

### 5. 1Panel 反向代理与 SSL 配置
打开您的 1Panel 后台：
1. 点击 **“网站”** -> **“反向代理”**。
2. 点击 **“创建反向代理”**：
   - **主域名**：`class.katelya.eu.org`
   - **代理地址**：`http://127.0.0.1:18318`
3. 配置 **HTTPS 证书**：
   - 使用 1Panel 内置的 Let's Encrypt 或者是 Cloudflare DNS 申领并绑定 HTTPS 证书。
4. 保存并启用。

外网验证：在浏览器访问 `https://class.katelya.eu.org/api/health`，若能正常访问且显示 HTTPS 安全锁，即反代成功。

---

## 可选方案（非 1Panel 环境）

如果您在非 1Panel 环境部署（无 Nginx 占用 80/443），可以直接使用内置的 Caddy 服务来自动反代和申请 SSL 证书：

```bash
# 使用可选的 docker-compose.caddy.yml 启动
docker compose -f docker-compose.caddy.yml up -d --build
```
> [!WARNING]
> 如果您使用的是 1Panel 面板，**千万不要**使用这个可选命令，否则会强占 80 和 443 端口导致 1Panel/OpenResty 面板瘫痪。
