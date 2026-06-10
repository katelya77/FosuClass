# 教学校历

教学校历按学期隔离存储，文件位置为：

```text
server/storage/terms/<term>/teaching-calendar.json
```

## 数据结构

```json
{
  "schemaVersion": 1,
  "term": "2025-2026-2",
  "semesterText": "2025-2026学年第二学期",
  "source": "admin-maintained",
  "updatedAt": "2026-06-10T00:00:00.000Z",
  "defaultWeekTitle": "正常教学周",
  "weeks": [
    {
      "weekNo": 1,
      "startDate": "2026-03-09",
      "endDate": "2026-03-15",
      "type": "opening",
      "title": "开学教学周",
      "note": ""
    }
  ]
}
```

## Release 发布

Release 构建时，会将校历发布为带版本的副本：

```text
server/storage/public/releases/<releaseVersion>/calendar.json
```

Release manifest 会包含 `calendarUrl`、`calendarHash`、`calendarCount` 和 `calendarUpdatedAt`。

校历缓存键同时包含 `term` 和 `releaseVersion`，因此浏览历史学期时不会误用当前学期备注。

## 缺省展示

如果 planned 学期还没有维护校历，客户端显示 `教学安排待维护`。系统不会为未来学期自动推断节假日或考试周。
