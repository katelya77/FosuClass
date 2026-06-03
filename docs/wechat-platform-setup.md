# 微信公众平台配置指引

本文档只说明“佛课小表”当前版本建议接入的低风险微信小程序平台能力。平台开关需要在微信公众平台手动配置；代码会在能力不可用时静默降级到普通 API。

## 服务器域名

在“开发管理 / 开发设置 / 服务器域名”中配置：

| 类型 | 建议值 | 说明 |
| --- | --- | --- |
| request 合法域名 | `https://class.katelya.eu.org` | 小程序所有业务 API 均走该域名。 |
| downloadFile 合法域名 | `https://class.katelya.eu.org` | 为后续静态 release manifest、index、detail JSON 下载预留。 |
| uploadFile 合法域名 | 暂不需要 | CLI 上传和后台网页上传不是小程序端 `uploadFile`。 |
| socket/udp/tcp | 暂不需要 | 当前没有实时连接需求。 |
| DNS 预解析域名 | `class.katelya.eu.org` | 优化首次解析。 |
| 预连接域名 | `class.katelya.eu.org` | 优化 iOS 首次连接体验。 |

## 建议开启

### 数据预拉取

后端接口：

```text
GET /api/fosu/prefetch
```

返回内容只包含 active release 的轻量元信息：`term`、`releaseVersion`、`updatedAt`、`cacheEpoch`、`counts`、`manifestUrl` 和必要 URL，不返回完整课表。

小程序端通过 `services/platformDataService.js` 读取微信平台预拉取数据；读取失败时继续请求 `/api/fosu/app-config` 和 `/api/fosu/bootstrap`。

### 数据周期性更新

后端接口：

```text
GET /api/fosu/periodic-data
```

返回 active manifest、最近 release 摘要、轻量索引计数和 empty-room index 元信息。它只作为加速缓存，不是唯一真相。

### 扫普通链接二维码打开小程序

建议配置普通链接规则，将链接参数映射到小程序页面：

```text
/pages/schedule-view/schedule-view?type=class&id=xxx&term=2025-2026-2&releaseVersion=xxx
/pages/schedule-view/schedule-view?type=teacher&id=xxx&term=2025-2026-2&releaseVersion=xxx
/pages/schedule-view/schedule-view?type=classroom&id=xxx&term=2025-2026-2&releaseVersion=xxx
/pages/empty-room/empty-room?building=C7&section=3-4
```

如果 `releaseVersion` 缺失，页面会回退到 active release。若 `id` 不存在，课表详情页会提示用户返回“全校”页重新搜索。

## 暂缓开启

- 微信网关：可作为后续抗刷、防护、国内接入优化方案；本轮不直接切生产流量。
- API 安全：当前核心 API 不依赖微信平台关键 API，本轮只保留文档说明。
- 安全键盘：当前没有高敏感输入场景，不接入。
- 消息推送：可用于后续反馈通知、release 通知，本轮不强行接入。
- 云开发/云托管迁移：当前 VPS 链路稳定，不迁移。

## 安全要求

- `AppSecret` 只允许服务端使用。
- 小程序代码上传密钥只放本地安全目录或 CI Secret。
- 不提交 `.env`、`local.secrets`、上传密钥、`ADMIN_API_TOKEN`、relay token 或任何密码。
- relay token 是一次性/短期权限，只能读取 relay 任务和上传 Staging，不能访问后台管理能力。
- 文档示例必须使用占位符，不写真实 token。

## 后台接口对应

| 接口 | 作用 | 缓存策略 |
| --- | --- | --- |
| `/api/fosu/app-config` | active 配置、公告、数据版本 | `no-store` |
| `/api/fosu/bootstrap` | active catalog/bootstrap | `no-store` |
| `/api/fosu/prefetch` | 微信数据预拉取轻量 payload | `no-store` |
| `/api/fosu/periodic-data` | 微信周期性数据轻量 payload | active `no-store`，带版本可短缓存 |
| `/api/fosu/search-index` | 班级/教师/教室/课程轻量索引 | 带 `releaseVersion` 可缓存 |
| `/api/fosu/schedule-detail` | 按需读取课表详情 | 带 `releaseVersion` 可缓存 |
| `/api/fosu/empty-classrooms` | 空教室查询 | 带 `releaseVersion` 可缓存 |
| `/api/fosu/client-diagnosis` | 客户端诊断 | `no-store` |

## 验收命令

```powershell
npm run test:miniprogram-cache-version
npm run test:empty-room-index-build
npm run test:empty-room-api
npm run test:empty-room-cache
npm run test:empty-room-current-section
```
