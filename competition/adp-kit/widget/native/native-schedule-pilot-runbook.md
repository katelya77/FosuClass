# 小序原生 Widget Pilot：课表票据

状态：`ADP_WIDGET_CODE_PILOT_READY`

目标：先在腾讯云 ADP 用官方“代码创建 Widget”方式完成一张 `小序-课表票据-Pilot`，验证 Template / Schema / Default、数组列表、`sys.chat` Action 和工作流 Widget 节点的真实行为。Pilot 通过后再复制同一已验证语法扩展 Classroom / Conflict / Day Plan / Choice / Error。

## 1. 创建 Widget

进入 ADP：

`Widget 开发 → 新建 Widget → 代码创建`

名称：

`小序-课表票据-Pilot`

建议标签：

- `校园智序`
- `课表`
- `结果展示`
- `competition-demo-v1`

不要发布应用。

## 2. 粘贴三份代码

Template：

`competition/adp-kit/widget/native/schedule-template.txt`

Schema：

`competition/adp-kit/widget/native/schedule-schema.json`

Default：

`competition/adp-kit/widget/native/schedule-default.json`

先只使用 Default 预览，不接 01 工作流。

## 3. Preview 验收

必须看到：

- 标题：`教师003 · 课表`
- 时间：`第1周 · 周一`
- `已核验`状态
- 2 条课：程序设计基础、计算机组成原理
- 第5-6节 / 第7-8节
- 校区A → 校区B 对应地点
- 3 个动作：查看整周 / 换一天 / 比较冲突
- 数据版本 `competition-demo-v1`

不得出现：

- 横向溢出；
- `undefined` / `[object Object]`；
- 内部 token / NodeID / VarBizID；
- 真实学校或真实身份。

### 若 Template 编译失败

只记录**第一条平台报错**和出错行，不要在 ADP 内大规模试错。

常见需要确认的兼容点按优先级：

1. `items.map(...)` 是否被当前编辑器支持；
2. 三元表达式 `condition ? A : B`；
3. `filter(Boolean).join(...)`；
4. 动态 `Button onClickAction` 中的 `action.message`。

把完整错误截图/文字发回负责 Agent；由仓库模板统一修，不要只在控制台临时改一份。

## 4. Action Pilot

如果 Preview 支持 Action 调试：

点击 `查看整周`，确认 Action 类型识别为：

`sys.chat`

payload 应只包含用户可理解的文本，例如：

```json
{
  "query": "查看教师003的整周课表"
}
```

如果 Preview 不执行对话 Action，只需确认编辑器识别 `sys.chat`，真实动作留到应用调试。

## 5. 接入 01 工作流

仅当 Preview 完全通过后执行。

在当前冻结的 01 工作流复制一个**测试副本**，推荐命名：

`01-多维课表查询-WidgetPilot`

不要直接覆盖已冻结正式 01。

测试副本在现有 `结果核验与呈现` 后增加：

`Widget数据适配（Code） → Widget（小序-课表票据-Pilot） → 原回复/结束`

原则：

- 原 CampusTools / 日期解析 / 实体解析全部不改；
- Widget 数据适配只做字段映射；
- Widget 节点使用“直接向后流转”；
- 原 Markdown 回复先保留作为 fallback；
- Pilot 未通过前不替换正式 01。

Widget 节点最少输入：

- `title`
- `timeText`
- `queryId`
- `dataVersion`
- `summary`
- `items`
- `actions`

数据结构必须与 `schedule-schema.json` 一致。

## 6. 应用级真实验收

测试：

`教师003第1周周一的课`

期望：

1. 仍然正确走课表工作流；
2. 课程事实与已冻结 01 完全一致；
3. 对话里出现原生 Schedule Widget；
4. 点击 `查看整周` 后发送 `sys.chat` 并继续当前上下文；
5. 点击 `比较冲突` 后能进入 03 的比较/澄清链路；
6. 不因 Widget 引入额外动态事实。

## 7. Pilot 通过标记

只有 Default Preview + 工作流真实对话 + 至少一个 `sys.chat` Action 均通过，检查点才能更新为：

`ADP_WIDGET_SCHEDULE_PILOT_PASS`

其余五张卡尚未完成时，不得写：

`ADP_WIDGET_NATIVE_PASS`

## 8. 后续自动扩展

Schedule Pilot 通过后，复用已验证 Template 语法生成：

1. `小序-空教室票据`
2. `小序-冲突赶场票据`
3. `小序-今日校园计划`
4. `小序-候选确认`
5. `小序-任务恢复`

其中 Choice 采用“等待用户操作”，其余结果卡默认“直接向后流转”。
