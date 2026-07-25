// Generated from server/config/agent-capability-manifest.json. Do not edit by hand.
// LLM function-calling schema for Planner and Coze Tool Gateway. x-fosu-safety carries execution policy.
const TOOL_SCHEMAS = Object.freeze({
  "get_today_courses": {
    "name": "get_today_courses",
    "description": "get_today_courses",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_tomorrow_courses": {
    "name": "get_tomorrow_courses",
    "description": "get_tomorrow_courses",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_next_course": {
    "name": "get_next_course",
    "description": "get_next_course",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_week_schedule": {
    "name": "get_week_schedule",
    "description": "get_week_schedule",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_teaching_week": {
    "name": "get_teaching_week",
    "description": "get_teaching_week",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_term_calendar": {
    "name": "get_term_calendar",
    "description": "get_term_calendar",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "search_empty_rooms": {
    "name": "search_empty_rooms",
    "description": "search_empty_rooms",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "search_continuous_empty_rooms": {
    "name": "search_continuous_empty_rooms",
    "description": "search_continuous_empty_rooms",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "search_school_index": {
    "name": "search_school_index",
    "description": "search_school_index",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_schedule_detail": {
    "name": "get_schedule_detail",
    "description": "get_schedule_detail",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "diagnose_data_status": {
    "name": "diagnose_data_status",
    "description": "diagnose_data_status",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "explain_personal_import": {
    "name": "explain_personal_import",
    "description": "explain_personal_import",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "medium",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "recommend_meeting_time": {
    "name": "recommend_meeting_time",
    "description": "recommend_meeting_time",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "clarify_missing_slot": {
    "name": "clarify_missing_slot",
    "description": "clarify_missing_slot",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_campus_weather": {
    "name": "get_campus_weather",
    "description": "get_campus_weather",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_course_weather_advice": {
    "name": "get_course_weather_advice",
    "description": "get_course_weather_advice",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "search_campus_place": {
    "name": "search_campus_place",
    "description": "search_campus_place",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_campus_route": {
    "name": "get_campus_route",
    "description": "get_campus_route",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_classroom_location": {
    "name": "get_classroom_location",
    "description": "get_classroom_location",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "get_today_schedule": {
    "name": "get_today_schedule",
    "description": "get_today_schedule",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "date": {
          "type": "string",
          "maxLength": 10
        }
      }
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "medium",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 3000
    }
  },
  "get_course_route": {
    "name": "get_course_route",
    "description": "get_course_route",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "message": {
          "type": "string",
          "maxLength": 240
        },
        "from": {
          "type": "string",
          "maxLength": 40
        },
        "dateHint": {
          "type": "string",
          "maxLength": 20
        },
        "walkingBufferMinutes": {
          "type": "integer",
          "minimum": 5,
          "maximum": 90
        }
      }
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "medium",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 5000
    }
  },
  "inspect_schedule_conflicts": {
    "name": "inspect_schedule_conflicts",
    "description": "inspect_schedule_conflicts",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "week": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        }
      }
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "medium",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 3000
    }
  },
  "detect_schedule_changes": {
    "name": "detect_schedule_changes",
    "description": "detect_schedule_changes",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "medium",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 3000
    }
  },
  "navigate_miniprogram_page": {
    "name": "navigate_miniprogram_page",
    "description": "navigate_miniprogram_page",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "url"
      ],
      "properties": {
        "url": {
          "type": "string",
          "maxLength": 240
        }
      }
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 1000
    }
  },
  "create_course_reminder": {
    "name": "create_course_reminder",
    "description": "create_course_reminder",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "message"
      ],
      "properties": {
        "message": {
          "type": "string",
          "minLength": 2,
          "maxLength": 240
        },
        "leadMinutes": {
          "type": "integer",
          "minimum": 5,
          "maximum": 180
        },
        "scope": {
          "type": "string",
          "enum": [
            "all_courses",
            "date_course",
            "room_change"
          ]
        }
      }
    },
    "x-fosu-safety": {
      "operation": "write",
      "confirmation": "required",
      "safetyLevel": "high",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 3000
    }
  },
  "update_course_reminder": {
    "name": "update_course_reminder",
    "description": "update_course_reminder",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "reminderId"
      ],
      "properties": {
        "reminderId": {
          "type": "string",
          "minLength": 8,
          "maxLength": 80
        },
        "status": {
          "type": "string",
          "enum": [
            "enabled",
            "paused"
          ]
        },
        "leadMinutes": {
          "type": "integer",
          "minimum": 5,
          "maximum": 180
        }
      }
    },
    "x-fosu-safety": {
      "operation": "write",
      "confirmation": "required",
      "safetyLevel": "high",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 3000
    }
  },
  "delete_course_reminder": {
    "name": "delete_course_reminder",
    "description": "delete_course_reminder",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "reminderId": {
          "type": "string",
          "minLength": 8,
          "maxLength": 80
        },
        "weekday": {
          "type": "integer",
          "minimum": 1,
          "maximum": 7
        },
        "period": {
          "type": "string",
          "enum": [
            "morning",
            "afternoon",
            "evening"
          ]
        }
      }
    },
    "x-fosu-safety": {
      "operation": "write",
      "confirmation": "required",
      "safetyLevel": "high",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 3000
    }
  },
  "list_course_reminders": {
    "name": "list_course_reminders",
    "description": "list_course_reminders",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "medium",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 3000
    }
  },
  "update_user_preference": {
    "name": "update_user_preference",
    "description": "update_user_preference",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "preferredName": {
          "type": "string",
          "maxLength": 24
        },
        "campus": {
          "type": "string",
          "enum": [
            "仙溪校区",
            "江湾校区"
          ]
        },
        "defaultReminderLeadMinutes": {
          "type": "integer",
          "minimum": 5,
          "maximum": 180
        }
      }
    },
    "x-fosu-safety": {
      "operation": "write",
      "confirmation": "explicit_user_command",
      "safetyLevel": "medium",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 3000
    }
  },
  "rag_search": {
    "name": "rag_search",
    "description": "rag_search",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "low",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "generate_image": {
    "name": "generate_image",
    "description": "generate_image",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {}
    },
    "x-fosu-safety": {
      "operation": "read",
      "confirmation": "none",
      "safetyLevel": "medium",
      "runtimeModes": [
        "trial",
        "dev"
      ],
      "idempotent": false,
      "timeoutMs": 8000
    }
  },
  "set_current_schedule": {
    "name": "set_current_schedule",
    "description": "set_current_schedule",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "detailId",
        "name"
      ],
      "properties": {
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
    "x-fosu-safety": {
      "operation": "write",
      "confirmation": "explicit_user_command",
      "safetyLevel": "medium",
      "runtimeModes": [
        "public",
        "trial",
        "dev"
      ],
      "idempotent": true,
      "timeoutMs": 3000
    }
  }
});

function getToolSchema(name) {
  return TOOL_SCHEMAS[String(name || "")] || null;
}

function listToolSchemasForRuntime(runtimeMode) {
  const mode = String(runtimeMode || "public");
  return Object.values(TOOL_SCHEMAS).filter((schema) => schema["x-fosu-safety"].runtimeModes.includes(mode));
}

module.exports = {
  TOOL_SCHEMAS,
  getToolSchema,
  listToolSchemasForRuntime,
};
