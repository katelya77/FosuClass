# 校园智序·小序｜最终架构

## 任务链

```text
用户自然语言任务
        │
        ▼
Main：理解目标、选择领域、组织结果
        │
        ├───────────────┬───────────────┐
        ▼               ▼               ▼
Schedule            Risk            Insight
课表・教室・协同      冲突・赶场・调课    负载・排名・下钻
        └───────────────┴───────────────┘
                        │
                        ▼
              13 个 CampusTools
              确定性计算动态校园事实
                        │
                        ▼
                  领域 Agent
                        │
                        ▼
Main：统一结果卡 + Verified + Evidence
                        │
                        ▼
                  人作最终判断
```

唯一协作路径是 `Main → Child → Main`。Main 的 CampusTools 直接绑定数为 0；三个 Child 之间不存在转发关系。

## 权威数量

| 对象 | 冻结值 | 说明 |
|---|---:|---|
| Agent | 4 | Main + Schedule + Risk + Insight |
| CampusTools | 13 | 唯一 operation 数量 |
| bindings | 14 | `campus_academic_context` 被 Schedule 与 Risk 共享 |
| Main direct bindings | 0 | 主协调不直接计算动态校园事实 |

## 事实与展示

```text
competition-demo-v3
        ↓ schema / reference validation
CampusTools deterministic computation
        ↓ canonical envelope
Golden Result / Verified / Evidence
        ↓ shared projection
Widget + natural-language answer
```

生成模型不能成为课表事实源。Widget 与文字必须共享同一工具结果；无结果、歧义或数据损坏时 fail-closed。

## 四个 Hero Result

- 风险发现：教师025，第1–4周，每周14课次、冲突0、跨校区赶场4、间隔20分钟。
- 协同规划：教师005/006/014，第1周周四1–4节，63间可用教室收束到7间容量达标候选，推荐 A1-201。
- 模拟调课：周一5–6节模拟到周四7–8节，`feasible=true` 与连续4节提醒同时成立，`mutatedData=false`。
- 全局洞察：第1–4周负载 Top1 为教师025，56课次、112课时；下钻后重新核验风险。

## 安全边界

- 交付数据完全匿名；不包含真实学校、院系、个人身份或真实部署信息。
- 程序包不包含凭据、真实地址、Git 历史、依赖目录、无关客户端源码或真实用户数据。
- 调课场景只读；任何高风险写入仍需人工确认、权限、审计与回滚。
