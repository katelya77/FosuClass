# FosuClass 安全威胁模型

本轮安全设计的目标，是提高匿名、长期、批量、低成本复用 FosuClass API 和静态 Release Pack 数据的门槛。它不宣称“只要合法客户端能读到的数据就绝对无法被提取”，而是通过会话、短期票据、限流、日志脱敏和静态资源策略降低滥用风险。

## 主要威胁与处理方式

A. 第三方网页盗链：通过 ticket 模式、严格的静态响应头和可选 Referer 检查降低风险。Referer 只作为辅助判断，不能作为主鉴权。

B. 匿名脚本批量下载：通过动态 API 会话门禁、短期静态票据、有限速率限制和可疑枚举事件记录提高成本。

C. 发现 `/api/fosu/*` 后直接调用：通过 `FOSU_SECURITY_MODE=session|ticket` 和集中路由策略控制；`observe` 模式只记录本应拒绝的请求。

D. 拿到有效 ticket 后的短期复用：这是可接受的剩余风险。ticket 是 Bearer 凭证，生命周期短、绑定 Release 和路径范围，并且不放在 URL 中。

E. 微信小程序被反编译：客户端代码中不存放长期共享密钥、AppSecret、HMAC secret、管理员 Token 或原始 openid。

F. 管理员登录被暴力尝试：保留现有登录限流；管理员登录失败会成为结构化安全事件；浏览器写操作需要 Origin 和 CSRF 校验。

G. 管理员 Token 泄露：浏览器 Cookie 鉴权与 `ADMIN_API_TOKEN` 鉴权分离。CLI Token 调用按设计绕过 CSRF，但 Token 值绝不写入日志。

H. Cloudflare 缓存绕过源站鉴权：受 ticket 保护的响应不能被公开缓存，除非边缘层已经实现 HMAC 校验并使用安全缓存键。

I. `X-Forwarded-For` / `CF-Connecting-IP` 伪造：只有当 socket peer 来自环回地址、私有网络或配置过的可信代理时，才信任代理头。

J. 路径穿越、目录扫描、备份文件泄露：静态 ticket 校验会规范化解码路径；OpenResty 模板拒绝点文件、备份、日志、source map、压缩包和非 `GET/HEAD` 方法。

K. 请求洪泛导致 Node/OpenResty 负载过高：动态端点使用有界内存限流。静态保护应由 OpenResty 本地校验或缓存鉴权回退处理，不让 Node 逐个读取静态文件正文。

L. ticket/session 泄露到日志、URL 或截图：敏感 Bearer 值绝不追加到 URL，安全日志会对 token、session、ticket 等字段脱敏。

## 安全模式

`FOSU_SECURITY_MODE=observe|session|ticket`

- `observe`：兼容旧行为，同时记录严格模式下会被拒绝的请求。
- `session`：动态小程序数据 API 要求有效 `X-Fosu-Session`；静态 Release Pack 仍公开。
- `ticket`：动态 API 需要 session，静态 Release Pack 需要 ticket。只应在 OpenResty 和 Cloudflare 缓存策略验证通过后启用。

快速回退：

```env
FOSU_SECURITY_MODE=observe
FOSU_STATIC_ACCESS_MODE=public
```

回退不需要重新构建 Release Pack。
