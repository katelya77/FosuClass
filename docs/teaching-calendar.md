# Teaching Calendar

Teaching calendar data is term-scoped and stored at:

```text
server/storage/terms/<term>/teaching-calendar.json
```

Schema:

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

Release builds publish a versioned copy to:

```text
server/storage/public/releases/<releaseVersion>/calendar.json
```

The release manifest includes `calendarUrl`, `calendarHash`, `calendarCount`, and `calendarUpdatedAt`. Calendar cache keys include both `term` and `releaseVersion`, so historical browsing cannot reuse the active term notes.

If a planned term has no maintained calendar, the client shows `教学安排待维护`. It does not infer holidays or exam weeks for future terms.
