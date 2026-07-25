# 小佛助手 User Action Surface（真实用户动作面）

> 生成日期：2026-07-25
> 数据来源：对 `miniprogram/` 下全部 29 个 wxml 的静态扫描（bind*/catch* 事件绑定 → handler → 关联页面 JS 行为特征），共 261 个唯一 handler。
> 本文档是「智能体可发起领域动作」的盘点与收编依据；每个收编动作的**唯一事实源是 `server/config/agent-capability-manifest.json` 的 `actions` 段**。

## 1. 扫描方法

- 事件正则：`(bind|catch|mut-bind|capture-bind|capture-catch):(tap|change|input|submit|confirm|longpress|blur|getphonenumber|opensetting|chooseavatar)`
- 对每个 handler，在其所属页面 `.js` 中提取函数体前 800 字符，标记行为特征：
  `network`（发请求）、`confirm-dialog`（已有确认弹窗）、`navigate`（页面跳转）、`storage-write`（写本地存储）、`subscribe`（订阅消息）、`auth`（授权相关）、`clear-delete`（清除/删除）、`export`（导出/保存）、`clipboard`（剪贴板）。
- 扫描脚本与原始结果：`tools/_tmp_scan_actions.js` → `tools/_tmp_scan_actions_result.json`（临时文件，验收后删除；结论已固化在本文档）。

## 2. 动作面总览（261 handler 按功能域归纳）

| 功能域 | 代表 handler | 数量级 | 副作用 | 是否收编为智能体动作 |
|---|---|---|---|---|
| 页面导航 | goTimetable / goEmptyRoom / viewClassSchedule / openPersonalSync / skipSelect | ~50 | 无（读） | 已由 `navigate` action 覆盖 |
| 面板与弹窗开关 | close* / hide* / show* / openFilterSheet | ~45 | 无（读） | 已由 `openSheet` 覆盖，其余不收编 |
| 表单输入 | onStudentIdInput / onFeedbackContentInput / onWeekChange 等 | ~50 | 无（读） | 已由 `fillForm`/`fillComposer` 覆盖 |
| 查询触发 | searchClassSchedule / confirmFilters / onQueryTap / refreshData | ~15 | 无（读） | 不收编（走工具查询链路） |
| **个人课表导入/同步** | validateAndPreviewStudentImport / confirmStudentImport / resyncStudentImport / useRecentStudentImport | ~12 | **高（凭据+写）** | ✅ importStudentSchedule / resyncStudentSchedule |
| **自定义课程** | saveCourse / toggleCourse / editCourse / deleteCourse / importJson / copyAsCustom | ~10 | **中（写本地+云端）** | ✅ saveCustomCourse / deleteCustomCourse |
| **学生调课编辑** | startEditStudentArrangement / saveStudentArrangementEdit / toggleStudentArrangement | ~8 | **中（写）** | ✅ saveStudentArrangement |
| **缓存清理/重置** | clearCache / clearLocalCache / cleanupOldReleaseCaches / diagnoseClearAllCaches / resetToNewUser | ~12 | **高（删数据）** | ✅ clearLocalCache / resetToNewUser |
| **意见反馈** | submitFeedback / showFeedback | 2 | **低（network 提交）** | ✅ submitFeedback |
| **基础数据刷新** | refreshBootstrapData / safeRefreshReleaseData / refreshReleaseManifestOnly / warmupReleaseIndexes | 4 | 低 | ✅ refreshBootstrapData |
| **课程提醒** | create / onConfirmCreate / onDelete / onGrantSubscription（reminder-sheet） | ~8 | **中（写+订阅授权）** | ✅ createCourseReminder / deleteReminder（授权由 requestSubscribe 覆盖） |
| **小佛记忆/会话管理** | onClearLocal / onDelete / onRename / onPin / onMemoryModeChange / onPersonalContextToggle | ~12 | **高（删记忆）** | ✅ clearAgentMemory（删除单会话等细粒度操作后续批次） |
| 剪贴板/导出/分享 | copyRoomName / copyAsCustom / exportJson / exportDiagnosisLog / onCopyCode | ~8 | 低 | 已由 `copy` 覆盖，其余不收编 |
| 收藏/选择 | toggleFavoriteRoom / toggleFavoriteBuilding / selectAllStudentActiveBucket | ~12 | 低（本地偏好） | 不收编（UI 内即时交互，无智能体场景） |
| 小佛对话交互 | onSubmit / onComposerConfirm / onRetryUserMessage / onVoiceTap / onSuggestionTap | ~30 | 无（对话本身） | 不收编（对话链路原生能力） |
| 其他 UI 细节 | prevWeek / backToCurrent / stopPropagation 等 | 其余 | 无 | 不收编 |

## 3. 收编动作清单（12 个新增 + 1 个已有）

> manifest `actions` 段是唯一事实源。每个动作登记：operation / safetyLevel / confirmation / idempotent / inputSchema / clientHandler / resultSchema / receiptRequired / testCases。
> `clientHandler` 指向客户端真实执行入口（页面或服务方法），格式 `页面路径#方法名` 或 `服务文件#方法名`。
> `receiptRequired: true` 的动作：客户端执行后必须 POST `/api/ai/agent/action-receipts` 回执；无 success 回执，服务端不得声称成功、不得提交记忆。
> `confirmation` 取值：`none`（无需确认）/ `required`（确认卡）/ `explicit_user_command`（用户当前消息即明确指令，跳过二次确认卡）。

| # | Action | 操作 | 安全级 | 确认 | 回执 | clientHandler（真实执行入口） |
|---|---|---|---|---|---|---|
| 0 | setCurrentSchedule（已有） | write | medium | explicit_user_command | ✅ | `services/currentScheduleService#setNewCurrentScheduleTarget` |
| 1 | importStudentSchedule | write | high | required | ✅ | `pages/personal-sync/personal-sync#confirmStudentImport` |
| 2 | resyncStudentSchedule | write | medium | required | ✅ | `pages/personal-sync/personal-sync#resyncStudentImport` |
| 3 | saveCustomCourse | write | medium | required | ✅ | `pages/custom-courses/custom-courses#saveCourse` |
| 4 | deleteCustomCourse | write | medium | required | ✅ | `pages/custom-courses/custom-courses#deleteCourse` |
| 5 | saveStudentArrangement | write | medium | required | ✅ | `pages/personal-sync/personal-sync#saveStudentArrangementEdit` |
| 6 | clearLocalCache | write | medium | required | — | `pages/settings/settings#clearCache` |
| 7 | resetToNewUser | write | high | required | — | `pages/settings/settings#resetToNewUser` |
| 8 | submitFeedback | write | low | required | ✅ | `pages/settings/settings#submitFeedback` |
| 9 | refreshBootstrapData | write | low | none | — | `pages/settings/settings#refreshBootstrapData` |
| 10 | createCourseReminder | write | medium | required | ✅ | `packageXiaofu/components/xiaofu-reminder-sheet/index#onConfirmCreate` |
| 11 | deleteReminder | write | medium | required | ✅ | `packageXiaofu/components/xiaofu-reminder-sheet/index#onDelete` |
| 12 | clearAgentMemory | write | high | required | ✅ | `packageXiaofu/components/xiaofu-memory-sheet/index#onClearLocal` |

## 4. 边界与原则

1. **智能体不复制平行写入逻辑**：所有动作复用页面/服务层既有入口（clientHandler），智能体只负责「理解意图 → 组装契约化 Action → 用户确认 → 触发既有入口 → 回收回执」。
2. **凭据不进智能体**：importStudentSchedule 的学号/密码永远由 personal-sync 页面表单直接持有，Action inputSchema 不含凭据字段；智能体只能引导用户打开页面（fillForm 仅填非敏感辅助字段）。
3. **危险操作不进 explicit_user_command**：high 级动作（importStudentSchedule / resetToNewUser / clearAgentMemory）必须 required 确认卡，不允许用用户一句话直接触发。
4. **回执防伪造**：receiptRequired 的动作，服务端回执端点做 command 白名单 + status 校验 + 目标存在性复核（参考 setCurrentSchedule 已实现的 readActiveIndex 校验模式）。
5. **未收编项**：纯读导航、面板开关、表单输入、UI 细节交互不单独收编（已由 navigate/openSheet/fillForm/fillComposer/copy 覆盖或属于对话原生能力）。
6. **后续批次**：deleteConversation、renameConversation、toggleMemoryMode、favoriteRoom 等低频动作在动作面文档留档，待有真实智能体场景再收编。
