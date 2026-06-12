# 接力 Agent 采集说明

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
npm run sync:relay-agent -- --server=https://class.katelya.eu.org --token=RELAY_TOKEN --term=2026-2027-1
```

代理端会显示任务、有效期和网络检测结果，自动打开浏览器让接力同学手动登录教务网，随后本机生成 `./staging/{term}-full.json`。确认摘要并输入 `yes` 后才会 gzip 分片上传。

当前代理端不会保存密码，不绕过验证码，不上传学号密码。Staging JSON 中出现 `password`、`cookie`、`ticket`、`session`、`token` 等敏感字段会被拒绝。

如果接力同学没有项目源码，发送 `tools/fosu-relay-agent/dist/fosu-relay-agent-win-x64.zip`。Windows 上解压后运行 `start.bat`，按提示填入 server、token 和 term。源码模式和打包模式都走同一套 relay API 和 gzip 分片上传。

## 打包

```powershell
npm run build:relay-agent
```

输出目录：`tools/fosu-relay-agent/dist/`。Windows 用户解压 `fosu-relay-agent-win-x64.zip` 后运行 `start.bat`。该打包产物只包含 relay agent 脚本，不包含后台管理页面源码、VPS SSH 信息、GitHub Secret、`ADMIN_PASSWORD`、`ADMIN_TOKEN` 或 `ADMIN_API_TOKEN`。

## 接力 token 权限

relay token 只能调用：

- `GET /api/relay/tasks/:token`
- `POST /api/relay/staging/upload`
- `POST /api/relay/staging/upload/init`
- `POST /api/relay/staging/upload/chunk`
- `POST /api/relay/staging/upload/finalize`

relay token 不能调用：

- `/api/admin/*`
- 发布正式 release
- 回滚 release
- 查看后台反馈
- 修改公告或配置
- 读取管理员 token

过期、吊销和上传次数限制由服务端校验：

- 超过 `expiresAt` 后，读取任务和上传都会返回拒绝。
- 管理员点击吊销后，token 立即失效。
- `uploadCount >= maxUploads` 后，继续上传会被拒绝。
- relay 上传状态只会进入 `pending-review`，不能直接发布正式 release。

## 生命周期检查清单

每次开学季或交接给新同学前，至少确认以下状态都能被后台或测试覆盖：

1. 管理员创建 relay task。
2. 复制分发命令或 zip 包说明。
3. agent 拉取任务详情。
4. agent 在校园网电脑登录并采集。
5. agent 使用 gzip chunk 上传。
6. 上传进入 `pending-review`，等待管理员审核。
7. 管理员可吊销任务。
8. 管理员可删除任务。
9. 过期任务拒绝继续上传。
10. 上传次数超过 `maxUploads` 后拒绝继续上传。

## 审核边界

接力上传不会直接影响小程序线上数据。数据必须先进入 relay upload area，再由管理员提升为 Staging，最后由管理员发布正式 release。

## 验证

无法真实访问校园网时，至少运行 mock 链路：

```powershell
npm run test:relay-agent
```

该测试覆盖任务创建/删除、relay token 不能访问 `/api/admin/*`、mock 上传进入 `pending-review`、吊销、过期 token、上传次数限制和 relay agent 语法检查。
