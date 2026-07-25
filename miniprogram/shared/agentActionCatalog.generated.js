// Generated from server/config/agent-capability-manifest.json. Do not edit by hand.
// Action Command Catalog: 模型只能引用此处定义的 Action，执行策略由 confirmation 字段决定。
const ACTION_CATALOG = Object.freeze({
  "navigate": {
    "displayName": "页面跳转",
    "description": "跳转到白名单内的小程序页面，禁止任意 URL",
    "operation": "read",
    "confirmation": "none",
    "safetyLevel": "low",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "page_url_whitelist",
    "allowedPages": [
      "/pages/school/school",
      "/pages/today/today",
      "/pages/empty-room/empty-room",
      "/pages/schedule-view/schedule-view",
      "/pages/personal-sync/personal-sync",
      "/packageXiaofu/pages/ai-assistant/ai-assistant",
      "/packageMaps/pages/campus-map/campus-map",
      "/pages/ai-assistant/ai-assistant",
      "/pages/campus-map/campus-map"
    ],
    "tabPages": [
      "/pages/school/school",
      "/pages/today/today"
    ],
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "url"
      ],
      "properties": {
        "url": {
          "type": "string",
          "maxLength": 240
        },
        "params": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 120
          },
          "maxProperties": 8
        }
      }
    }
  },
  "openSheet": {
    "displayName": "打开面板",
    "description": "打开助手内的提醒、记忆、对话或工具面板",
    "operation": "read",
    "confirmation": "none",
    "safetyLevel": "low",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "sheet_enum_whitelist",
    "allowedSheets": [
      "reminders",
      "memory",
      "conversations",
      "tasks"
    ],
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sheet"
      ],
      "properties": {
        "sheet": {
          "type": "string",
          "enum": [
            "reminders",
            "memory",
            "conversations",
            "tasks"
          ]
        }
      }
    }
  },
  "fillComposer": {
    "displayName": "填入待发送文本",
    "description": "把文本填入输入框，绝不自动发送",
    "operation": "read",
    "confirmation": "none",
    "safetyLevel": "low",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "none",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "text"
      ],
      "properties": {
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      }
    }
  },
  "fillForm": {
    "displayName": "填写表单字段",
    "description": "填写白名单表单字段，绝不自动提交",
    "operation": "read",
    "confirmation": "none",
    "safetyLevel": "medium",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "form_field_whitelist",
    "allowedForms": [
      "reminder_create",
      "personal_import_help",
      "preference"
    ],
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "form",
        "fields"
      ],
      "properties": {
        "form": {
          "type": "string",
          "enum": [
            "reminder_create",
            "personal_import_help",
            "preference"
          ]
        },
        "fields": {
          "type": "object",
          "additionalProperties": {
            "type": [
              "string",
              "integer",
              "boolean"
            ]
          },
          "maxProperties": 12
        }
      }
    }
  },
  "requestSubscribe": {
    "displayName": "请求订阅授权",
    "description": "请求微信订阅消息授权，仅用于课程提醒",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "high",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "subscribe_scene_whitelist",
    "allowedScenes": [
      "course_reminder"
    ],
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "scene"
      ],
      "properties": {
        "scene": {
          "type": "string",
          "enum": [
            "course_reminder"
          ]
        }
      }
    }
  },
  "confirmWrite": {
    "displayName": "写操作确认",
    "description": "展示写操作确认卡，由用户明确点击后才执行",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "high",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "write_intent_whitelist",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "intent",
        "summary"
      ],
      "properties": {
        "intent": {
          "type": "string",
          "maxLength": 80
        },
        "summary": {
          "type": "string",
          "minLength": 2,
          "maxLength": 240
        },
        "dangerLevel": {
          "type": "string",
          "enum": [
            "normal",
            "high"
          ]
        }
      }
    }
  },
  "copy": {
    "displayName": "复制结果",
    "description": "把文本结果复制到剪贴板",
    "operation": "read",
    "confirmation": "none",
    "safetyLevel": "low",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "none",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "text"
      ],
      "properties": {
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000
        }
      }
    }
  },
  "retry": {
    "displayName": "重试安全任务",
    "description": "重新执行一个原本就安全的只读任务",
    "operation": "read",
    "confirmation": "none",
    "safetyLevel": "medium",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "retryable_task_whitelist",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "taskId"
      ],
      "properties": {
        "taskId": {
          "type": "string",
          "minLength": 4,
          "maxLength": 120
        }
      }
    }
  },
  "setCurrentSchedule": {
    "displayName": "设置首页课表",
    "description": "将指定班级课表设为首页当前课表；客户端执行真实切换后必须回传回执，服务端收到成功回执才提交记忆与最终答复；载荷只携带目标描述，不携带整份课程",
    "operation": "write",
    "confirmation": "explicit_user_command",
    "safetyLevel": "medium",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "schedule_target_whitelist",
    "receiptRequired": true,
    "idempotent": true,
    "clientHandler": "services/currentScheduleService#setNewCurrentScheduleTarget",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "detailId",
        "name"
      ],
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "class"
          ]
        },
        "detailId": {
          "type": "string",
          "minLength": 8,
          "maxLength": 80
        },
        "name": {
          "type": "string",
          "minLength": 2,
          "maxLength": 80
        },
        "term": {
          "type": "string",
          "maxLength": 20
        },
        "releaseVersion": {
          "type": "string",
          "maxLength": 40
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "appliedTarget": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "type": {
              "type": "string"
            },
            "detailId": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "term": {
              "type": "string"
            }
          }
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "显式指令切换成功",
        "given": "目标 detailId+name 存在于当前索引，explicitCommand=true",
        "expect": "客户端切换并回执 success；服务端校验索引后提交 currentScheduleTarget 记忆"
      },
      {
        "name": "目标不在索引拒绝",
        "given": "detailId 不存在于 readActiveIndex",
        "expect": "SCHEDULE_TARGET_NOT_FOUND；不生成 action；不声称成功"
      }
    ]
  },
  "importStudentSchedule": {
    "displayName": "导入个人课表",
    "description": "通过 personal-sync 页既有导入链路完成个人课表导入；学号/密码凭据永远由页面表单直接持有，不进入 Action 载荷与智能体上下文",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "high",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "personal_import_session",
    "receiptRequired": true,
    "idempotent": false,
    "clientHandler": "pages/personal-sync/personal-sync#confirmStudentImport",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [],
      "properties": {
        "term": {
          "type": "string",
          "maxLength": 20
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "importedCount": {
          "type": "integer",
          "minimum": 0
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "凭据缺失引导打开页面",
        "given": "用户未在 personal-sync 页填写学号/密码",
        "expect": "生成 navigate action 引导至 /pages/personal-sync/personal-sync，不生成 importStudentSchedule action"
      },
      {
        "name": "导入成功回执",
        "given": "页面内凭据有效且预览确认",
        "expect": "客户端执行后回执 success+importedCount；无回执不声称导入成功"
      }
    ]
  },
  "resyncStudentSchedule": {
    "displayName": "重新同步个人课表",
    "description": "复用 personal-sync 页最近导入凭据重新同步个人课表",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "medium",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "personal_import_session",
    "receiptRequired": true,
    "idempotent": true,
    "clientHandler": "pages/personal-sync/personal-sync#resyncStudentImport",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [],
      "properties": {
        "term": {
          "type": "string",
          "maxLength": 20
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "updatedCount": {
          "type": "integer",
          "minimum": 0
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "有最近导入记录可重同步",
        "given": "存在 useRecentStudentImport 可用的历史凭据会话",
        "expect": "确认后执行 resyncStudentImport 并回执 updatedCount"
      },
      {
        "name": "无凭据降级引导",
        "given": "无最近导入记录",
        "expect": "引导至导入页，不执行同步"
      }
    ]
  },
  "saveCustomCourse": {
    "displayName": "保存自定义课程",
    "description": "保存一门自定义课程（新增或编辑），复用 custom-courses 页保存入口",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "medium",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "custom_course_whitelist",
    "receiptRequired": true,
    "idempotent": false,
    "clientHandler": "pages/custom-courses/custom-courses#saveCourse",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "weekday",
        "startSection",
        "endSection",
        "weeks"
      ],
      "properties": {
        "courseId": {
          "type": "string",
          "maxLength": 80
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        },
        "weekday": {
          "type": "integer",
          "minimum": 1,
          "maximum": 7
        },
        "startSection": {
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        },
        "endSection": {
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        },
        "weeks": {
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1,
            "maximum": 30
          },
          "maxItems": 30
        },
        "room": {
          "type": "string",
          "maxLength": 60
        },
        "teacher": {
          "type": "string",
          "maxLength": 40
        },
        "color": {
          "type": "string",
          "maxLength": 20
        },
        "enabled": {
          "type": "boolean"
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "courseId": {
          "type": "string",
          "maxLength": 80
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "字段完整保存成功",
        "given": "name/weekday/sections/weeks 齐全且 endSection>=startSection",
        "expect": "确认后保存并回执 courseId"
      },
      {
        "name": "缺必填字段拒绝",
        "given": "缺 weeks 或 name",
        "expect": "stableActionCommands 过滤该 action，转为澄清提问"
      }
    ]
  },
  "deleteCustomCourse": {
    "displayName": "删除自定义课程",
    "description": "删除指定自定义课程，幂等",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "medium",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "custom_course_whitelist",
    "receiptRequired": true,
    "idempotent": true,
    "clientHandler": "pages/custom-courses/custom-courses#deleteCourse",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "courseId"
      ],
      "properties": {
        "courseId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "删除存在课程",
        "given": "courseId 存在于本地自定义课程列表",
        "expect": "确认卡展示课程名，确认后删除并回执"
      },
      {
        "name": "重复删除幂等",
        "given": "courseId 已不存在",
        "expect": "回执 success（幂等）或 COURSE_NOT_FOUND，不崩溃"
      }
    ]
  },
  "saveStudentArrangement": {
    "displayName": "保存调课编辑",
    "description": "保存 personal-sync 页学生课表调课编辑（单条安排的节次/教室/周次调整）",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "medium",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "personal_arrangement_whitelist",
    "receiptRequired": true,
    "idempotent": false,
    "clientHandler": "pages/personal-sync/personal-sync#saveStudentArrangementEdit",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "arrangementKey"
      ],
      "properties": {
        "arrangementKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "weekday": {
          "type": "integer",
          "minimum": 1,
          "maximum": 7
        },
        "startSection": {
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        },
        "endSection": {
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        },
        "room": {
          "type": "string",
          "maxLength": 60
        },
        "weekText": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "arrangementKey": {
          "type": "string",
          "maxLength": 120
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "编辑后保存",
        "given": "arrangementKey 对应已导入个人课表中的一条安排",
        "expect": "确认后保存修改并回执"
      },
      {
        "name": "无个人课表拒绝",
        "given": "未导入个人课表",
        "expect": "引导先导入，不生成 action"
      }
    ]
  },
  "clearLocalCache": {
    "displayName": "清除本地缓存",
    "description": "清除本地课表/版本缓存，不触碰登录态与个人课表数据；大范围清除等价于设置页 diagnoseClearAllCaches",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "medium",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "cache_scope_whitelist",
    "receiptRequired": false,
    "idempotent": true,
    "clientHandler": "pages/settings/settings#clearCache",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "scope"
      ],
      "properties": {
        "scope": {
          "type": "string",
          "enum": [
            "schedule_cache",
            "release_cache",
            "all"
          ]
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "clearedKeys": {
          "type": "integer",
          "minimum": 0
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "清除课表缓存",
        "given": "scope=schedule_cache",
        "expect": "确认后仅清除课表缓存键，保留登录态"
      },
      {
        "name": "scope 非法拒绝",
        "given": "scope 不在枚举内",
        "expect": "stableActionCommands 过滤该 action"
      }
    ]
  },
  "resetToNewUser": {
    "displayName": "重置为新用户",
    "description": "清空本地全部用户数据回到新用户状态，高危不可逆",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "high",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "local_data_reset",
    "receiptRequired": false,
    "idempotent": true,
    "clientHandler": "pages/settings/settings#resetToNewUser",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [],
      "properties": {
        "keepLogin": {
          "type": "boolean"
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "确认卡强确认",
        "given": "任何触发路径",
        "expect": "必须展示高危确认卡；不允许 explicit_user_command 直触"
      },
      {
        "name": "重置后回到引导",
        "given": "用户确认",
        "expect": "本地数据清空并导航到班级选择引导"
      }
    ]
  },
  "submitFeedback": {
    "displayName": "提交意见反馈",
    "description": "向服务端提交用户意见反馈，复用设置页反馈入口",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "low",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "feedback_channel",
    "receiptRequired": true,
    "idempotent": false,
    "clientHandler": "pages/settings/settings#submitFeedback",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "content"
      ],
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "bug",
            "suggestion",
            "other"
          ]
        },
        "content": {
          "type": "string",
          "minLength": 2,
          "maxLength": 500
        },
        "contact": {
          "type": "string",
          "maxLength": 80
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "feedbackId": {
          "type": "string",
          "maxLength": 80
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "提交反馈成功",
        "given": "type+content 合法",
        "expect": "确认后提交并回执 feedbackId；无回执提示未确认提交状态"
      },
      {
        "name": "内容过短拒绝",
        "given": "content 长度<2",
        "expect": "stableActionCommands 过滤该 action，引导补充内容"
      }
    ]
  },
  "refreshBootstrapData": {
    "displayName": "刷新基础数据",
    "description": "刷新 release 清单/索引等基础数据，只读重建本地缓存",
    "operation": "read",
    "confirmation": "none",
    "safetyLevel": "low",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "bootstrap_refresh",
    "receiptRequired": false,
    "idempotent": true,
    "clientHandler": "pages/settings/settings#refreshBootstrapData",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [],
      "properties": {
        "include": {
          "type": "string",
          "enum": [
            "release_manifest",
            "indexes",
            "all"
          ]
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "releaseVersion": {
          "type": "string",
          "maxLength": 40
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "刷新成功",
        "given": "网络可用",
        "expect": "重建本地缓存并返回最新 releaseVersion"
      },
      {
        "name": "刷新失败保留旧数据",
        "given": "网络不可用",
        "expect": "last-known-good 不破坏，errorCode 标示失败原因"
      }
    ]
  },
  "createCourseReminder": {
    "displayName": "创建课程提醒",
    "description": "创建课程上课提醒，复用提醒面板创建入口；订阅消息授权由 requestSubscribe 动作独立完成",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "medium",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "reminder_whitelist",
    "receiptRequired": true,
    "idempotent": false,
    "clientHandler": "packageXiaofu/components/xiaofu-reminder-sheet/index#onConfirmCreate",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "leadMinutes",
        "scope"
      ],
      "properties": {
        "courseName": {
          "type": "string",
          "maxLength": 60
        },
        "weekday": {
          "type": "integer",
          "minimum": 1,
          "maximum": 7
        },
        "startSection": {
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        },
        "leadMinutes": {
          "type": "integer",
          "minimum": 5,
          "maximum": 120
        },
        "scope": {
          "type": "string",
          "enum": [
            "single",
            "all"
          ]
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "reminderId": {
          "type": "string",
          "maxLength": 80
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "创建成功回执",
        "given": "leadMinutes/scope 合法且已登录",
        "expect": "确认后创建并回执 reminderId"
      },
      {
        "name": "未登录降级",
        "given": "无会话",
        "expect": "引导登录，不生成 action"
      }
    ]
  },
  "deleteReminder": {
    "displayName": "删除课程提醒",
    "description": "删除指定课程提醒，幂等",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "medium",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "reminder_whitelist",
    "receiptRequired": true,
    "idempotent": true,
    "clientHandler": "packageXiaofu/components/xiaofu-reminder-sheet/index#onDelete",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "reminderId"
      ],
      "properties": {
        "reminderId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "删除存在提醒",
        "given": "reminderId 存在",
        "expect": "确认卡展示提醒概要，确认后删除并回执"
      },
      {
        "name": "重复删除幂等",
        "given": "reminderId 已不存在",
        "expect": "不崩溃，回执 success 或 REMINDER_NOT_FOUND"
      }
    ]
  },
  "clearAgentMemory": {
    "displayName": "清除小佛记忆",
    "description": "清除小佛助手记忆（本地/云端/全部），高危不可逆",
    "operation": "write",
    "confirmation": "required",
    "safetyLevel": "high",
    "runtimeModes": [
      "public",
      "trial",
      "dev"
    ],
    "targetPolicy": "agent_memory_scope",
    "receiptRequired": true,
    "idempotent": true,
    "clientHandler": "packageXiaofu/components/xiaofu-memory-sheet/index#onClearLocal",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "scope"
      ],
      "properties": {
        "scope": {
          "type": "string",
          "enum": [
            "local",
            "cloud",
            "all"
          ]
        },
        "conversationId": {
          "type": "string",
          "maxLength": 80
        }
      }
    },
    "resultSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "success"
      ],
      "properties": {
        "success": {
          "type": "boolean"
        },
        "clearedScope": {
          "type": "string",
          "maxLength": 20
        },
        "errorCode": {
          "type": "string",
          "maxLength": 60
        }
      }
    },
    "testCases": [
      {
        "name": "高危确认卡",
        "given": "任何触发路径",
        "expect": "必须 required 确认卡；清除后记忆面板显示为空并回执 clearedScope"
      },
      {
        "name": "scope 非法拒绝",
        "given": "scope 不在枚举内",
        "expect": "stableActionCommands 过滤该 action"
      }
    ]
  }
});

// 卡片按钮类型 → Action Command 映射（null 表示协议层特殊类型，不进入 Command Bus）
const CARD_ACTION_TO_COMMAND = Object.freeze({
  "navigate": "navigate",
  "switchTab": "navigate",
  "retry": "retry",
  "openSheet": "openSheet",
  "toggleFloat": "openSheet",
  "confirmReminder": "confirmWrite",
  "manageReminders": "openSheet",
  "ask": null,
  "noop": null
});

const ACTION_CONFIRMATION_REQUIRED = Object.freeze([
  "requestSubscribe",
  "confirmWrite",
  "importStudentSchedule",
  "resyncStudentSchedule",
  "saveCustomCourse",
  "deleteCustomCourse",
  "saveStudentArrangement",
  "clearLocalCache",
  "resetToNewUser",
  "submitFeedback",
  "createCourseReminder",
  "deleteReminder",
  "clearAgentMemory"
]);
const ACTION_DOUBLE_CONFIRMATION_REQUIRED = Object.freeze([]);

function getAction(id) {
  return ACTION_CATALOG[String(id || "")] || null;
}

function isAutoExecutable(id) {
  const action = getAction(id);
  return Boolean(action && action.confirmation === "none");
}

function isActionAllowedForRuntime(id, runtimeMode) {
  const action = getAction(id);
  const mode = String(runtimeMode || "public");
  return Boolean(action && Array.isArray(action.runtimeModes) && action.runtimeModes.includes(mode));
}

module.exports = {
  ACTION_CATALOG,
  CARD_ACTION_TO_COMMAND,
  ACTION_CONFIRMATION_REQUIRED,
  ACTION_DOUBLE_CONFIRMATION_REQUIRED,
  getAction,
  isAutoExecutable,
  isActionAllowedForRuntime,
};
