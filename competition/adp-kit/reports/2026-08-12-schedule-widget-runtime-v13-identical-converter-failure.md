# Schedule Widget Runtime V1.3 identical converter failure

更新时间：2026-08-12 01:09 +08:00

## 真实 ADP 结果

工作流：`01-多维课表查询-WidgetPilot-V1.3`

测试：`教师003第1周周一的课`

结果：

- CampusTools：成功；
- `Widget数据适配-Schedule`：成功；
- `Widget展示判断`：成功；
- `小序-课表票据-RuntimeSafe-V3`：失败；
- ADP 继续返回同一错误：

```text
460101-工作流运行异常: 获取Widget内容失败:
convert widget view failed: http request failed:
type:framework, code:122,
msg:client codec Unmarshal: rpc.toJsonViewResponse.Data:
ReadMapCB: expect { or n, but found ",
...
operator to search for '__jsx' in undefined
```

## 已排除

用户同时导出了当前实际保存后的 `小序-课表票据-V2(1).widget`。解析该文件确认：

- WidgetID 仍为 `23fbc659efe3482fab588d754e4420a4`；
- Template 已真实替换为 RuntimeSafe V3；
- Schema 仅包含 STRING / INT；
- 无 `.map()`；
- 无 ARRAY_OBJECT / ARRAY_STRING / OBJECT 输入；
- 仅包含静态组件树、简单变量绑定和 3 个 `sys.chat` Button；
- `schemaValidity=viewValidity=defaultStateValidity=valid`。

因此 V1.2 后“复杂 JSX / 复杂 Schema 是主要根因”的假设已被 V1.3 实机结果否证。

## 当前最重要的未验证架构点

此前用于自动生成工作流 Widget 节点的 Seed 来自 `export-00-节点格式种子-勿启用(3).zip`。该 Seed 中两个 Widget 节点都未完成正式运行配置，捕获到：

```text
WidgetNodeData.ActionType = WIDGET_ACTION_NONE
```

而腾讯云官方文档明确要求 Widget 节点配置“Widget 下发方式”：

- 直接向后流转；
- 等待用户操作。

当前自动生成的 Schedule Pilot 一直沿用了 `WIDGET_ACTION_NONE`，尚未捕获“直接向后流转”的真实平台枚举值。因此，继续修改 Template 已经没有证据基础。

## 下一步：单变量实验，不再盲改 Widget

在现有 V1.3 画布中人工打开 `小序-课表票据-RuntimeSafe-V3` 节点：

1. 找到“Widget 下发方式”；
2. 明确选择“直接向后流转”；
3. 保存；
4. 重新调试同一句。

其他任何内容保持不变。

若通过：根因锁定为 `WIDGET_ACTION_NONE / 下发方式未配置`。

若仍失败：立即导出这份“已人工配置直接向后流转”的 V1.3 ZIP，用于捕获真实 ActionType 枚举；随后用腾讯云官方文档中的最小静态 Widget（Card + Title + Text，手动固定输入）做独立 Runtime 基线，判断是自定义 Widget 转换问题还是空间/平台 Widget Runtime 服务问题。

## 调试原则

已经连续 3 个修复版本未解决同一 Runtime converter 错误。根据系统化调试原则，停止继续堆 V1.4/V1.5 Template 补丁；先验证架构假设并建立官方最小工作基线。
