# 佛大课表 FosuClass

面向佛山大学的原生微信小程序课表模板。

## 当前架构推荐

为了提高教务网数据获取的稳定性和安全性，目前项目已从微信云开发架构整体迁移为以下自建 VPS 后端 API 方案：

**微信小程序前端** → `wx.request` (HTTPS) → **自建 VPS 后端 API (Node.js)** → **佛山大学教务系统**

新架构为 **1Panel 友好部署设计**，将 API 服务端口绑定限制在宿主机 `127.0.0.1:18318`，从而与服务器上已运行的 Nginx/OpenResty (1Panel) 以及 DecoTV (占用 3000 端口) 完美兼容，保障了 VPS 服务的稳定运行和接口安全。

> [!NOTE]
> 原微信云开发云函数方案（`cloudfunctions` 目录）已保留作为备用/可选的历史方案。如果需要使用云开发，请参阅 `cloudfunctions` 内的逻辑。

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
   编辑 `server/.env`，在 `FOSU_SERVICE_USERNAME` 和 `FOSU_SERVICE_PASSWORD` 处填入您的佛大教务网服务账号和密码（本地调试需要真实账号，此文件已在 Git 中忽略）。

3. 运行本地开发服务：
   ```bash
   npm run dev
   ```
   服务将默认运行在 `http://localhost:3000`。

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

### 3. VPS 部署步骤
在您的 VPS 服务器上克隆并运行服务：
```bash
# 1. 克隆代码
git clone https://github.com/katelya77/FosuClass.git
cd FosuClass/server

# 2. 拷贝并配置生产环境变量
cp .env.example .env
nano .env  # 填写 FOSU_SERVICE_USERNAME 和 FOSU_SERVICE_PASSWORD

# 3. 编译并启动容器
docker compose up -d --build
```
启动后，可在 VPS 本地终端使用 `curl http://127.0.0.1:18318/api/health` 验证服务可用性。

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
