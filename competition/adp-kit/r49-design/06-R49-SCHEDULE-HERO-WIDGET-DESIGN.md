# R49 06 — Schedule Hero Widget 设计（WakeUp-inspired Campus Blocks）

> 阶段：R49 设计/审计阶段 — DESIGN DRAFT
> 视觉方向：WakeUp-inspired Campus Blocks（借鉴信息密度与克制感，非复制）
> 约束：不覆盖 r48-v3；不产生正式 WidgetID；视觉层不改事实数据

---

## 1. 设计方向

关键词：彩色课程方块 / 高信息密度 / 清晰 / 克制 / 商业级 / 校园效率工具 / 少装饰。
禁则：无 AI 紫渐变、无玻璃拟态、无大面积装饰、无巨型标题、无多余说明。
Neutral base：暖白 / 浅灰背景。

## 2. 布局结构（Schedule Widget）

### 2.1 顶部信息条（只展示）

```
T09老师 · 第1周课表      已核验 ✔
2026-08-31 ~ 09-06  ·  6 门课程  ·  3 个有课日  ·  2 个校区
```

- 对象 / 教学周-日期 / 已核验（小 Badge）/ 课程数 / 有课日数 / 校区数。
- 不塞大段说明文字。

### 2.2 星期区域

```
一  二  三  四  五  六  日
1   3   2   0   0   0   0   （课程数）
```

- 移动端：weekday selector（横向 7 个 chip）+ 选中日的彩色课程方块列表 + 顶部 week overview 迷你条。
- 桌面宽度允许时：week grid concept（7 列 × 节次行，课程方块落入格子）。
- 不强行把 7 列课表压缩成手机上的不可读小格。

### 2.3 课程方块内容优先级

1. 课程名（主）
2. 节次 / 时间（次）
3. 地点（校区 + 楼栋/教室）
4. 教师 / 班级（次级文字，更小）

每块为 Clickable；点击 → detail mode（见 §4）。

### 2.4 viewMode 设计

| viewMode | 内容 | 触发 |
|---|---|---|
| week | weekday selector + active-day blocks + week overview | 默认整周结果 |
| day | 单日课程方块 + 顶部当日日期 | 选中某天后 / DAY 查询 |
| detail | 单课程详情卡（见 §4） | 点击课程方块 |
| picker | 日期/范围/校区筛选表单（见 §5） | 点「筛选/换日期」 |

r48-v3 `viewmodel-schema.json` 当前 viewMode 枚举为 `day/date/week`——R49 扩展为 `day/week/detail/picker`（date 并入 day 或保留别名，实施阶段定）。

## 3. 课程颜色（deterministic）

- 调色板 5~7 个低饱和、区分明确的颜色（见 07 文档 token）。
- **同一课程颜色 deterministic**：hash(课程名/课程ID) → 调色板索引；禁止随机、禁止按周变化。
- 冲突/赶场徽标只做小角标，不用整块底色。

## 4. detail mode

点击课程方块后显示：

| 字段 | 说明 |
|---|---|
| 课程名 | 主标题 |
| 星期 / 日期 | 2026-09-02 周三 |
| 节次 | 第 7-8 节 |
| 时间 | 16:00-17:40 |
| 校区 | 校区A |
| 楼栋 / 教室 | B2-301 |
| 教师 | T09（次级） |
| 班级 | G01（次级） |

Actions（全部 state-complete sys.chat）：

```
检查风险        → 检查T09老师第1周周三是否存在时间冲突或跨校区赶场
查看当天        → 查询T09老师第1周周三的课
找对应时段空教室 → 校区A第1周周三第7-8节有哪些空教室
```

## 5. 日期 / 筛选交互（真实表单）

用 ADP 原生组件实现：

```
日期      [ DatePicker ]
范围      ○ 当天  ○ 整周
校区      ☑ A  □ B  □ C
          [查看课表]
```

- 表单提交 → 生成**完整可独立执行**的新 query/state（如 `查询T09老师2026-09-03的课表` 或 `查询T09老师第1周的课表`）。
- 禁止依赖「其他条件不变」；提交后的消息自带全部必要槽位，直接作为新 root turn 进 00。

## 6. ADP 原生组件映射研究

| R49 需求 | ADP 组件 | 备注 |
|---|---|---|
| 课程方块可点击 | Clickable | 每块 1 个 action，sys.chat 完整消息 |
| 卡片容器 | Card | 白底、圆角、轻边框 |
| 版式 | Box / Row / Col | 高密度网格 |
| 日期筛选 | Form + DatePicker | 表单提交为独立 query |
| 单选范围/多选校区 | RadioGroup / Checkbox / Select | 值与槽位一一对应 |
| 操作按钮 | Button | 40px 触控目标 |
| 已核验/课程数角标 | Badge | 语义色 |
| 列表（楼栋/教室明细） | ListView | detail 内使用 |
| 统计图（态势可选） | Chart | 05 扩展预留，非本轮必须 |

## 7. 与 r48-v3 的关系

- r48-v3 为工程化底座（7 契约 + adapter + 13 modes + tests 5/5）——**保留不动**。
- R49 的 Hero 设计作为「r49-design/widget-prototype」本地浏览器原型先行（纯视觉预览，无 WidgetID），确认后下一阶段再做契约级 v4 扩展（新 viewMode 枚举、detail/picker 结构、课程色 token）。
- 任何视觉变化不得修改 CampusTools 事实数据与证据结构（evidence.verified/dataVersion 原样展示）。

## 8. 不做什么

- 不在设计阶段生成正式 ADP Widget 文件或猜测 WidgetID。
- 不推翻 r48-v3 已验收的 13 状态与 action 链。
- 不用装饰性元素（图标库/渐变/玻璃）替换信息密度。