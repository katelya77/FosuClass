# 新学期发布手册

## 生命周期

新学期数据从计划到上线的顺序：

`计划中 -> 采集中 -> 已暂存 -> 已生成版本 -> 当前生效 -> 已归档`

后台兼容旧状态字段，但页面展示应拆分为：

- `stagingState`：上传中、校验中、待审核、校验失败、发布受阻、重复上传、已归档。
- `releaseState`：未生成版本、版本构建中、已发布、版本不健康、已归档。
- `runtimeState`：未生效、当前生效、回滚候选。

## 创建或更新学期

必须确认：

- `term`，例如 `2026-2027-1`
- `termStartDate`
- `totalWeeks`
- `weekStart`，通常为 `monday`

不要猜测未来学期的第一教学周日期。`2025-2026-2` 已确认是 `2026-03-09` 开始、周一为周起点、共 19 周。

## 采集

在校园网或 VPN 本机运行：

```powershell
npm run sync:current-term
```

该命令会采集目录、专业、班级、班级课表和资源维度课表，生成 Staging 并上传。默认不激活新学期。

## 审核

发布前检查：

- Resource Count Contract 是否完整。
- sourceMode 是否与线上可比。
- scopeFilters 是否一致。
- 教师、教室、课程目录实体数是否来自真实目录数组。
- 教师名称质量是否通过。
- totalWeeks 是否来自 Registry 或显式参数。
- OpenResty 静态健康检查是否通过。

教师直抓如果退到学院请求并出现班级名、课程名或“临班”，必须判定为数据质量不通过，不能激活。

## 激活

readiness 通过后才可激活：

```powershell
npm run sync:current-term -- --activate
```

激活前后台必须展示旧 current term、新 term、releaseVersion、教学周历数量、来源口径、partial 状态、OpenResty 状态和回滚候选。激活失败时恢复旧 active pointer。

## 禁止事项

- 不用旧学期动态缓存填充新学期。
- 不猜测开学日期和周数。
- 不把 Published 当成 Active。
- 不降低发布阈值绕过 83 教师版本。
- 不提交 `.cache`、`.debug`、`.session`、`staging` 或真实课表 JSON。
