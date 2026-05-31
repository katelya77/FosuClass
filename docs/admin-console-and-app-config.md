# Admin Console、公告配置与个性化课程验收清单

## 新增后台页面

- `/admin`：根据登录状态跳转到 `/admin/login` 或 `/admin/dashboard`。
- `/admin/login`：输入 `ADMIN_PASSWORD` 或 `ADMIN_TOKEN` 登录，登录态写入 httpOnly Cookie。
- `/admin/dashboard`：管理数据概览、公告、最新动态、数据版本和反馈。

## 新增 API

- `GET /api/fosu/app-config`：小程序公开运行时配置，不需要后台 token。
- `POST /api/admin/login`、`POST /api/admin/logout`、`GET /api/admin/session`
- `GET/POST /api/admin/config`
- `GET/POST/PUT/DELETE /api/admin/notices`
- `GET/POST/PUT/DELETE /api/admin/news`
- `GET /api/admin/feedbacks`、`PUT /api/admin/feedbacks/:id`

## 环境变量

- `ADMIN_API_TOKEN`：同步器上传和 release/sync 管理接口使用。
- `ADMIN_PASSWORD`：Web 后台登录密码。
- `ADMIN_TOKEN`：可选，后台 API Bearer Token。

生产环境未配置 `ADMIN_PASSWORD` 或 `ADMIN_TOKEN` 时，后台登录会被关闭。

## 小程序验收

1. 启动小程序后异步请求 `/api/fosu/app-config`，网络失败时读取本地缓存。
2. 首页展示 `home/all` 公告，ticker 公告显示为轻量滚动入口，modal 公告启动后弹出一次。
3. 今日页显示 urgent 公告或数据更新提示。
4. 全校页顶部只保留轻量数据更新时间和公告入口，免责声明放到底部。
5. 设置页「数据与公告」可查看数据版本、最新动态、公告历史和反馈入口。
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
7. 在首页、今日、全校、设置页逐一验证公告和数据更新时间展示。
8. 进入「个性化课程」，新增一门当前周课程，返回首页和今日页确认显示；隐藏后确认不再显示；删除后确认消失。
