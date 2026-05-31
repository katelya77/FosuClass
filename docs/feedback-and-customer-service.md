# FosuClass 反馈与微信客服消息

## 两类反馈入口

小程序里 `open-type="contact"` 打开的微信客服消息不会进入 VPS 的 `/app/storage/feedback.jsonl`。这是微信官方客服消息通道，消息由微信平台接收和管理。

开发者需要登录微信公众平台小程序后台查看这类客服消息：

1. 打开并登录 `https://mp.weixin.qq.com`。
2. 进入对应的小程序。
3. 找到客服、客服消息或客服人员相关入口。
4. 绑定开发者微信号为客服人员。
5. 用户从小程序客服入口发来的消息会进入微信官方客服消息系统。

FosuClass 自己的“问题反馈 / 建议反馈”表单才会提交到 VPS 的 `/app/storage/feedback.jsonl`，同时兼容 `/app/storage/feedbacks.json`。这类反馈可以在 Web 后台查看：

```text
https://class.katelya.eu.org/admin
```

打开页面后使用 `ADMIN_PASSWORD` 或 `ADMIN_TOKEN` 登录。登录成功后在「反馈查看」模块处理反馈状态和管理员备注；旧的 `/admin/feedback` 会跳转到同一个后台控制台。
