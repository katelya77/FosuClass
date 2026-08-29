# Schedule Widget Runtime V1.2 — ADP converter failure

更新时间：2026-08-11 22:45 +08:00

## 真实 ADP 结果

工作流：`01-多维课表查询-WidgetPilot-V1.2`

输入：`教师003第1周周一的课`

真实执行状态：

- CampusTools：成功；
- `Widget数据适配-Schedule`：成功；
- `Widget展示判断`：成功并进入 widget 分支；
- `小序-课表票据-V2`：失败。

平台错误：

```text
460101-工作流运行异常: 获取Widget内容失败:
convert widget view failed: http request failed:
type:framework, code:122,
msg:client codec Unmarshal: rpc.toJsonViewResponse.Data:
ReadMapCB: expect { or n, but found ",
...
operator to search for '__jsx' in undefined
```

## 结论

V1.2 已通过 ARRAY_STRING 结构校验，因此当前错误不再属于：

- teachers/classes 缺少子参数；
- CampusTools；
- Schedule Adapter；
- route 判断；
- WidgetID 不存在。

故障已经收敛到 **Widget Template → JSON View 转换阶段**。

## 证据与推断

腾讯云官方：

- `代码创建`（127031）示例使用静态组件树 + 简单变量绑定；
- `ListView`（126995）示例通过静态 `ListViewItem` children 构建列表；
- `配置 Widget 节点`（126979）要求上游输出与 Widget 输入结构/类型严格匹配；
- `ADP-Widget SDK`（129230）说明最终渲染协议是 JSON 驱动。

当前 `小序-课表票据-V2` Template 使用：

- `items.map(...)`
- `actions.map(...)`
- 三元条件 JSX
- 动态数组 children
- 嵌套 OBJECT / ARRAY_OBJECT / ARRAY_STRING Schema

Preview 可以显示并不能证明 Runtime converter 能稳定处理这些高级表达式；V1.2 的真实错误正发生在 `convert widget view`。

因此下一诊断版本不继续修旧 V2，而采用保守兼容子集：

`小序-课表票据-RuntimeSafe-V3`

## RuntimeSafe V3 原则

- Template：零 `.map()`；
- Template：零三元条件；
- Template：零动态 children 数组；
- Schema：仅 `string / integer` 原子字段；
- Schema：零 `OBJECT / ARRAY_OBJECT / ARRAY_STRING`；
- ListView：固定 2 个静态 `ListViewItem`，仅用 `shownCount` 控制显示数量；
- Button：固定 3 个静态 `sys.chat` Action；
- 所有字符串拼接在 Adapter 中完成，Template 只做简单变量绑定。

这是 Runtime compatibility pilot，不改变正式 01 的任何事实逻辑。

## 下一 Gate

1. 导入 `小序-课表票据-RuntimeSafe-V3.widget`；
2. Preview 正常后，拖入禁用的 00 Seed 工作流，无需接线；
3. 导出 00 Seed ZIP；
4. 读取平台分配的真实 RuntimeSafe V3 WidgetID；
5. 自动生成 `01-多维课表查询-WidgetPilot-V1.3`；
6. 真实调试相同输入；
7. V1.3 Widget 节点成功后，再验证 `sys.chat → Agent → 03`。

在 V1.3 Runtime 真实成功前，不允许标记 `ADP_WIDGET_SCHEDULE_RUNTIME_PASS`。
