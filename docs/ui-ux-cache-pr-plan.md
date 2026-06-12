# UI/UX 与缓存优化实施说明

## 改动范围

- 设置页：把当前课表、XLS 导入、个性化课程、当前学期、开学日期和总教学周合并到首屏概览卡，删除重复的 XLS-only 入口和重复的数据状态卡。
- 公告栏：ticker 公告整条点击即可打开详情，详情弹窗不再放额外确认按钮。
- AI 校园管家：常用任务与更多任务统一改用本地 SVG 图标；更多任务分组打开时才写入页面 `data`，并缓存到 `FOSU_AI_TASK_PANEL_GROUPS_CACHE`。
- AI 课程卡片：课程类结果优先展示具体时间段，例如 `08:00-09:25`；节次保留在副标题中。
- 全校课表缓存：同 `releaseVersion` 的搜索索引命中缓存后走快速路径，不再立刻重复请求 API；服务端版本化搜索索引返回一周公共缓存。
- 个人课表缓存：XLS 课表绑定后写入 `FOSU_PERSONAL_SCHEDULE_CACHE`，页面内优先复用内存中的当前课表对象。

## 关键文件

- `miniprogram/pages/settings/settings.wxml`
- `miniprogram/pages/settings/settings.wxss`
- `miniprogram/components/notice-ticker/*`
- `miniprogram/pages/ai-assistant/*`
- `miniprogram/assets/icons/ai-tasks/*.svg`
- `miniprogram/utils/storage.js`
- `miniprogram/pages/school/school.js`
- `server/src/routes/fosu.js`
- `server/src/services/ai/toolRegistry.js`
- `server/src/services/ai/providers/mockProvider.js`

## 验证建议

```bash
npm run test:notice-ticker-array-guard
npm run test:ai-assistant-ui-layout
npm run test:ai-assistant-minimal-ui
npm run test:ai-quick-actions-behavior
npm run test:ai-task-sheet-groups
npm run test:ai-card-polish-contract
npm run test:miniprogram-package-hygiene
npm run test:fusu-search-index-contract
```

## PR 摘要建议

标题：`[codex] 优化小程序设置页、AI 管家与课表缓存`

正文要点：

- 精简设置页首屏，合并课表绑定、导入和学期信息。
- AI 任务入口改为 SVG 图标，更多任务按需渲染并加入防抖。
- 课程卡片展示具体上课时间，后端工具补齐 `timeText`。
- 全校索引和个人 XLS 课表新增快速缓存路径，减少重复请求和 storage 反序列化。
