# 佛课小表多端应用适配说明

## 目标与边界

当前工程继续以 `miniprogram/` 为唯一业务代码源，通过微信开发者工具的多端应用模式构建 Android、iOS 与 HarmonyOS 应用。小程序仍可独立预览和发布；Release Pack、受控本机摘要、缓存与 last-known-good 机制没有改变，多端应用不会引入第二套课表事实源或在线 Agent。

本次采用“编辑式教育工具”的移动端视觉方向：保留佛课小表红、墨色文字、白色卡片与浅灰背景；手机维持单列，平板和折叠屏将内容限制在 720px 可读轨道内；底部与浮动小佛助手同时遵守系统安全区。

## 已适配能力

| 能力 | 微信小程序 | 多端应用 |
| --- | --- | --- |
| 服务端会话登录 | `wx.login` | `wx.getMiniProgramCode`，后端 bootstrap 协议不变 |
| 运行环境版本 | `miniProgram.envVersion` | `miniapp.envVersion`，避免 App 中恒为 `release` 的误判 |
| 个人课表文件 | `wx.chooseMessageFile` | `wx.miniapp.chooseFile`，选择后统一校验格式和 5MB 上限 |
| 隐私授权 | 小程序隐私接口 | Android/iOS 原生隐私门禁与 `wx.miniapp` 隐私接口 |
| 分享 | `open-type="share"` | `wx.miniapp.shareMiniProgramMessage` |
| 客服 | 小程序客服按钮 | 展示开发者微信提示与备用邮箱 |
| 图片预览 | 小程序基础库 | Android Media / iOS WeAppMedia 扩展 SDK |
| 课程提醒 | 小程序订阅消息 + 应用内提醒 | 当前保留应用内提醒；原生订阅消息需单独申请移动应用模板后再启用 |

CloudBase 与小程序专属能力仍按“能力存在才调用”的方式降级。多端不可用时必须保留静态源、缓存与 last-known-good，不能把网络失败解释为数据不存在。

## 开发者工具操作

1. 用当前仓库根目录打开微信开发者工具，选择“多端应用模式”。`project.config.json` 的 `projectArchitecture` 已设为 `multiPlatform`。
   工具升级流程同时开启 `setting.condition`，并记录当前安装的多端模拟器插件版本；这两项用于开发者工具的多端条件编译和模拟器复现，不应手工删除。
2. 在多端应用控制台创建并绑定微信开放平台移动应用，完整配置 Android 包名、iOS Bundle ID 和 HarmonyOS 应用标识。登录和分享都依赖这一步。
3. 当前 `miniprogram/app.miniapp.json` 使用官方登录页，并把授权目标设为开发版（`authorizeMiniprogramType: 1`）。切回“小程序模式”重新预览一次，使包含授权页的开发版小程序生效，再从 App 发起登录。
4. 发正式包前，把 `authorizeMiniprogramType` 改为 `0`，重新提交并发布包含授权页的小程序版本，然后再构建 App。多端绑定关系或包名变化后，也必须重新发布对应小程序版本。
5. `wx.miniapp.chooseFile` 不能在开发者工具模拟器或移动应用助手中验证，必须安装真实包，在 iOS/Android/HarmonyOS 真机各测试一次文件选择与导入。

## 构建前检查

```powershell
npm run test:miniprogram-multi-platform
npm run test:miniprogram-session-singleflight
npm run test:miniprogram-request-final-header
npm run test:miniprogram-compile-preflight
```

本次改动还影响请求作用域的运行环境判定，因此需要执行仓库规定的 Agent Foundation、Regression、AI Competition、Final Convergence 与 Phase 3 套件。

## 图标资产

移动端图标统一来自 `miniapp/assets/source/favicon-original.png`，该文件是用户提供的 `favicon.png` 的仓库内受控副本。`tools/generate-mobile-icons.py` 只做边缘白底去除、透明边缘去污染、居中留出约 6% 安全区和确定性缩放，不会重绘图形内容。

```powershell
python tools/generate-mobile-icons.py
```

生成物已覆盖 Android 的 72/96/144/192 px 密度图标、iOS 的主图标/Spotlight/设置/通知/1024 px 商店图标，以及 HarmonyOS 的前景、背景和启动图标。透明素材用于 Android 与 HarmonyOS；iOS 使用品牌红底合成 RGB 图片，以满足商店图标不得包含 Alpha 通道的要求。配置与测试都引用仓库相对路径，因此不依赖开发者桌面的临时位置。

## 发布前仍需准备

- Android：正式包名、签名证书与隐私政策 HTTPS 页面。
- iOS：Bundle ID、发布证书、Provisioning Profile 与审核隐私文案。
- HarmonyOS：AppGallery Connect 应用、签名材料以及对应市场隐私资料。
- 提醒能力：在微信开放平台为移动应用申请独立订阅消息模板，并增加对应的服务端投递配置。`wx.miniapp.requestSubscribeMessage` 虽然可用于移动端，但它的移动应用 `templateId`、回调结构与投递渠道均不同；现有小程序模板 ID 不应直接复用。当前 App 会保留应用内提醒并返回明确的未配置状态，不会伪造订阅成功。

当前各平台所需像素尺寸已经齐备；原始品牌图分辨率为 256×256，因此 1024 px 商店图属于高质量确定性放大。若后续取得同版矢量稿或更高分辨率源图，可替换受控源文件后重新运行生成器。签名、账号绑定和商店资料都属于外部凭据/控制台步骤，不应提交到仓库。

## 验收矩阵

每个平台至少验证：冷启动、隐私同意/拒绝、微信登录返回、首页课表与静态回退、全校搜索、今日/周历、个人课表导入、反馈、微信分享、小佛助手浮窗拖动、横竖屏/刘海/底部手势区、弱网与断网缓存恢复。HarmonyOS 当前 SDK 仍应单独记录不支持的 API，不得用 Android 结果代替验收。

## 回滚

回滚仅需恢复 `project.config.json`、`project.miniapp.json`、`miniprogram/app.json`、`miniprogram/app.miniapp.json` 及本次修改的页面/工具文件，并删除新增的 `miniprogram/utils/multiPlatform.js`、`miniapp/privacy.json`、测试与本文档。服务端接口和数据包格式未改变，无需迁移或回滚数据库。不要删除 Release Pack、缓存或 last-known-good 数据。
