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
> **注意**：部分本地网络环境由于 Node.js/OpenSSL 握手兼容问题，可能会报错 `NODE_TLS_HANDSHAKE_FAILED`，这不代表 EasyConnect 没有连上。**只要 DNS 能成功解析出以 `172.16` 等开头的内网 IP，脚本就会判定诊断通过**，允许继续登录。

### 2. 浏览器级深度诊断 (推荐)
如果您对网络连接存疑，可以运行浏览器级诊断命令：
```bash
npm run diagnose:browser
```
> 该命令将启动 Playwright 界面浏览器访问 `http://100.fosu.edu.cn`，如果跳转正常则说明校内网链路通畅；若报错，会在 `.debug/` 目录下生成 `diagnose-browser.png` 调试截图。

### 3. 登录教务系统 (仅 playwright-manual 模式需要)
打开一个可见的浏览器，引导您手动进行账号登录：
```bash
npm run login
```
> **说明**：程序将自动为您跳转至教务网。请手动输入您的学号、密码，并完成验证码或滑块验证。成功登录进入系统主页后，浏览器将自动关闭，并将会话信息安全保存至本地 `.session/session.json` 中（已在 `.gitignore` 中默认过滤，严禁提交到 Git）。

### 3. 开始同步数据

#### 选项 A：一键全部同步 (推荐)
一键执行网络诊断、登录会话检验、抓取 Catalog、联动抓取专业和抓取并上传全部班级课表：
```bash
npm run sync:all
```

#### 选项 B：分步同步
若有需要，也可以分步执行：
- **同步基础目录** (学期、学院、年级、周次)：
  ```bash
  npm run sync:catalog
  ```
- **联动同步所有专业选项**：
  ```bash
  npm run sync:majors
  ```
- **抓取并同步全校班级课表** (依赖上述两步生成的本地临时文件)：
  ```bash
  npm run sync:class
  ```

---

## 验证与监控

1. **验证 VPS 接收状态**：
   访问 `https://class.katelya.eu.org/api/admin/sync/status`，若返回结果中 `success` 为 `true`，且 `catalogUpdatedAt`、`collegesCount`、`majorsCount`、`classScheduleCount` 显示了您的同步时间及正确条目数，说明 VPS 已成功接收并写入静态缓存。

2. **验证微信小程序展示**：
   打开小程序中的“查找佛大课表”页面，切换到“班级” Tab，如能正确拉出刚刚同步的学院和年级，并在底端看到类似 “数据更新于：xxxx-xx-xx xx:xx” 的提示，即代表同步链路大功告成！
