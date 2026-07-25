# 小佛助手最终可交付收敛 — 脱敏诊断（Layer Attribution）

> 日期：2026-07-26  
> 基线：`9f23f4b8`（main / PR #33 合并后）  
> 分支：`release/xiaofu-final-product-convergence`  
> 方法：代码路径复现 + 本机 Release Pack `26.05.29.22` + `releaseService.searchActiveIndex` / `releasePackService.filterIndexPayload` / 页面布局源码核对  
> 脱敏：不记录 OpenID、学号、Token、Cookie、密钥、真实用户会话。

## Runtime fingerprint（本地）

| 字段 | 值 |
|------|-----|
| clientBuild | miniprogram @ `9f23f4b8` |
| serverCommit | `9f23f4b8` |
| releaseVersion | `26.05.29.22`（本机 active pack；教师索引样本 20 人，**磁盘项无 collegeCodes、无「陈芳」**） |
| teacherIndexSchemaVersion（代码常量） | `2`（目标升至 `3`） |
| SCHOOL_CACHE_SCHEMA_VERSION | `6` |
| conversationIdHash | 场景级合成 `sha1(scenarioId)` 前 12 位 |

> 说明：本机 pack 为健康样本子集。服务端读路径可对 teacher 做 on-read enrich；全校页默认走静态索引 + 客户端过滤，二者数据完备度不一致是核心分裂点。

---

## 问题 1：小佛助手搜索「陈芳」可以命中

### Redacted Trace

| 字段 | 值 |
|------|-----|
| rawMessage | 陈芳 / 查教师课表→陈芳 |
| toolName | `search_school_index`（服务端 Agent Kernel） |
| toolArgs | `{ type: teacher, q: 陈芳 }` |
| data path | `releaseService.getActiveIndex('teacher')` → `enrichTeacherIndexItemsOnRead` → `filterActiveIndexItems` |
| observation | 服务端在读路径补齐 `collegeCodes`；精确姓名优先。生产完整 pack 可命中；本机样本无「陈芳」→ total=0，但路径正确 |
| renderedCardType | search result / schedule card（依赖 items） |

### 失败层

- **数据覆盖层 / Release Pack 层**（本机）：样本索引不含「陈芳」，无法用本地 pack 做生产级命中验收。  
- **非数据源分裂主因**：Agent 侧过滤语义在 PR #33 后已与 server enrich 对齐。  
- **Action 层**（连带）：即使命中，常规搜索（非 `open_schedule` goal）的 `deriveActionCommands` 仅在 `goalAction===open_schedule` 时生成 navigate，用户常只能看到列表文案而不能「打开教师课表」。

---

## 问题 2：全校页选择动物科技学院，搜索「陈芳」为零结果

### Redacted Trace

| 字段 | 值 |
|------|-----|
| UI | 全校 Tab → 教师 → college=动物科技学院(04) → keyword=陈芳 |
| toolName | `releasePackService.searchIndex` → 静态 `teachers-index` + `filterIndexPayload` |
| toolArgs | `{ type:teacher, q:陈芳, collegeCode:04 }` |
| cacheKey | `school:v6:index:...:tidx2:...`（含 teacher schema v2，但静态索引本身无 collegeCodes） |
| observation | 磁盘 `teachers-index.json` 项：`collegeCode:""`, **无 `collegeCodes[]`**；客户端 `matchesTeacherCollegeFilter` 在有 college 时拒绝无 codes 项 → total=0。服务端路径会 enrich，**客户端静态路径不会**。 |
| 对比 | `executeSearch` 对 `type===teacher` 在 pack 失败时 **不回退** `/api/fosu/search-index`（显式 `throw packError`） |

### 失败层（必须点名）

1. **Release Pack 层**（主因产物）：发布的 teachers-index 未落盘 Schema v3（缺 `collegeCodes` / `normalizedName` / `teacherIndexSchemaVersion`）。  
2. **数据源层**（主因链路分裂）：Agent 用服务端 enrich 后的 index；全校页用旧静态 index + 客户端过滤。  
3. **缓存层**：旧 `tidx2` / `school:v6` 缓存可能固化错误空结果；键已含 college 但仍可跨 schema 残留。  
4. **Client filter 层**（正确严格化后的副作用）：PR #33 取消 `allowMissing` 后，无学院字段的旧索引在学院筛选下全部被滤空 — 正确行为暴露了产物不完整。

---

## 问题 3：查询教师课表后只能看结果，不能直接打开教师课表

### Redacted Trace

| 字段 | 值 |
|------|-----|
| rawMessage | 查教师课表 / 陈芳老师课表 |
| toolName | `search_school_index` |
| observation | 结果卡/文案可展示教师名；主按钮常见「打开全校查询」或无按钮 |
| deriveActionCommands | 仅 `goalAction===open_schedule` 或 `get_schedule_detail` 时生成 navigate；普通 search 唯一命中 **不** 生成「打开教师课表」 |
| navigate target | `/pages/schedule-view/schedule-view` 已在 Action 白名单；`scheduleNavigator.buildScheduleViewUrl` 已存在但未统一挂到 Agent 结果卡与四类课表 |

### 失败层

1. **Action 层**（主因）：`deriveActionCommands` 覆盖不全；四类课表（班级/教师/教室/课程）无统一 ScheduleNavigation 契约与类型化主按钮文案。  
2. **布局/卡片层**：多候选时缺少行级 `detailId` 打开；detailId 缺失时的降级 pending 未统一。  
3. **非** 缺少 `schedule-view` 页面 — 复用现有页即可。

---

## 问题 4：首次点击麦克风提示「未获得麦克风权限」

### Redacted Trace

| 字段 | 值 |
|------|-----|
| entry | composer 麦克风 → `ensureRecordPermission` → `voiceAuthStateMachine.ensureVoiceReady` |
| 路径 | privacy → getSetting(scope.record) → authorize → 再 getSetting |
| 失败分支 | `!setting.decided` 且 authorize fail → `lastError="未获得麦克风权限"`，`openSettingSuggested=false` |
| UI | 仅 `wx.showToast`，**无** 可继续授权按钮；用户无法从 Toast 恢复 |
| app.json | 已声明 `permission.scope.record.desc`；`__usePrivacyCheck__: true` |

### 失败层

1. **微信权限层**（主因状态机）：首次未决定（`WECHAT_RECORD_UNDECIDED`）被折叠为笼统 Toast，未输出 `reasonCode`，未提供再触发 authorize 的操作。  
2. **API/宿主层**：未区分 `PRIVACY_NOT_ACCEPTED` / `SYSTEM_MIC_DENIED` / `RECORDER_START_FAILED` / `ASR_*`；ASR 失败与录音权限错误混用「识别失败」。  
3. **非** app.json 未声明（源码已声明；体验版是否含最新包需上传核验）。

---

## 问题 5：长对话滚到底后，最后一张卡片与输入胶囊之间大块空白

### Redacted Trace

| 字段 | 值 |
|------|-----|
| layout | `.ai-page` flex 列；`.message-scroll` flex:1；`.composer` 在 flex 流内 `position:relative`（非真正悬浮） |
| padding | `.message-scroll` 固定 `padding-bottom: 12rpx`；composer 另有 safe-area padding |
| geometry helper | `measureXiaofuGeometry` **只测量**，不写回 `composerInset`，无布局闭环 |
| scroll | `scrollIntoView: message-bottom-anchor`；卡片异步增高后可能只滚一次，未 nextTick 二次锚定 |

### 失败层

1. **布局层**（主因）：composer 占位与 scroll 底部 padding **双套**，未用单一动态 `composerInset`。  
2. **ScrollView 层**：未在卡片 layout 完成后 nextTick 再滚到真实 anchor；滚到底时 `composerTop - lastContentBottom` 未约束到 12–24rpx。  
3. **测量层**：geometry probe 未驱动 setData 闭环。

---

## 问题 6：状态岛左右留白过大；输入胶囊按钮垂直偏下

### Redacted Trace

| 字段 | 值 |
|------|-----|
| 状态岛 wrapper | `width:100%` + **`padding: 0 8rpx`**（叠加在 `.ai-page` 已有 `16rpx` 边距上） |
| capsule | `width:auto` + `inline-flex` → 收起时内容宽，展开时可能变宽 → **横向跳动** |
| 动画 | `transition` 含 min-height/border-radius；未保证不动画 width |
| composer-pill | **`align-items: flex-end`** → ＋/麦/发送贴底，视觉偏下 |
| 按钮 | 72rpx 点击区；与 flex-end 叠加导致单行几何中心不对齐 |

### 失败层

1. **布局层**（主因）：状态岛非真正全宽长胶囊；wrapper 额外 8rpx；capsule `width:auto`。  
2. **布局层**（composer）：`align-items:flex-end` 导致按钮垂直偏下。  
3. **动画层**：缺少 reduced-motion 与「只动高度/透明度/translateY」约束。

---

## 汇总矩阵

| # | 问题 | 主责层 | 次责层 |
|---|------|--------|--------|
| 1 | Agent 陈芳可命中（路径正确/本机数据可能空） | Release Pack 层（样本） | Action 层（不能直开） |
| 2 | 全校页动科+陈芳零结果 | 数据源层 + Release Pack 层 | 缓存层 |
| 3 | 不能直接打开教师课表 | Action 层 | 卡片层 |
| 4 | 首次麦克风 Toast 无法恢复 | 微信权限层 | UI 恢复路径 |
| 5 | 末条与输入大空白 | 布局层 | ScrollView 层 |
| 6 | 状态岛留白 / 按钮偏下 | 布局层 | 动画层 |

## 修复原则（本轮）

1. **唯一 Teacher Search Contract**（Schema v3 + 统一过滤语义 + 旧 schema 走 `/api/fosu/search-index`）。  
2. **ScheduleNavigation** 覆盖四类课表，复用 `schedule-view` 与 Action Bus 白名单。  
3. **几何闭环**：状态岛全宽同宽；composer 悬浮 + 单一 `composerInset`。  
4. **麦克风 reasonCode 状态机** + 可恢复操作；ASR 与权限分型。  
5. 不新建第二套 Agent / 搜索引擎 / 详情页；不引入大型 UI 框架。
