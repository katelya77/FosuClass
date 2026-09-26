# 管理后台、公告配置与个性化课程验收清单

## 新增后台页面

- `/admin`：根据登录状态跳转到 `/admin/login` 或 `/admin/dashboard`。
- `/admin/login`：输入 `ADMIN_PASSWORD` 或 `ADMIN_TOKEN` 登录，登录态写入 httpOnly Cookie。
- `/admin/dashboard`：管理数据概览、每日知识、数据版本和反馈。公告管理与最新动态已从后台导航移除；`GET /api/fosu/app-config` 仍返回 `notices` 与 `news` 数组，兼容审核中的小程序。

## 新增 API

- `GET /api/fosu/app-config`：小程序公开运行时配置，不需要后台 token。
- `POST /api/admin/login`、`POST /api/admin/logout`、`GET /api/admin/session`
- `GET/POST /api/admin/config`
- `GET/POST/PUT/DELETE /api/admin/notices`
- `GET/POST/PUT/DELETE /api/admin/news`
- `GET /api/admin/feedbacks`、`PUT /api/admin/feedbacks/:id`

## 环境变量与密钥配置

为了保证安全和部署便捷性，系统环境变量配置说明如下：

- `ADMIN_PASSWORD`：必须。Web 后台登录密码。如果未配置，生产环境将关闭后台登录功能。
- `ADMIN_API_TOKEN`：可选。数据同步鉴权使用。若未配置此项，后台将基于 `ADMIN_PASSWORD` 自动进行安全派生，保证强智同步功能不中断。
- `ADMIN_TOKEN`：可选。管理端静态 Token，配置后可作为管理 API 的 Bearer 鉴权凭证或登录密码。

### GitHub Actions 密钥配置建议
请到 GitHub Settings → Secrets and variables → Actions 中配置：
1. `VPS_HOST`、`VPS_USER`、`VPS_SSH_KEY`、`VPS_APP_DIR` (用于远程服务器自动化部署)
2. `ADMIN_PASSWORD` (后台登录密码，必配置项)
3. `ADMIN_API_TOKEN` (可选，不配置则自动从 `ADMIN_PASSWORD` 派生，用于本地同步脚本认证)
4. `ADMIN_TOKEN` (可选)

## 小程序验收

1. 启动小程序后异步请求 `/api/fosu/app-config`，网络失败时读取本地缓存。
2. 首页展示 `home/all` 公告，ticker 公告整条可点击查看详情，不再额外展示“查看”按钮；modal 公告启动后弹出一次。
3. 今日页显示 urgent 公告或数据更新提示。
4. 全校页顶部只保留轻量数据更新时间和公告入口，免责声明放到底部。
5. 设置页首屏把当前课表、XLS 导入入口、当前学期、开学日期和总教学周合并到「课表与学期」概览中；「数据与公告」可查看数据版本、最新动态、公告历史和反馈入口。
6. 首页「编辑」或设置页「个性化课程」进入自定义课程页。
7. 添加、编辑、删除、隐藏自定义课程后，首页周课表和今日课程同步变化。
8. 课程详情页「复制为自定义课程」能带入课程名、教师、教室、周次和节次。

## 手动测试步骤

1. 本地启动后端：
   ```bash
   cd server
   $env:ADMIN_PASSWORD="dev-password"
   $env:ADMIN_TOKEN="dev-admin-token"
   $env:ADMIN_API_TOKEN="dev-sync-token"
   npm run dev
   ```
2. 打开 `http://localhost:3000/admin`，使用 `dev-password` 登录。
3. 创建一条 `targetPage=home`、`displayMode=banner`、`enabled=true` 的公告。
4. 访问 `http://localhost:3000/api/fosu/app-config`，确认只返回启用且在有效期内的公告。
5. 运行：
   ```bash
   $env:ADMIN_TOKEN="dev-admin-token"
   npm run test:app-config-admin
   ```
6. 微信开发者工具中把 `miniprogram/config/api.js` 切到本地地址，勾选「不校验合法域名」后编译。
7. 在首页、今日、全校、设置页逐一验证公告和数据更新时间展示；点击公告条应直接打开详情弹窗。
8. 进入「个性化课程」，新增一门当前周课程，返回首页和今日页确认显示；隐藏后确认不再显示；删除后确认消失。
