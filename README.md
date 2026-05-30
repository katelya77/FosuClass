# 佛课小表

用于课程表查看与今日上课提醒的原生微信小程序。

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

3. 运行本地开发服务：
   ```bash
   npm run dev
   ```
   服务将默认运行在 `http://localhost:3000`。
   
4. **运行本地同步器同步数据**：
   本地启动后端后，需运行同步器向本地后端注入初始数据。请参阅 [本地同步器 README](file:///c:/Users/Katelya/Documents/VScode/FosuClass/tools/fosu-sync-client/README.md) 引导登录并运行 `npm run sync:all` 进行同步。

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
    - `VPS_HOST`：您的 VPS 公网 IP (例如 `146.235.201.244`)
    - `VPS_USER`：登录 VPS 的用户名 (例如 `ubuntu`)
    - `VPS_SSH_KEY`：您的 SSH 私钥内容 (用于免密登录 VPS)
    - `VPS_APP_DIR`：在 VPS 上的应用运行目录位置 (例如 `/home/ubuntu/FosuClass`)
    - `ADMIN_API_TOKEN`：数据同步鉴权密钥 Token（本地同步器和 VPS 后端之间校验用的 Token）

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
