# Relay Agent 接力采集说明

## 目的

Relay Agent 用于把轻量采集/上传能力交给在校同学使用。接力同学只需要在校园网环境运行代理端并上传 Staging JSON，不需要后台管理员密码，也不会拿到项目 server 源码。

## 管理员操作

1. 登录后台，进入“同步中心”。
2. 在“接力任务管理”里填写目标学期、说明、有效期和最大上传次数。
3. 创建任务后复制运行命令。
4. 把 `tools/fosu-relay-agent` 目录或打包产物发给接力同学，同时发送 relay token 命令。
5. 接力上传完成后，在后台查看上传记录。
6. 点击“设为 Staging”，再检查 Staging diff。
7. 确认后发布正式 release。

## 接力同学操作

接力同学在校园网电脑上运行：

```powershell
npm run sync:relay-agent -- --server=https://class.katelya.eu.org --token=RELAY_TOKEN --term=2026-2027-1 --file=./staging/2026-2027-1-full.json
```

代理端会显示任务、有效期、网络检测结果和将要上传的数据摘要。输入 `yes` 后才会上传。

当前代理端不会保存密码，不绕过验证码，不上传学号密码。Staging JSON 中出现 `password`、`cookie`、`ticket`、`session`、`token` 等敏感字段会被拒绝。

## 打包

```powershell
npm run build:relay-agent
```

输出目录：`tools/fosu-relay-agent/dist/`。Windows 用户可运行 `fosu-relay-agent-win-x64.cmd`。该打包产物只包含 relay agent 脚本，不包含后台管理页面源码、VPS SSH 信息、GitHub Secret、`ADMIN_PASSWORD`、`ADMIN_TOKEN` 或 `ADMIN_API_TOKEN`。

## relay token 权限

relay token 只能调用：

- `GET /api/relay/tasks/:token`
- `POST /api/relay/staging/upload`

relay token 不能调用：

- `/api/admin/*`
- 发布正式 release
- 回滚 release
- 查看后台反馈
- 修改公告或配置
- 读取管理员 token

## 审核边界

接力上传不会直接影响小程序线上数据。数据必须先进入 relay upload area，再由管理员提升为 Staging，最后由管理员发布正式 release。
