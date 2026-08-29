# Legacy Workflows 结论（R47 工作流）

> CSF Phase 7：评估 R47 工作流（`competition/adp-kit/workflows/`）是否可以归档删除。

## 现状盘点
- `workflows/` 含：5 个工作流定义（01-多维课表查询、02-空教室规划、03-课程冲突比较、
  04-今日校园计划、05-校园教学态势）、`role-instruction.txt`、
  `application-config.json`、`workflow-specs.json`、`workflow-definitions.js`、`generate-workflows.js`。
- **仍然被引用**（当前不可删除的证据）：
  - `submission-package/workflows/application-config.json`：`roleInstruction`
    指向 `workflows/role-instruction.txt` 为权威源；
  - `evaluation/evaluation-dataset.json`：全部 60+ 用例的 `workflow` 字段引用
    01–04 工作流名；
  - `widget/native/real-adp-export-catalog.json`：02/03/04 的导出 zip 关联工作流 ID；
  - `widget/native/runtime-e2e-cases.json`：01–04 的 `-Final` 工作流名；
  - `widget/native/action-contract.json`：01 的三个工作流变体 ID；
  - `widget/native/campus-overview-v1/contract.json`：动作按钮映射到工作流 01/02/03。

## 结论：保留 active + legacy-pending，删除决策推迟
- 工作流仍是应用配置与评测数据的引用目标（角色指令权威源、评测数据集、导出目录），
  直接删除会破坏 `npm run generate` 与既有评测链路。
- 但 R47 工作流不是 R51 时代的事实来源：R51 事实只来自 CampusTools 确定性工具。
- 处置：保持现状（active 使用），标记 **legacy-pending**（本文档），删除决策推迟到
  应用配置与评测数据集完成迁移之后。

## 回滚与恢复证据
- 回滚：本目录任何文件均可从 git 历史原样恢复（本仓库版本控制完整）。
- 恢复证据：`reports/generated-assets-manifest.json` 登记了全部工作流资产路径
  （10 项），删除前必须先更新该清单与 application-config 引用。
- 本次未删除任何文件；仅新增本文档作为演进证据。

## 未来迁移条件（满足后才可归档）
1. `submission-package/workflows/application-config.json` 不再指向
   `workflows/role-instruction.txt`；
2. `evaluation/evaluation-dataset.json` 的 workflow 字段完成到能力/工具语义的迁移；
3. `real-adp-export-catalog.json` / `runtime-e2e-cases.json` / `action-contract.json` /
   `campus-overview-v1/contract.json` 不再引用工作流 ID 或名称；
4. `npm run generate` 与 `npm run test` 全链路在移除后仍通过（保留 CI 证据）。