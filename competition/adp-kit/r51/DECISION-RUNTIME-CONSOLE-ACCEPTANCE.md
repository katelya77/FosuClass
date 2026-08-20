# Decision Runtime Console Acceptance Matrix

目标：在腾讯 ADP 预览环境验证真实调用链 `user turn → Main/Child → existing CampusTool handler → verified facts → Decision Core → authoritative decision → existing result-card`。全程使用现有受保护鉴权配置；不得记录或粘贴凭据，不发布 Agent。

## 自动化锚点

`r49-ma/tests/test-decision-runtime-activation.js` 对同一 live handler facade 覆盖 D1–D9；`cloudfunctions/test-http-function.js` 对实际 Cloud Function 部署镜像做 HTTP smoke。线上函数还须以只读调用确认 response 顶层存在 `decision`，不能用 repo 模块存在代替。

## Console Matrix

| ID | 预览输入目标 | 预期 |
|---|---|---|
| D1 | 查询某教师第 1 周课表 | 直接课表事实；不显示 Decision 推荐卡，不强行进入决策层。 |
| D2 | 查询第 1 周周三第 5–6 节校区A可用教室，并偏好更大容量 | `preferred` 为 verified items 中容量最大的可行教室；重复运行稳定。 |
| D3 | 同一空间查询，hard capacity=60 | 容量不足者不进入推荐或备选；hard 不自动放宽。 |
| D4 | 使用高于所有教室的 hard capacity | `no_feasible_candidate`，preferred=null，alternatives=[]，不伪造候选。 |
| D5 | 对可行目标时段做调课模拟 | `recommended`；理由只引用 verified feasible 系统约束。 |
| D6 | 对存在冲突的目标时段做调课模拟 | 工具 summary.feasible=false，Decision 必为 `no_feasible_candidate`。 |
| D7 | 对同一群体方案与相同 preference 连续运行两次 | preferred / alternatives / receipt 完全稳定。 |
| D8 | 触发需要写入或提交的后续动作 | `needs_user_choice`；仅显示“确认后继续”的 `sys.chat`，不自动执行。 |
| D9 | 查看有推荐、理由、备选的 Decision 结果 | 复用“小序-校园智序结果卡”；推荐/理由/备选正常；1–3 个 action，全部 `sys.chat` 且 payload 只有自然语言 `query`。 |

## Fail-closed 检查

- 公开结果不得显示 resultRef、queryId、dataHash、fingerprint、internal evaluation、Agent/Tool 名称。
- authoritative decision 存在时，Main 与 Child 不得重新排序或补写无证据理由。
- `needs_more_facts` 继续 Mission；`needs_user_choice` 才澄清；无可行候选不建议“自动放宽” hard constraint。
- 工具总数保持 13，bindings 保持 14，Main CampusTools 保持 0。

## ADP 手工动作（仅刷新，不发布）

1. 在现有 CampusTools 插件中用 `r49-ma/tools/openapi/campus-agent-tools.adp-import.json` 刷新 API schema；确认仍为 13 个 operation，不新建重复插件或工具。
2. 保留现有 server URL 与鉴权配置；不要把鉴权值复制进 prompt、日志或截图。
3. 将 `r51/prompts/main-orchestrator.r51.md` 与三个 Child prompt 的最小规则同步到对应 Agent；bindings 不变，Main 仍为 0 CampusTools。
4. 继续绑定现有 Widget“小序-校园智序结果卡”，保持 `sys.chat`；不创建 Decision 专用 Widget。
5. 在预览/调试而非发布环境逐项执行 D1–D9，保存脱敏结果；本轮不点击发布。
