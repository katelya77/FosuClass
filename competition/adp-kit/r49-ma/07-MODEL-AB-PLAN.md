# 07 — Model A/B Plan（模型迁移计划）

## 0. 原则

- 当前运行基线：Thinking=`youtu-intent-pro`、Generation=`youtu-mrc-pro`、Rewrite=`youtu-rewrite`。
  > **2026-08-17 控制台实测更新（§6）**：四 Agent 已均为 `DeepSeek V4 Flash`，协同方式=自由转交；§1-§4 的 A/B 目标按 §6 冻结基线重新校准。
- **youtu-mrc-pro 腾讯计划 2026-08-28 下线**，必须在此之前完成 Generation 迁移评估。
- Multi-Agent 架构先全绿（14 用例门槛），**再**切模型；不做第一天双切。
- 一次只切一个角色，单变量回滚，以回归矩阵为准。

## 1. A/B 计划总览

| 角色 | Baseline | A（推荐） | B（保底） | 说明 |
|---|---|---|---|---|
| Generation | youtu-mrc-pro | DeepSeek V4 Pro | youtu-mrc-pro（保底） | 目标角色；08-28 前必须给出结论 |
| Semantic Planner / Main 判定 | youtu-intent-pro | DeepSeek V4 Flash（快） | DeepSeek V4 Pro | 主协调/路由判定用；与 Generation 分开评 |
| Rewrite | youtu-rewrite | **保留** | — | 不动 |
| Intent（顶层意图） | youtu-intent-pro | 保留 baseline | — | 稳定 baseline，不先动 |

## 2. 切换顺序（每步单变量）

1. 架构基线（youtu-agent 全绿）→ 记录 14 用例基线分数。
2. Generation A/B：A=DeepSeek V4 Pro / B=mrc-pro，**仅切 Generation**。
3. Planner A/B：Main 判定模型 A=DeepSeek V4 Flash / B=V4 Pro，仅切 Main。
4. 若 2/3 均达标 → 组合（V4 Pro Gen + Flash Planner）复测一次。
5. 任一失败 → 回滚该变量到 baseline。

## 3. 通过门槛（严格）

- 14 核心 E2E case（A~H + 13 case 去重）**总体优于或持平** baseline：
  - 不允许：self-risk 追问第二对象、stale escape 失败、Top1 下钻伪造、day_plan 下一天失效、首轮只看周三伪造实体。
- 动态事实字段零编造（工具结果一致）。
- R48 A~G 回归不倒退。

## 4. 时序提醒

- 2026-08-28 `youtu-mrc-pro` 下线 → 建议 **08-26 前**完成 Generation 评估并切换，留 08-27 缓冲与真机复验。
- 真机复验位置：**应用首页正常聊天**（不是单工作流调试）。

## 5. 评测集

- 复用 `r49-ma/tests/fixtures/multi-turn-cases.json`（14 用例）+ 现有 QA/评测集。
- 每个用例记录：expected route / expected state / inherited slots / dropped slots / tools called / expected widget（见 09 矩阵）。

## 6. R49.2 Runtime Frozen Baseline（2026-08-17 实测记录）

> 本节记录「用户已在腾讯控制台实际配置的模型」，作为本轮运行时冻结基线。
> Agent 不替用户修改平台配置；仅记录事实并以此评估 A/B 目标。平台模型名以控制台/导出包实际名称为准。

| 位置 | 平台实测模型 | 备注 |
|---|---|---|
| 主协调 | `DeepSeek V4 Flash`（控制台实测 2026-08-17） | 用户控制台核对；2026-08-12 导出包 workflow.json `ModelParams` 曾为 `u-intent-pro`（Temperature 0 / TopP 0.6）——**该导出为过时快照，以控制台实测为准** |
| 课程空间 / 风险规划 / 校园洞察 | `DeepSeek V4 Flash`（控制台实测 2026-08-17，四 Agent 全部） | 与主协调同模型；未做 Generation 独立切换 |
| 协同方式 | `自由转交`（控制台实测 2026-08-17） | 仓库设计仍以 Main 中心化转交协议为准（03-HANDOFF-POLICY），转交信封/回传协议不变 |
| Rewrite | `youtu-rewrite`（文档基线，未实测到独立节点） | 不参与本轮改动 |

- 冻结内容：模型名、协同方式均为控制台实测事实；本次 R49.2.1 改动**不触碰任何模型配置**。
- A/B 仍按 §1-§4 执行；切模型是用户手动操作，Agent 只提供评估证据。
- 2026-08-28 `youtu-mrc-pro` 下线提醒仍有效；控制台现行基线为 DeepSeek V4 Flash 族，需在控制台确认其替代模型后再评估。
