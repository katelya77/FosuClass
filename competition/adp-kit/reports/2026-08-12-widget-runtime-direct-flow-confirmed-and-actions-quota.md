# 2026-08-12 Widget Runtime：直接向后流转已确认 + GitHub Actions 额度说明

## ADP 最新实机事实

用户确认：Schedule Widget 节点从一开始就是“直接向后流转”，V1.3 RuntimeSafe 实机仍报相同错误：

```text
460101-工作流运行异常: 获取Widget内容失败:
convert widget view failed: http request failed:
type:framework, code:122,
msg:client codec Unmarshal: rpc.toJsonViewResponse.Data:
ReadMapCB: expect { or n, but found ",
...
operator to search for '__jsx' in undefined
```

因此此前“WIDGET_ACTION_NONE / 下发方式未配置是根因”的假设被用户实机事实否证。禁止继续沿该假设生成新 Pilot。

同时，用户重新导出的 `小序-课表票据-V2(1).widget` 已解析确认：WidgetID 保持 `23fbc659efe3482fab588d754e4420a4`，RuntimeSafe V3 已真实保存，Schema 仅 STRING/INT，零 map/复杂对象，validity 全部 valid。

## 当前架构判断

Schedule Runtime 已连续多版失败，且复杂 Schema、ARRAY_STRING 子槽位、RuntimeSafe Template、下发方式均已逐步排除。按照系统化调试原则，停止继续叠加 V1.4/V1.5 补丁，改为建立“平台原生最小 Runtime 基线”。

下一 Gate 必须使用腾讯云 ADP 自带 Widget 模板（不是自制/导入 .widget），建立最小工作流：

开始 → 平台模板 Widget（固定手工输入，直接向后流转） → 结束

不允许加入 CampusTools、Adapter、ListView、Button、sys.chat、动态引用。

结果解释：
- 平台模板最小 Widget PASS：问题位于自定义 Widget / 导入 Widget / Runtime converter 兼容链；再做代码创建官方天气示例的最小复刻对照。
- 平台模板最小 Widget FAIL 且同类 460101：优先判断当前赛事空间/平台 Widget Runtime 服务异常，保存 request_id/trace_id，转腾讯云工单；比赛主线暂时保留 Markdown 输出，不让 Widget 阻塞 32 QA / 80 eval / 安全红队等研发。

## GitHub Actions

用户截图显示个人账户 Actions included minutes 已达到 `3000 / 3000`，Actions storage 约 `0.5 / 2 GB`；页面显示 billable usage $0，consumed usage $18.64 被 discounts 抵消。

该额度问题只影响 GitHub-hosted runner 在私有仓库中的 CI，和腾讯云 ADP 的 Widget Runtime 460101 没有调用链关系，不可能造成 `convert widget view failed`。

应对：
- 短期：本地 Codex/Kimi 执行测试和构建，不依赖 Actions；PR 保持 open。
- 可选：为 Actions 设置小额月度预算/付款方式以恢复超额 hosted-runner 使用；或使用 self-hosted runner（GitHub Actions 自托管 runner 不计 hosted-runner 分钟）。
- 下一 billing cycle included minutes 会重置。

## 状态

- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_SCHEDULE_RUNTIME_DEBUGGING`
- `ADP_WIDGET_RUNTIME_ARCHITECTURE_RECHECK`
- `ADP_WIDGET_MINIMAL_PLATFORM_BASELINE_PENDING`
- `GITHUB_ACTIONS_INCLUDED_MINUTES_EXHAUSTED`
- PR #49 保持 open / unmerged / 未发布。
