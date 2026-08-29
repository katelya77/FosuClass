# 后台同步中心运维说明

后台同步中心是运维控制台，不是 VPS 抓取器。100 网采集只能在已连接校园网或 VPN 的本机执行；服务器负责接收 Staging、校验数据、构建不可变 Release、同步 OpenResty 静态目录并切换 runtime pointer。

## 页面分区

同步中心按六段组织：

- 操作台：当前线上版本、最近一次同步、待处理任务、系统状态。
- 待处理：只显示待审核、失败、发布受阻、重复上传、等待确认。
- 当前线上：只显示 runtime pointer 指向的 active Release；Published 不等于 Active。
- 版本管理：Release 与 Staging 分开查看，可对比、健康检查、激活、回滚、归档。
- 发布链状态：显示最近一次本机 Publisher receipt，按钮只生成本机命令，不伪装服务器能抓校园网。
- 上传记录：按 `term + canonicalHash` 分组，重复上传折叠展示，支持筛选、分页、单条删除、批量清理和重建索引。
- 命令手册：中文说明，命令代码保留英文，只推荐 `sync:publish`。

## 命令手册名称

- 生成本机一键同步命令
- 查看本机 Publisher 状态
- 重试 CloudBase 镜像
- 导出人工上传包
- 新学期全量采集
- 恢复中断任务

示例命令：

```powershell
npm run sync:publish
```

## 统一同步入口

主入口固定为：

```powershell
npm run sync:publish
```

该入口自动串联 session 检查、校园网采集、规范化、Staging/Release Pack 生成、gzip/chunk 上传、服务端校验、Release 发布、OpenResty 静态同步、CloudBase 镜像和状态回报。100 网 session 过期时必须快速失败，并提示：

```powershell
session 已过期，请执行 npm run sync:login 后重试
```

常用模式：

```powershell
npm run sync:publish -- --incremental --term=2026-2027-1 --grade=2026 --concurrency=8 --resume
npm run sync:publish -- --full --term=2026-2027-1 --grade=2026
```

- `--incremental` 用于开学初频繁调整，只拉取目录和疑似变化课表，并复用断点进度。
- `--full` 用于新学期首次采集或源站目录大变更，会忽略旧进度并重新校验负缓存。
- `--resume` 用于中断后继续，避免无意义重复抓取。
- `--grade=2026` 只限定采集范围，不硬编码 26 级；源站未发现 26 级课表时应提示“当前源站未发现 2026 级课表”，不作为发布失败。
- `--concurrency=8` 为受控并发，仍受限速、超时和重试保护。

每次同步回执必须记录阶段耗时：session 检查、目录抓取、课表抓取、规范化、hash、gzip、上传、校验、release、OpenResty、CloudBase。后台只展示摘要；完整 hash、manifest URL、uploadId、stagingId、target dir 只放在技术详情中。

## Release 与镜像约束

- Release Pack 是不可变版本；active pointer 切换必须保持原子化。
- OpenResty 可先完成并作为线上 active 数据源。
- CloudBase 是镜像状态，可单独失败和重试，但不能破坏 active release 的正确性。
- Relay 只能上传候选 Staging JSON，不能登录后台、不能发布、不能查看管理员配置。

## 安全清理策略

后台“执行安全清理”默认应先预览。删除前必须确认目标不被 active pointer、manifest 或 history index 引用。

- active release 永久保留。
- 每个学期最新 published 永久保留。
- duplicate staging 超 7 天可清理。
- failed 超 7 天可清理。
- incomplete 超 24 小时可清理。
- superseded 原始大文件超 30 天可清理。
- archived release 按最近 N 个/最近 N 天保留，删除前必须再次检查引用关系。

## 资源计数契约

后台和上传摘要统一读取 v2 计数契约：

- `class.scheduleDocuments`：班级课表文档数。
- `class.administrativeClasses`：行政班数量。
- `class.aggregateSchedules`：专业聚合课表数量。
- `teacher.directoryEntities`：教师目录实体数。
- `teacher.scheduleDocuments`：教师课表文档数。
- `teacher.courseEvents`：教师课程事件数。
- `classroom.directoryEntities`：教室目录实体数。
- `classroom.scheduleDocuments`：教室课表文档数。
- `classroom.courseEvents`：教室课程事件数。
- `course.directoryEntities`：课程目录实体数。
- `course.scheduleDocuments`：课程课表文档数。
- `course.courseEvents`：课程排课事件数。

目录实体数不得从课表文档数 fallback。缺少目录数组时显示“未统计”，旧 Release 只在现场派生 v2 视图并标记 `derivedFromLegacy=true`，不改写不可变 Release 文件。

## 发布门禁

Staging 与线上 active 只在相同契约版本、相同学期、相同过滤范围、相同资源维度、相同 `sourceMode` 下比较。以下情况阻止普通发布：

- `COUNT_CONTRACT_MISMATCH`
- `SOURCE_MODE_MISMATCH`
- `SCOPE_FILTER_MISMATCH`
- `COVERAGE_INVALID`
- `ENTITY_NAME_CONTAMINATED`

教师 83 版本必须继续阻止发布。后台应显示教师课表 1007 份到 83 份的下降、历史派生口径与 100 网直接抓取的来源不一致，以及教师名称疑似被班级名或课程名污染。

## 上传记录语义

- 只有 canonicalHash 与 active 一致时显示“与当前线上数据一致”。
- 只是与另一个 Staging 一致时显示“重复上传”。
- `stagingState` 描述上传和校验状态。
- `releaseState` 描述版本包状态。
- `runtimeState` 描述是否当前生效。
- 删除上传记录、删除 Staging 文件、删除 Release 是三类不同操作，后台按钮会明确区分。
- Active、正在上传、正在验证、正在发布、当前 staging-latest 唯一来源禁止删除。
- 自动清理策略：duplicate > 7 天、failed > 7 天、incomplete > 24 小时、superseded 原始大文件 > 30 天；Active 与每学期最新 Published 永久保留。

技术字段如 uploadId、hash、stagingId 放入技术详情，不作为主视觉。
