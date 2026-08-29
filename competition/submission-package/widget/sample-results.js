window.CampusTaskSamples = {
  "schedule": {
    "schemaVersion": "campus-widget/v2",
    "cardType": "schedule",
    "success": true,
    "queryId": "q-sample-schedule",
    "dataVersion": "competition-demo-v1",
    "title": "教师001 · 课表",
    "subtitle": "",
    "timeText": "第1周 · 周三",
    "filters": [],
    "summary": {
      "totalCount": 2,
      "shownCount": 2,
      "hiddenCount": 0,
      "entityType": "teacher",
      "entityName": "教师001"
    },
    "items": [
      {
        "lessonId": "les-012",
        "courseName": "高等数学A",
        "periodText": "第1-2节",
        "startTime": "08:00",
        "endTime": "09:40",
        "date": "2026-09-02",
        "weekdayName": "周三",
        "campusName": "校区A",
        "building": "教学楼A1",
        "roomName": "A1-104",
        "teachers": [
          "教师001"
        ],
        "classes": [
          "2025级B班"
        ]
      },
      {
        "lessonId": "les-002",
        "courseName": "高等数学A",
        "periodText": "第3-4节",
        "startTime": "10:00",
        "endTime": "11:40",
        "date": "2026-09-02",
        "weekdayName": "周三",
        "campusName": "校区A",
        "building": "教学楼A1",
        "roomName": "A1-101",
        "teachers": [
          "教师001"
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
        "message": "查看教师001的整周课表"
      },
      {
        "id": "schedule-day",
        "type": "sys.chat",
        "label": "换一天",
        "message": "换一天看看教师001的课表"
      },
      {
        "id": "schedule-compare",
        "type": "sys.chat",
        "label": "比较冲突",
        "message": "把教师001和另一个对象比较一下有没有冲突"
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null
  },
  "classroom": {
    "schemaVersion": "campus-widget/v2",
    "cardType": "classroom",
    "success": true,
    "queryId": "q-sample-classroom",
    "dataVersion": "competition-demo-v1",
    "title": "校区A · 空教室",
    "subtitle": "",
    "timeText": "2026-08-31 · 第1-2节",
    "filters": [
      {
        "id": "campus",
        "label": "校区A",
        "value": "校区A"
      },
      {
        "id": "date",
        "label": "2026-08-31",
        "value": "2026-08-31"
      },
      {
        "id": "period",
        "label": "第1-2节",
        "value": "第1-2节"
      },
      {
        "id": "capacity",
        "label": "容量≥60",
        "value": 60
      }
    ],
    "summary": {
      "totalCount": 8,
      "shownCount": 5,
      "hiddenCount": 3,
      "empty": false
    },
    "items": [
      {
        "roomName": "A1-102",
        "campusName": "校区A",
        "building": "教学楼A1",
        "capacity": 60,
        "roomType": "多媒体",
        "periodText": "第1-2节",
        "date": "2026-08-31"
      },
      {
        "roomName": "A1-104",
        "campusName": "校区A",
        "building": "教学楼A1",
        "capacity": 60,
        "roomType": "普通",
        "periodText": "第1-2节",
        "date": "2026-08-31"
      },
      {
        "roomName": "A1-105",
        "campusName": "校区A",
        "building": "教学楼A1",
        "capacity": 60,
        "roomType": "普通",
        "periodText": "第1-2节",
        "date": "2026-08-31"
      },
      {
        "roomName": "A1-103",
        "campusName": "校区A",
        "building": "教学楼A1",
        "capacity": 80,
        "roomType": "多媒体",
        "periodText": "第1-2节",
        "date": "2026-08-31"
      },
      {
        "roomName": "A1-106",
        "campusName": "校区A",
        "building": "教学楼A1",
        "capacity": 80,
        "roomType": "多媒体",
        "periodText": "第1-2节",
        "date": "2026-08-31"
      }
    ],
    "rushWarnings": [],
    "actions": [
      {
        "id": "classroom-change-campus",
        "type": "sys.chat",
        "label": "换校区",
        "message": "那校区B呢"
      },
      {
        "id": "classroom-change-time",
        "type": "sys.chat",
        "label": "改时段",
        "message": "我想改一下查询时段"
      },
      {
        "id": "classroom-relax-capacity",
        "type": "sys.chat",
        "label": "放宽容量",
        "message": "放宽一下容量条件"
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null
  },
  "conflict": {
    "schemaVersion": "campus-widget/v2",
    "cardType": "conflict",
    "success": true,
    "queryId": "q-sample-conflict",
    "dataVersion": "competition-demo-v1",
    "title": "2025级A班 vs 2025级B班 · 课程冲突比较",
    "subtitle": "",
    "timeText": "第1周 · 周五下午",
    "filters": [],
    "summary": {
      "conflictCount": 1,
      "hasConflict": true,
      "firstBusySlots": 1,
      "secondBusySlots": 2,
      "selfCompare": false,
      "rushWarningCount": 0
    },
    "items": [
      {
        "date": "2026-09-04",
        "weekdayName": "周五",
        "periodStart": 5,
        "periodEnd": 6,
        "periodText": "第5-6节",
        "first": {
          "courseName": "大学物理B",
          "periodText": "第5-6节",
          "campusName": "校区A",
          "roomName": "A1-201"
        },
        "second": {
          "courseName": "大学物理B",
          "periodText": "第5-6节",
          "campusName": "校区A",
          "roomName": "A1-202"
        }
      }
    ],
    "rushWarnings": [],
    "actions": [
      {
        "id": "conflict-first-schedule",
        "type": "sys.chat",
        "label": "看第一方课表",
        "message": "查看2025级A班的课表"
      },
      {
        "id": "conflict-second-schedule",
        "type": "sys.chat",
        "label": "看第二方课表",
        "message": "查看2025级B班的课表"
      },
      {
        "id": "conflict-change-target",
        "type": "sys.chat",
        "label": "换对象比较",
        "message": "把2025级A班换一个对象继续比较冲突"
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null
  },
  "day_plan": {
    "schemaVersion": "campus-widget/v2",
    "cardType": "day_plan",
    "success": true,
    "queryId": "q-sample-day-plan",
    "dataVersion": "competition-demo-v1",
    "title": "2026-09-04 · 校园计划",
    "subtitle": "演示用户001 · 匿名赛事计划",
    "timeText": "2026-09-04 · 周五",
    "filters": [],
    "summary": {
      "lessonCount": 2,
      "gapCount": 1,
      "studySuggestionCount": 1,
      "hasCrossCampus": false
    },
    "items": [
      {
        "type": "lesson",
        "lessonId": "les-010",
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
          "实验楼A1-401（40人）",
          "A1-101（60人）"
        ]
      },
      {
        "type": "lesson",
        "lessonId": "les-007",
        "courseName": "大学物理B",
        "periodText": "第5-6节",
        "startTime": "14:00",
        "endTime": "15:40",
        "campusName": "校区A",
        "roomName": "A1-201",
        "teachers": [
          "教师004"
        ],
        "suggestion": "",
        "studyRooms": []
      }
    ],
    "rushWarnings": [],
    "actions": [
      {
        "id": "day-plan-next-day",
        "type": "sys.chat",
        "label": "看明天",
        "message": "那明天的安排呢"
      },
      {
        "id": "day-plan-classroom",
        "type": "sys.chat",
        "label": "找空教室",
        "message": "我空闲的时候有哪些空教室适合自习"
      },
      {
        "id": "day-plan-study-2",
        "type": "sys.chat",
        "label": "连续自习2节",
        "message": "那天想连续自习2节"
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": true
    },
    "error": null
  },
  "choice": {
    "schemaVersion": "campus-widget/v2",
    "cardType": "choice",
    "success": false,
    "queryId": "q-choice-demo",
    "dataVersion": "competition-demo-v1",
    "title": "找到多个匹配，请确认一个",
    "subtitle": "选择后会继续原任务，不需要重新输入",
    "timeText": "",
    "filters": [],
    "summary": {},
    "items": [
      {
        "key": "choice-1",
        "name": "2025级A班",
        "type": "class",
        "description": "",
        "action": {
          "id": "choice-1",
          "type": "sys.chat",
          "label": "选择2025级A班",
          "message": "选择2025级A班，继续刚才的课表查询"
        }
      },
      {
        "key": "choice-2",
        "name": "校区A",
        "type": "campus",
        "description": "",
        "action": {
          "id": "choice-2",
          "type": "sys.chat",
          "label": "选择校区A",
          "message": "选择校区A，继续刚才的课表查询"
        }
      },
      {
        "key": "choice-3",
        "name": "课程A",
        "type": "course",
        "description": "",
        "action": {
          "id": "choice-3",
          "type": "sys.chat",
          "label": "选择课程A",
          "message": "选择课程A，继续刚才的课表查询"
        }
      }
    ],
    "rushWarnings": [],
    "actions": [
      {
        "id": "choice-rephrase",
        "type": "sys.chat",
        "label": "重新描述",
        "message": "我重新描述一下查询对象"
      }
    ],
    "interaction": {
      "waitForUser": true
    },
    "evidence": {
      "verified": false
    },
    "error": {
      "code": "AMBIGUOUS_ENTITY",
      "message": "需要确认"
    }
  },
  "error": {
    "schemaVersion": "campus-widget/v2",
    "cardType": "error",
    "success": false,
    "queryId": "q-error-demo",
    "dataVersion": "competition-demo-v1",
    "title": "这次没有查成功",
    "subtitle": "动态事实未通过工具核验",
    "timeText": "",
    "filters": [],
    "summary": {},
    "items": [],
    "rushWarnings": [],
    "actions": [
      {
        "id": "error-retry",
        "type": "sys.chat",
        "label": "重新查询",
        "message": "重新执行刚才的查询"
      },
      {
        "id": "error-edit-query",
        "type": "sys.chat",
        "label": "修改条件",
        "message": "我想修改刚才的查询条件"
      }
    ],
    "interaction": {
      "waitForUser": false
    },
    "evidence": {
      "verified": false
    },
    "error": {
      "code": "TIMEOUT",
      "message": "工具查询超时，本次没有使用模型补造动态事实。"
    }
  }
};
