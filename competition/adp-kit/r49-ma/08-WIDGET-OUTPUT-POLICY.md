# 08 — Widget 输出策略

## 0. 目标

明确三类 Widget 的使用边界，**第一阶段 Tool Direct Output = OFF**，先文本全链验证，避免复杂请求（schedule → risk → classroom）被第一个工具直接终止、切断后续 reasoning / tool call。

## 1. 三类 Widget

| 类型 | 用途 | 触发方 | 说明 |
|---|---|---|---|
| A. Clarification Widget | 主 Agent 缺参数/多候选时 | Main | 复用「小序-候选确认-R42」；走 NEED_CLARIFICATION 协议 |
| B. Agent Output Widget | Agent 最终分析结果 | Main（收口） | 结果已收敛后展示；复用 r48-v3 各结果卡 |
| C. Tool Direct Widget | 仅当「该工具就是本轮最终结果」 | （预留） | **第一阶段 OFF** |

## 2. 为什么第一阶段 Tool Direct Output = OFF

- 复杂请求可能是 `schedule → risk → classroom` 多步链。
- 若第一个工具（如 schedule）直接终止并输出 Widget，后续 risk / classroom 推理会被切断。
- 正确顺序：子 Agent 调工具 → 回 Main → Main 判断是否已收敛 → 收敛才输出 Agent Output Widget。

## 3. 状态流转

```
子 Agent 调工具
   │
   ▼
回 Main（SUCCESS / NEED_CLARIFICATION / NO_RESULT / ERROR）
   │
   ├─ NEED_CLARIFICATION → Main 用 Clarification Widget（A）澄清
   ├─ NO_RESULT/ERROR    → 文本说明 + 放宽建议（不上 Widget 假装成功）
   └─ SUCCESS（已收敛）   → Main 组装 Agent Output Widget（B）
```

## 4. Widget 复用（r48-v3 baseline，不推翻）

| 结果域 | 复用 Widget | 备注 |
|---|---|---|
| 课表 | 小序-课表票据-R42 / 整周课表-R46 | schedule |
| 空教室 | 小序-空教室票据-R42 | classroom |
| 冲突/赶场 | 小序-冲突赶场票据-R42 | conflict |
| 日计划 | 小序-今日校园计划-R42 | day-plan |
| 校园态势 | 小序-校园教学态势-R42 | campus-overview |
| 候选/澄清 | 小序-候选确认-R42 | choice |
| 恢复 | 小序-任务恢复-R42 | recovery |

- `r48-v3/`（adapter、viewmodel-schema、design-tokens、各域 sample）继续作为 Widget V3 baseline，**不删除、不重写**。
- 真实 WidgetID 以平台导出为准；未取得前不猜测、不写死。

## 5. Widget action 规范（承接 R49）

- 课程方块 Clickable → 发出**完整 state-complete sys.chat**（新 root turn），例如：
  `查看T09老师第1周周三第7-8节"科学计算"的课程详情`
- 禁止使用：`查看详情` / `再看看` / `换一天` / `其他条件不变` 等不完整 payload。
- 所有 Widget action 尽量 state-complete，让 Main 能独立接管并路由。

## 6. Campus Hero Widget（预留，统一视觉规范）

- WakeUp-inspired Campus Blocks（借鉴非复制）：低饱和丰富课程色、课程方块、移动端优先、简洁克制、少装饰。
- 禁用：AI 紫色渐变、玻璃拟态、大面积装饰、巨型标题、多余说明。
- 课程颜色 deterministic（归一化课程名 hash），禁止随机变色。
- viewMode：week / day / detail / picker；移动端用 weekday selector + active-day 彩色方块 + week overview。
- 顶部只展示：对象、教学周/日期、已核验、课程数、有课日数、校区数。
- 本轮不产生正式 WidgetID；视觉验证用 `r49-design/widget-prototype/`（纯本地预览）。
