# ADP 原生 Widget 最小 Seed 要求

## 目的

腾讯云智能 ADP 的原生 Widget 若使用平台私有导出/序列化格式，比赛主版本不得凭猜测手写该格式。只需要用户在 ADP 内**手工建立一次最小 Widget Seed**，导出后交给 Codex/Kimi/ChatGPT 解析真实格式；后续六张正式 Widget 由 Agent 自动生成，避免人工重复搭六遍。

## Seed 名称

`00-Widget格式种子-勿用于正式展示`

保持为测试/未发布状态。

## Seed 只需要覆盖以下能力

### 1. 顶层输入

创建一个 Widget 输入对象或若干最小输入字段，至少包括：

- `title: string`
- `subtitle: string`
- `verified: boolean`
- `items: array<object>`，对象内至少有 `name: string`
- `actionLabel: string`
- `actionMessage: string`

如果平台要求逐字段创建，则照平台要求建立；不要为了 seed 完整复刻 `campus-widget/v2`。

### 2. 组件

在同一张 Seed 中尽量放入：

- 文本 Text
- 容器 Container/Card
- 标签/Badge/Tag（平台有哪个用哪个）
- 列表/循环 Repeater/List（平台有哪个用哪个）
- Button
- 条件显示/Visibility（如果编辑器支持）

目标不是视觉好看，而是拿到这些组件在真实导出文件中的序列化结构。

### 3. 数据绑定

至少建立：

- Text ← `title`
- Text ← `subtitle`
- Badge/Tag 或 Text ← `verified`
- Repeater/List ← `items`
- Repeater 子项 Text ← `item.name`
- Button label ← `actionLabel`

### 4. Action

Button 必须配置：

- Action 类型：`sys.chat`
- 消息内容绑定 `actionMessage`；如果平台不允许动态绑定，则先写固定文本：`继续刚才的校园任务`

必须确保导出内容中能识别出 Button → sys.chat 的真实平台结构。

### 5. 条件显示

如果 ADP Widget 编辑器支持条件显示：

- 创建一个 Text：`已核验`
- 条件：`verified == true`

如果不支持，不强求；导出后在研发检查点标记 `WIDGET_CONDITIONAL_UI_UNSUPPORTED`，正式卡改用常驻核验 Badge。

## 不需要做的事情

- 不要建立六张正式卡。
- 不要连接 01–04 工作流。
- 不要输入真实 token。
- 不要输入真实学校/教师/学生信息。
- 不要发布 Seed。
- 不要在 Seed 里实现任何课表或教室业务逻辑。

## 导出后交付

导出 Seed 的原始文件/ZIP，保持文件名和目录结构不变，上传给负责实现的 Agent。

Agent 必须先做：

1. 列出全部文件与 SHA256；
2. 定位输入 Schema、组件树、数据绑定、循环结构、Action、条件显示的真实字段；
3. 形成 `adp-native-widget-format-notes.md`；
4. 写静态校验器；
5. 再生成 4 主 + 2 辅正式 Widget；
6. 原始 Seed 只读保留，永不覆盖。

## 自动生成后的正式命名

1. `小序-课表票据`
2. `小序-空教室票据`
3. `小序-冲突赶场票据`
4. `小序-今日校园计划`
5. `小序-候选确认`
6. `小序-任务恢复`

## 如果平台没有导出功能

如果当前 ADP Widget 编辑器没有 Widget 导出能力：

1. 不伪造所谓 `.widget` 文件；
2. 使用 `adp-widget-mapping.md` 作为唯一人工配置合同；
3. 让 Codex/Kimi 通过浏览器自动化（若本机工具支持）在 ADP 页面完成组件配置；
4. 没有浏览器自动化时，只人工完成第一张主卡 Schedule，确认字段与 Action 可用后再复制模板改成其余卡；
5. H5 fallback 继续用于视觉预览和比赛备份，但不冒充 ADP 原生 Widget。

## 通过标准

Seed 阶段只需要证明：

- 结构化输入可以绑定；
- 列表可以循环；
- `sys.chat` 可以从按钮触发；
- 条件显示若平台支持则可用；
- 导出/复制模板流程可复用。

没有这些证据前，研发检查点必须保持：

`ADP_WIDGET_SEED_PENDING`
