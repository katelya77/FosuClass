# 后台同步中心运维说明

后台同步中心是运维控制台，不是 VPS 抓取器。100 网采集只能在已连接校园网或 VPN 的本机执行；服务器负责接收 Staging、校验数据、构建不可变 Release、同步 OpenResty 静态目录并切换 runtime pointer。

## 页面分区

同步中心按六段组织：

- 操作台：当前线上版本、最近一次同步、待处理任务、系统状态。
- 待处理：只显示待审核、失败、发布受阻、重复上传、等待确认。
- 当前线上：只显示 runtime pointer 指向的 active Release；Published 不等于 Active。
- 版本管理：Release 与 Staging 分开查看，可对比、健康检查、激活、回滚、归档。
- 上传记录：按 `term + canonicalHash` 分组，重复上传折叠展示。
- 命令手册：中文说明，命令代码保留英文。

## 命令手册名称

- 日常同步：全部动态课表
- 日常同步：班级课表
- 日常同步：教师课表
- 日常同步：教室课表
- 日常同步：课程课表
- 自定义同步范围
- 新学期全量采集
- 上传本地暂存文件
- 恢复中断任务

示例命令：

```powershell
npm run sync:daily -- --term=2025-2026-2
```

## Resource Count Contract

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

技术字段如 uploadId、hash、stagingId 放入技术详情，不作为主视觉。
