/* 由 generate-samples.js 生成，请勿手工编辑 */
window.R48V3Samples = {
  "schedule-day": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "schedule",
    "success": true,
    "queryId": "q-r48-schedule-day",
    "dataVersion": "competition-demo-v1",
    "title": "教师003",
    "subtitle": "教师",
    "timeText": "第1周 · 周三 · 2026-09-02",
    "statusText": "已核验",
    "filters": [],
    "summary": {
      "totalCount": 2,
      "shownCount": 2,
      "hiddenCount": 0,
      "entityType": "teacher",
      "entityTypeLabel": "教师",
      "entityName": "教师003",
      "campusCount": 2
    },
    "items": [
      {
        "lessonId": "les-101",
        "courseName": "高等数学A",
        "periodText": "第1-2节",
        "startTime": "08:00",
        "endTime": "09:40",
        "date": "2026-09-02",
        "weekday": 3,
        "weekdayName": "周三",
        "campusName": "校区A",
        "building": "教学楼A1",
        "roomName": "A1-104",
        "teachers": [
          "教师003"
        ],
        "classes": [
          "2025级A班"
        ]
      },
      {
        "lessonId": "les-102",
        "courseName": "数据结构",
        "periodText": "第5-6节",
        "startTime": "14:00",
        "endTime": "15:40",
        "date": "2026-09-02",
        "weekday": 3,
        "weekdayName": "周三",
        "campusName": "校区B",
        "building": "实验楼B2",
        "roomName": "B2-301",
        "teachers": [
          "教师003"
        ],
        "classes": [
          "2025级A班",
          "2025级B班"
        ]
      }
    ],
    "rushWarnings": [],
    "actions": [
      {
        "id": "schedule-week",
        "type": "sys.chat",
        "label": "查看整周",
        "message": "查询教师003第1周的课表",
        "intentHint": "schedule_week",
        "entityType": "teacher",
        "entityName": "教师003",
        "week": 1,
        "weekday": 3
      },
      {
        "id": "schedule-choose-day",
        "type": "sys.chat",
        "label": "换一天",
        "message": "【小序操作:选择课表日期】教师003|第1周",
        "intentHint": "schedule_choose_day",
        "entityType": "teacher",
        "entityName": "教师003",
        "week": 1,
        "weekday": 3
      },
      {
        "id": "schedule-risk",
        "type": "sys.chat",
        "label": "检查风险",
        "message": "检查教师003第1周周三是否存在时间冲突或跨校区赶场",
        "intentHint": "schedule_risk_check",
        "entityType": "teacher",
        "entityName": "教师003",
        "week": 1,
        "weekday": 3
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null,
    "viewMode": "day",
    "activeWeekday": 3,
    "days": [
      {
        "weekday": 3,
        "weekdayName": "周三",
        "date": "2026-09-02",
        "count": 2
      }
    ],
    "footerText": "数据源：校园课表工具 · competition-demo-v1"
  },
  "schedule-week": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "schedule",
    "success": true,
    "queryId": "q-r48-schedule-week",
    "dataVersion": "competition-demo-v1",
    "title": "教师009",
    "subtitle": "教师",
    "timeText": "第1周 · 2026-08-31",
    "statusText": "已核验",
    "filters": [],
    "summary": {
      "totalCount": 7,
      "shownCount": 7,
      "hiddenCount": 0,
      "entityType": "teacher",
      "entityTypeLabel": "教师",
      "entityName": "教师009",
      "campusCount": 2
    },
    "items": [
      {
        "lessonId": "les-201",
        "courseName": "操作系统",
        "periodText": "第1-2节",
        "startTime": "08:00",
        "endTime": "09:40",
        "date": "2026-08-31",
        "weekday": 1,
        "weekdayName": "周一",
        "campusName": "校区A",
        "building": "教学楼A1",
        "roomName": "A1-201",
        "teachers": [
          "教师009"
        ],
        "classes": [
          "2024级C班"
        ]
      },
      {
        "lessonId": "les-202",
        "courseName": "操作系统",
        "periodText": "第3-4节",
        "startTime": "10:00",
        "endTime": "11:40",
        "date": "2026-08-31",
        "weekday": 1,
        "weekdayName": "周一",
        "campusName": "校区A",
        "building": "教学楼A1",
        "roomName": "A1-201",
        "teachers": [
          "教师009"
        ],
        "classes": [
          "2024级D班"
        ]
      },
      {
        "lessonId": "les-203",
        "courseName": "编译原理",
        "periodText": "第5-6节",
        "startTime": "14:00",
        "endTime": "15:40",
        "date": "2026-09-01",
        "weekday": 2,
        "weekdayName": "周二",
        "campusName": "校区B",
        "building": "教学楼B1",
        "roomName": "B1-102",
        "teachers": [
          "教师009"
        ],
        "classes": [
          "2024级C班"
        ]
      },
      {
        "lessonId": "les-204",
        "courseName": "操作系统实验",
        "periodText": "第7-8节",
        "startTime": "16:00",
        "endTime": "17:40",
        "date": "2026-09-02",
        "weekday": 3,
        "weekdayName": "周三",
        "campusName": "校区B",
        "building": "实验楼B2",
        "roomName": "B2-204",
        "teachers": [
          "教师009"
        ],
        "classes": [
          "2024级C班"
        ]
      },
      {
        "lessonId": "les-205",
        "courseName": "编译原理",
        "periodText": "第1-2节",
        "startTime": "08:00",
        "endTime": "09:40",
        "date": "2026-09-03",
        "weekday": 4,
        "weekdayName": "周四",
        "campusName": "校区A",
        "building": "教学楼A2",
        "roomName": "A2-305",
        "teachers": [
          "教师009"
        ],
        "classes": [
          "2024级D班"
        ]
      },
      {
        "lessonId": "les-206",
        "courseName": "操作系统",
        "periodText": "第5-6节",
        "startTime": "14:00",
        "endTime": "15:40",
        "date": "2026-09-04",
        "weekday": 5,
        "weekdayName": "周五",
        "campusName": "校区A",
        "building": "教学楼A1",
        "roomName": "A1-201",
        "teachers": [
          "教师009"
        ],
        "classes": [
          "2024级C班"
        ]
      },
      {
        "lessonId": "les-207",
        "courseName": "专业导论",
        "periodText": "第9-10节",
        "startTime": "19:00",
        "endTime": "20:40",
        "date": "2026-09-04",
        "weekday": 5,
        "weekdayName": "周五",
        "campusName": "校区A",
        "building": "教学楼A1",
        "roomName": "A1-108",
        "teachers": [
          "教师009"
        ],
        "classes": [
          "2025级A班"
        ]
      }
    ],
    "rushWarnings": [],
    "actions": [
      {
        "id": "schedule-next-week",
        "type": "sys.chat",
        "label": "下一周",
        "message": "查询教师009第2周的课表",
        "intentHint": "schedule_week",
        "entityType": "teacher",
        "entityName": "教师009",
        "week": 2
      },
      {
        "id": "schedule-week-risk",
        "type": "sys.chat",
        "label": "检查本周风险",
        "message": "检查教师009第1周是否存在时间冲突或跨校区赶场",
        "intentHint": "schedule_risk_check",
        "entityType": "teacher",
        "entityName": "教师009",
        "week": 1
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null,
    "viewMode": "week",
    "activeWeekday": 1,
    "days": [
      {
        "weekday": 1,
        "weekdayName": "周一",
        "date": "2026-08-31",
        "count": 2
      },
      {
        "weekday": 2,
        "weekdayName": "周二",
        "date": "2026-09-01",
        "count": 1
      },
      {
        "weekday": 3,
        "weekdayName": "周三",
        "date": "2026-09-02",
        "count": 1
      },
      {
        "weekday": 4,
        "weekdayName": "周四",
        "date": "2026-09-03",
        "count": 1
      },
      {
        "weekday": 5,
        "weekdayName": "周五",
        "date": "2026-09-04",
        "count": 2
      },
      {
        "weekday": 6,
        "weekdayName": "周六",
        "date": "",
        "count": 0
      },
      {
        "weekday": 7,
        "weekdayName": "周日",
        "date": "",
        "count": 0
      }
    ],
    "footerText": "数据源：校园课表工具 · competition-demo-v1"
  },
  "schedule-date": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "schedule",
    "success": true,
    "queryId": "q-r48-schedule-date",
    "dataVersion": "competition-demo-v1",
    "title": "A1-101",
    "subtitle": "教室",
    "timeText": "2026-09-03",
    "statusText": "已核验",
    "filters": [],
    "summary": {
      "totalCount": 3,
      "shownCount": 3,
      "hiddenCount": 0,
      "entityType": "room",
      "entityTypeLabel": "教室",
      "entityName": "A1-101",
      "campusCount": 1
    },
    "items": [
      {
        "lessonId": "les-301",
        "courseName": "大学物理B",
        "periodText": "第1-2节",
        "startTime": "08:00",
        "endTime": "09:40",
        "date": "2026-09-03",
        "weekday": 4,
        "weekdayName": "周四",
        "campusName": "校区A",
        "building": "教学楼A1",
        "roomName": "A1-101",
        "teachers": [
          "教师004"
        ],
        "classes": [
          "2025级B班"
        ]
      },
      {
        "lessonId": "les-302",
        "courseName": "大学物理B",
        "periodText": "第3-4节",
        "startTime": "10:00",
        "endTime": "11:40",
        "date": "2026-09-03",
        "weekday": 4,
        "weekdayName": "周四",
        "campusName": "校区A",
        "building": "教学楼A1",
        "roomName": "A1-101",
        "teachers": [
          "教师004"
        ],
        "classes": [
          "2025级C班"
        ]
      },
      {
        "lessonId": "les-303",
        "courseName": "思政通识",
        "periodText": "第7-8节",
        "startTime": "16:00",
        "endTime": "17:40",
        "date": "2026-09-03",
        "weekday": 4,
        "weekdayName": "周四",
        "campusName": "校区A",
        "building": "教学楼A1",
        "roomName": "A1-101",
        "teachers": [
          "教师007"
        ],
        "classes": [
          "2025级A班"
        ]
      }
    ],
    "rushWarnings": [],
    "actions": [
      {
        "id": "schedule-week",
        "type": "sys.chat",
        "label": "查看整周",
        "message": "查看A1-101的整周课表",
        "intentHint": "schedule_week",
        "entityType": "room",
        "entityName": "A1-101",
        "date": "2026-09-03"
      },
      {
        "id": "schedule-choose-day",
        "type": "sys.chat",
        "label": "换一天",
        "message": "换日期查看A1-101的课表",
        "intentHint": "schedule_choose_day",
        "entityType": "room",
        "entityName": "A1-101",
        "date": "2026-09-03"
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null,
    "viewMode": "date",
    "activeWeekday": 4,
    "days": [
      {
        "weekday": 4,
        "weekdayName": "周四",
        "date": "2026-09-03",
        "count": 3
      }
    ],
    "footerText": "数据源：校园课表工具 · competition-demo-v1"
  },
  "classroom-normal": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "classroom",
    "success": true,
    "queryId": "q-r48-classroom",
    "dataVersion": "competition-demo-v1",
    "title": "校区A · 空教室",
    "subtitle": "可用空间查询",
    "timeText": "2026-09-03 · 第7-8节",
    "statusText": "已核验",
    "filters": [
      {
        "id": "campus",
        "label": "校区A",
        "value": "校区A"
      },
      {
        "id": "date",
        "label": "2026-09-03",
        "value": "2026-09-03"
      },
      {
        "id": "period",
        "label": "第7-8节",
        "value": "第7-8节"
      },
      {
        "id": "capacity",
        "label": "≥60人",
        "value": 60
      }
    ],
    "summary": {
      "totalCount": 4,
      "shownCount": 4,
      "hiddenCount": 0,
      "empty": false
    },
    "items": [
      {
        "roomName": "A1-103",
        "campusName": "校区A",
        "building": "教学楼A1",
        "capacity": 80,
        "roomType": "多媒体",
        "periodText": "第7-8节",
        "date": "2026-09-03"
      },
      {
        "roomName": "A1-106",
        "campusName": "校区A",
        "building": "教学楼A1",
        "capacity": 80,
        "roomType": "多媒体",
        "periodText": "第7-8节",
        "date": "2026-09-03"
      },
      {
        "roomName": "A2-201",
        "campusName": "校区A",
        "building": "教学楼A2",
        "capacity": 60,
        "roomType": "普通",
        "periodText": "第7-8节",
        "date": "2026-09-03"
      },
      {
        "roomName": "A2-204",
        "campusName": "校区A",
        "building": "教学楼A2",
        "capacity": 60,
        "roomType": "普通",
        "periodText": "第7-8节",
        "date": "2026-09-03"
      }
    ],
    "rushWarnings": [],
    "actions": [
      {
        "id": "classroom-change-campus",
        "type": "sys.chat",
        "label": "换校区",
        "message": "换成校区B，日期保持2026-09-03，节次保持第7-8节，其他条件不变",
        "intentHint": "classroom_find"
      },
      {
        "id": "classroom-change-date",
        "type": "sys.chat",
        "label": "换日期",
        "message": "改日期再查空教室（当前2026-09-03），其他条件不变",
        "intentHint": "classroom_find"
      },
      {
        "id": "classroom-relax-capacity",
        "type": "sys.chat",
        "label": "放宽容量",
        "message": "取消容量限制，日期保持2026-09-03，节次保持第7-8节，其他条件不变",
        "intentHint": "classroom_find"
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null,
    "footerText": "数据源：空教室工具 · competition-demo-v1"
  },
  "classroom-empty": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "classroom",
    "success": true,
    "queryId": "q-r48-classroom-empty",
    "dataVersion": "competition-demo-v1",
    "title": "校区B · 空教室",
    "subtitle": "可用空间查询",
    "timeText": "2026-09-03 · 第3-4节",
    "statusText": "已核验",
    "filters": [
      {
        "id": "campus",
        "label": "校区B",
        "value": "校区B"
      },
      {
        "id": "date",
        "label": "2026-09-03",
        "value": "2026-09-03"
      },
      {
        "id": "period",
        "label": "第3-4节",
        "value": "第3-4节"
      },
      {
        "id": "building",
        "label": "实验楼B1",
        "value": "实验楼B1"
      },
      {
        "id": "capacity",
        "label": "≥120人",
        "value": 120
      }
    ],
    "summary": {
      "totalCount": 0,
      "shownCount": 0,
      "hiddenCount": 0,
      "empty": true
    },
    "items": [],
    "rushWarnings": [],
    "actions": [
      {
        "id": "classroom-relax-capacity",
        "type": "sys.chat",
        "label": "放宽容量",
        "message": "取消容量限制，日期保持2026-09-03，节次保持第3-4节，其他条件不变",
        "intentHint": "classroom_find"
      },
      {
        "id": "classroom-remove-building",
        "type": "sys.chat",
        "label": "取消楼栋",
        "message": "取消楼栋限制，日期保持2026-09-03，节次保持第3-4节，其他条件不变",
        "intentHint": "classroom_find"
      },
      {
        "id": "classroom-change-period",
        "type": "sys.chat",
        "label": "换时段",
        "message": "换一个时段再找空教室，日期保持2026-09-03，其他条件不变",
        "intentHint": "classroom_find"
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null,
    "footerText": "数据源：空教室工具 · competition-demo-v1"
  },
  "conflict-compare": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "conflict",
    "success": true,
    "queryId": "q-r48-conflict-compare",
    "dataVersion": "competition-demo-v1",
    "title": "教师003 vs 教师009 · 课程冲突比较",
    "subtitle": "双对象时间比较",
    "timeText": "第1周 · 周五",
    "statusText": "已核验",
    "filters": [],
    "summary": {
      "conflictCount": 1,
      "rushWarningCount": 1,
      "selfCompare": false,
      "firstBusySlots": 2,
      "secondBusySlots": 3
    },
    "items": [
      {
        "date": "2026-09-04",
        "weekdayName": "周五",
        "periodText": "第5-6节",
        "first": {
          "courseName": "高等数学A",
          "periodText": "第5-6节",
          "campusName": "校区A",
          "roomName": "A1-201"
        },
        "second": {
          "courseName": "操作系统",
          "periodText": "第5-6节",
          "campusName": "校区A",
          "roomName": "A1-201"
        }
      }
    ],
    "rushWarnings": [
      {
        "entity": "教师009",
        "date": "2026-09-04",
        "weekdayName": "周五",
        "gapMinutes": 20,
        "from": {
          "courseName": "操作系统",
          "periodText": "第5-6节",
          "campusName": "校区A",
          "roomName": "A1-201"
        },
        "to": {
          "courseName": "专业导论",
          "periodText": "第9-10节",
          "campusName": "校区B",
          "roomName": "B1-105"
        }
      }
    ],
    "actions": [
      {
        "id": "conflict-first-schedule",
        "type": "sys.chat",
        "label": "查看教师003课表",
        "message": "查询教师003第1周的课表",
        "intentHint": "schedule_week",
        "entityName": "教师003",
        "week": 1
      },
      {
        "id": "conflict-second-schedule",
        "type": "sys.chat",
        "label": "查看教师009课表",
        "message": "查询教师009第1周的课表",
        "intentHint": "schedule_week",
        "entityName": "教师009",
        "week": 1
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null,
    "footerText": "数据源：冲突比较工具 · competition-demo-v1"
  },
  "conflict-self": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "conflict",
    "success": true,
    "queryId": "q-r48-conflict-self",
    "dataVersion": "competition-demo-v1",
    "title": "教师009 · 课程安排风险检查",
    "subtitle": "单对象排课风险",
    "timeText": "第1周 · 周一",
    "statusText": "已核验",
    "filters": [],
    "summary": {
      "conflictCount": 0,
      "rushWarningCount": 1,
      "selfCompare": true,
      "firstBusySlots": 3,
      "secondBusySlots": 3
    },
    "items": [],
    "rushWarnings": [
      {
        "entity": "教师009",
        "date": "2026-08-31",
        "weekdayName": "周一",
        "gapMinutes": 20,
        "from": {
          "courseName": "操作系统",
          "periodText": "第3-4节",
          "campusName": "校区A",
          "roomName": "A1-201"
        },
        "to": {
          "courseName": "编译原理",
          "periodText": "第5-6节",
          "campusName": "校区B",
          "roomName": "B1-102"
        }
      }
    ],
    "actions": [
      {
        "id": "conflict-self-day",
        "type": "sys.chat",
        "label": "查看当天课表",
        "message": "查询教师009第1周周一的课",
        "intentHint": "schedule_day",
        "entityName": "教师009",
        "week": 1,
        "weekday": 1
      },
      {
        "id": "conflict-self-week",
        "type": "sys.chat",
        "label": "查看整周课表",
        "message": "查询教师009第1周的课表",
        "intentHint": "schedule_week",
        "entityName": "教师009",
        "week": 1
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null,
    "footerText": "数据源：冲突比较工具 · competition-demo-v1"
  },
  "conflict-safe": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "conflict",
    "success": true,
    "queryId": "q-r48-conflict-safe",
    "dataVersion": "competition-demo-v1",
    "title": "教师003 · 课程安排风险检查",
    "subtitle": "单对象排课风险",
    "timeText": "第1周 · 周二",
    "statusText": "已核验",
    "filters": [],
    "summary": {
      "conflictCount": 0,
      "rushWarningCount": 0,
      "selfCompare": true,
      "firstBusySlots": 2,
      "secondBusySlots": 2
    },
    "items": [],
    "rushWarnings": [],
    "actions": [
      {
        "id": "conflict-self-day",
        "type": "sys.chat",
        "label": "查看当天课表",
        "message": "查询教师003第1周周二的课",
        "intentHint": "schedule_day",
        "entityName": "教师003",
        "week": 1,
        "weekday": 2
      },
      {
        "id": "conflict-self-week",
        "type": "sys.chat",
        "label": "查看整周课表",
        "message": "查询教师003第1周的课表",
        "intentHint": "schedule_week",
        "entityName": "教师003",
        "week": 1
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null,
    "footerText": "数据源：冲突比较工具 · competition-demo-v1"
  },
  "day-plan": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "day_plan",
    "success": true,
    "queryId": "q-r48-day-plan",
    "dataVersion": "competition-demo-v1",
    "title": "2026-09-04 · 一天安排",
    "subtitle": "今日校园计划",
    "timeText": "2026-09-04 · 周五",
    "statusText": "已核验",
    "filters": [],
    "summary": {
      "lessonCount": 2,
      "gapCount": 2,
      "studySuggestionCount": 2,
      "hasCrossCampus": true
    },
    "items": [
      {
        "type": "lesson",
        "lessonId": "les-401",
        "courseName": "思政通识",
        "periodText": "第1-2节",
        "startTime": "08:00",
        "endTime": "09:40",
        "campusName": "校区A",
        "roomName": "A1-201",
        "teachers": [
          "教师007"
        ],
        "suggestion": "",
        "studyRooms": []
      },
      {
        "type": "gap",
        "lessonId": "",
        "courseName": "",
        "periodText": "第3-4节",
        "startTime": "10:00",
        "endTime": "11:40",
        "campusName": "",
        "roomName": "",
        "teachers": [],
        "suggestion": "空闲时段，可安排自习",
        "studyRooms": [
          "A1-203（60人）",
          "A1-205（60人）"
        ]
      },
      {
        "type": "lesson",
        "lessonId": "les-402",
        "courseName": "大学物理B",
        "periodText": "第5-6节",
        "startTime": "14:00",
        "endTime": "15:40",
        "campusName": "校区B",
        "roomName": "B1-201",
        "teachers": [
          "教师004"
        ],
        "suggestion": "",
        "studyRooms": []
      },
      {
        "type": "risk",
        "lessonId": "",
        "courseName": "",
        "periodText": "午间转场",
        "startTime": "11:40",
        "endTime": "14:00",
        "campusName": "",
        "roomName": "",
        "teachers": [],
        "suggestion": "上午在校区A、下午在校区B，注意午间跨校区转场时间",
        "studyRooms": []
      },
      {
        "type": "gap",
        "lessonId": "",
        "courseName": "",
        "periodText": "第7-8节",
        "startTime": "16:00",
        "endTime": "17:40",
        "campusName": "",
        "roomName": "",
        "teachers": [],
        "suggestion": "空闲时段，可安排自习",
        "studyRooms": [
          "B1-301（45人）"
        ]
      }
    ],
    "rushWarnings": [],
    "actions": [
      {
        "id": "day-plan-next-day",
        "type": "sys.chat",
        "label": "下一天",
        "message": "基于2026-09-04继续安排下一天，其他偏好不变",
        "intentHint": "day_plan"
      },
      {
        "id": "day-plan-campus-pref",
        "type": "sys.chat",
        "label": "换校区偏好",
        "message": "重新安排2026-09-04的一天，我想换校区偏好",
        "intentHint": "day_plan",
        "date": "2026-09-04"
      },
      {
        "id": "day-plan-study-2",
        "type": "sys.chat",
        "label": "连续自习2节",
        "message": "安排2026-09-04的一天，希望连续自习2节",
        "intentHint": "day_plan",
        "date": "2026-09-04"
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null,
    "footerText": "数据源：今日计划工具 · competition-demo-v1"
  },
  "campus-overview": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "campus_overview",
    "success": true,
    "queryId": "q-r48-campus-overview",
    "dataVersion": "competition-demo-v1",
    "title": "未来四周 · 校园教学态势",
    "subtitle": "校园运行概览",
    "timeText": "2026-08-25 ～ 2026-09-27",
    "statusText": "已核验",
    "filters": [],
    "summary": {
      "lessonOccurrences": 126,
      "teacherCount": 8,
      "roomCount": 22,
      "campusCount": 2,
      "weekCount": 4
    },
    "items": [],
    "rushWarnings": [],
    "actions": [
      {
        "id": "overview-top1-schedule",
        "type": "sys.chat",
        "label": "查看Top1课表",
        "message": "查询教师002第1周的课表",
        "intentHint": "schedule_week",
        "entityType": "teacher",
        "entityName": "教师002",
        "week": 1
      },
      {
        "id": "overview-top1-risk",
        "type": "sys.chat",
        "label": "检查Top1风险",
        "message": "检查教师002第1周是否存在时间冲突或跨校区赶场",
        "intentHint": "schedule_risk_check",
        "entityType": "teacher",
        "entityName": "教师002",
        "week": 1
      },
      {
        "id": "overview-classroom",
        "type": "sys.chat",
        "label": "查空教室",
        "message": "查找第1周校园空教室",
        "intentHint": "classroom_find",
        "week": 1
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null,
    "phaseText": "2026-08-25～2026-08-30 准备期无教学安排 · 2026-08-31 起进入教学周",
    "metrics": [
      {
        "id": "lessons",
        "label": "课程总量",
        "value": "126 次"
      },
      {
        "id": "busiest-campus",
        "label": "最忙校区",
        "value": "校区A"
      },
      {
        "id": "top-teacher",
        "label": "高负载教师",
        "value": "教师002"
      },
      {
        "id": "rush",
        "label": "跨校区赶场",
        "value": "8 起"
      }
    ],
    "weeks": [
      {
        "label": "W1",
        "count": 31
      },
      {
        "label": "W2",
        "count": 32
      },
      {
        "label": "W3",
        "count": 31
      },
      {
        "label": "W4",
        "count": 32
      }
    ],
    "campuses": [
      {
        "campusName": "校区A",
        "occurrences": 76,
        "loadText": "校区A · 76 次课程 · 占用率 6.3%",
        "freeText": "可用教室时段 2248 · ≥60人资源可用率 93.3%"
      },
      {
        "campusName": "校区B",
        "occurrences": 50,
        "loadText": "校区B · 50 次课程 · 占用率 6.3%",
        "freeText": "可用教室时段 1500 · ≥60人资源可用率 93.4%"
      }
    ],
    "topTeachers": [
      {
        "teacherName": "教师002",
        "loadText": "24 次课程 · 48 节次"
      },
      {
        "teacherName": "教师003",
        "loadText": "20 次课程 · 40 节次"
      },
      {
        "teacherName": "教师001",
        "loadText": "16 次课程 · 32 节次"
      }
    ],
    "top1": {
      "teacherName": "教师002",
      "loadText": "24 次课程 · 48 节次",
      "week": 1
    },
    "risks": {
      "conflictCount": 0,
      "rushCount": 8,
      "continuousLoadCount": 24,
      "summaryText": "时间冲突 0 · 跨校区赶场 8 · 连续课负载 24",
      "peakText": "高峰：第1周周三第5节 · 3 次课程"
    },
    "footerText": "数据源：校园教学态势工具 · competition-demo-v1"
  },
  "choice": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "choice",
    "success": false,
    "queryId": "q-r48-choice",
    "dataVersion": "competition-demo-v1",
    "title": "找到多个匹配，请确认一个",
    "subtitle": "选择后继续刚才的任务，不需要重新输入",
    "timeText": "",
    "statusText": "请确认对象",
    "filters": [],
    "summary": {},
    "items": [
      {
        "key": "choice-1",
        "name": "教师003",
        "typeLabel": "教师",
        "description": "第1周有 5 次课程",
        "message": "选择教师003，继续刚才的课表查询"
      },
      {
        "key": "choice-2",
        "name": "教师009",
        "typeLabel": "教师",
        "description": "第1周有 7 次课程",
        "message": "选择教师009，继续刚才的课表查询"
      },
      {
        "key": "choice-3",
        "name": "教师030",
        "typeLabel": "教师",
        "description": "第1周有 2 次课程",
        "message": "选择教师030，继续刚才的课表查询"
      }
    ],
    "rushWarnings": [],
    "actions": [
      {
        "id": "choice-rephrase",
        "type": "sys.chat",
        "label": "重新描述",
        "message": "我重新描述一下查询对象",
        "intentHint": "rephrase"
      }
    ],
    "interaction": {
      "waitForUser": true
    },
    "evidence": {
      "verified": false
    },
    "error": {
      "code": "AMBIGUOUS_ENTITY"
    }
  },
  "recovery-range": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "recovery",
    "success": false,
    "queryId": "q-r48-recovery-range",
    "dataVersion": "competition-demo-v1",
    "title": "这个日期超出了当前学期可查询范围",
    "subtitle": "任务恢复 · 事实未核验时不展示推测结果",
    "timeText": "",
    "statusText": "任务恢复",
    "filters": [],
    "summary": {},
    "items": [],
    "rushWarnings": [],
    "actions": [
      {
        "id": "recovery-semester-range",
        "type": "sys.chat",
        "label": "查看学期范围",
        "message": "本学期可查询的日期范围是什么",
        "intentHint": "semester_range"
      },
      {
        "id": "recovery-first-week",
        "type": "sys.chat",
        "label": "改到开学第一周",
        "message": "查询开学第1周的安排",
        "intentHint": "schedule_week",
        "week": 1
      }
    ],
    "interaction": {
      "waitForUser": true
    },
    "evidence": {
      "verified": false
    },
    "error": {
      "code": "OUT_OF_RANGE"
    },
    "reasonText": "这个日期超出了当前学期可查询范围",
    "keptFilters": [
      {
        "id": "date",
        "label": "2027-03-01",
        "value": "2027-03-01"
      }
    ],
    "footerText": "未核验状态下不展示任何推测性校园事实"
  },
  "recovery-tool": {
    "schemaVersion": "campus-widget/v3",
    "cardType": "recovery",
    "success": false,
    "queryId": "q-r48-recovery-tool",
    "dataVersion": "competition-demo-v1",
    "title": "校园工具暂时没有返回可核验结果",
    "subtitle": "任务恢复 · 事实未核验时不展示推测结果",
    "timeText": "",
    "statusText": "任务恢复",
    "filters": [],
    "summary": {},
    "items": [],
    "rushWarnings": [],
    "actions": [
      {
        "id": "recovery-retry",
        "type": "sys.chat",
        "label": "重试",
        "message": "重新执行刚才的查询",
        "intentHint": "retry"
      },
      {
        "id": "recovery-edit-query",
        "type": "sys.chat",
        "label": "修改条件",
        "message": "我想修改刚才的查询条件",
        "intentHint": "rephrase"
      }
    ],
    "interaction": {
      "waitForUser": true
    },
    "evidence": {
      "verified": false
    },
    "error": {
      "code": "TIMEOUT"
    },
    "reasonText": "校园工具暂时没有返回可核验结果",
    "keptFilters": [
      {
        "id": "campus",
        "label": "校区A",
        "value": "校区A"
      },
      {
        "id": "date",
        "label": "2026-09-03",
        "value": "2026-09-03"
      },
      {
        "id": "period",
        "label": "第7-8节",
        "value": "第7-8节"
      }
    ],
    "footerText": "未核验状态下不展示任何推测性校园事实"
  }
};
