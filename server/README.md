# FosuClass 后端 API 服务 (1Panel 友好版)

FosuClass Node.js API 服务。将对强智教务系统的页面请求、解析与规范化处理上提至 VPS 后端，为微信小程序提供实时、安全的教务 API 服务。

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
   修改 `.env` 中的 `FOSU_SERVICE_USERNAME` 和 `FOSU_SERVICE_PASSWORD` 为您本人的教务服务账号密码（仅供本地开发和测试，请确保本文件不被提交）。

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

### 3. VPS 上启动 API 容器

在您的 VPS 上克隆代码并使用默认的 `docker-compose.yml` 运行（已配有针对 18318 端口的本地绑定和健康检查）：

```bash
# 1. 克隆代码
git clone https://github.com/katelya77/FosuClass.git
cd FosuClass/server

# 2. 准备生产环境变量
cp .env.example .env
nano .env  # 填写 FOSU_SERVICE_USERNAME、FOSU_SERVICE_PASSWORD 等

# 3. 启动容器
docker compose up -d --build
```

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
