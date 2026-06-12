# FosuClass 微信小程序存储隔离与安全审计清单

本清单用于审计与追踪课表读取、选择缓存及分享参数相关的安全隔离机制，避免开发者本地课表状态或分享者信息污染普通新用户。

## 1. 统一管理的存储键

以下存储 Key 被划归为**当前活跃课表管理模块**，禁止在业务页面内直接读写，必须通过 `utils/storage.js` 中的统一函数进行生命周期管理：

| 存储键 | 说明 | 统一管理函数 |
| :--- | :--- | :--- |
| `FOSU_CURRENT_SCHEDULE_TARGET` | 首页及核心页面正在展现的课表目标（含 courses 数据） | `getCurrentScheduleTarget()`, `setCurrentScheduleTarget(target)`, `clearCurrentScheduleTarget()` |
| `hasInitializedSchedule` | 用户是否已绑定过或跳过绑定课表的状态 | `isScheduleInitialized()` |
| `currentScheduleId` | 当前绑定的课表 ID（用于后台快照联动） | 自动在 `setCurrentScheduleTarget()` 中写入，并在 `clearCurrentScheduleTarget()` 时自动清除 |
| `currentScheduleName` | 当前绑定的课表显示名（如 25动物科学3） | 同上 |
| `currentScheduleSource` | 当前绑定课表的数据类型（如 class, teacher） | 同上 |
| `FOSU_CLASS_SETTINGS` | 存储 hideInactiveCourses, showWeekend, weekendShowMode 等用户个性化选项 | `getSettings()`, `saveSettings()`, `resetSettings()` |

## 2. 旧 Key 迁移与清理

- **迁移策略：** 不再使用可能导致脏读的 `CURRENT_SCHEDULE` 与 `SELECTED_SCHEDULE` 键，统一收拢为 `FOSU_CURRENT_SCHEDULE_TARGET`。
- **清理逻辑：** 
  - 当检测到 `settings.className` 有值，但 `FOSU_CURRENT_SCHEDULE_TARGET` 为空时，视为不完整残留状态，在统一验证 `isScheduleInitialized()` 时会被识为不合法，直接引导进入新用户选择页面。
  - 用户或测试人员在设置页点击 **“重置为新用户状态”** 时，系统会安全且彻底地移除以上所有 Storage 键，并清空学院与班级的筛选记录。

## 3. 分享路径隔离审计

为了杜绝通过普通分享链路泄露课表缓存，项目建立了严格的分享方案：

### 普通分享（如首页/设置页分享）
- **路径示例：** `/pages/index/index`
- **安全要求：** 绝对不允许携带 `className`, `scheduleId`, `target` 等任何参数。对方打开后为独立的新用户状态，加载其本地的绑定课表或弹出绑定引导。

### 特定课表分享（如班级课表详情页 `schedule-view` 分享）
- **路径示例：** `/pages/schedule-view/schedule-view?shareScheduleId=25动物医学6&name=25动物医学6&type=class&semester=2025-2026-2&preview=1`
- **安全要求：** 
  - 必须携带 `preview=1` 标识，表明该页面处于只读预览态。
  - **绝不允许**在 onLoad 期间自动将该参数写入本地 `FOSU_CURRENT_SCHEDULE_TARGET`。
  - 只有当新用户在页面上方主动点击 **“设为我的课表”** 按钮时，才会显式写入本地并开启初始化标记。

## 4. 新用户初始化测试步骤

1. **完全清空 Storage：** 在微信开发者工具控制台或“设置”页中，点击“恢复默认设置”或“重置为新用户状态”。
2. **首次进入首页：**
   - 首页必须展示“请选择一个班级课表作为首页展示”空状态。
   - **预期结果：** 不展示 25动物科学3班 或 25动物医学6班 的课程，无任何旧课表残余。
3. **点击“先浏览全校课表”：**
   - **预期结果：** 首页依然回到空状态，且 `hasBoundTarget` 依然为 false，不自动继承旧数据。
4. **分享链路验证：**
   - 在已选定课表的情况下，点击首页右上角“转发”至群聊。
   - **预期结果：** 抓包或真机确认分享卡片的 path 为 `/pages/index/index`（无参数）。
5. **课表预览功能验证：**
   - 在全校页点入 25动物医学6班，点击右上角转发。
   - **预期结果：** 分享卡片 path 包含 `preview=1` 等参数。新用户通过该链接打开时只作预览，其首页的“我的课表”状态不会被污染。
