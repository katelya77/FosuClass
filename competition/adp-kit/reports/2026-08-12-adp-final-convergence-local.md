# 校园智序 · 小序 — ADP Final Convergence 本地收敛

日期：2026-08-12

## 结论

- `ADP_LOCAL_CONVERGENCE = PASS`
- `ADP_FINAL_RUNTIME_E2E = PENDING`
- `PUBLIC_READY = FAIL`
- PR #49 保持 open / unmerged；本轮没有 push、GitHub Actions、部署或 ADP 发布。

## 根因与最终结构

真实 ADP 的 optional `INT` 在 Tool Node transport 层可能把空值序列化为 `0`；旧万能 `query_schedule` 因而向 CampusTools 发送 `weekday=0`。最终 01 改为确定性 Scope Router：

- `WEEK` 独立 Tool Node：仅发送 `entityType/entityName/week/periodStart/periodEnd`，结构中完全没有 `weekday` 与 `date`；
- `DAY` 独立 Tool Node：发送 `week/weekday`，完全没有 `date`；
- `DATE` 独立 Tool Node：发送 `date`，完全没有 `week/weekday`；
- 三条路径各自 Verify → Adapter → Display → 原生 Schedule Widget；Action 文案与 payload 保持冻结合同。

CampusTools 的 `querySchedule` 事实逻辑、`competition-demo-v1` 数据与非法 `weekday=0` 校验均未修改。

## 工程化交付

- `adp-transport-contract.json` 成为 01–04 optional transport policy 单一真源；
- `compile_adp_bundle.py` 从 canonical contracts 与真实 V1.1 ADP platform seed 生成 Workflow JSON、五个 XLSX、清单、校验报告与 Bundle；
- `validate-adp-artifact.py` 直接解包最终 ZIP，执行 65 项身份、图、引用、工具、Widget、Schema 与 XLSX 一致性检查；
- 连续两次编译的 Bundle SHA-256 完全一致；
- 生产部署/镜像/平台发布 workflow 已改为仅 `workflow_dispatch`，测试型 `xiaofu-agent-ci` 保持 CI 触发且不部署；
- `npm run public-ready` 覆盖 working tree、ignored files、branches/tags 与 reachable history，并只输出脱敏指纹。

## Fresh 本机验证

- Week Scope：7/7
- Action Contract：7 cases + 13 guards
- CampusTools：34/34
- Golden：33/33，verified=100%
- Final Artifact Gate：65/65
- `npm test --prefix competition/adp-kit`：PASS
- Agent Foundation：42/42
- Agent Regression：197/197
- AI Competition：PASS
- Final Convergence：PASS（含 120 cases）
- 统一 Agent Release Gate：前四组 PASS；P4a 因本机 Docker daemon 不可达、PostgreSQL conformance 为 `UNVERIFIED` 而按规则 FAIL，未冒充完整发布验证。

## 制品与边界

唯一入口：`output/competition-adp/final/CampusFlow-ADP-Import-Bundle.zip`。

当前只安全生成 `01-Schedule-Final.zip`。02/03/04 与 Conflict/Choice/Error 原生卡不伪造 WidgetID；缺失的真实腾讯导出已集中写入 Bundle 内的 `NEEDS_ADP_EXPORT.md`。

`PUBLIC_READY` 因本机 HAR、私钥、敏感环境文件及 reachable history 待审计命中而 FAIL；禁止在完成清理、轮换与历史审计前把仓库改 public。
