# 多端迁移规划

本轮不迁移工程，也不使用微信开发者工具生成 iOS、Android 或鸿蒙安装包。微信开发者工具只能上传微信小程序，不能产出 App Store、Android 或 HarmonyOS 安装包。

## 现在的边界

- 小程序在 `miniprogram/`，页面是原生 WXML / WXSS / JS。
- 课表学期规则在 `shared/`，服务端归一化在 `server/src/utils/scheduleNormalizer.js`。
- 个人课表同步依赖 `wx.login`、服务端 `jscode2session` 和 Fosu Session。这段不能原样搬到其他客户端。
- `GET /api/fosu/app-config` 是公开配置。缺少 `ads` 时客户端保持现有界面。

## 可以共享

- 课程模型、周次计算、课程 normalize、学期配置。
- 公开 API 合同和已经映射成中文的安全错误码。
- 不包含密码、Cookie、ticket、session 的存储字段。

## 必须按平台重做

- 登录：微信是 `wx.login`；iOS / Android / 鸿蒙需要各自的系统账号或学校登录，不能复用小程序 code。
- 网络、安全区和本地存储。
- 课表界面。7 天概览可以保留交互，但不能指望 WXML 直接变成原生界面。

## 推荐顺序

1. 继续让小程序做平台适配层，不引入 Taro、uni-app 或 Flutter。
2. 以后先把纯函数收进 `packages/schedule-domain` 和 `packages/api-client`，服务端与小程序一起引用。
3. 三端客户端另立原生工程。只有在共享包稳定后，才评估是否用同一套 UI 框架。
4. 广告位等下一版单独发布，不放进正在审核的 3.1.0。
