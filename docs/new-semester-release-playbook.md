# 新学期课表发布流程

## 目标

新学期切换只改统一 `termConfig`，避免首页、今日页、周历和 AI 上下文分别硬编码学期开始日期。

## termConfig 字段

```json
{
  "term": "2026-2027-1",
  "semesterText": "2026-2027学年第一学期",
  "termStartDate": "2026-09-07",
  "totalWeeks": 18,
  "weekStart": "monday",
  "updatedAt": "2026-09-01T00:00:00.000Z",
  "source": "release-manifest",
  "releaseVersion": "2026-09-01T00-00-00"
}
```

## 来源优先级

1. activeRelease.manifest.termConfig
2. appConfig.data.termConfig
3. appConfig.data.currentSemester + dataVersion.termStartDate
4. 小程序 fallback constants

## 操作清单

1. 设置新学期 `term`、`semesterText`、`termStartDate`、`totalWeeks`。
2. 在校园网/VPN 环境运行本地采集，生成 staging 数据。
3. 上传 staging，检查班级、教师、教室、课程、空教室索引 counts。
4. 生成 Release Pack，确认 manifest 含 `termConfig`。
5. 后台发布 release。
6. 小程序刷新 active release，确认首页当前周、今日页、周历和 AI context 的 `termStartDate` 一致。
7. 跑验收：

```bash
npm run test:term-config-runtime
npm run test:ai-term-config-context
npm run test:ai-competition
```

## AI 约束

AI 今日课程使用客户端 context 中的 `currentTeachingWeek`、`todayTeachingInfo.weekNo` 和 `termStartDate` 计算周次，不再内置某个固定学期。课程是否激活仍由共享周次规则判断。
