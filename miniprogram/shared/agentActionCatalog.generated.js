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
  "confirmWrite"
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
