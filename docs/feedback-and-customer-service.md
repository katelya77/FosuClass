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
https://class.katelya.eu.org/admin/feedback
```

打开页面后输入 `ADMIN_API_TOKEN`，后台会通过 `/api/admin/feedback` 读取反馈列表。
