# Handoff Probe Matrix

本矩阵区分 Repo 可证明契约与腾讯 ADP Console 实际轨迹。Agent 标签只表示当前可见消息归属，不能单独证明 Main 是否执行。只有 Preview 调用轨迹或平台审计记录能把 `MANUAL_REQUIRED` 改为 live pass。

| Probe | 输入入口 | 完整目标 | 期望轨迹 | Repo 证据 | Console 证据 | 状态 |
|---|---|---|---|---|---|---|
| H1 | 键盘新输入 | 单域课表 | new turn → Main → Schedule；纯单域可完成 | Main-start + simple-domain contract | 查看 Preview 调用轨迹 | MANUAL_REQUIRED |
| H2 | Widget `sys.chat` | 看下一个教学周 | new turn → Main → Schedule；必须 fresh 查询 | Main-start + action contract | 点击按钮并查看调用轨迹 | MANUAL_REQUIRED |
| H3 | 键盘续问 | 看下一周 | 与 H2 等价：Main → Schedule | keyboard continuation contract | 与 H2 并排比较 | MANUAL_REQUIRED |
| H4 | 键盘新输入 | 课表并检查风险 | Main → Schedule → Main → Risk → Main | residual-goal + Mission tests | 轨迹包含两次回到 Main | MANUAL_REQUIRED |
| H5 | 键盘新输入 | 排名对象再看课表与风险 | Main → Insight → Main → Schedule → Main → Risk → Main | three-domain residual-goal contract | 轨迹依次覆盖三个领域 | MANUAL_REQUIRED |
| H6 | 键盘新输入 | 共同空闲并推荐空间 | Main → Schedule；共同空闲和空间方案均完成后收口 | collaboration completion contract | 不在共同空闲阶段提前结束 | MANUAL_REQUIRED |
| H7 | Child 阶段结果 | 尚有跨域目标 | Child 必须 transfer Main，不直接对用户收口 | Child-return contract | 检查 transfer event，而非消息标签 | MANUAL_REQUIRED |
| H8 | 可见消息标签 | 任一跨域任务 | 标签不能作为路由结论 | 本矩阵明确证据边界 | 对照调用轨迹判断 Main 隐藏或跳过 | MANUAL_REQUIRED |

## 最小人工步骤

1. 新建 Preview 会话，键盘输入“看下一周”，展开调用轨迹，记录起点与 Schedule 调用。
2. 在同一会话点击 Widget 的“看下一个教学周”，再次展开轨迹；确认它作为新 user input 从 Main 开始。
3. 分别执行课表→风险、洞察→课表→风险、共同空闲→空间三个目标，记录每个 Child 后是否出现返回 Main。
4. Tool Result Direct Output 保持 OFF；否则工具会绕过 Main，探针无效。
5. 不以最终消息的 Agent 标签替代调用轨迹证据，不创建 Release，不发布应用。
