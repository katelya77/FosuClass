# Product Capability Tiers

## Tier 0 — Must never break

核心数据与发布链路。任一失败视为 P0 事故。

| Capability | Components |
|------------|------------|
| 课表采集 | sync-client, relay agent, publisher |
| 课程规范化 | scheduleNormalizer, courseNormalizer |
| Staging | stagingUploadService, staging finalize |
| Release Pack | releaseService, release worker |
| 静态同步 | staticReleaseSyncService |
| URL 验证 | static verify / health jobs |
| Active Pointer | runtimePointerService |
| 小程序读取 | miniprogram services + static indexes |
| Last-known-good | school LKG cache paths |
| 个人课表导入 | personal + fosuApaas import |
| 学期生命周期 | termRegistry, activation transaction |

**规则：** Tier 2/3 的任何失败都不得阻塞 Tier 0。

## Tier 1 — Core experience

| Capability | Notes |
|------------|-------|
| 全校课表 | 依赖 Tier 0 数据平面 |
| 今日课程 | |
| 教学周历 | |
| 空教室 | empty-room index |
| 冲突课程 | teaching-event-resolver |
| 班级/教师/教室/课程查询 | catalog + indexes |

## Tier 2 — Operations

| Capability | Admin module |
|------------|--------------|
| 公告 | content/notices |
| 动态 | content/news |
| 反馈 | feedback |
| 校园地图 | campus-map |
| 数据分析 / 热力 | quality/dashboard |
| 质量运营 | quality |

## Tier 3 — Experimental

| Capability | Isolation requirement |
|------------|----------------------|
| 小佛助手 | Feature Flag + Kill Switch |
| Provider | 故障不影响课表 API |
| 知识库 | 独立存储与发布 |
| 模型增强 | 可降级 mock / disabled |

## Failure isolation matrix

| Failure | Must still work |
|---------|-----------------|
| AI Provider down | Schedule read, release publish, staging |
| Campus map CDN fail | Active release, school schedule |
| Feedback store corrupt | Sync pipeline |
| Admin SPA build missing | Legacy admin + all APIs |
| Tier 3 admin page error | Rest of admin shell (error boundary) |
